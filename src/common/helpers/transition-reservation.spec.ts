import { ConflictException } from '@nestjs/common';
import { transitionReservation } from './transition-reservation';
import { ReservationStatus } from '../constants/state-machine';

describe('transitionReservation', () => {
  let tx: Record<string, any>;

  beforeEach(() => {
    tx = {
      reservation: { update: jest.fn().mockResolvedValue({}) },
      eventSeat: { updateMany: jest.fn().mockResolvedValue({}) },
      reservationSeat: { updateMany: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
  });

  const RESERVATION_ID = 'res-uuid-1';

  // ─── CONFIRMED TRANSITION ────────────────────────────────

  it('should transition PENDING → CONFIRMED with correct seat status', async () => {
    await transitionReservation(
      tx,
      RESERVATION_ID,
      ReservationStatus.PENDING,
      ReservationStatus.CONFIRMED,
      'worker',
    );

    expect(tx.reservation.update).toHaveBeenCalledWith({
      where: { id: RESERVATION_ID },
      data: expect.objectContaining({
        status: 'CONFIRMED',
        confirmedAt: expect.any(Date),
      }),
    });
    expect(tx.eventSeat.updateMany).toHaveBeenCalledWith({
      where: { reservationSeats: { some: { reservationId: RESERVATION_ID } } },
      data: { status: 'BOOKED' },
    });
    // Should NOT deactivate reservationSeats on confirm
    expect(tx.reservationSeat.updateMany).not.toHaveBeenCalled();
  });

  // ─── CANCELLED TRANSITION ────────────────────────────────

  it('should transition PENDING → CANCELLED and deactivate reservation seats', async () => {
    await transitionReservation(
      tx,
      RESERVATION_ID,
      ReservationStatus.PENDING,
      ReservationStatus.CANCELLED,
      'api',
      { reason: 'user_initiated' },
      { reason: 'changed mind' },
    );

    expect(tx.reservation.update).toHaveBeenCalledWith({
      where: { id: RESERVATION_ID },
      data: expect.objectContaining({
        status: 'CANCELLED',
        cancelledAt: expect.any(Date),
        cancellationReason: 'changed mind',
      }),
    });
    expect(tx.eventSeat.updateMany).toHaveBeenCalledWith({
      where: { reservationSeats: { some: { reservationId: RESERVATION_ID } } },
      data: { status: 'AVAILABLE' },
    });
    expect(tx.reservationSeat.updateMany).toHaveBeenCalledWith({
      where: { reservationId: RESERVATION_ID },
      data: { isActive: false },
    });
  });

  it('should transition CONFIRMED → CANCELLED', async () => {
    await transitionReservation(
      tx,
      RESERVATION_ID,
      ReservationStatus.CONFIRMED,
      ReservationStatus.CANCELLED,
      'api',
    );

    expect(tx.reservation.update).toHaveBeenCalledWith({
      where: { id: RESERVATION_ID },
      data: expect.objectContaining({ status: 'CANCELLED' }),
    });
    expect(tx.reservationSeat.updateMany).toHaveBeenCalled();
  });

  // ─── REJECTED TRANSITION ─────────────────────────────────

  it('should transition PENDING → REJECTED and deactivate reservation seats', async () => {
    await transitionReservation(
      tx,
      RESERVATION_ID,
      ReservationStatus.PENDING,
      ReservationStatus.REJECTED,
      'cron',
      { reason: 'reservation_timeout' },
      { reason: 'timed out' },
    );

    expect(tx.reservation.update).toHaveBeenCalledWith({
      where: { id: RESERVATION_ID },
      data: expect.objectContaining({
        status: 'REJECTED',
        rejectedAt: expect.any(Date),
        rejectionReason: 'timed out',
      }),
    });
    expect(tx.eventSeat.updateMany).toHaveBeenCalledWith({
      where: { reservationSeats: { some: { reservationId: RESERVATION_ID } } },
      data: { status: 'AVAILABLE' },
    });
    expect(tx.reservationSeat.updateMany).toHaveBeenCalledWith({
      where: { reservationId: RESERVATION_ID },
      data: { isActive: false },
    });
  });

  // ─── AUDIT LOG ────────────────────────────────────────────

  it('should create audit log entry with correct data', async () => {
    const metadata = { reason: 'test_reason' };

    await transitionReservation(
      tx,
      RESERVATION_ID,
      ReservationStatus.PENDING,
      ReservationStatus.CONFIRMED,
      'worker',
      metadata,
    );

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        reservationId: RESERVATION_ID,
        entityType: 'Reservation',
        entityId: RESERVATION_ID,
        action: 'STATUS_CHANGED',
        previousStatus: 'PENDING',
        newStatus: 'CONFIRMED',
        triggeredBy: 'worker',
        metadata,
      },
    });
  });

  it('should use empty object as default metadata', async () => {
    await transitionReservation(
      tx,
      RESERVATION_ID,
      ReservationStatus.PENDING,
      ReservationStatus.CONFIRMED,
      'worker',
    );

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata: {} }),
    });
  });

  // ─── INVALID TRANSITIONS ─────────────────────────────────

  it('should throw ConflictException for invalid transition', async () => {
    await expect(
      transitionReservation(
        tx,
        RESERVATION_ID,
        ReservationStatus.CANCELLED,
        ReservationStatus.CONFIRMED,
        'api',
      ),
    ).rejects.toThrow(ConflictException);

    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it('should throw ConflictException for REJECTED → PENDING', async () => {
    await expect(
      transitionReservation(
        tx,
        RESERVATION_ID,
        ReservationStatus.REJECTED,
        ReservationStatus.PENDING,
        'api',
      ),
    ).rejects.toThrow('Invalid transition: REJECTED → PENDING');
  });

  // ─── CANCELLATION WITHOUT REASON ─────────────────────────

  it('should not set cancellationReason when extra.reason is undefined', async () => {
    await transitionReservation(
      tx,
      RESERVATION_ID,
      ReservationStatus.PENDING,
      ReservationStatus.CANCELLED,
      'api',
    );

    const updateData = tx.reservation.update.mock.calls[0][0].data;
    expect(updateData.cancellationReason).toBeUndefined();
  });
});
