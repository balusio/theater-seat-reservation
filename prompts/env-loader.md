# 02 — Environment Loader

## Role

You are setting up the entire development environment from scratch. After this document completes, running `mprocs` should start postgres, localstack (SQS), and the NestJS API — all healthy and connected.

## Prerequisites

- Node.js 22+
- pnpm installed globally
- Docker and Docker Compose installed
- mprocs installed (`brew install mprocs` or `cargo install mprocs`)
- AWS CLI installed (for LocalStack queue creation)

## Step 1: Scaffold NestJS Project

```bash
pnpm dlx @nestjs/cli new theater-reservation --package-manager pnpm --skip-git
cd theater-reservation
```

## Step 2: Install Dependencies

```bash
# Core
pnpm add @nestjs/config @nestjs/schedule @nestjs/terminus

# Prisma
pnpm add @prisma/client
pnpm add -D prisma

# SQS
pnpm add @ssut/nestjs-sqs @aws-sdk/client-sqs

# Validation
pnpm add class-validator class-transformer

# Utils
pnpm add uuid
pnpm add -D @types/uuid
```

## Step 3: Create docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: reservation_user
      POSTGRES_PASSWORD: reservation_pass
      POSTGRES_DB: reservation_db
    ports:
      - '5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U reservation_user']
      interval: 5s
      retries: 5

  localstack:
    image: localstack/localstack:latest
    ports:
      - '4566:4566'
    environment:
      - SERVICES=sqs
      - DEBUG=0
      - DEFAULT_REGION=us-east-1
    volumes:
      - './init-localstack.sh:/etc/localstack/init/ready.d/init.sh'
    healthcheck:
      test: ['CMD-SHELL', 'awslocal sqs list-queues']
      interval: 10s
      retries: 5

volumes:
  pgdata:
```

## Step 4: Create init-localstack.sh

This script runs automatically when LocalStack is ready. Create `init-localstack.sh` at the project root:

```bash
#!/bin/bash
echo "Creating SQS queues..."

awslocal sqs create-queue --queue-name reservation-confirm-dlq

awslocal sqs create-queue --queue-name reservation-confirm \
  --attributes '{
    "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:reservation-confirm-dlq\",\"maxReceiveCount\":\"3\"}",
    "VisibilityTimeout": "30"
  }'

echo "SQS queues created:"
awslocal sqs list-queues
```

Make it executable: `chmod +x init-localstack.sh`

## Step 5: Create mprocs.yaml

```yaml
procs:
  infra:
    shell: docker compose up
  api:
    shell: pnpm run start:dev
    depends: [infra]
  studio:
    shell: pnpm dlx prisma studio
    depends: [infra]
```

## Step 6: Create .env

```
DATABASE_URL=postgresql://reservation_user:reservation_pass@localhost:5432/reservation_db
AWS_REGION=us-east-1
AWS_ENDPOINT=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
SQS_CONFIRM_QUEUE_URL=http://localhost:4566/000000000000/reservation-confirm
SQS_CONFIRM_DLQ_URL=http://localhost:4566/000000000000/reservation-confirm-dlq
NODE_ENV=development
PORT=3000
RESERVATION_TTL_MINUTES=5
RESERVATION_GRACE_PERIOD_MINUTES=2
```

Create `.env.example` with the same keys but placeholder values.

## Step 7: Configure NestJS main.ts

- Enable `ValidationPipe` globally with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`
- Enable CORS
- Set port from `process.env.PORT || 3000`
- Log the startup URL

## Step 8: Configure AppModule

`app.module.ts` must import:
- `ConfigModule.forRoot({ isGlobal: true })`
- `ScheduleModule.forRoot()`
- `PrismaModule` (global)
- `QueueModule`
- `ReservationModule`
- `SeatModule`
- `MonitoringModule`
- `SchedulerModule`
- `HealthModule`

## Step 9: Create PrismaModule

`prisma/prisma.service.ts`:
- Extends `PrismaClient`
- Implements `OnModuleInit` (calls `$connect`)
- Implements `OnModuleDestroy` (calls `$disconnect`)

`prisma/prisma.module.ts`:
- Global module (`@Global()`)
- Exports `PrismaService`

## Step 10: Create QueueModule

`queue/queue.module.ts`:
- Imports `SqsModule.register()` from `@ssut/nestjs-sqs`
- Configure producer for `reservation-confirm` queue using `SQS_CONFIRM_QUEUE_URL` from ConfigService
- Configure consumer for `reservation-confirm` queue
- Set AWS endpoint, region, accessKeyId, secretAccessKey from env vars
- The AWS SDK client needs the endpoint override for LocalStack:

```typescript
import * as AWS from '@aws-sdk/client-sqs';

// Before SqsModule.register, configure the SDK
const sqsClient = new AWS.SQSClient({
  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
```

Register the module:

```typescript
SqsModule.register({
  consumers: [
    {
      name: 'reservation-confirm',
      queueUrl: process.env.SQS_CONFIRM_QUEUE_URL,
      region: process.env.AWS_REGION,
    },
  ],
  producers: [
    {
      name: 'reservation-confirm',
      queueUrl: process.env.SQS_CONFIRM_QUEUE_URL,
      region: process.env.AWS_REGION,
    },
  ],
})
```

## Step 11: Create Stub Modules

Create empty module, controller, and service files for: `ReservationModule`, `SeatModule`, `MonitoringModule`, `SchedulerModule`, `HealthModule`. Each module should be importable and not throw errors. Controllers can have placeholder endpoints that return `{ status: 'ok' }`.

## Step 12: Create common/constants/state-machine.ts

```typescript
export enum ReservationStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
}

export enum SeatStatus {
  AVAILABLE = 'AVAILABLE',
  HELD = 'HELD',
  BOOKED = 'BOOKED',
}

export const VALID_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  [ReservationStatus.PENDING]: [ReservationStatus.CONFIRMED, ReservationStatus.CANCELLED, ReservationStatus.REJECTED],
  [ReservationStatus.CONFIRMED]: [ReservationStatus.CANCELLED],
  [ReservationStatus.CANCELLED]: [],
  [ReservationStatus.REJECTED]: [],
};
```

## Step 13: Create common/filters/prisma-exception.filter.ts

Global exception filter that catches Prisma errors:
- `P2002` (unique constraint) → 409 Conflict
- `P2025` (record not found) → 404 Not Found
- Register it globally in `main.ts`

## Step 14: Create HealthModule

Use `@nestjs/terminus`:
- `GET /health` endpoint
- Check database connectivity (Prisma `$queryRaw SELECT 1`)
- Check SQS connectivity (attempt to get queue attributes via AWS SDK)

## Verification

After completing all steps, running `mprocs` should:
1. Start postgres and localstack via docker compose
2. LocalStack auto-creates SQS queues (check `docker compose logs localstack`)
3. Start NestJS API at :3000
4. `GET http://localhost:3000/health` returns `{ status: 'ok', info: { database: { status: 'up' }, sqs: { status: 'up' } } }`
5. `aws --endpoint-url=http://localhost:4566 sqs list-queues` shows both queues
6. All stub endpoints return `{ status: 'ok' }`