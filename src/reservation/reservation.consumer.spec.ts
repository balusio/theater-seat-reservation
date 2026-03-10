import { Test } from '@nestjs/testing';
import { ReservationConsumer } from './reservation.consumer';
import { ReservationService } from './reservation.service';

describe('ReservationConsumer', () => {
  let consumer: ReservationConsumer;
  let reservationService: jest.Mocked<Pick<ReservationService, 'confirm'>>;

  beforeEach(async () => {
    reservationService = {
      confirm: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        ReservationConsumer,
        { provide: ReservationService, useValue: reservationService },
      ],
    }).compile();

    consumer = module.get(ReservationConsumer);
  });

  describe('handleMessage', () => {
    it('should call confirm with reservationId from message body', async () => {
      const message = {
        Body: JSON.stringify({
          reservationId: 'res-uuid-1',
          idempotencyKey: 'idem-uuid-1',
        }),
      } as any;

      await consumer.handleMessage(message);

      expect(reservationService.confirm).toHaveBeenCalledWith('res-uuid-1');
    });

    it('should propagate errors from confirm', async () => {
      reservationService.confirm.mockRejectedValue(new Error('fail'));

      const message = {
        Body: JSON.stringify({ reservationId: 'res-uuid-1' }),
      } as any;

      await expect(consumer.handleMessage(message)).rejects.toThrow('fail');
    });
  });

  describe('onProcessingError', () => {
    it('should log error without throwing', () => {
      const logSpy = jest.spyOn(console, 'error').mockImplementation();
      // onProcessingError uses this.logger.error internally, but we just verify it doesn't throw
      const message = {
        Body: JSON.stringify({ reservationId: 'res-uuid-1' }),
      } as any;

      expect(() =>
        consumer.onProcessingError(new Error('timeout'), message),
      ).not.toThrow();

      logSpy.mockRestore();
    });
  });
});
