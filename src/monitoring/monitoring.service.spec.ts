import { Test } from '@nestjs/testing';
import { MonitoringService } from './monitoring.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MonitoringService', () => {
  let service: MonitoringService;
  let prisma: jest.Mocked<any>;

  beforeEach(async () => {
    prisma = {
      reservation: {
        groupBy: jest.fn(),
      },
      eventSeat: {
        groupBy: jest.fn(),
      },
      auditLog: {
        findMany: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        MonitoringService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(MonitoringService);
  });

  it('should aggregate reservation and seat stats correctly', async () => {
    prisma.reservation.groupBy.mockResolvedValue([
      { status: 'PENDING', _count: { status: 3 } },
      { status: 'CONFIRMED', _count: { status: 5 } },
      { status: 'CANCELLED', _count: { status: 1 } },
      { status: 'REJECTED', _count: { status: 2 } },
    ]);
    prisma.eventSeat.groupBy.mockResolvedValue([
      { status: 'AVAILABLE', _count: { status: 100 } },
      { status: 'HELD', _count: { status: 3 } },
      { status: 'BOOKED', _count: { status: 5 } },
    ]);
    prisma.auditLog.findMany.mockResolvedValue([
      {
        action: 'CREATED',
        reservationId: 'res-1',
        previousStatus: null,
        newStatus: 'PENDING',
        triggeredBy: 'api',
        timestamp: new Date('2025-01-01'),
        metadata: {},
      },
    ]);

    const stats = await service.getStats();

    expect(stats.reservations).toEqual({
      pending: 3,
      confirmed: 5,
      cancelled: 1,
      rejected: 2,
      total: 11,
    });
    expect(stats.seats).toEqual({
      available: 100,
      held: 3,
      booked: 5,
      total: 108,
    });
    expect(stats.recentActivity).toHaveLength(1);
    expect(stats.recentActivity[0].action).toBe('CREATED');
    expect(stats.recentActivity[0].timestamp).toBe('2025-01-01T00:00:00.000Z');
    expect(stats.timestamp).toBeDefined();
    expect(stats.uptime).toBeGreaterThan(0);
    expect(stats.memory.rss).toBeGreaterThan(0);
  });

  it('should handle empty database gracefully', async () => {
    prisma.reservation.groupBy.mockResolvedValue([]);
    prisma.eventSeat.groupBy.mockResolvedValue([]);
    prisma.auditLog.findMany.mockResolvedValue([]);

    const stats = await service.getStats();

    expect(stats.reservations).toEqual({
      pending: 0,
      confirmed: 0,
      cancelled: 0,
      rejected: 0,
      total: 0,
    });
    expect(stats.seats).toEqual({
      available: 0,
      held: 0,
      booked: 0,
      total: 0,
    });
    expect(stats.recentActivity).toEqual([]);
  });
});
