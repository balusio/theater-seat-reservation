import { Test } from '@nestjs/testing';
import { HealthCheckService } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

// Mock the SQS client module
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ QueueUrls: [] }),
  })),
  ListQueuesCommand: jest.fn(),
}));

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: jest.Mocked<Pick<HealthCheckService, 'check'>>;

  beforeEach(async () => {
    healthCheckService = {
      check: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: healthCheckService },
        {
          provide: PrismaService,
          useValue: { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const map: Record<string, string> = {
                AWS_REGION: 'us-east-1',
                AWS_ENDPOINT: 'http://localhost:4566',
                AWS_ACCESS_KEY_ID: 'test',
                AWS_SECRET_ACCESS_KEY: 'test',
              };
              return map[key];
            }),
          },
        },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  describe('check', () => {
    it('should delegate to HealthCheckService.check with indicators', async () => {
      const healthResult = {
        status: 'ok' as const,
        info: { database: { status: 'up' as const }, sqs: { status: 'up' as const } },
        error: {},
        details: { database: { status: 'up' as const }, sqs: { status: 'up' as const } },
      };
      healthCheckService.check.mockResolvedValue(healthResult);

      const result = await controller.check();

      expect(result).toEqual(healthResult);
      expect(healthCheckService.check).toHaveBeenCalledWith(
        expect.arrayContaining([expect.any(Function), expect.any(Function)]),
      );
    });

    it('should pass two health indicators (database + sqs)', async () => {
      healthCheckService.check.mockResolvedValue({} as any);

      await controller.check();

      const indicators = healthCheckService.check.mock.calls[0][0];
      expect(indicators).toHaveLength(2);
    });
  });
});
