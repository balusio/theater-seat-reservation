import { Controller, Get } from '@nestjs/common';

@Controller('seats')
export class SeatController {
  @Get()
  findAll() {
    return { status: 'ok' };
  }
}
