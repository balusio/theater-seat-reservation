import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SqsService } from '@ssut/nestjs-sqs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import {
  ReservationStatus,
  SeatStatus,
} from '../common/constants/state-machine';
import { transitionReservation } from '../common/helpers/transition-reservation';

@Injectable()
export class ReservationService {
  private readonly ttlMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsService: SqsService,
    private readonly config: ConfigService,
  ) {
    this.ttlMinutes = Number(this.config.get('RESERVATION_TTL_MINUTES') ?? 5);
  }

  async create(dto: CreateReservationDto) {
    return this.prisma.$transaction(async (tx) => {
      try {
        // Idempotency: check if this key already created a reservation
        const existing = await tx.reservation.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          include: {
            reservationSeats: {
              include: { eventSeat: { include: { seat: true } } },
            },
          },
        });
        if (existing) return existing;

        const locked = await tx.eventSeat.updateMany({
          where: {
            id: { in: dto.seatIds },
            eventId: dto.eventId,
            status: SeatStatus.AVAILABLE,
          },
          data: { status: SeatStatus.HELD },
        });

        if (locked.count !== dto.seatIds.length) {
          throw new ConflictException('One or more seats unavailable');
        }

        const reservation = await tx.reservation.create({
          data: {
            idempotencyKey: dto.idempotencyKey,
            eventId: dto.eventId,
            status: ReservationStatus.PENDING,
            expiresAt: new Date(Date.now() + this.ttlMinutes * 60 * 1000),
            reservationSeats: {
              create: dto.seatIds.map((id) => ({
                eventSeatId: id,
                isActive: true,
              })),
            },
          },
          include: {
            reservationSeats: {
              include: { eventSeat: { include: { seat: true } } },
            },
          },
        });

        await tx.auditLog.create({
          data: {
            reservationId: reservation.id,
            entityType: 'Reservation',
            entityId: reservation.id,
            action: 'CREATED',
            newStatus: ReservationStatus.PENDING,
            triggeredBy: 'api',
            metadata: { seatCount: dto.seatIds.length },
          },
        });

        return reservation;
      } catch (error) {
        if (
          error.code === 'P2002' &&
          error.meta?.target?.includes('idempotencyKey')
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
        reservationSeats: {
          include: { eventSeat: { include: { seat: true } } },
        },
      },
    });

    if (!reservation) throw new NotFoundException('Reservation not found');
    return reservation;
  }

  async enqueueConfirmation(reservationId: string, idempotencyKey: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
    });

    if (!reservation || reservation.status !== ReservationStatus.PENDING) {
      throw new ConflictException('Reservation is not pending');
    }

    await this.sqsService.send('reservation-confirm', {
      id: idempotencyKey,
      body: { reservationId, idempotencyKey },
    });

    return { status: 'processing' };
  }

  async confirm(reservationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const [reservation] = await tx.$queryRaw<any[]>`
        SELECT * FROM "Reservation"
        WHERE id = ${reservationId}::uuid
        AND status = ${ReservationStatus.PENDING}
        FOR UPDATE
      `;

      if (!reservation) {
        throw new ConflictException('Reservation not found or not pending');
      }

      await transitionReservation(
        tx,
        reservationId,
        ReservationStatus.PENDING,
        ReservationStatus.CONFIRMED,
        'worker',
      );
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

      const previousStatus = reservation.status as ReservationStatus;

      if (
        previousStatus !== ReservationStatus.PENDING &&
        previousStatus !== ReservationStatus.CONFIRMED
      ) {
        throw new ConflictException(
          `Cannot cancel reservation in ${previousStatus} status`,
        );
      }

      await transitionReservation(
        tx,
        reservationId,
        previousStatus,
        ReservationStatus.CANCELLED,
        'api',
        { reason: reason ?? 'user_initiated' },
        { reason },
      );

      return tx.reservation.findUnique({
        where: { id: reservationId },
        include: {
          reservationSeats: {
            include: { eventSeat: { include: { seat: true } } },
          },
        },
      });
    });
  }
}
