import { Controller, Get } from '@nestjs/common';

@Controller('reservations')
export class ReservationController {
  @Get()
  findAll() {
    return { status: 'ok' };
  }
}
