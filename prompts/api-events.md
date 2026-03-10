# 04 — API, Events & Application Logic

## Role

You are implementing all NestJS controllers, services, DTOs, the SQS consumer, the cron scheduler, and the monitoring dashboard. Follow the architecture rules from `01-architecture.md` strictly: optimistic for create/expire, pessimistic for confirm/cancel, SQS for queue, grace period on expiration.

## Endpoints to Implement

```
POST   /events/:eventId/seats/generate     SeatController
GET    /events/:eventId/seats              SeatController
GET    /events/:eventId/seats/stats        SeatController
POST   /reservations                       ReservationController
GET    /reservations/:id                   ReservationController
POST   /reservations/:id/confirm           ReservationController
POST   /reservations/:id/cancel            ReservationController
GET    /monitoring/stats                   MonitoringController
GET    /monitoring/dashboard               MonitoringController
```

---

## SeatModule

### SeatController

**POST /events/:eventId/seats/generate**
- Generates EventSeat records for all seats in the event's theater
- Uses upsert (idempotent — can be called multiple times safely)
- Response: `{ generated: number, eventId: number }`

**GET /events/:eventId/seats**
- Query params: `status` (optional), `section` (optional)
- Returns seats grouped by section with status and price

**GET /events/:eventId/seats/stats**
- Returns count of seats by status for the event
- Response: `{ eventId, available: number, held: number, booked: number, total: number }`

### SeatService

- `generateEventSeats(eventId)`: Find all seats for the event's theater. Upsert EventSeat for each. Use `$transaction`.
- `findByEvent(eventId, filters)`: Query EventSeats with optional status/section filters.
- `getStats(eventId)`: Use `groupBy` on EventSeat status.

---

## ReservationModule

### DTOs

**CreateReservationDto**
- `idempotencyKey`: string, required, IsUUID
- `eventId`: number, required, IsInt
- `seatIds`: number[], required, IsArray, ArrayMinSize(1), each IsInt — these are EventSeat IDs

### ReservationController

**POST /reservations**
- Calls `ReservationService.create(dto)`
- Returns 201 with reservation data
- Returns 409 on conflict

**GET /reservations/:id**
- Calls `ReservationService.findOne(id)`
- Returns 404 if not found

**POST /reservations/:id/confirm**
- Accepts idempotencyKey in body
- Calls `ReservationService.enqueueConfirmation(id, idempotencyKey)`
- Returns 202 with `{ status: 'processing' }`

**POST /reservations/:id/cancel**
- Accepts optional `reason` in body
- Calls `ReservationService.cancel(id, reason)`
- Returns 200 with updated reservation

### ReservationService

**create(dto) — OPTIMISTIC LOCKING**

No read before write. Single atomic UPDATE checks availability.

```typescript
async create(dto: CreateReservationDto) {
  return this.prisma.$transaction(async (tx) => {
    try {
      // 1. OPTIMISTIC: atomic UPDATE, no SELECT
      const locked = await tx.eventSeat.updateMany({
        where: { id: { in: dto.seatIds }, status: 'AVAILABLE' },
        data: { status: 'HELD' },
      });

      if (locked.count !== dto.seatIds.length) {
        throw new ConflictException('One or more seats unavailable');
      }

      // 2. Create reservation with idempotency key
      const reservation = await tx.reservation.create({
        data: {
          idempotencyKey: dto.idempotencyKey,
          eventId: dto.eventId,
          status: 'PENDING',
          expiresAt: new Date(Date.now() + this.ttlMinutes * 60 * 1000),
          seats: {
            create: dto.seatIds.map(id => ({ eventSeatId: id, isActive: true })),
          },
        },
        include: { seats: { include: { eventSeat: { include: { seat: true } } } } },
      });

      // 3. Audit log
      await tx.auditLog.create({
        data: {
          reservationId: reservation.id,
          entityType: 'Reservation',
          entityId: reservation.id,
          action: 'CREATED',
          newStatus: 'PENDING',
          triggeredBy: 'api',
          metadata: { seatCount: dto.seatIds.length },
        },
      });

      return reservation;

    } catch (error) {
      // Idempotency: catch unique violation on idempotencyKey
      if (error.code === 'P2002' && error.meta?.target?.includes('idempotencyKey')) {
        return tx.reservation.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          include: { seats: { include: { eventSeat: { include: { seat: true } } } } },
        });
      }
      throw error;
    }
  });
}
```

**enqueueConfirmation(reservationId, idempotencyKey)**

Send message to SQS. No transaction needed — just dispatch.

```typescript
async enqueueConfirmation(reservationId: string, idempotencyKey: string) {
  // Quick check that reservation exists and is PENDING
  const reservation = await this.prisma.reservation.findUnique({
    where: { id: reservationId },
  });
  if (!reservation || reservation.status !== 'PENDING') {
    throw new ConflictException('Reservation is not pending');
  }

  await this.sqsService.send('reservation-confirm', {
    id: idempotencyKey,  // SQS message ID
    body: { reservationId, idempotencyKey },
  });

  return { status: 'processing' };
}
```

