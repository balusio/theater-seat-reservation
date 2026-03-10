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

-- PARTIAL UNIQUE INDEX: prevent double-booking at DB level
CREATE UNIQUE INDEX idx_active_seat_reservation
  ON "ReservationSeat" ("eventSeatId")
  WHERE "isActive" = true;