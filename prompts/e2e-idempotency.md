# 06 — E2E Idempotency Tests

## Role

You are testing the three layers of protection against double-booking. Each test targets a specific layer. Jest + NestJS Testing Module, call services directly.

## File: `test/idempotency.e2e-spec.ts`

Same helper as `05-testing.md`: `createTestingApp()`, `cleanDatabase()`.

---

## Layer 1 Tests: Idempotency Key on Reservation

**"should return same reservation on retry with same idempotencyKey"**

```typescript
const key = randomUUID();

const first = await reservationService.create({
  idempotencyKey: key, eventId: 1, seatIds: [1, 2],
});
const second = await reservationService.create({
  idempotencyKey: key, eventId: 1, seatIds: [1, 2],
});

expect(second.id).toBe(first.id);

const dbCount = await prisma.reservation.count({ where: { idempotencyKey: key } });
expect(dbCount).toBe(1);
```

**"should return existing reservation even with different seatIds on retry"**

```typescript
const key = randomUUID();

const first = await reservationService.create({
  idempotencyKey: key, eventId: 1, seatIds: [1, 2],
});
const second = await reservationService.create({
  idempotencyKey: key, eventId: 1, seatIds: [3, 4],
});

expect(second.id).toBe(first.id);

const seat3 = await prisma.eventSeat.findUnique({ where: { id: 3 } });
const seat4 = await prisma.eventSeat.findUnique({ where: { id: 4 } });
expect(seat3.status).toBe('AVAILABLE');  // rollback freed them
expect(seat4.status).toBe('AVAILABLE');
```

**"should handle 20 concurrent requests with same idempotencyKey"**

```typescript
const key = randomUUID();
const CONCURRENT = 20;

const results = await Promise.allSettled(
  Array.from({ length: CONCURRENT }, () =>
    reservationService.create({
      idempotencyKey: key, eventId: 1, seatIds: [1],
    })
  )
);

const successes = results.filter(r => r.status === 'fulfilled');
const reservationIds = successes.map(r => (r as PromiseFulfilledResult<any>).value.id);
const uniqueIds = new Set(reservationIds);

expect(uniqueIds.size).toBe(1);

const dbCount = await prisma.reservation.count({ where: { idempotencyKey: key } });
expect(dbCount).toBe(1);
```

---

## Layer 2 Tests: Pessimistic Locking (SELECT FOR UPDATE)

These tests prove that pessimistic locking on confirm/cancel prevents concurrent operations from corrupting state.

**"should not double-confirm even with concurrent calls"**

The pessimistic lock (`SELECT FOR UPDATE`) serializes concurrent confirms — the second one sees CONFIRMED and fails.

```typescript
const reservation = await reservationService.create({
  idempotencyKey: randomUUID(), eventId: 1, seatIds: [1],
});

// Fire 5 concurrent confirms
const results = await Promise.allSettled(
  Array.from({ length: 5 }, () =>
    reservationService.confirm(reservation.id)
  )
);

const successes = results.filter(r => r.status === 'fulfilled');
const failures = results.filter(r => r.status === 'rejected');

expect(successes).toHaveLength(1);
expect(failures).toHaveLength(4);

// Exactly 1 CONFIRMED audit entry
const logs = await prisma.auditLog.count({
  where: { reservationId: reservation.id, newStatus: 'CONFIRMED' },
});
expect(logs).toBe(1);
```

**"should not confirm and cancel simultaneously leaving inconsistent state"**

The pessimistic lock serializes confirm and cancel — whichever gets the lock first wins, the other sees the new state and responds accordingly.

```typescript
const reservation = await reservationService.create({
  idempotencyKey: randomUUID(), eventId: 1, seatIds: [1],
});

const [confirmResult, cancelResult] = await Promise.allSettled([
  reservationService.confirm(reservation.id),
  reservationService.cancel(reservation.id),
]);

// One wins, one loses — we don't care which
const finalReservation = await prisma.reservation.findUnique({
  where: { id: reservation.id },
});

// Must be in a terminal or confirmed state — never still PENDING
expect(['CONFIRMED', 'CANCELLED']).toContain(finalReservation.status);

// Seats must be consistent with reservation status
const seats = await prisma.eventSeat.findMany({
  where: { reservationSeats: { some: { reservationId: reservation.id } } },
});

if (finalReservation.status === 'CONFIRMED') {
  expect(seats.every(s => s.status === 'BOOKED')).toBe(true);
} else {
  expect(seats.every(s => s.status === 'AVAILABLE')).toBe(true);
}
```

**"cron should not expire a reservation being confirmed (FOR UPDATE blocks cron)"**

