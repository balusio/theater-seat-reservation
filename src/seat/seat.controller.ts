import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { SeatService } from './seat.service';

@Controller('events/:eventId/seats')
export class SeatController {
  constructor(private readonly seatService: SeatService) {}

  @Post('generate')
  generate(@Param('eventId') eventId: string) {
    return this.seatService.generateEventSeats(eventId);
  }

  @Get('stats')
  getStats(@Param('eventId') eventId: string) {
    return this.seatService.getStats(eventId);
  }

  @Get()
  findAll(
    @Param('eventId') eventId: string,
    @Query('status') status?: string,
    @Query('section') section?: string,
  ) {
    return this.seatService.findByEvent(eventId, status, section);
  }
}