**confirm(reservationId) — PESSIMISTIC LOCKING**

Must read expiresAt to decide if still valid. Uses SELECT FOR UPDATE via $queryRaw.

```typescript
async confirm(reservationId: string) {
  const gracePeriodMs = this.gracePeriodMinutes * 60 * 1000;

  return this.prisma.$transaction(async (tx) => {
    // 1. PESSIMISTIC: lock the row, read data
    const [reservation] = await tx.$queryRaw<any[]>`
      SELECT * FROM "Reservation"
      WHERE id = ${reservationId}
      AND status = 'PENDING'
      FOR UPDATE
    `;

    if (!reservation) {
      throw new ConflictException('Reservation not found or not pending');
    }

    // 2. DECIDE: check expiration with grace period
    const expiresAt = new Date(reservation.expiresAt);
    const graceDeadline = new Date(expiresAt.getTime() + gracePeriodMs);

    if (new Date() > graceDeadline) {
      // Expired even with grace period — reject it
      await tx.reservation.update({
        where: { id: reservationId },
        data: { status: 'REJECTED', rejectedAt: new Date() },
      });
      await tx.eventSeat.updateMany({
        where: { reservationSeats: { some: { reservationId } } },
        data: { status: 'AVAILABLE' },
      });
      await tx.reservationSeat.updateMany({
        where: { reservationId },
        data: { isActive: false },
      });
      await tx.auditLog.create({
        data: {
          reservationId,
          entityType: 'Reservation',
          entityId: reservationId,
          action: 'STATUS_CHANGED',
          previousStatus: 'PENDING',
          newStatus: 'REJECTED',
          triggeredBy: 'worker',
          metadata: { reason: 'expired_during_confirmation' },
        },
      });
      throw new ConflictException('Reservation expired');
    }

    // 3. WRITE: confirm reservation and seats
    await tx.reservation.update({
      where: { id: reservationId },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });
    await tx.eventSeat.updateMany({
      where: { reservationSeats: { some: { reservationId } } },
      data: { status: 'BOOKED' },
    });
    await tx.auditLog.create({
      data: {
        reservationId,
        entityType: 'Reservation',
        entityId: reservationId,
        action: 'STATUS_CHANGED',
        previousStatus: 'PENDING',
        newStatus: 'CONFIRMED',
        triggeredBy: 'worker',
      },
    });
  });
}
```

**cancel(reservationId, reason?) — PESSIMISTIC LOCKING**

Must read status to validate transition.

```typescript
async cancel(reservationId: string, reason?: string) {
  return this.prisma.$transaction(async (tx) => {
    // 1. PESSIMISTIC: lock and read
    const [reservation] = await tx.$queryRaw<any[]>`
      SELECT * FROM "Reservation"
      WHERE id = ${reservationId}
      FOR UPDATE
    `;

    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    // 2. DECIDE: validate transition
    const validFrom = ['PENDING', 'CONFIRMED'];
    if (!validFrom.includes(reservation.status)) {
      throw new ConflictException(`Cannot cancel reservation in ${reservation.status} status`);
    }

    const previousStatus = reservation.status;

    // 3. WRITE: cancel and release seats
    await tx.reservation.update({
      where: { id: reservationId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: reason,
      },
    });
    await tx.eventSeat.updateMany({
      where: { reservationSeats: { some: { reservationId } } },
      data: { status: 'AVAILABLE' },
    });
    await tx.reservationSeat.updateMany({
      where: { reservationId },
      data: { isActive: false },
    });
    await tx.auditLog.create({
      data: {
        reservationId,
        entityType: 'Reservation',
        entityId: reservationId,
        action: 'STATUS_CHANGED',
        previousStatus,
        newStatus: 'CANCELLED',
        triggeredBy: 'api',
        metadata: { reason: reason || 'user_initiated' },
      },
    });
  });
}
```

**findOne(reservationId)**

Simple findUnique with includes. Throw NotFoundException if null.

### ReservationConsumer (SQS)

Create `reservation.consumer.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { SqsMessageHandler, SqsConsumerEventHandler } from '@ssut/nestjs-sqs';
import { Message } from '@aws-sdk/client-sqs';
import { ReservationService } from './reservation.service';

@Injectable()
export class ReservationConsumer {
  constructor(private readonly reservationService: ReservationService) {}

  @SqsMessageHandler('reservation-confirm', false)
  async handleMessage(message: Message) {
    const body = JSON.parse(message.Body);
    await this.reservationService.confirm(body.reservationId);
  }

  @SqsConsumerEventHandler('reservation-confirm', 'processing_error')
  async onProcessingError(error: Error, message: Message) {
    const body = JSON.parse(message.Body);
    // Log to audit when message fails (will go to DLQ after 3 attempts)
    // This is informational — SQS handles retry/DLQ automatically
    console.error(`SQS processing error for reservation ${body.reservationId}:`, error.message);
  }
}
```

