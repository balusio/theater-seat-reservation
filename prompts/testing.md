# 05 — Testing

## Role

You are the test architect. Tests call services directly using Jest + NestJS Testing Module. No supertest. Tests run against real PostgreSQL and LocalStack SQS via Docker Compose.

## Setup

### Test database

Create `.env.test`:

```
DATABASE_URL=postgresql://reservation_user:reservation_pass@localhost:5432/reservation_test_db
AWS_REGION=us-east-1
AWS_ENDPOINT=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
SQS_CONFIRM_QUEUE_URL=http://localhost:4566/000000000000/reservation-confirm
SQS_CONFIRM_DLQ_URL=http://localhost:4566/000000000000/reservation-confirm-dlq
RESERVATION_TTL_MINUTES=1
RESERVATION_GRACE_PERIOD_MINUTES=1
```

### package.json scripts

```json
{
  "scripts": {
    "test": "jest",
    "test:e2e": "dotenv -e .env.test -- jest --config ./test/jest-e2e.json --runInBand",
    "test:db:setup": "dotenv -e .env.test -- pnpm dlx prisma migrate deploy && dotenv -e .env.test -- pnpm dlx prisma db seed"
  }
}
```

Install: `pnpm add -D dotenv-cli`

`--runInBand`: tests share the same database, must run sequentially.

### jest-e2e.json

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "testTimeout": 30000,
  "moduleNameMapper": { "^src/(.*)$": "<rootDir>/src/$1" }
}
```

### Shared test helper

Create `test/helpers/setup.ts` that exports:

- `createTestingApp()`: builds NestJS testing module from AppModule, returns `{ app, prisma, reservationService, seatService, schedulerService, monitoringService }`
- `cleanDatabase(prisma)`: deletes AuditLog, ReservationSeat, Reservation (in order), resets all EventSeat status to AVAILABLE

---

## Test 1: Reservation Lifecycle

File: `test/reservation.e2e-spec.ts`

**"should create a reservation with PENDING status"**
1. `reservationService.create(...)` with seatIds [1, 2]
2. Assert: `status === 'PENDING'`, `expiresAt` in the future, `seats.length === 2`
3. Query DB: both EventSeats `status === 'HELD'`
4. Query DB: 1 AuditLog with `action === 'CREATED'`

**"should throw ConflictException when seats are taken"**
1. Create with seatIds [1, 2] → succeeds
2. Create with seatIds [1, 3] different key → `rejects.toThrow(ConflictException)`
3. Query DB: seat 3 still AVAILABLE (rollback freed it)

**"should confirm a reservation (pessimistic lock)"**
1. Create → get id
2. `reservationService.confirm(id)` — this uses SELECT FOR UPDATE internally
3. Query: `status === 'CONFIRMED'`, `confirmedAt` not null
4. Query: EventSeats `status === 'BOOKED'`

**"should throw when confirming expired reservation past grace period"**
1. Create reservation
2. Set expiresAt to past the grace period: `prisma.reservation.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 5 * 60 * 1000) } })`
3. `expect(reservationService.confirm(id)).rejects.toThrow(ConflictException)`

**"should confirm within grace period even if expiresAt passed"**
1. Create reservation
2. Set expiresAt to 30 seconds ago (within 1-min test grace period): `prisma.reservation.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 30000) } })`
3. `reservationService.confirm(id)` → should SUCCEED
4. Query: `status === 'CONFIRMED'`

**"should cancel a PENDING reservation (pessimistic lock)"**
1. Create → cancel
2. Query: `status === 'CANCELLED'`, EventSeats AVAILABLE, ReservationSeat `isActive === false`

**"should cancel a CONFIRMED reservation"**
1. Create → confirm → cancel
2. Query: `status === 'CANCELLED'`, EventSeats AVAILABLE

**"should throw when cancelling already cancelled"**
1. Create → cancel → cancel again → `rejects.toThrow(ConflictException)`

**"should reject expired reservations via cron (respecting grace period)"**
1. Create reservation
2. Set expiresAt past the grace period
3. `schedulerService.expireReservations()`
4. Query: `status === 'REJECTED'`, EventSeats AVAILABLE
5. AuditLog: `triggeredBy === 'cron'`, `newStatus === 'REJECTED'`

**"should NOT expire reservations within grace period"**
1. Create reservation
2. Set expiresAt to 30 seconds ago (within grace period)
3. `schedulerService.expireReservations()`
4. Query: `status` is still `'PENDING'` (not expired yet)

---

## Test 2: Seat Management

File: `test/seat.e2e-spec.ts`

**"should generate event seats idempotently"**
1. `seatService.generateEventSeats(eventId)` → count
2. Call again → same count, no errors

**"should return correct stats"**
1. Reserve 3, confirm 2
2. `seatService.getStats(eventId)`
3. Assert `held === 1`, `booked === 2`, all sum to total

---

## Test 3: Concurrent Stress Test

File: `test/concurrent.e2e-spec.ts`

**"50 concurrent requests for same seat → exactly 1 winner"**

```typescript
const CONCURRENT = 50;
const targetSeatId = 1;

const results = await Promise.allSettled(
  Array.from({ length: CONCURRENT }, () =>
    reservationService.create({
      idempotencyKey: randomUUID(),
      eventId: 1,
      seatIds: [targetSeatId],
    })
  )
);

const successes = results.filter(r => r.status === 'fulfilled');
const failures = results.filter(r => r.status === 'rejected');

expect(successes).toHaveLength(1);
expect(failures).toHaveLength(CONCURRENT - 1);

const seat = await prisma.eventSeat.findUnique({ where: { id: targetSeatId } });
expect(seat.status).toBe('HELD');

const active = await prisma.reservationSeat.count({
  where: { eventSeatId: targetSeatId, isActive: true },
});
expect(active).toBe(1);
```

**"20 concurrent overlapping seat requests → atomic all-or-nothing"**

Fire 20 requests each wanting seats [1, 2, 3]. Exactly 1 succeeds. All 3 seats HELD together. Failed requests have 0 seats HELD (rollback).

**"should not double-confirm (pessimistic lock prevents it)"**

```typescript
const reservation = await reservationService.create({
  idempotencyKey: randomUUID(), eventId: 1, seatIds: [1],
});

await reservationService.confirm(reservation.id);

await expect(
  reservationService.confirm(reservation.id)
).rejects.toThrow(ConflictException);

const logs = await prisma.auditLog.count({
  where: { reservationId: reservation.id, newStatus: 'CONFIRMED' },
});
expect(logs).toBe(1);
```

---

## Test 4: Monitoring

File: `test/monitoring.e2e-spec.ts`

**"should return accurate stats"**
1. Create 3 reservations, confirm 1, cancel 1
2. `monitoringService.getStats()`
3. Assert counts match

---

## Running

```bash
docker compose up -d
docker compose exec postgres createdb -U reservation_user reservation_test_db
pnpm run test:db:setup
pnpm run test:e2e
```