import { Module } from '@nestjs/common';
import { SqsModule } from '@ssut/nestjs-sqs';
import { SQSClient } from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({
  region: process.env.AWS_REGION!,
  endpoint: process.env.AWS_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

@Module({
  imports: [
    SqsModule.register({
      consumers: [
        {
          name: 'reservation-confirm',
          queueUrl: process.env.SQS_CONFIRM_QUEUE_URL!,
          region: process.env.AWS_REGION!,
          sqs: sqsClient,
        },
      ],
      producers: [
        {
          name: 'reservation-confirm',
          queueUrl: process.env.SQS_CONFIRM_QUEUE_URL!,
          region: process.env.AWS_REGION!,
          sqs: sqsClient,
        },
      ],
    }),
  ],
})
export class QueueModule {}
