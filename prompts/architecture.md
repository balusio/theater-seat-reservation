# 01 — Architecture Foundation

## Role

You are building a theater seat reservation system with NestJS. This document defines the architectural rules that ALL other documents must follow. Based on Alex Xu's System Design Interview Vol. 2, Chapter 7: Hotel Reservation System.

## Stack

- **Runtime**: Node.js 22+ with pnpm
- **Framework**: NestJS (nest-cli, NOT NX)
- **ORM**: Prisma with PostgreSQL 16
- **Queue**: AWS SQS via LocalStack (`@ssut/nestjs-sqs` v3)
- **Scheduler**: @nestjs/schedule
- **Health**: @nestjs/terminus
- **Validation**: class-validator + class-transformer
- **Infrastructure**: Docker Compose (postgres, localstack) + mprocs for local dev

## Project Structure

```
theater-reservation/
├── docker-compose.yml
├── mprocs.yaml
├── init-localstack.sh
├── .env
├── .env.example
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts
│   └── migrations/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── prisma/
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts
│   ├── reservation/
│   │   ├── reservation.module.ts
│   │   ├── reservation.controller.ts
│   │   ├── reservation.service.ts
│   │   ├── reservation.consumer.ts
│   │   └── dto/
│   │       ├── create-reservation.dto.ts
│   │       └── reservation-response.dto.ts
│   ├── seat/
│   │   ├── seat.module.ts
│   │   ├── seat.controller.ts
│   │   └── seat.service.ts
│   ├── monitoring/
│   │   ├── monitoring.module.ts
│   │   ├── monitoring.controller.ts
│   │   └── monitoring.service.ts
│   ├── queue/
│   │   └── queue.module.ts
│   ├── scheduler/
│   │   ├── scheduler.module.ts
│   │   └── scheduler.service.ts
│   ├── health/
│   │   ├── health.module.ts
│   │   └── health.controller.ts
│   └── common/
│       ├── filters/
│       │   └── prisma-exception.filter.ts
│       └── constants/
│           └── state-machine.ts
├── test/
│   ├── reservation.e2e-spec.ts
│   └── idempotency.e2e-spec.ts
└── package.json
```

## Core Architectural Rules

### Rule 1: Mixed Locking Strategy (Alex Xu Ch.7)

Two strategies, each used where it fits:

**Optimistic locking** — for operations that don't need to read before writing:

```typescript
// CREATE reservation (lock seats) and EXPIRE (cron bulk update)
const result = await tx.eventSeat.updateMany({
  where: { id: { in: seatIds }, status: 'AVAILABLE' },
  data: { status: 'HELD' },
});
if (result.count !== seatIds.length) {
  throw new ConflictException('Seats unavailable');
}
```

**Pessimistic locking** — for operations that must read-then-decide-then-write:

```typescript
// CONFIRM and CANCEL — must read expiresAt/status, validate, then update
const [reservation] = await tx.$queryRaw<Reservation[]>`
  SELECT * FROM "Reservation"
  WHERE id = ${reservationId}
  AND status = 'PENDING'
  FOR UPDATE
`;
// now validate, decide, and write — no one else can touch this row
```

```
Operation              Strategy          Why
──────────────────────────────────────────────────────────────────
Create reservation     OPTIMISTIC        UPDATE WHERE AVAILABLE, check count
Confirm reservation    PESSIMISTIC       Must read expiresAt, validate grace period
Cancel reservation     PESSIMISTIC       Must read status, validate transition
Expire (cron)          OPTIMISTIC        Bulk UPDATE WHERE PENDING AND expired
Generate EventSeats    OPTIMISTIC        Upsert, idempotent
```

### Rule 2: Coupled State Transitions

Reservation and EventSeat ALWAYS change state within the SAME `$transaction`. Never one without the other.

```
Reservation → PENDING    +  EventSeat → HELD       (together)
Reservation → CONFIRMED  +  EventSeat → BOOKED     (together)
Reservation → CANCELLED  +  EventSeat → AVAILABLE  (together)
Reservation → REJECTED   +  EventSeat → AVAILABLE  (together)
```

### Rule 3: Idempotency via Column, Not Interceptor

No separate IdempotencyKey table. No interceptor. The `idempotencyKey` field on Reservation with a UNIQUE constraint handles it. Catch Prisma `P2002` error to detect duplicates. Everything in one transaction.

### Rule 4: State Machine

```typescript
enum ReservationStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
}

const VALID_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  PENDING:   ['CONFIRMED', 'CANCELLED', 'REJECTED'],
  CONFIRMED: ['CANCELLED'],
  CANCELLED: [],
  REJECTED:  [],
};
```

- `CANCELLED` = user-initiated cancellation
- `REJECTED` = system-initiated (timeout, conflict, worker failure)

### Rule 5: SQS for Confirmation Queue

- Confirmation goes through SQS queue (`reservation-confirm`)
- SQS provides native DLQ (`reservation-confirm-dlq`) with `maxReceiveCount: 3`
- Messages survive independently of the application (critical for system-down recovery)
- Idempotency is handled ONLY at the database level (not duplicated in the queue)
- `@ssut/nestjs-sqs` provides NestJS decorators: `@SqsMessageHandler`, `@SqsConsumerEventHandler`
- LocalStack for local development, real AWS SQS in production (swap endpoint URL only)

### Rule 6: Grace Period on Expiration

The cron must NOT blindly expire reservations at `expiresAt`. A 2-minute grace period prevents losing confirmed reservations after system recovery.

```
Confirm:  WHERE expiresAt > NOW() - INTERVAL '2 minutes'   (allows 2min past expiry)
Cron:     WHERE expiresAt < NOW() - INTERVAL '2 minutes'   (waits 2min past expiry)
```

This solves the critical scenario: user pays → message enters SQS → system crashes → system recovers → cron should NOT expire what's waiting to be confirmed.

### Rule 7: Three Layers of Protection

```
Layer 1: idempotencyKey @unique on Reservation    → prevents duplicate requests
Layer 2: Locking (optimistic + pessimistic)        → prevents double-booking (app level)
Layer 3: UNIQUE(event_seat_id, is_active) constraint → prevents double-booking (DB level)
```

### Rule 8: Audit Everything

Every state transition creates an AuditLog entry with: `action`, `previousStatus`, `newStatus`, `triggeredBy` (api | worker | cron | dlq), `metadata` (JSON with context).

## Module Dependency Graph

```
AppModule
├── PrismaModule          (global)
├── QueueModule           (SQS config via @ssut/nestjs-sqs)
├── ReservationModule     (imports: PrismaModule, QueueModule)
├── SeatModule            (imports: PrismaModule)
├── MonitoringModule      (imports: PrismaModule)
├── SchedulerModule       (imports: PrismaModule)
└── HealthModule          (imports: TerminusModule)
```

## Environment Variables

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
CRON_EXPIRATION_INTERVAL=*/1 * * * *
```