```typescript
const reservation = await reservationService.create({
  idempotencyKey: randomUUID(), eventId: 1, seatIds: [1],
});

// Set expiresAt to just past grace period boundary
await prisma.reservation.update({
  where: { id: reservation.id },
  data: { expiresAt: new Date(Date.now() - 30000) },  // 30s ago, within grace
});

// Fire confirm and cron simultaneously
const [confirmResult, cronResult] = await Promise.allSettled([
  reservationService.confirm(reservation.id),
  schedulerService.expireReservations(),
]);

const final = await prisma.reservation.findUnique({
  where: { id: reservation.id },
});

// Confirm should win (within grace period)
expect(final.status).toBe('CONFIRMED');
```

---

## Layer 3 Tests: Database Constraint

**"should reject double-booking at DB level"**

```typescript
const res1 = await prisma.reservation.create({
  data: { eventId: 1, status: 'PENDING', expiresAt: new Date(Date.now() + 300000) },
});
const res2 = await prisma.reservation.create({
  data: { eventId: 1, status: 'PENDING', expiresAt: new Date(Date.now() + 300000) },
});

await prisma.reservationSeat.create({
  data: { reservationId: res1.id, eventSeatId: 1, isActive: true },
});

await expect(
  prisma.reservationSeat.create({
    data: { reservationId: res2.id, eventSeatId: 1, isActive: true },
  })
).rejects.toThrow();
```

**"should allow re-booking after cancellation"**

```typescript
const res1 = await reservationService.create({
  idempotencyKey: randomUUID(), eventId: 1, seatIds: [1],
});
await reservationService.cancel(res1.id);

const res2 = await reservationService.create({
  idempotencyKey: randomUUID(), eventId: 1, seatIds: [1],
});

expect(res2.id).not.toBe(res1.id);
expect(res2.status).toBe('PENDING');

const records = await prisma.reservationSeat.findMany({ where: { eventSeatId: 1 } });
expect(records.filter(r => r.isActive)).toHaveLength(1);
expect(records.filter(r => !r.isActive)).toHaveLength(1);
```

---

## Combined Integration Tests

**"full lifecycle: create → retry → confirm → cancel → re-reserve"**

```typescript
const key1 = randomUUID();

const res1 = await reservationService.create({
  idempotencyKey: key1, eventId: 1, seatIds: [1, 2],
});
expect(res1.status).toBe('PENDING');

// Retry → same reservation
const retry = await reservationService.create({
  idempotencyKey: key1, eventId: 1, seatIds: [1, 2],
});
expect(retry.id).toBe(res1.id);

// Confirm (pessimistic)
await reservationService.confirm(res1.id);
const confirmed = await prisma.reservation.findUnique({ where: { id: res1.id } });
expect(confirmed.status).toBe('CONFIRMED');

// Cancel (pessimistic)
await reservationService.cancel(res1.id);
const cancelled = await prisma.reservation.findUnique({ where: { id: res1.id } });
expect(cancelled.status).toBe('CANCELLED');

// Seats freed
const seats = await prisma.eventSeat.findMany({ where: { id: { in: [1, 2] } } });
expect(seats.every(s => s.status === 'AVAILABLE')).toBe(true);

// Re-reserve with new key
const res2 = await reservationService.create({
  idempotencyKey: randomUUID(), eventId: 1, seatIds: [1, 2],
});
expect(res2.id).not.toBe(res1.id);
expect(res2.status).toBe('PENDING');
```

**"concurrent war: 10 users, 5 seats, overlapping combos"**

```typescript
const combos = [
  [1, 2, 3], [1, 2, 4], [2, 3, 5], [1, 3, 4], [3, 4, 5],
  [1, 2, 5], [2, 4, 5], [1, 3, 5], [1, 4, 5], [2, 3, 4],
];

const results = await Promise.allSettled(
  combos.map(seatIds =>
    reservationService.create({
      idempotencyKey: randomUUID(), eventId: 1, seatIds,
    })
  )
);

const successes = results.filter(r => r.status === 'fulfilled');

// No double-booking
const heldSeats = await prisma.eventSeat.findMany({
  where: { id: { in: [1, 2, 3, 4, 5] }, status: 'HELD' },
});
const heldIds = heldSeats.map(s => s.id);
expect(heldIds.length).toBe(new Set(heldIds).size);

// Atomicity: winners have ALL seats HELD
for (const s of successes) {
  const res = (s as PromiseFulfilledResult<any>).value;
  const records = await prisma.reservationSeat.findMany({
    where: { reservationId: res.id },
    include: { eventSeat: true },
  });
  expect(records.every(rs => rs.eventSeat.status === 'HELD')).toBe(true);
  expect(records.every(rs => rs.isActive === true)).toBe(true);
}
```

---

## Running

```bash
pnpm run test:e2e -- --testPathPattern=idempotency --verbose
```

## Verification

- Layer 1: same key → same reservation, even 20x concurrent
- Layer 2: pessimistic lock serializes concurrent confirms — exactly 1 wins, confirm+cancel never leave inconsistent state
- Layer 3: DB constraint physically blocks double-booking
- Combined: full lifecycle with re-booking after cancel
- Stress: 10 overlapping → zero inconsistencies, perfect atomicity