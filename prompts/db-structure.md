# 03 — Database Structure

## Role

You are creating the complete database schema, migrations, constraints, indexes, and seed data. After this document completes, the database should be fully migrated with test data ready.

## Prisma Schema

Create `prisma/schema.prisma` with the following models. Use `postgresql` as provider. Use `env("DATABASE_URL")` for the datasource.

### Enums

```prisma
enum EventStatus {
  SCHEDULED
  OPEN
  CLOSED
}

enum SeatStatus {
  AVAILABLE
  HELD
  BOOKED
}

enum ReservationStatus {
  PENDING
  CONFIRMED
  CANCELLED
  REJECTED
}
```

### Models

**Theater**
- `id`: Int, autoincrement PK
- `name`: String, not null
- `address`: String, optional
- `totalCapacity`: Int, not null
- `createdAt`: DateTime, default now
- Relations: has many Section, has many Event

**Section**
- `id`: Int, autoincrement PK
- `theaterId`: Int, FK to Theater
- `name`: String, not null (e.g. "Orchestra", "Mezzanine", "Balcony")
- `rows`: Int
- `seatsPerRow`: Int
- Unique constraint: `@@unique([theaterId, name])`
- Relations: belongs to Theater, has many Seat

**Seat**
- `id`: Int, autoincrement PK
- `sectionId`: Int, FK to Section
- `row`: String (e.g. "A", "B")
- `number`: Int (e.g. 1, 2, 3)
- `label`: String, optional (e.g. "A-12")
- Unique constraint: `@@unique([sectionId, row, number])`
- Relations: belongs to Section, has many EventSeat

**Event**
- `id`: Int, autoincrement PK
- `theaterId`: Int, FK to Theater
- `title`: String
- `startsAt`: DateTime
- `endsAt`: DateTime, optional
- `status`: EventStatus, default SCHEDULED
- `createdAt`: DateTime, default now
- Indexes: `@@index([startsAt])`, `@@index([theaterId])`
- Relations: belongs to Theater, has many EventSeat, has many Reservation

**EventSeat**
- `id`: Int, autoincrement PK
- `eventId`: Int, FK to Event
- `seatId`: Int, FK to Seat
- `status`: SeatStatus, default AVAILABLE
- `price`: Decimal(10,2)
- `updatedAt`: DateTime, @updatedAt
- Unique constraint: `@@unique([eventId, seatId])`
- Index: `@@index([eventId, status])`
- Relations: belongs to Event, belongs to Seat, has many ReservationSeat

**Reservation**
- `id`: String, @default(uuid()), PK
- `idempotencyKey`: String, optional, @unique
- `eventId`: Int, FK to Event
- `status`: ReservationStatus, default PENDING
- `expiresAt`: DateTime, optional
- `confirmedAt`: DateTime, optional
- `cancelledAt`: DateTime, optional
- `rejectedAt`: DateTime, optional
- `rejectionReason`: String, optional
- `cancellationReason`: String, optional
- `metadata`: Json, optional
- `createdAt`: DateTime, default now
- `updatedAt`: DateTime, @updatedAt
- Index: `@@index([status, expiresAt])`
- Index: `@@index([eventId])`
- Relations: belongs to Event, has many ReservationSeat, has many AuditLog

**ReservationSeat**
- `id`: Int, autoincrement PK
- `reservationId`: String, FK to Reservation
- `eventSeatId`: Int, FK to EventSeat
- `isActive`: Boolean, default true
- Unique constraint: `@@unique([reservationId, eventSeatId])`
- Unique constraint: `@@unique([eventSeatId, isActive])` — THIS IS THE DOUBLE-BOOKING CONSTRAINT
- Relations: belongs to Reservation, belongs to EventSeat

**AuditLog**
- `id`: Int, autoincrement PK
- `reservationId`: String, optional, FK to Reservation
- `entityType`: String (e.g. "Reservation", "EventSeat")
- `entityId`: String
- `action`: String (e.g. "CREATED", "STATUS_CHANGED", "SEAT_RELEASED", "JOB_SENT_TO_DLQ")
- `previousStatus`: String, optional
- `newStatus`: String
- `triggeredBy`: String (e.g. "api", "worker", "cron", "dlq")
- `metadata`: Json, optional
- `timestamp`: DateTime, default now
- Index: `@@index([reservationId])`
- Index: `@@index([timestamp])`
- Index: `@@index([entityType, action])`
- Relations: belongs to Reservation (optional)

## Custom SQL Migration

After running `prisma migrate dev --name init`, create a new empty migration:

```bash
pnpm dlx prisma migrate dev --name custom_constraints --create-only
```

Add the following SQL to the generated migration file:

```sql
-- CHECK: price must be positive
ALTER TABLE "EventSeat" ADD CONSTRAINT chk_price_positive
  CHECK (price > 0);

-- CHECK: expiresAt must be after createdAt
ALTER TABLE "Reservation" ADD CONSTRAINT chk_expires_after_created
  CHECK ("expiresAt" > "createdAt");

-- CHECK: confirmed reservations must have confirmedAt
ALTER TABLE "Reservation" ADD CONSTRAINT chk_confirmed_has_timestamp
  CHECK (("status" != 'CONFIRMED') OR ("confirmedAt" IS NOT NULL));

-- CHECK: cancelled reservations must have cancelledAt
ALTER TABLE "Reservation" ADD CONSTRAINT chk_cancelled_has_timestamp
  CHECK (("status" != 'CANCELLED') OR ("cancelledAt" IS NOT NULL));

-- CHECK: rejected reservations must have rejectedAt
ALTER TABLE "Reservation" ADD CONSTRAINT chk_rejected_has_timestamp
  CHECK (("status" != 'REJECTED') OR ("rejectedAt" IS NOT NULL));

-- PARTIAL INDEX: accelerate available seats query
CREATE INDEX idx_available_seats
  ON "EventSeat" ("eventId") WHERE status = 'AVAILABLE';

-- PARTIAL INDEX: accelerate cron expiration sweep
CREATE INDEX idx_pending_expirable
  ON "Reservation" ("expiresAt") WHERE status = 'PENDING';
```

Then apply: `pnpm dlx prisma migrate dev`

## Seed Script

Create `prisma/seed.ts`. Configure it in `package.json` under `prisma.seed`: `"ts-node prisma/seed.ts"`.

The seed must create:

1. **1 Theater**: "Grand Theater", capacity 200
2. **3 Sections**:
   - Orchestra: 10 rows × 10 seats = 100
   - Mezzanine: 5 rows × 8 seats = 40
   - Balcony: 5 rows × 6 seats = 30
3. **170 Seats** total with labels (e.g. "A-1", "B-5")
4. **2 Events**:
   - "Hamlet" — starts tomorrow, status: OPEN
   - "Swan Lake" — starts in 3 days, status: OPEN
5. **340 EventSeats** (170 per event) with prices:
   - Orchestra: $150.00
   - Mezzanine: $100.00
   - Balcony: $60.00

Use `createMany` for bulk inserts where possible. Use `upsert` for idempotent seeding (run seed multiple times without errors).

Run seed: `pnpm dlx prisma db seed`

## Verification

After completing all steps:
- `pnpm dlx prisma studio` shows all tables with data
- `SELECT count(*) FROM "EventSeat" WHERE status = 'AVAILABLE'` returns 340
- `SELECT count(*) FROM "Seat"` returns 170
- Unique constraint on `(eventSeatId, isActive)` exists on ReservationSeat
- CHECK constraints are active (try inserting price = -1, should fail)