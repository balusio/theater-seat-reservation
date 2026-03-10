import { Injectable, Logger } from '@nestjs/common';
import { SqsMessageHandler, SqsConsumerEventHandler } from '@ssut/nestjs-sqs';
import { Message } from '@aws-sdk/client-sqs';
import { ReservationService } from './reservation.service';

@Injectable()
export class ReservationConsumer {
  private readonly logger = new Logger(ReservationConsumer.name);

  constructor(private readonly reservationService: ReservationService) {}

  @SqsMessageHandler('reservation-confirm', false)
  async handleMessage(message: Message) {
    const body = JSON.parse(message.Body!);
    await this.reservationService.confirm(body.reservationId);
  }

  @SqsConsumerEventHandler('reservation-confirm', 'processing_error')
  onProcessingError(error: Error, message: Message) {
    const body = JSON.parse(message.Body!);
    this.logger.error(
      `SQS processing error for reservation ${body.reservationId}: ${error.message}`,
    );
  }
}
