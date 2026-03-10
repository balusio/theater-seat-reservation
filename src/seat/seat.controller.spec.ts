import { Test } from '@nestjs/testing';
import { SeatController } from './seat.controller';
import { SeatService } from './seat.service';

describe('SeatController', () => {
  let controller: SeatController;
  let service: jest.Mocked<Pick<SeatService, 'generateEventSeats' | 'getStats' | 'findByEvent'>>;

  const EVENT_ID = 'event-uuid-1';

  beforeEach(async () => {
    service = {
      generateEventSeats: jest.fn(),
      getStats: jest.fn(),
      findByEvent: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [SeatController],
      providers: [{ provide: SeatService, useValue: service }],
    }).compile();

    controller = module.get(SeatController);
  });

  describe('generate', () => {
    it('should delegate to service.generateEventSeats', async () => {
      service.generateEventSeats.mockResolvedValue({ generated: 170, eventId: EVENT_ID });

      const result = await controller.generate(EVENT_ID);

      expect(result).toEqual({ generated: 170, eventId: EVENT_ID });
      expect(service.generateEventSeats).toHaveBeenCalledWith(EVENT_ID);
    });
  });

  describe('getStats', () => {
    it('should delegate to service.getStats', async () => {
      const stats = { eventId: EVENT_ID, available: 100, held: 5, booked: 10, total: 115 };
      service.getStats.mockResolvedValue(stats);

      const result = await controller.getStats(EVENT_ID);

      expect(result).toEqual(stats);
      expect(service.getStats).toHaveBeenCalledWith(EVENT_ID);
    });
  });

  describe('findAll', () => {
    it('should delegate to service.findByEvent with no filters', async () => {
      service.findByEvent.mockResolvedValue({});

      await controller.findAll(EVENT_ID);

      expect(service.findByEvent).toHaveBeenCalledWith(EVENT_ID, undefined, undefined);
    });

    it('should pass status filter', async () => {
      service.findByEvent.mockResolvedValue({});

      await controller.findAll(EVENT_ID, 'available');

      expect(service.findByEvent).toHaveBeenCalledWith(EVENT_ID, 'available', undefined);
    });

    it('should pass section filter', async () => {
      service.findByEvent.mockResolvedValue({});

      await controller.findAll(EVENT_ID, undefined, 'Orchestra');

      expect(service.findByEvent).toHaveBeenCalledWith(EVENT_ID, undefined, 'Orchestra');
    });

    it('should pass both filters', async () => {
      service.findByEvent.mockResolvedValue({});

      await controller.findAll(EVENT_ID, 'held', 'Balcony');

      expect(service.findByEvent).toHaveBeenCalledWith(EVENT_ID, 'held', 'Balcony');
    });
  });
});
