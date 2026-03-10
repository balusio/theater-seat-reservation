export enum ReservationStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
}

export enum SeatStatus {
  AVAILABLE = 'AVAILABLE',
  HELD = 'HELD',
  BOOKED = 'BOOKED',
}

export const VALID_TRANSITIONS: Record<
  ReservationStatus,
  ReservationStatus[]
> = {
  [ReservationStatus.PENDING]: [
    ReservationStatus.CONFIRMED,
    ReservationStatus.CANCELLED,
    ReservationStatus.REJECTED,
  ],
  [ReservationStatus.CONFIRMED]: [ReservationStatus.CANCELLED],
  [ReservationStatus.CANCELLED]: [],
  [ReservationStatus.REJECTED]: [],
};

export const RESERVATION_TO_SEAT_STATUS: Record<ReservationStatus, SeatStatus> =
  {
    [ReservationStatus.PENDING]: SeatStatus.HELD,
    [ReservationStatus.CONFIRMED]: SeatStatus.BOOKED,
    [ReservationStatus.CANCELLED]: SeatStatus.AVAILABLE,
    [ReservationStatus.REJECTED]: SeatStatus.AVAILABLE,
  };

export const STATUS_TIMESTAMP_FIELD: Partial<
  Record<ReservationStatus, string>
> = {
  [ReservationStatus.CONFIRMED]: 'confirmedAt',
  [ReservationStatus.CANCELLED]: 'cancelledAt',
  [ReservationStatus.REJECTED]: 'rejectedAt',
};

export function isValidTransition(
  from: ReservationStatus,
  to: ReservationStatus,
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
