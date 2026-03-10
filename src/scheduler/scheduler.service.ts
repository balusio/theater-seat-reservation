import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly gracePeriodMinutes: number;
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.gracePeriodMinutes = Number(
      this.config.get('RESERVATION_GRACE_PERIOD_MINUTES') ?? 2,
    );
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async expireReservations() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const graceDeadline = new Date(
        Date.now() - this.gracePeriodMinutes * 60 * 1000,
      );

      await this.prisma.$transaction(async (tx) => {
        const expired = await tx.reservation.findMany({
          where: { status: 'PENDING', expiresAt: { lte: graceDeadline } },
          select: { id: true },
        });

        if (expired.length === 0) return;

        const ids = expired.map((r) => r.id);

        await tx.reservation.updateMany({
          where: { id: { in: ids } },
          data: { status: 'REJECTED', rejectedAt: new Date() },
        });
        await tx.eventSeat.updateMany({
          where: { reservationSeats: { some: { reservationId: { in: ids } } } },
          data: { status: 'AVAILABLE' },
        });
        await tx.reservationSeat.updateMany({
          where: { reservationId: { in: ids } },
          data: { isActive: false },
        });
        await tx.auditLog.createMany({
          data: ids.map((id) => ({
            reservationId: id,
            entityType: 'Reservation',
            entityId: id,
            action: 'STATUS_CHANGED',
            previousStatus: 'PENDING',
            newStatus: 'REJECTED',
            triggeredBy: 'cron',
            metadata: { reason: 'reservation_timeout' },
          })),
        });

        this.logger.log(`Expired ${ids.length} reservations`);
      });
    } finally {
      this.isRunning = false;
    }
  }
}
