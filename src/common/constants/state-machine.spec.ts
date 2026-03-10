import {
  ReservationStatus,
  SeatStatus,
  VALID_TRANSITIONS,
  RESERVATION_TO_SEAT_STATUS,
  STATUS_TIMESTAMP_FIELD,
  isValidTransition,
} from './state-machine';

describe('State Machine', () => {
  describe('isValidTransition', () => {
    it('should allow PENDING → CONFIRMED', () => {
      expect(isValidTransition(ReservationStatus.PENDING, ReservationStatus.CONFIRMED)).toBe(true);
    });

    it('should allow PENDING → CANCELLED', () => {
      expect(isValidTransition(ReservationStatus.PENDING, ReservationStatus.CANCELLED)).toBe(true);
    });

    it('should allow PENDING → REJECTED', () => {
      expect(isValidTransition(ReservationStatus.PENDING, ReservationStatus.REJECTED)).toBe(true);
    });

    it('should allow CONFIRMED → CANCELLED', () => {
      expect(isValidTransition(ReservationStatus.CONFIRMED, ReservationStatus.CANCELLED)).toBe(true);
    });

    it('should NOT allow CONFIRMED → PENDING', () => {
      expect(isValidTransition(ReservationStatus.CONFIRMED, ReservationStatus.PENDING)).toBe(false);
    });

    it('should NOT allow CANCELLED → any', () => {
      expect(isValidTransition(ReservationStatus.CANCELLED, ReservationStatus.PENDING)).toBe(false);
      expect(isValidTransition(ReservationStatus.CANCELLED, ReservationStatus.CONFIRMED)).toBe(false);
      expect(isValidTransition(ReservationStatus.CANCELLED, ReservationStatus.REJECTED)).toBe(false);
    });

    it('should NOT allow REJECTED → any', () => {
      expect(isValidTransition(ReservationStatus.REJECTED, ReservationStatus.PENDING)).toBe(false);
      expect(isValidTransition(ReservationStatus.REJECTED, ReservationStatus.CONFIRMED)).toBe(false);
      expect(isValidTransition(ReservationStatus.REJECTED, ReservationStatus.CANCELLED)).toBe(false);
    });

    it('should NOT allow self-transitions', () => {
      expect(isValidTransition(ReservationStatus.PENDING, ReservationStatus.PENDING)).toBe(false);
      expect(isValidTransition(ReservationStatus.CONFIRMED, ReservationStatus.CONFIRMED)).toBe(false);
    });

    it('should return false for unknown from status', () => {
      expect(isValidTransition('UNKNOWN' as ReservationStatus, ReservationStatus.CONFIRMED)).toBe(false);
    });
  });

  describe('VALID_TRANSITIONS', () => {
    it('PENDING has 3 valid transitions', () => {
      expect(VALID_TRANSITIONS[ReservationStatus.PENDING]).toHaveLength(3);
    });

    it('CONFIRMED has 1 valid transition', () => {
      expect(VALID_TRANSITIONS[ReservationStatus.CONFIRMED]).toHaveLength(1);
    });

    it('CANCELLED is terminal', () => {
      expect(VALID_TRANSITIONS[ReservationStatus.CANCELLED]).toHaveLength(0);
    });

    it('REJECTED is terminal', () => {
      expect(VALID_TRANSITIONS[ReservationStatus.REJECTED]).toHaveLength(0);
    });
  });

  describe('RESERVATION_TO_SEAT_STATUS', () => {
    it('maps PENDING → HELD', () => {
      expect(RESERVATION_TO_SEAT_STATUS[ReservationStatus.PENDING]).toBe(SeatStatus.HELD);
    });

    it('maps CONFIRMED → BOOKED', () => {
      expect(RESERVATION_TO_SEAT_STATUS[ReservationStatus.CONFIRMED]).toBe(SeatStatus.BOOKED);
    });

    it('maps CANCELLED → AVAILABLE', () => {
      expect(RESERVATION_TO_SEAT_STATUS[ReservationStatus.CANCELLED]).toBe(SeatStatus.AVAILABLE);
    });

    it('maps REJECTED → AVAILABLE', () => {
      expect(RESERVATION_TO_SEAT_STATUS[ReservationStatus.REJECTED]).toBe(SeatStatus.AVAILABLE);
    });
  });

  describe('STATUS_TIMESTAMP_FIELD', () => {
    it('maps CONFIRMED → confirmedAt', () => {
      expect(STATUS_TIMESTAMP_FIELD[ReservationStatus.CONFIRMED]).toBe('confirmedAt');
    });

    it('maps CANCELLED → cancelledAt', () => {
      expect(STATUS_TIMESTAMP_FIELD[ReservationStatus.CANCELLED]).toBe('cancelledAt');
    });

    it('maps REJECTED → rejectedAt', () => {
      expect(STATUS_TIMESTAMP_FIELD[ReservationStatus.REJECTED]).toBe('rejectedAt');
    });

    it('does not map PENDING', () => {
      expect(STATUS_TIMESTAMP_FIELD[ReservationStatus.PENDING]).toBeUndefined();
    });
  });
});
