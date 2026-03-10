import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SqsService } from '@ssut/nestjs-sqs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReservationDto } from './dto/create-reservation.dto';

@Injectable()
export class ReservationService {
  private readonly ttlMinutes: number;
  private readonly gracePeriodMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsService: SqsService,
    private readonly config: ConfigService,
  ) {
    this.ttlMinutes = Number(this.config.get('RESERVATION_TTL_MINUTES') ?? 5);
    this.gracePeriodMinutes = Number(
      this.config.get('RESERVATION_GRACE_PERIOD_MINUTES') ?? 2,
    );
  }

  async create(dto: CreateReservationDto) {
    return this.prisma.$transaction(async (tx) => {
      try {
        const locked = await tx.eventSeat.updateMany({
          where: { id: { in: dto.seatIds }, status: 'AVAILABLE' },
          data: { status: 'HELD' },
        });

        if (locked.count !== dto.seatIds.length) {
          throw new ConflictException('One or more seats unavailable');
        }

        const reservation = await tx.reservation.create({
          data: {
            idempotencyKey: dto.idempotencyKey,
            eventId: dto.eventId,
            status: 'PENDING',
            expiresAt: new Date(Date.now() + this.ttlMinutes * 60 * 1000),
            reservationSeats: {
              create: dto.seatIds.map((id) => ({ eventSeatId: id, isActive: true })),
            },
          },
          include: {
            reservationSeats: { include: { eventSeat: { include: { seat: true } } } },
          },
        });

        await tx.auditLog.create({
          data: {
            reservationId: reservation.id,
            entityType: 'Reservation',
            entityId: reservation.id,
            action: 'CREATED',
            newStatus: 'PENDING',
            triggeredBy: 'api',
            metadata: { seatCount: dto.seatIds.length },
          },
        });

        return reservation;
      } catch (error) {
        if (
          error?.code === 'P2002' &&
          error?.meta?.target?.includes('idempotencyKey')
        ) {
          return tx.reservation.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
            include: {
              reservationSeats: {
                include: { eventSeat: { include: { seat: true } } },
              },
            },
          });
        }
        throw error;
      }
    });
  }

  async findOne(reservationId: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        reservationSeats: { include: { eventSeat: { include: { seat: true } } } },
      },
    });

    if (!reservation) throw new NotFoundException('Reservation not found');
    return reservation;
  }

  async enqueueConfirmation(reservationId: string, idempotencyKey: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
    });

    if (!reservation || reservation.status !== 'PENDING') {
      throw new ConflictException('Reservation is not pending');
    }

    await this.sqsService.send('reservation-confirm', {
      id: idempotencyKey,
      body: { reservationId, idempotencyKey },
    });

    return { status: 'processing' };
  }

  async confirm(reservationId: string) {
    const gracePeriodMs = this.gracePeriodMinutes * 60 * 1000;

    return this.prisma.$transaction(async (tx) => {
      const [reservation] = await tx.$queryRaw<any[]>`
        SELECT * FROM "Reservation"
        WHERE id = ${reservationId}::uuid
        AND status = 'PENDING'
        FOR UPDATE
      `;

      if (!reservation) {
        throw new ConflictException('Reservation not found or not pending');
      }

      const graceDeadline = new Date(
        new Date(reservation.expiresAt).getTime() + gracePeriodMs,
      );

      if (new Date() > graceDeadline) {
        await tx.reservation.update({
          where: { id: reservationId },
          data: { status: 'REJECTED', rejectedAt: new Date() },
        });
        await tx.eventSeat.updateMany({
          where: { reservationSeats: { some: { reservationId } } },
          data: { status: 'AVAILABLE' },
        });
        await tx.reservationSeat.updateMany({
          where: { reservationId },
          data: { isActive: false },
        });
        await tx.auditLog.create({
          data: {
            reservationId,
            entityType: 'Reservation',
            entityId: reservationId,
            action: 'STATUS_CHANGED',
            previousStatus: 'PENDING',
            newStatus: 'REJECTED',
            triggeredBy: 'worker',
            metadata: { reason: 'expired_during_confirmation' },
          },
        });
        throw new ConflictException('Reservation expired');
      }

      await tx.reservation.update({
        where: { id: reservationId },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      });
      await tx.eventSeat.updateMany({
        where: { reservationSeats: { some: { reservationId } } },
        data: { status: 'BOOKED' },
      });
      await tx.auditLog.create({
        data: {
          reservationId,
          entityType: 'Reservation',
          entityId: reservationId,
          action: 'STATUS_CHANGED',
          previousStatus: 'PENDING',
          newStatus: 'CONFIRMED',
          triggeredBy: 'worker',
        },
      });
    });
  }

  async cancel(reservationId: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const [reservation] = await tx.$queryRaw<any[]>`
        SELECT * FROM "Reservation"
        WHERE id = ${reservationId}::uuid
        FOR UPDATE
      `;

      if (!reservation) {
        throw new NotFoundException('Reservation not found');
      }

      const validFrom = ['PENDING', 'CONFIRMED'];
      if (!validFrom.includes(reservation.status)) {
        throw new ConflictException(
          `Cannot cancel reservation in ${reservation.status} status`,
        );
      }

      const previousStatus = reservation.status;

      await tx.reservation.update({
        where: { id: reservationId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason },
      });
      await tx.eventSeat.updateMany({
        where: { reservationSeats: { some: { reservationId } } },
        data: { status: 'AVAILABLE' },
      });
      await tx.reservationSeat.updateMany({
        where: { reservationId },
        data: { isActive: false },
      });
      await tx.auditLog.create({
        data: {
          reservationId,
          entityType: 'Reservation',
          entityId: reservationId,
          action: 'STATUS_CHANGED',
          previousStatus,
          newStatus: 'CANCELLED',
          triggeredBy: 'api',
          metadata: { reason: reason ?? 'user_initiated' },
        },
      });

      return this.prisma.reservation.findUnique({ where: { id: reservationId } });
    });
  }
}
