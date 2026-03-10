import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { MonitoringService } from './monitoring.service';
import { DASHBOARD_HTML } from './utils';

@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Get('stats')
  getStats() {
    return this.monitoringService.getStats();
  }

  @Get('dashboard')
  dashboard(@Res() res: Response) {
    res.type('html').send(DASHBOARD_HTML);
  }
}