Register `ReservationConsumer` as a provider in `ReservationModule`.

---

## SchedulerModule

### SchedulerService

**@Cron('*/1 * * * *') — expireReservations() — OPTIMISTIC LOCKING**

Uses grace period: only expire reservations that are past `expiresAt + GRACE_PERIOD`.

```typescript
@Cron(CronExpression.EVERY_MINUTE)
async expireReservations() {
  if (this.isRunning) return;
  this.isRunning = true;

  try {
    const gracePeriodMs = this.gracePeriodMinutes * 60 * 1000;
    const graceDeadline = new Date(Date.now() - gracePeriodMs);

    await this.prisma.$transaction(async (tx) => {
      // Find expired IDs (past grace period)
      const expiredIds = await tx.reservation.findMany({
        where: {
          status: 'PENDING',
          expiresAt: { lte: graceDeadline },  // expiresAt + grace < now
        },
        select: { id: true },
      });

      if (expiredIds.length === 0) return;

      const ids = expiredIds.map(r => r.id);

      await tx.reservation.updateMany({
        where: { id: { in: ids } },
        data: { status: 'REJECTED', rejectedAt: new Date() },
      });
      await tx.eventSeat.updateMany({
        where: { reservationSeats: { some: { reservationId: { in: ids } } } },
        data: { status: 'AVAILABLE' },
      });
      await tx.reservationSeat.updateMany({
        where: { reservationId: { in: ids } },
        data: { isActive: false },
      });

      // Bulk audit log
      await tx.auditLog.createMany({
        data: ids.map(id => ({
          reservationId: id,
          entityType: 'Reservation',
          entityId: id,
          action: 'STATUS_CHANGED',
          previousStatus: 'PENDING',
          newStatus: 'REJECTED',
          triggeredBy: 'cron',
          metadata: { reason: 'reservation_timeout' },
        })),
      });

      this.logger.log(`Expired ${ids.length} reservations`);
    });
  } finally {
    this.isRunning = false;
  }
}
```

---

## MonitoringModule

The monitoring system has 3 pieces, zero additional containers:

1. **GET /monitoring/stats** — system metrics as JSON (~10 min)
2. **GET /monitoring/dashboard** — vanilla HTML dashboard polling stats every 2s (~15 min)
3. **GET /health** — structured health check (already in HealthModule)

### MonitoringService

**getStats()** must return:

```typescript
{
  timestamp: string,
  uptime: number,                 // process.uptime()
  memory: {
    rss: number,                  // process.memoryUsage()
    heapUsed: number,
    heapTotal: number,
  },
  reservations: {
    pending: number,              // prisma groupBy status
    confirmed: number,
    cancelled: number,
    rejected: number,
    total: number,
  },
  seats: {
    available: number,            // prisma groupBy on EventSeat.status
    held: number,
    booked: number,
    total: number,
  },
  recentActivity: Array<{        // last 20 audit_log entries desc by timestamp
    action: string,
    reservationId: string,
    previousStatus: string | null,
    newStatus: string,
    triggeredBy: string,
    timestamp: string,
    metadata: any,
  }>,
}
```

Implementation: use `prisma.reservation.groupBy`, `prisma.eventSeat.groupBy`, `prisma.auditLog.findMany({ take: 20, orderBy: { timestamp: 'desc' } })`.

### MonitoringController

**GET /monitoring/stats** — returns JSON from MonitoringService

**GET /monitoring/dashboard** — serves self-contained HTML page using `@Res()` with `res.type('html').send(HTML_STRING)`.

The HTML must:
- Use recursive `setTimeout(poll, 2000)` (NOT setInterval)
- Fetch `/monitoring/stats` and render cards for: reservations by status, seats by status, system memory
- Display a table of recent activity from audit_log
- Dark theme, inline CSS, zero external dependencies
- Show green/red connection dot and last-updated timestamp

Use the complete HTML template from the architecture docs (dark theme with flexbox cards, color-coded tags for triggeredBy).

---

## Global Error Handling

### PrismaExceptionFilter

Handles:
- `P2002` → 409 with message about which field caused the unique violation
- `P2025` → 404 with "Resource not found"
- All other Prisma errors → 500

---

## Verification

After completing all steps:

1. `POST /events/1/seats/generate` creates EventSeats with status AVAILABLE
2. `POST /reservations` with valid seatIds returns 201 with status PENDING
3. Same request with same idempotencyKey returns 201 with same reservationId (idempotent)
4. `POST /reservations/:id/confirm` returns 202, SQS message sent
5. SQS consumer processes → reservation CONFIRMED, seats BOOKED
6. `POST /reservations/:id/cancel` on PENDING → CANCELLED, seats AVAILABLE
7. `POST /reservations/:id/cancel` on CONFIRMED → CANCELLED, seats AVAILABLE
8. Cron respects grace period: reservations expire at `expiresAt + 2min`, not `expiresAt`
9. `/monitoring/stats` returns live data
10. `/monitoring/dashboard` shows live updating HTML page
11. `/health` checks database and SQS