import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SqsModule } from '@ssut/nestjs-sqs';
import { SQSClient } from '@aws-sdk/client-sqs';

@Module({
  imports: [
    SqsModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const sqsClient = new SQSClient({
          region: config.get<string>('AWS_REGION')!,
          endpoint: config.get<string>('AWS_ENDPOINT'),
          credentials: {
            accessKeyId: config.get<string>('AWS_ACCESS_KEY_ID')!,
            secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY')!,
          },
        });

        return {
          consumers: [
            {
              name: 'reservation-confirm',
              queueUrl: config.get<string>('SQS_CONFIRM_QUEUE_URL')!,
              region: config.get<string>('AWS_REGION')!,
              sqs: sqsClient,
            },
          ],
          producers: [
            {
              name: 'reservation-confirm',
              queueUrl: config.get<string>('SQS_CONFIRM_QUEUE_URL')!,
              region: config.get<string>('AWS_REGION')!,
              sqs: sqsClient,
            },
          ],
        };
      },
    }),
  ],
  exports: [SqsModule],
})
export class QueueModule {}
