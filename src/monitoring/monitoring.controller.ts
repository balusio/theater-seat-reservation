import { Controller, Get } from '@nestjs/common';

@Controller('monitoring')
export class MonitoringController {
  @Get()
  getStatus() {
    return { status: 'ok' };
  }
}
