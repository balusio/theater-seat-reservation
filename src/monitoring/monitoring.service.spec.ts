import { Test } from '@nestjs/testing';
import { MonitoringService } from './monitoring.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MonitoringService', () => {
  let service: MonitoringService;
  let prisma: jest.Mocked<any>;

  const EVENT_ID = 'event-uuid-1';

  beforeEach(async () => {
    prisma = {
      reservation: {
        groupBy: jest.fn(),
      },
      eventSeat: {
        groupBy: jest.fn(),
      },
      event: {
        findMany: jest.fn(),
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

  it('should aggregate reservation stats and seats per event', async () => {
    prisma.reservation.groupBy.mockResolvedValue([
      { status: 'PENDING', _count: { status: 3 } },
      { status: 'CONFIRMED', _count: { status: 5 } },
      { status: 'CANCELLED', _count: { status: 1 } },
      { status: 'REJECTED', _count: { status: 2 } },
    ]);
    prisma.eventSeat.groupBy.mockResolvedValue([
      { eventId: EVENT_ID, status: 'AVAILABLE', _count: { status: 100 } },
      { eventId: EVENT_ID, status: 'HELD', _count: { status: 3 } },
      { eventId: EVENT_ID, status: 'BOOKED', _count: { status: 5 } },
    ]);
    prisma.event.findMany.mockResolvedValue([
      { id: EVENT_ID, title: 'Hamlet', status: 'OPEN' },
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
    expect(stats.events).toHaveLength(1);
    expect(stats.events[0]).toEqual({
      eventId: EVENT_ID,
      title: 'Hamlet',
      eventStatus: 'OPEN',
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
    prisma.event.findMany.mockResolvedValue([]);
    prisma.auditLog.findMany.mockResolvedValue([]);

    const stats = await service.getStats();

    expect(stats.reservations).toEqual({
      pending: 0,
      confirmed: 0,
      cancelled: 0,
      rejected: 0,
      total: 0,
    });
    expect(stats.events).toEqual([]);
    expect(stats.recentActivity).toEqual([]);
  });

  it('should show multiple events separately', async () => {
    prisma.reservation.groupBy.mockResolvedValue([]);
    prisma.eventSeat.groupBy.mockResolvedValue([
      { eventId: 'event-1', status: 'AVAILABLE', _count: { status: 80 } },
      { eventId: 'event-1', status: 'HELD', _count: { status: 10 } },
      { eventId: 'event-2', status: 'AVAILABLE', _count: { status: 170 } },
    ]);
    prisma.event.findMany.mockResolvedValue([
      { id: 'event-1', title: 'Hamlet', status: 'OPEN' },
      { id: 'event-2', title: 'Swan Lake', status: 'SCHEDULED' },
    ]);
    prisma.auditLog.findMany.mockResolvedValue([]);

    const stats = await service.getStats();

    expect(stats.events).toHaveLength(2);
    expect(stats.events[0]).toEqual(
      expect.objectContaining({ title: 'Hamlet', available: 80, held: 10, total: 90 }),
    );
    expect(stats.events[1]).toEqual(
      expect.objectContaining({ title: 'Swan Lake', available: 170, held: 0, total: 170 }),
    );
  });
});
