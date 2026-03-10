import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ReservationService } from './reservation.service';
import { CreateReservationDto } from './dto/create-reservation.dto';

@Controller('reservations')
export class ReservationController {
  constructor(private readonly reservationService: ReservationService) {}

  @Post()
  create(@Body() dto: CreateReservationDto) {
    return this.reservationService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.reservationService.findOne(id);
  }

  @Post(':id/confirm')
  @HttpCode(202)
  confirm(
    @Param('id') id: string,
    @Body('idempotencyKey') idempotencyKey: string,
  ) {
    return this.reservationService.enqueueConfirmation(id, idempotencyKey);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.reservationService.cancel(id, reason);
  }
}
