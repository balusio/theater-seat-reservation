# Theater Seat Reservation System

A concurrent seat reservation system built with NestJS that handles multiple users competing for limited seats simultaneously, maintaining data integrity through pessimistic locking, idempotency keys, and database-level constraints.

## Architecture Foundation

Based on **Alex Xu's System Design Interview Vol. 2, Chapter 7: Hotel Reservation System**, this system adapts the following concepts to a theater context:

- **State machine** of a reservation lifecycle (Pending → Confirmed | Cancelled | Rejected)
- **Concurrency control** through pessimistic locking with database transactions
- **Idempotency** to prevent duplicate bookings from retries or network failures
- **Race condition prevention** between expiration cron and confirmation events

The hotel reservation model was adapted for theater because theater has a key difference: the same physical seat has independent availability per event, requiring an `EventSeat` entity that the hotel model doesn't need (a hotel room is the resource itself).

---

## Architecture Decisions

### Why pessimistic locking for confirmations?

Following Alex Xu's analysis, we use **pessimistic locking (`SELECT FOR UPDATE`)** for operations that need to read-then-decide-then-write: confirming and cancelling reservations. The confirm flow must read the reservation's `expiresAt`, decide if it's still valid, and then update both the reservation and its seats. Without a lock, the expiration cron can modify the row between the read and the write.

For **creating reservations** (locking seats), we use **optimistic locking** — an atomic `UPDATE WHERE status = 'AVAILABLE'` that checks the count. No read is needed before writing, so no lock is needed.

```
Operation              Strategy          Why
─────────────────────────────────────────────────────────────
Create reservation     OPTIMISTIC        No read needed — UPDATE WHERE AVAILABLE, check count
Confirm reservation    PESSIMISTIC       Must read expiresAt, validate, then write
Cancel reservation     PESSIMISTIC       Must read current status, validate transition, then write
Expire (cron)          OPTIMISTIC        Bulk UPDATE WHERE PENDING AND expiresAt <= NOW()
```

This is the same mixed approach Alex Xu recommends: optimistic for high-throughput paths, pessimistic for critical state transitions.

### Why SQS (LocalStack) instead of BullMQ?

Three reasons:

**1. Message durability when the system goes down.** This is the critical scenario: the user pays, a confirmation message enters the queue, and the system crashes. With BullMQ, jobs live in Redis inside the same infrastructure — if the app goes down for more than 5 minutes, the cron revives and expires the reservation before the worker processes the confirmation. The user paid but lost their seats.

With SQS, messages persist independently of the application. When the system comes back up, the consumer processes pending confirmations before the cron runs its next sweep. SQS messages have a configurable visibility timeout and can survive days in the queue.

**2. Native DLQ without extra code.** SQS Dead Letter Queues are a first-class AWS feature — you declare a `RedrivePolicy` with `maxReceiveCount` and SQS automatically moves failed messages after N attempts. No event listeners, no manual job movement, no `removeOnFail: false` workaround.

**3. Idempotency belongs in one layer, not two.** BullMQ's `jobId` deduplication creates a second idempotency layer that duplicates what the database `@unique` constraint already does. The queue should be just transport — it doesn't own deduplication logic.

Stack: `@ssut/nestjs-sqs` (v3.0.1, decorator-based like BullMQ) + LocalStack for local development. In production, swap the endpoint URL — zero code changes.

### Why a grace period on expiration?

The naive approach expires any reservation where `expiresAt < NOW()`. This is dangerous:

```
10:00  User reserves seat (PENDING, expires 10:05)
10:03  User pays → confirmation message enters SQS
10:04  System crashes
10:07  System recovers
10:07  Cron: "expiresAt < NOW()" → REJECTED (user loses seats despite paying)
10:07  SQS consumer: processes confirmation → "not PENDING" → FAILS
```

The fix: a **2-minute grace period**. The confirm allows up to 2 minutes past `expiresAt`. The cron only expires reservations past the grace period. This gives the system time to process queued confirmations after recovery.

```
Confirm:  WHERE expiresAt > NOW() - INTERVAL '2 minutes'
Cron:     WHERE expiresAt < NOW() - INTERVAL '2 minutes'
```

### Why idempotency lives on the Reservation table?

The `idempotencyKey` is a `@unique` column on Reservation. Before starting a transaction, the service checks if a reservation with that key already exists — if so, it returns it immediately without touching any seats.

A separate IdempotencyKey table with an interceptor was discarded because it operates outside the main transaction — three separate DB operations that can leave inconsistent state if the app crashes between them. With the column approach, the key is part of the reservation itself: if the transaction commits, the key is saved; if it fails, the key doesn't exist.

