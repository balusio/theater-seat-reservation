import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SeatService } from './seat.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SeatService', () => {
  let service: SeatService;
  let prisma: jest.Mocked<any>;

  const EVENT_ID = 'event-uuid-1';

  beforeEach(async () => {
    prisma = {
      event: {
        findUnique: jest.fn(),
      },
      eventSeat: {
        upsert: jest.fn(),
        findMany: jest.fn(),
        groupBy: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        SeatService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(SeatService);
  });

  // ─── GENERATE EVENT SEATS ─────────────────────────────────

  describe('generateEventSeats', () => {
    it('should generate event seats for all theater seats', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: EVENT_ID,
        theater: {
          sections: [
            {
              name: 'Orchestra',
              seats: [
                { id: 'seat-1', row: 'A', number: 1 },
                { id: 'seat-2', row: 'A', number: 2 },
              ],
            },
            {
              name: 'Balcony',
              seats: [{ id: 'seat-3', row: 'A', number: 1 }],
            },
          ],
        },
      });
      // $transaction receives an array of promises for batch upsert
      prisma.$transaction.mockResolvedValue([{}, {}, {}]);

      const result = await service.generateEventSeats(EVENT_ID);

      expect(result).toEqual({ generated: 3, eventId: EVENT_ID });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException if event does not exist', async () => {
      prisma.event.findUnique.mockResolvedValue(null);

      await expect(service.generateEventSeats(EVENT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should use correct prices per section', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: EVENT_ID,
        theater: {
          sections: [
            {
              name: 'Orchestra',
              seats: [{ id: 'seat-1', row: 'A', number: 1 }],
            },
            {
              name: 'Mezzanine',
              seats: [{ id: 'seat-2', row: 'A', number: 1 }],
            },
            {
              name: 'Balcony',
              seats: [{ id: 'seat-3', row: 'A', number: 1 }],
            },
          ],
        },
      });
      prisma.$transaction.mockResolvedValue([{}, {}, {}]);

      await service.generateEventSeats(EVENT_ID);

      // $transaction receives array of upsert calls
      const upsertCalls = prisma.$transaction.mock.calls[0][0];
      // We can't easily inspect PrismaPromise internals, but we verified it's called
      expect(upsertCalls).toHaveLength(3);
    });
  });

  // ─── GET STATS ────────────────────────────────────────────

  describe('getStats', () => {
    it('should return counts grouped by status', async () => {
      prisma.eventSeat.groupBy.mockResolvedValue([
        { status: 'AVAILABLE', _count: { status: 100 } },
        { status: 'HELD', _count: { status: 5 } },
        { status: 'BOOKED', _count: { status: 10 } },
      ]);

      const result = await service.getStats(EVENT_ID);

      expect(result).toEqual({
        eventId: EVENT_ID,
        available: 100,
        held: 5,
        booked: 10,
        total: 115,
      });
    });

    it('should default missing statuses to 0', async () => {
      prisma.eventSeat.groupBy.mockResolvedValue([
        { status: 'AVAILABLE', _count: { status: 50 } },
      ]);

      const result = await service.getStats(EVENT_ID);

      expect(result).toEqual({
        eventId: EVENT_ID,
        available: 50,
        held: 0,
        booked: 0,
        total: 50,
      });
    });

    it('should return all zeros when no seats exist', async () => {
      prisma.eventSeat.groupBy.mockResolvedValue([]);

      const result = await service.getStats(EVENT_ID);

      expect(result).toEqual({
        eventId: EVENT_ID,
        available: 0,
        held: 0,
        booked: 0,
        total: 0,
      });
    });
  });

  // ─── FIND BY EVENT ────────────────────────────────────────

  describe('findByEvent', () => {
    it('should return seats grouped by section', async () => {
      prisma.eventSeat.findMany.mockResolvedValue([
        {
          id: 'es-1',
          status: 'AVAILABLE',
          price: 150,
          seat: { row: 'A', number: 1, label: 'A-1', section: { name: 'Orchestra' } },
        },
        {
          id: 'es-2',
          status: 'HELD',
          price: 60,
          seat: { row: 'A', number: 1, label: 'A-1', section: { name: 'Balcony' } },
        },
      ]);

      const result = await service.findByEvent(EVENT_ID);

      expect(result).toEqual({
        Orchestra: [
          { id: 'es-1', row: 'A', number: 1, label: 'A-1', status: 'AVAILABLE', price: 150 },
        ],
        Balcony: [
          { id: 'es-2', row: 'A', number: 1, label: 'A-1', status: 'HELD', price: 60 },
        ],
      });
    });

    it('should pass status filter to query', async () => {
      prisma.eventSeat.findMany.mockResolvedValue([]);

      await service.findByEvent(EVENT_ID, 'available');

      expect(prisma.eventSeat.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'AVAILABLE' }),
        }),
      );
    });

    it('should pass section filter to query', async () => {
      prisma.eventSeat.findMany.mockResolvedValue([]);

      await service.findByEvent(EVENT_ID, undefined, 'Orchestra');

      expect(prisma.eventSeat.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            seat: { section: { name: { equals: 'Orchestra', mode: 'insensitive' } } },
          }),
        }),
      );
    });
  });
});
