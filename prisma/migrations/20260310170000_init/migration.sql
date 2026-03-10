-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('SCHEDULED', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SeatStatus" AS ENUM ('AVAILABLE', 'HELD', 'BOOKED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'REJECTED');

-- CreateTable
CREATE TABLE "Theater" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "address" TEXT,
    "totalCapacity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Theater_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "theaterId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "seatsPerRow" INTEGER NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seat" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sectionId" UUID NOT NULL,
    "row" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT,

    CONSTRAINT "Seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "theaterId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "status" "EventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSeat" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "eventId" UUID NOT NULL,
    "seatId" UUID NOT NULL,
    "status" "SeatStatus" NOT NULL DEFAULT 'AVAILABLE',
    "price" DECIMAL(10,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "idempotencyKey" TEXT NOT NULL,
    "eventId" UUID NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "cancellationReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationSeat" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservationId" UUID NOT NULL,
    "eventSeatId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ReservationSeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservationId" UUID,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "previousStatus" TEXT,
    "newStatus" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- Prisma indexes
CREATE UNIQUE INDEX "Section_theaterId_name_key" ON "Section"("theaterId", "name");
CREATE UNIQUE INDEX "Seat_sectionId_row_number_key" ON "Seat"("sectionId", "row", "number");
CREATE INDEX "Event_startsAt_idx" ON "Event"("startsAt");
CREATE INDEX "Event_theaterId_idx" ON "Event"("theaterId");
CREATE INDEX "EventSeat_eventId_status_idx" ON "EventSeat"("eventId", "status");
CREATE UNIQUE INDEX "EventSeat_eventId_seatId_key" ON "EventSeat"("eventId", "seatId");
CREATE UNIQUE INDEX "Reservation_idempotencyKey_key" ON "Reservation"("idempotencyKey");
CREATE INDEX "Reservation_status_expiresAt_idx" ON "Reservation"("status", "expiresAt");
CREATE INDEX "Reservation_eventId_idx" ON "Reservation"("eventId");
CREATE INDEX "ReservationSeat_reservationId_idx" ON "ReservationSeat"("reservationId");
CREATE INDEX "ReservationSeat_eventSeatId_isActive_idx" ON "ReservationSeat"("eventSeatId", "isActive");
CREATE UNIQUE INDEX "ReservationSeat_reservationId_eventSeatId_key" ON "ReservationSeat"("reservationId", "eventSeatId");
CREATE INDEX "AuditLog_reservationId_idx" ON "AuditLog"("reservationId");
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");
CREATE INDEX "AuditLog_entityType_action_idx" ON "AuditLog"("entityType", "action");

-- Foreign keys
ALTER TABLE "Section" ADD CONSTRAINT "Section_theaterId_fkey" FOREIGN KEY ("theaterId") REFERENCES "Theater"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_theaterId_fkey" FOREIGN KEY ("theaterId") REFERENCES "Theater"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventSeat" ADD CONSTRAINT "EventSeat_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventSeat" ADD CONSTRAINT "EventSeat_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReservationSeat" ADD CONSTRAINT "ReservationSeat_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReservationSeat" ADD CONSTRAINT "ReservationSeat_eventSeatId_fkey" FOREIGN KEY ("eventSeatId") REFERENCES "EventSeat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Custom CHECK constraints
ALTER TABLE "EventSeat" ADD CONSTRAINT chk_price_positive CHECK ("price" > 0);
ALTER TABLE "Reservation" ADD CONSTRAINT chk_expires_after_created CHECK ("expiresAt" > "createdAt");
ALTER TABLE "Reservation" ADD CONSTRAINT chk_confirmed_has_timestamp CHECK (("status" != 'CONFIRMED') OR ("confirmedAt" IS NOT NULL));
ALTER TABLE "Reservation" ADD CONSTRAINT chk_cancelled_has_timestamp CHECK (("status" != 'CANCELLED') OR ("cancelledAt" IS NOT NULL));
ALTER TABLE "Reservation" ADD CONSTRAINT chk_rejected_has_timestamp CHECK (("status" != 'REJECTED') OR ("rejectedAt" IS NOT NULL));

-- Partial indexes for performance
CREATE INDEX idx_available_seats ON "EventSeat" ("eventId") WHERE status = 'AVAILABLE';
CREATE INDEX idx_pending_expirable ON "Reservation" ("expiresAt") WHERE status = 'PENDING';

-- Partial unique index: Layer 3 anti double-booking
CREATE UNIQUE INDEX idx_active_seat_reservation ON "ReservationSeat" ("eventSeatId") WHERE "isActive" = true;