The confirmation endpoint also receives an `idempotencyKey` in the request body, used as the SQS message `id` for deduplication at the queue transport level. This is a different key from the reservation's — it prevents the same confirmation from being enqueued twice.

### Why CANCELLED vs REJECTED?

`CANCELLED` = user-initiated action (voluntary).
`REJECTED` = system-initiated action (timeout, conflict, worker failure).

This distinction feeds the monitoring dashboard: timeout rate (are 5 minutes enough?) vs voluntary cancellation rate (is there a UX problem?).

### Why EventSeat as a separate entity?

A physical seat (A-12) is permanent. Its availability changes per event. Without `EventSeat`, you can only sell one event at a time. The `EventSeat` table holds the per-event state machine and price (same seat can cost differently per show).

---

## Three Layers of Protection Against Double-Booking

```
Layer 1 — Idempotency Key (@unique on Reservation)
  Prevents: duplicate requests from the same user (retries, double-click)
  How: INSERT fails with P2002 → return existing reservation

Layer 2 — Locking Strategy (optimistic + pessimistic in transactions)
  Prevents: two different users booking the same seat
  How: UPDATE WHERE status='AVAILABLE' → count=0 means seat taken

Layer 3 — Database Constraint (UNIQUE on ReservationSeat(eventSeatId, isActive))
  Prevents: any bug in layers 1 and 2
  How: PostgreSQL physically rejects duplicate active reservations
```

Each layer is independent. If one has a bug, the other two catch it.

---

## State Machines

### Reservation Status

```
                    POST /reservations
                           │
                           ▼
                    ┌─────────────┐
                    │   PENDING   │ ← timer: 5 min + 2 min grace
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
         confirm        system          user
            │           rejects        cancels
            ▼              ▼              ▼
     ┌────────────┐ ┌────────────┐ ┌────────────┐
     │ CONFIRMED  │ │  REJECTED  │ │ CANCELLED  │
     └─────┬──────┘ └────────────┘ └────────────┘
           │          (terminal)     (terminal)
           │ user cancels
           ▼
     ┌────────────┐
     │ CANCELLED  │
     └────────────┘
      (terminal)
```

### EventSeat Status (coupled — always changes in same transaction)

```
  AVAILABLE → HELD → BOOKED → AVAILABLE (cycles on cancel/reject)
```

---

## Data Model

