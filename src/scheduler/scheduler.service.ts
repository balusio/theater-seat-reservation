import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationStatus } from '../common/constants/state-machine';
import { transitionReservation } from '../common/helpers/transition-reservation';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private isRunning = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireReservations() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      await this.prisma.$transaction(async (tx) => {
        const expired = await tx.reservation.findMany({
          where: {
            status: ReservationStatus.PENDING,
            expiresAt: { lte: new Date() },
          },
          select: { id: true },
        });

        if (expired.length === 0) return;

        for (const { id } of expired) {
          await transitionReservation(
            tx,
            id,
            ReservationStatus.PENDING,
            ReservationStatus.REJECTED,
            'cron',
            { reason: 'reservation_timeout' },
          );
        }

        this.logger.log(`Expired ${expired.length} reservations`);
      });
    } finally {
      this.isRunning = false;
    }
  }
}
