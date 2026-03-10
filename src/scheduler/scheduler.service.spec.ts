import { Test } from '@nestjs/testing';
import { SchedulerService } from './scheduler.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SchedulerService', () => {
  let service: SchedulerService;
  let tx: Record<string, any>;

  beforeEach(async () => {
    tx = {
      reservation: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      eventSeat: {
        updateMany: jest.fn().mockResolvedValue({}),
      },
      reservationSeat: {
        updateMany: jest.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const prisma = {
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(tx)),
    };

    const module = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(SchedulerService);
  });

  it('should reject expired reservations where expiresAt <= now', async () => {
    const expiredIds = [{ id: 'res-1' }, { id: 'res-2' }];
    tx.reservation.findMany.mockResolvedValue(expiredIds);

    await service.expireReservations();

    const findCall = tx.reservation.findMany.mock.calls[0][0];
    expect(findCall.where.status).toBe('PENDING');
    expect(findCall.where.expiresAt.lte).toBeInstanceOf(Date);

    expect(tx.reservation.update).toHaveBeenCalledTimes(2);
    expect(tx.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: expect.objectContaining({ status: 'REJECTED', rejectedAt: expect.any(Date) }),
    });
    expect(tx.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-2' },
      data: expect.objectContaining({ status: 'REJECTED', rejectedAt: expect.any(Date) }),
    });

    expect(tx.eventSeat.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.reservationSeat.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reservationId: 'res-1',
        previousStatus: 'PENDING',
        newStatus: 'REJECTED',
        triggeredBy: 'cron',
        metadata: { reason: 'reservation_timeout' },
      }),
    });
  });

  it('should do nothing when no expired reservations found', async () => {
    tx.reservation.findMany.mockResolvedValue([]);

    await service.expireReservations();

    expect(tx.reservation.update).not.toHaveBeenCalled();
    expect(tx.eventSeat.updateMany).not.toHaveBeenCalled();
  });

  it('should not run concurrently (isRunning guard)', async () => {
    let resolveFirst: () => void;
    const firstPromise = new Promise<void>((r) => (resolveFirst = r));
    tx.reservation.findMany.mockImplementationOnce(() => firstPromise.then(() => []));

    const run1 = service.expireReservations();
    const run2 = service.expireReservations();

    resolveFirst!();
    await run1;
    await run2;

    expect(tx.reservation.findMany).toHaveBeenCalledTimes(1);
  });

  it('should reset isRunning flag even on error', async () => {
    tx.reservation.findMany.mockRejectedValue(new Error('DB error'));

    await expect(service.expireReservations()).rejects.toThrow('DB error');

    tx.reservation.findMany.mockResolvedValue([]);
    await service.expireReservations();

    expect(tx.reservation.findMany).toHaveBeenCalledTimes(2);
  });
});
