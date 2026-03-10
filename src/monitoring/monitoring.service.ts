import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MonitoringService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [reservationGroups, eventSeatGroups, events, recentActivity] =
      await Promise.all([
        this.prisma.reservation.groupBy({
          by: ['status'],
          _count: { status: true },
        }),
        this.prisma.eventSeat.groupBy({
          by: ['eventId', 'status'],
          _count: { status: true },
        }),
        this.prisma.event.findMany({
          select: { id: true, title: true, status: true },
        }),
        this.prisma.auditLog.findMany({
          take: 20,
          orderBy: { timestamp: 'desc' },
          select: {
            action: true,
            reservationId: true,
            previousStatus: true,
            newStatus: true,
            triggeredBy: true,
            timestamp: true,
            metadata: true,
          },
        }),
      ]);

    const reservations = {
      pending: 0,
      confirmed: 0,
      cancelled: 0,
      rejected: 0,
      total: 0,
    };
    for (const g of reservationGroups) {
      reservations[g.status.toLowerCase() as keyof typeof reservations] =
        g._count.status;
      reservations.total += g._count.status;
    }

    const eventMap = new Map(events.map((e) => [e.id, e]));

    const eventSeats: Array<{
      eventId: string;
      title: string;
      eventStatus: string;
      available: number;
      held: number;
      booked: number;
      total: number;
    }> = [];

    const grouped = new Map<
      string,
      { available: number; held: number; booked: number }
    >();
    for (const g of eventSeatGroups) {
      if (!grouped.has(g.eventId)) {
        grouped.set(g.eventId, { available: 0, held: 0, booked: 0 });
      }
      const entry = grouped.get(g.eventId)!;
      entry[g.status.toLowerCase() as keyof typeof entry] = g._count.status;
    }

    for (const [eventId, counts] of grouped) {
      const event = eventMap.get(eventId);
      eventSeats.push({
        eventId,
        title: event?.title ?? 'Unknown',
        eventStatus: event?.status ?? 'Unknown',
        ...counts,
        total: counts.available + counts.held + counts.booked,
      });
    }

    const mem = process.memoryUsage();

    return {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      },
      reservations,
      events: eventSeats,
      recentActivity: recentActivity.map((a) => ({
        action: a.action,
        reservationId: a.reservationId,
        previousStatus: a.previousStatus,
        newStatus: a.newStatus,
        triggeredBy: a.triggeredBy,
        timestamp: a.timestamp.toISOString(),
        metadata: a.metadata,
      })),
    };
  }
}
