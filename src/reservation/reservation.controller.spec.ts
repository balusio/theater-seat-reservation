import { Test } from '@nestjs/testing';
import { ReservationController } from './reservation.controller';
import { ReservationService } from './reservation.service';

describe('ReservationController', () => {
  let controller: ReservationController;
  let service: jest.Mocked<Pick<ReservationService, 'create' | 'findOne' | 'enqueueConfirmation' | 'cancel'>>;

  const RESERVATION_ID = 'res-uuid-1';
  const IDEMPOTENCY_KEY = 'idem-uuid-1';

  const mockReservation = {
    id: RESERVATION_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    eventId: 'event-uuid-1',
    status: 'PENDING',
    reservationSeats: [],
  };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findOne: jest.fn(),
      enqueueConfirmation: jest.fn(),
      cancel: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [ReservationController],
      providers: [{ provide: ReservationService, useValue: service }],
    }).compile();

    controller = module.get(ReservationController);
  });

  describe('create', () => {
    it('should delegate to service.create and return result', async () => {
      service.create.mockResolvedValue(mockReservation as any);

      const dto = {
        idempotencyKey: IDEMPOTENCY_KEY,
        eventId: 'event-uuid-1',
        seatIds: ['seat-1', 'seat-2'],
      };

      const result = await controller.create(dto);

      expect(result).toEqual(mockReservation);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findOne', () => {
    it('should delegate to service.findOne', async () => {
      service.findOne.mockResolvedValue(mockReservation as any);

      const result = await controller.findOne(RESERVATION_ID);

      expect(result).toEqual(mockReservation);
      expect(service.findOne).toHaveBeenCalledWith(RESERVATION_ID);
    });
  });

  describe('confirm', () => {
    it('should delegate to service.enqueueConfirmation', async () => {
      service.enqueueConfirmation.mockResolvedValue({ status: 'processing' });

      const result = await controller.confirm(RESERVATION_ID, IDEMPOTENCY_KEY);

      expect(result).toEqual({ status: 'processing' });
      expect(service.enqueueConfirmation).toHaveBeenCalledWith(
        RESERVATION_ID,
        IDEMPOTENCY_KEY,
      );
    });
  });

  describe('cancel', () => {
    it('should delegate to service.cancel with reason', async () => {
      const cancelled = { ...mockReservation, status: 'CANCELLED' };
      service.cancel.mockResolvedValue(cancelled as any);

      const result = await controller.cancel(RESERVATION_ID, 'changed mind');

      expect(result).toEqual(cancelled);
      expect(service.cancel).toHaveBeenCalledWith(RESERVATION_ID, 'changed mind');
    });

    it('should delegate to service.cancel without reason', async () => {
      service.cancel.mockResolvedValue({} as any);

      await controller.cancel(RESERVATION_ID, undefined);

      expect(service.cancel).toHaveBeenCalledWith(RESERVATION_ID, undefined);
    });
  });
});
