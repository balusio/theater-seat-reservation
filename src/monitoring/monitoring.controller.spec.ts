import { Test } from '@nestjs/testing';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

describe('MonitoringController', () => {
  let controller: MonitoringController;
  let service: jest.Mocked<Pick<MonitoringService, 'getStats'>>;

  beforeEach(async () => {
    service = {
      getStats: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [MonitoringController],
      providers: [{ provide: MonitoringService, useValue: service }],
    }).compile();

    controller = module.get(MonitoringController);
  });

  describe('getStats', () => {
    it('should delegate to service.getStats', async () => {
      const stats = {
        timestamp: '2025-01-01T00:00:00.000Z',
        uptime: 100,
        memory: { rss: 100, heapUsed: 50, heapTotal: 80 },
        reservations: { pending: 1, confirmed: 2, cancelled: 0, rejected: 0, total: 3 },
        seats: { available: 100, held: 1, booked: 2, total: 103 },
        recentActivity: [],
      };
      service.getStats.mockResolvedValue(stats);

      const result = await controller.getStats();

      expect(result).toEqual(stats);
      expect(service.getStats).toHaveBeenCalled();
    });
  });

  describe('dashboard', () => {
    it('should serve HTML response', () => {
      const mockRes = {
        type: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      } as any;

      controller.dashboard(mockRes);

      expect(mockRes.type).toHaveBeenCalledWith('html');
      expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('<!DOCTYPE html>'));
      expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('Theater Reservation Dashboard'));
    });
  });
});
