import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { SQSClient, ListQueuesCommand } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';

@Controller('health')
export class HealthController {
  private readonly sqsClient: SQSClient;

  constructor(
    private health: HealthCheckService,
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.sqsClient = new SQSClient({
      region: this.config.get('AWS_REGION'),
      endpoint: this.config.get('AWS_ENDPOINT'),
      credentials: {
        accessKeyId: this.config.get('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.config.get('AWS_SECRET_ACCESS_KEY'),
      },
    });
  }

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      async (): Promise<HealthIndicatorResult> => {
        await this.prisma.$queryRawUnsafe('SELECT 1');
        return { database: { status: 'up' } };
      },
      async (): Promise<HealthIndicatorResult> => {
        await this.sqsClient.send(new ListQueuesCommand({}));
        return { sqs: { status: 'up' } };
      },
    ]);
  }
}
