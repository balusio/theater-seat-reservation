import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerService } from './scheduler.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SchedulerService', () => {
  let service: SchedulerService;
  let tx: Record<string, any>;

  beforeEach(async () => {
    tx = {
      reservation: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      eventSeat: {
        updateMany: jest.fn(),
      },
      reservationSeat: {
        updateMany: jest.fn(),
      },
      auditLog: {
        createMany: jest.fn(),
      },
    };

    const prisma = {
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(tx)),
    };

    const module = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'RESERVATION_GRACE_PERIOD_MINUTES') return '2';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(SchedulerService);
  });

  it('should reject expired reservations past grace period', async () => {
    const expiredIds = [{ id: 'res-1' }, { id: 'res-2' }];
    tx.reservation.findMany.mockResolvedValue(expiredIds);
    tx.reservation.updateMany.mockResolvedValue({ count: 2 });
    tx.eventSeat.updateMany.mockResolvedValue({ count: 4 });
    tx.reservationSeat.updateMany.mockResolvedValue({ count: 4 });
    tx.auditLog.createMany.mockResolvedValue({ count: 2 });

    await service.expireReservations();

    // Verify query uses grace period
    const findCall = tx.reservation.findMany.mock.calls[0][0];
    expect(findCall.where.status).toBe('PENDING');
    expect(findCall.where.expiresAt.lte).toBeInstanceOf(Date);
    // Grace deadline should be ~2 min ago
    const graceDeadline = findCall.where.expiresAt.lte.getTime();
    const expected = Date.now() - 2 * 60 * 1000;
    expect(Math.abs(graceDeadline - expected)).toBeLessThan(1000);

    expect(tx.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['res-1', 'res-2'] } },
      data: expect.objectContaining({ status: 'REJECTED' }),
    });
    expect(tx.eventSeat.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'AVAILABLE' } }),
    );
    expect(tx.reservationSeat.updateMany).toHaveBeenCalledWith({
      where: { reservationId: { in: ['res-1', 'res-2'] } },
      data: { isActive: false },
    });
    expect(tx.auditLog.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          reservationId: 'res-1',
          triggeredBy: 'cron',
          newStatus: 'REJECTED',
        }),
      ]),
    });
  });

  it('should do nothing when no expired reservations found', async () => {
    tx.reservation.findMany.mockResolvedValue([]);

    await service.expireReservations();

    expect(tx.reservation.updateMany).not.toHaveBeenCalled();
    expect(tx.eventSeat.updateMany).not.toHaveBeenCalled();
  });

  it('should not run concurrently (isRunning guard)', async () => {
    // Simulate a slow transaction
    let resolveFirst: () => void;
    const firstPromise = new Promise<void>((r) => (resolveFirst = r));
    tx.reservation.findMany.mockImplementationOnce(() => firstPromise.then(() => []));

    const run1 = service.expireReservations();
    const run2 = service.expireReservations(); // should skip (isRunning = true)

    resolveFirst!();
    await run1;
    await run2;

    // findMany should only be called once
    expect(tx.reservation.findMany).toHaveBeenCalledTimes(1);
  });
});
