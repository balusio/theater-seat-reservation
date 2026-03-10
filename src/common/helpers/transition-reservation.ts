import { ConflictException } from '@nestjs/common';
import {
  ReservationStatus,
  RESERVATION_TO_SEAT_STATUS,
  STATUS_TIMESTAMP_FIELD,
  isValidTransition,
} from '../constants/state-machine';

export async function transitionReservation(
  tx: any,
  reservationId: string,
  fromStatus: ReservationStatus,
  toStatus: ReservationStatus,
  triggeredBy: string,
  metadata?: Record<string, any>,
  extra?: { reason?: string },
) {
  if (!isValidTransition(fromStatus, toStatus)) {
    throw new ConflictException(
      `Invalid transition: ${fromStatus} → ${toStatus}`,
    );
  }

  const updateData: Record<string, any> = { status: toStatus };
  const tsField = STATUS_TIMESTAMP_FIELD[toStatus];
  if (tsField) updateData[tsField] = new Date();
  if (toStatus === ReservationStatus.CANCELLED && extra?.reason) {
    updateData.cancellationReason = extra.reason;
  }
  if (toStatus === ReservationStatus.REJECTED && extra?.reason) {
    updateData.rejectionReason = extra.reason;
  }

  await tx.reservation.update({
    where: { id: reservationId },
    data: updateData,
  });

  const seatStatus = RESERVATION_TO_SEAT_STATUS[toStatus];
  await tx.eventSeat.updateMany({
    where: { reservationSeats: { some: { reservationId } } },
    data: { status: seatStatus },
  });

  if (
    toStatus === ReservationStatus.CANCELLED ||
    toStatus === ReservationStatus.REJECTED
  ) {
    await tx.reservationSeat.updateMany({
      where: { reservationId },
      data: { isActive: false },
    });
  }

  await tx.auditLog.create({
    data: {
      reservationId,
      entityType: 'Reservation',
      entityId: reservationId,
      action: 'STATUS_CHANGED',
      previousStatus: fromStatus,
      newStatus: toStatus,
      triggeredBy,
      metadata: metadata ?? {},
    },
  });
}