Full database diagram: [dbdiagram.io](https://dbdiagram.io/d/69b0209ccf54053b6f4ecd9a)

Key entities:

- `Theater` → `Section` → `Seat` (physical infrastructure)
- `Event` → `EventSeat` (per-event seat availability + price)
- `Reservation` → `ReservationSeat` (booking unit, N seats per reservation)
- `AuditLog` (every state transition, feeds monitoring)

### Database Constraints

```
EventSeat
├── UNIQUE (eventId, seatId)
├── CHECK price > 0
└── FK → Event, Seat

ReservationSeat
├── UNIQUE (eventSeatId, isActive)     ← prevents double-booking at DB level
├── UNIQUE (reservationId, eventSeatId)
└── FK → Reservation, EventSeat

Reservation
├── UNIQUE idempotencyKey              ← prevents duplicate requests
├── CHECK expiresAt > createdAt
├── CHECK CONFIRMED → confirmedAt NOT NULL
├── CHECK CANCELLED → cancelledAt NOT NULL
├── CHECK REJECTED → rejectedAt NOT NULL
└── FK → Event
```

---

## SQS Queue Architecture

```
                    ┌─────────────────────────┐
                    │   reservation-confirm    │ ← SQS Queue
                    │   visibilityTimeout: 30s │
                    │   maxReceiveCount: 3      │
                    └───────────┬──────────────┘
                                │
                         on 3 failures
                                │
                                ▼
                    ┌─────────────────────────┐
                    │ reservation-confirm-dlq  │ ← SQS DLQ (native)
                    │ messages stay for 14 days │
                    └──────────────────────────┘
```

LocalStack runs SQS locally. Queues are created via CLI on `docker compose up`. In production, replace LocalStack endpoint with real AWS SQS — zero code changes.

`@ssut/nestjs-sqs` provides NestJS decorators:
- `@SqsMessageHandler('queue-name')` — consumer (like BullMQ's `@Processor`)
- `@SqsConsumerEventHandler('queue-name', 'processing_error')` — error handler
- `sqsService.send('queue-name', { id, body })` — producer

---

## Monitoring

All served from the same NestJS process, zero additional containers:

| URL | What it shows |
|-----|--------------|
| `/monitoring/stats` | JSON: reservation counts, seat stats, recent audit log |
| `/monitoring/dashboard` | Live HTML dashboard polling every 2s with dark theme cards |
| `/health` | Structured health check: PostgreSQL + SQS status |

The `AuditLog` table is the single source of truth. Every state transition writes an entry with `action`, `previousStatus`, `newStatus`, `triggeredBy` (api / worker / cron / dlq), and `metadata`.

---

## Assumptions

- A theater hosts **multiple events**; the same physical seat is sold independently per event
- A user can reserve **multiple seats** in one operation (e.g., 4 tickets for a family)
- Sections (Orchestra, Mezzanine, Balcony) exist with different pricing per event
- **"Auto-cancel after 5 minutes"** means REJECTED (system action) with a 2-minute grace period for system recovery
- The cron runs every minute; with grace period, effective expiration is ~7 minutes worst case
- **"Real-time monitoring"** means polling every 2 seconds
- **No user authentication** (challenge explicitly excludes this)
- **No payment system** (challenge explicitly excludes this) — confirmation simulates a successful payment webhook
- The `idempotencyKey` is client-generated (UUID v7) and sent in the request body

---

## Caveats and Considerations

- **Pessimistic locking requires `$queryRaw` in Prisma.** `SELECT FOR UPDATE` is not natively supported by Prisma's query API. We use raw queries inside interactive transactions for confirm and cancel. This trades type safety for correctness on the two most critical operations.

- **LocalStack can be flaky.** SQS on LocalStack occasionally has higher latency than real AWS. For this challenge it works reliably. In production, swap the endpoint URL — the code stays identical.

- **Prisma transactions have a performance cost.** Every write runs inside a transaction. For theater scale (hundreds of seats), this is not a bottleneck. For Ticketmaster scale, add PgBouncer for connection pooling.

- **If the system goes down and the cron couldn't run**, SQS preserves the confirmation messages. When the system recovers, the grace period ensures confirmations process before the cron expires them. This is the primary advantage over an in-process queue like BullMQ.

- **SQS does not provide a built-in dashboard** like bull-board. Monitoring is handled through our custom HTML dashboard + audit_log. For production, AWS CloudWatch provides SQS metrics natively.

---

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Framework | NestJS (nest-cli) | REST API, DI, decorators |
| ORM | Prisma | Queries, `$transaction`, `$queryRaw` |
| Database | PostgreSQL 16 | ACID, constraints, partial indexes |
| Queue | AWS SQS (LocalStack) | Confirmation processing, native DLQ |
| SQS Client | `@ssut/nestjs-sqs` v3 | Decorator-based consumer/producer |
| Scheduler | `@nestjs/schedule` | Cron for reservation expiration |
| Health | `@nestjs/terminus` | Liveness/readiness checks |
| Infra | Docker Compose | postgres + localstack |
| Dev Tools | mprocs | Run all services in one terminal |

---

## Requirements

- Node.js 22+ (or nvm)
- pnpm
- Docker & Docker Compose
- [mprocs](https://github.com/pvolok/mprocs) (optional, for smooth local dev)
- AWS CLI (for LocalStack queue creation)

## Running Locally

```bash
# Clone and install
git clone <repo-url> && cd theater-reservation
cp .env.example .env
pnpm install

# Start infrastructure (postgres + localstack)
docker compose up -d

# Create SQS queues in LocalStack
aws --endpoint-url=http://localhost:4566 sqs create-queue \
  --queue-name reservation-confirm-dlq
aws --endpoint-url=http://localhost:4566 sqs create-queue \
  --queue-name reservation-confirm \
  --attributes '{
    "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:reservation-confirm-dlq\",\"maxReceiveCount\":\"3\"}"
  }'

# Setup database
pnpm dlx prisma migrate deploy
pnpm dlx prisma db seed

# Start API
pnpm run start:dev

# Or use mprocs (starts infra + api + prisma studio)
mprocs
```

### Available endpoints

```
API:        http://localhost:3000
Dashboard:  http://localhost:3000/monitoring/dashboard
Stats:      http://localhost:3000/monitoring/stats
Health:     http://localhost:3000/health
```

### Running tests

```bash
pnpm test          # unit tests
pnpm test:cov      # with coverage report
```

---

## References

- Alex Xu, *System Design Interview Vol. 2* — Chapter 7: Hotel Reservation System