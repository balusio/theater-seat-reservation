import { Module } from '@nestjs/common';
import { ReservationController } from './reservation.controller';
import { ReservationService } from './reservation.service';
import { ReservationConsumer } from './reservation.consumer';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [QueueModule],
  controllers: [ReservationController],
  providers: [ReservationService, ReservationConsumer],
})
export class ReservationModule {}
