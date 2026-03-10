import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MonitoringService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [reservationGroups, seatGroups, recentActivity] = await Promise.all([
      this.prisma.reservation.groupBy({ by: ['status'], _count: { status: true } }),
      this.prisma.eventSeat.groupBy({ by: ['status'], _count: { status: true } }),
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

    const reservations = { pending: 0, confirmed: 0, cancelled: 0, rejected: 0, total: 0 };
    for (const g of reservationGroups) {
      reservations[g.status.toLowerCase() as keyof typeof reservations] = g._count.status;
      reservations.total += g._count.status;
    }

    const seats = { available: 0, held: 0, booked: 0, total: 0 };
    for (const g of seatGroups) {
      seats[g.status.toLowerCase() as keyof typeof seats] = g._count.status;
      seats.total += g._count.status;
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
      seats,
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
