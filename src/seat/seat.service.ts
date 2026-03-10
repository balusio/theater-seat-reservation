import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SeatStatus } from '@prisma/client';

const SECTION_PRICE_MAP: Record<string, number> = {
  orchestra: 150,
  mezzanine: 100,
  balcony: 60,
};

function getPriceForSection(sectionName: string): number {
  return SECTION_PRICE_MAP[sectionName.toLowerCase()] ?? 50;
}

@Injectable()
export class SeatService {
  constructor(private readonly prisma: PrismaService) {}

  async generateEventSeats(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        theater: {
          include: {
            sections: { include: { seats: true } },
          },
        },
      },
    });

    if (!event) throw new NotFoundException('Event not found');

    const seats = event.theater.sections.flatMap((section) =>
      section.seats.map((seat) => ({ seat, section })),
    );

    await this.prisma.$transaction(
      seats.map(({ seat, section }) =>
        this.prisma.eventSeat.upsert({
          where: { eventId_seatId: { eventId, seatId: seat.id } },
          update: {},
          create: {
            eventId,
            seatId: seat.id,
            status: 'AVAILABLE',
            price: getPriceForSection(section.name),
          },
        }),
      ),
    );

    return { generated: seats.length, eventId };
  }

  async findByEvent(eventId: string, status?: string, section?: string) {
    const where: Record<string, unknown> = { eventId };

    if (status) {
      where.status = status.toUpperCase() as SeatStatus;
    }
    if (section) {
      where.seat = { section: { name: { equals: section, mode: 'insensitive' } } };
    }

    const eventSeats = await this.prisma.eventSeat.findMany({
      where,
      include: { seat: { include: { section: true } } },
      orderBy: [
        { seat: { section: { name: 'asc' } } },
        { seat: { row: 'asc' } },
        { seat: { number: 'asc' } },
      ],
    });

    return eventSeats.reduce(
      (acc, es) => {
        const sectionName = es.seat.section.name;
        if (!acc[sectionName]) acc[sectionName] = [];
        acc[sectionName].push({
          id: es.id,
          row: es.seat.row,
          number: es.seat.number,
          label: es.seat.label,
          status: es.status,
          price: es.price,
        });
        return acc;
      },
      {} as Record<string, unknown[]>,
    );
  }

  async getStats(eventId: string) {
    const groups = await this.prisma.eventSeat.groupBy({
      by: ['status'],
      where: { eventId },
      _count: { status: true },
    });

    const counts = { available: 0, held: 0, booked: 0 };
    for (const g of groups) {
      counts[g.status.toLowerCase() as keyof typeof counts] = g._count.status;
    }

    return {
      eventId,
      ...counts,
      total: counts.available + counts.held + counts.booked,
    };
  }
}
