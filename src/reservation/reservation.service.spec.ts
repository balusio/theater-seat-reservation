import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SqsService } from '@ssut/nestjs-sqs';
import { ReservationService } from './reservation.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ReservationService', () => {
  let service: ReservationService;
  let prisma: jest.Mocked<any>;
  let sqsService: jest.Mocked<any>;

  // Reusable tx mock — each test can override methods as needed
  let tx: Record<string, any>;

  const RESERVATION_ID = 'res-uuid-1';
  const IDEMPOTENCY_KEY = 'idem-uuid-1';
  const EVENT_ID = 'event-uuid-1';
  const SEAT_IDS = ['seat-uuid-1', 'seat-uuid-2'];

  const mockReservation = {
    id: RESERVATION_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    eventId: EVENT_ID,
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
    reservationSeats: [
      { id: 'rs-1', eventSeatId: SEAT_IDS[0], isActive: true, eventSeat: { seat: {} } },
      { id: 'rs-2', eventSeatId: SEAT_IDS[1], isActive: true, eventSeat: { seat: {} } },
    ],
  };

  beforeEach(async () => {
    tx = {
      eventSeat: {
        updateMany: jest.fn(),
      },
      reservation: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      reservationSeat: {
        updateMany: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };

    prisma = {
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(tx)),
      reservation: {
        findUnique: jest.fn(),
      },
    };

    sqsService = {
      send: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        ReservationService,
        { provide: PrismaService, useValue: prisma },
        { provide: SqsService, useValue: sqsService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const map: Record<string, string> = {
                RESERVATION_TTL_MINUTES: '5',
              };
              return map[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get(ReservationService);
  });

  // ─── CREATE ───────────────────────────────────────────────

  describe('create', () => {
    it('should create a PENDING reservation when seats are available', async () => {
      prisma.reservation.findUnique.mockResolvedValue(null);
      tx.eventSeat.updateMany.mockResolvedValue({ count: 2 });
      tx.reservation.create.mockResolvedValue(mockReservation);
      tx.auditLog.create.mockResolvedValue({});

      const result = await service.create({
        idempotencyKey: IDEMPOTENCY_KEY,
        eventId: EVENT_ID,
        seatIds: SEAT_IDS,
      });

      expect(result).toEqual(mockReservation);
      expect(tx.eventSeat.updateMany).toHaveBeenCalledWith({
        where: { id: { in: SEAT_IDS }, eventId: EVENT_ID, status: 'AVAILABLE' },
        data: { status: 'HELD' },
      });
      expect(tx.reservation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            idempotencyKey: IDEMPOTENCY_KEY,
            eventId: EVENT_ID,
            status: 'PENDING',
          }),
        }),
      );
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CREATED',
            newStatus: 'PENDING',
            triggeredBy: 'api',
          }),
        }),
      );
    });

    it('should throw ConflictException when not all seats are available', async () => {
      prisma.reservation.findUnique.mockResolvedValue(null);
      tx.eventSeat.updateMany.mockResolvedValue({ count: 1 }); // only 1 of 2

      await expect(
        service.create({
          idempotencyKey: IDEMPOTENCY_KEY,
          eventId: EVENT_ID,
          seatIds: SEAT_IDS,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should return existing reservation on duplicate idempotencyKey', async () => {
      prisma.reservation.findUnique.mockResolvedValue(mockReservation);

      const result = await service.create({
        idempotencyKey: IDEMPOTENCY_KEY,
        eventId: EVENT_ID,
        seatIds: SEAT_IDS,
      });

      expect(result).toEqual(mockReservation);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should rethrow errors from transaction', async () => {
      prisma.reservation.findUnique.mockResolvedValue(null);
      tx.eventSeat.updateMany.mockResolvedValue({ count: 2 });
      tx.reservation.create.mockRejectedValue(new Error('DB down'));

      await expect(
        service.create({
          idempotencyKey: IDEMPOTENCY_KEY,
          eventId: EVENT_ID,
          seatIds: SEAT_IDS,
        }),
      ).rejects.toThrow('DB down');
    });

    it('should set expiresAt based on TTL config', async () => {
      prisma.reservation.findUnique.mockResolvedValue(null);
      tx.eventSeat.updateMany.mockResolvedValue({ count: 2 });
      tx.reservation.create.mockResolvedValue(mockReservation);
      tx.auditLog.create.mockResolvedValue({});

      const before = Date.now();
      await service.create({
        idempotencyKey: IDEMPOTENCY_KEY,
        eventId: EVENT_ID,
        seatIds: SEAT_IDS,
      });

      const createCall = tx.reservation.create.mock.calls[0][0];
      const expiresAt = createCall.data.expiresAt.getTime();
      // TTL = 5 min = 300000ms
      expect(expiresAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 100);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 100);
    });
  });

  // ─── FIND ONE ─────────────────────────────────────────────

  describe('findOne', () => {
    it('should return the reservation with includes', async () => {
      prisma.reservation.findUnique.mockResolvedValue(mockReservation);

      const result = await service.findOne(RESERVATION_ID);

      expect(result).toEqual(mockReservation);
      expect(prisma.reservation.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: RESERVATION_ID } }),
      );
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.reservation.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── ENQUEUE CONFIRMATION ─────────────────────────────────

  describe('enqueueConfirmation', () => {
    it('should send SQS message for PENDING reservation', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: RESERVATION_ID,
        status: 'PENDING',
      });

      const result = await service.enqueueConfirmation(
        RESERVATION_ID,
        IDEMPOTENCY_KEY,
      );

      expect(result).toEqual({ status: 'processing' });
      expect(sqsService.send).toHaveBeenCalledWith('reservation-confirm', {
        id: IDEMPOTENCY_KEY,
        body: { reservationId: RESERVATION_ID, idempotencyKey: IDEMPOTENCY_KEY },
      });
    });

    it('should throw ConflictException if reservation is not PENDING', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: RESERVATION_ID,
        status: 'CONFIRMED',
      });

      await expect(
        service.enqueueConfirmation(RESERVATION_ID, IDEMPOTENCY_KEY),
      ).rejects.toThrow(ConflictException);
      expect(sqsService.send).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if reservation not found', async () => {
      prisma.reservation.findUnique.mockResolvedValue(null);

      await expect(
        service.enqueueConfirmation(RESERVATION_ID, IDEMPOTENCY_KEY),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── CONFIRM ──────────────────────────────────────────────

  describe('confirm', () => {
    it('should confirm a PENDING reservation', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: RESERVATION_ID, status: 'PENDING' },
      ]);
      tx.reservation.update.mockResolvedValue({});
      tx.eventSeat.updateMany.mockResolvedValue({});
      tx.auditLog.create.mockResolvedValue({});

      await service.confirm(RESERVATION_ID);

      expect(tx.reservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: RESERVATION_ID },
          data: expect.objectContaining({
            status: 'CONFIRMED',
          }),
        }),
      );
      expect(tx.eventSeat.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'BOOKED' },
        }),
      );
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            previousStatus: 'PENDING',
            newStatus: 'CONFIRMED',
            triggeredBy: 'worker',
          }),
        }),
      );
    });

    it('should throw ConflictException if reservation not found or not PENDING', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      await expect(service.confirm(RESERVATION_ID)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── CANCEL ───────────────────────────────────────────────

  describe('cancel', () => {
    it('should cancel a PENDING reservation', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: RESERVATION_ID, status: 'PENDING' },
      ]);
      tx.reservation.update.mockResolvedValue({});
      tx.eventSeat.updateMany.mockResolvedValue({});
      tx.reservationSeat.updateMany.mockResolvedValue({});
      tx.auditLog.create.mockResolvedValue({});
      tx.reservation.findUnique.mockResolvedValue({
        id: RESERVATION_ID,
        status: 'CANCELLED',
      });

      await service.cancel(RESERVATION_ID, 'changed mind');

      expect(tx.reservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CANCELLED',
            cancellationReason: 'changed mind',
          }),
        }),
      );
      expect(tx.eventSeat.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'AVAILABLE' },
        }),
      );
      expect(tx.reservationSeat.updateMany).toHaveBeenCalledWith({
        where: { reservationId: RESERVATION_ID },
        data: { isActive: false },
      });
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            previousStatus: 'PENDING',
            newStatus: 'CANCELLED',
            triggeredBy: 'api',
          }),
        }),
      );
    });

    it('should cancel a CONFIRMED reservation', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: RESERVATION_ID, status: 'CONFIRMED' },
      ]);
      tx.reservation.update.mockResolvedValue({});
      tx.eventSeat.updateMany.mockResolvedValue({});
      tx.reservationSeat.updateMany.mockResolvedValue({});
      tx.auditLog.create.mockResolvedValue({});
      tx.reservation.findUnique.mockResolvedValue({
        id: RESERVATION_ID,
        status: 'CANCELLED',
      });

      await service.cancel(RESERVATION_ID);

      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            previousStatus: 'CONFIRMED',
            newStatus: 'CANCELLED',
          }),
        }),
      );
    });

    it('should throw NotFoundException if reservation not found', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      await expect(service.cancel(RESERVATION_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException for invalid status transition', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: RESERVATION_ID, status: 'CANCELLED' },
      ]);

      await expect(service.cancel(RESERVATION_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException for REJECTED status', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: RESERVATION_ID, status: 'REJECTED' },
      ]);

      await expect(service.cancel(RESERVATION_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should use default reason metadata when no reason provided', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: RESERVATION_ID, status: 'PENDING' },
      ]);
      tx.reservation.update.mockResolvedValue({});
      tx.eventSeat.updateMany.mockResolvedValue({});
      tx.reservationSeat.updateMany.mockResolvedValue({});
      tx.auditLog.create.mockResolvedValue({});
      tx.reservation.findUnique.mockResolvedValue({});

      await service.cancel(RESERVATION_ID);

      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: { reason: 'user_initiated' },
          }),
        }),
      );
    });
  });
});
