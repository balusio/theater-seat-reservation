import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateReservationDto } from './create-reservation.dto';

describe('CreateReservationDto', () => {
  function toDto(data: Record<string, any>): CreateReservationDto {
    return plainToInstance(CreateReservationDto, data);
  }

  it('should pass validation with valid data', async () => {
    const dto = toDto({
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      eventId: '550e8400-e29b-41d4-a716-446655440001',
      seatIds: ['550e8400-e29b-41d4-a716-446655440002'],
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail when idempotencyKey is missing', async () => {
    const dto = toDto({
      eventId: '550e8400-e29b-41d4-a716-446655440001',
      seatIds: ['550e8400-e29b-41d4-a716-446655440002'],
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'idempotencyKey')).toBe(true);
  });

  it('should fail when idempotencyKey is not a UUID', async () => {
    const dto = toDto({
      idempotencyKey: 'not-a-uuid',
      eventId: '550e8400-e29b-41d4-a716-446655440001',
      seatIds: ['550e8400-e29b-41d4-a716-446655440002'],
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'idempotencyKey')).toBe(true);
  });

  it('should fail when eventId is missing', async () => {
    const dto = toDto({
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      seatIds: ['550e8400-e29b-41d4-a716-446655440002'],
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'eventId')).toBe(true);
  });

  it('should fail when eventId is not a UUID', async () => {
    const dto = toDto({
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      eventId: 'not-uuid',
      seatIds: ['550e8400-e29b-41d4-a716-446655440002'],
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'eventId')).toBe(true);
  });

  it('should fail when seatIds is empty', async () => {
    const dto = toDto({
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      eventId: '550e8400-e29b-41d4-a716-446655440001',
      seatIds: [],
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'seatIds')).toBe(true);
  });

  it('should fail when seatIds is missing', async () => {
    const dto = toDto({
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      eventId: '550e8400-e29b-41d4-a716-446655440001',
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'seatIds')).toBe(true);
  });

  it('should fail when seatIds contains non-UUID values', async () => {
    const dto = toDto({
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      eventId: '550e8400-e29b-41d4-a716-446655440001',
      seatIds: ['not-a-uuid'],
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'seatIds')).toBe(true);
  });

  it('should pass with multiple valid seatIds', async () => {
    const dto = toDto({
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      eventId: '550e8400-e29b-41d4-a716-446655440001',
      seatIds: [
        '550e8400-e29b-41d4-a716-446655440002',
        '550e8400-e29b-41d4-a716-446655440003',
        '550e8400-e29b-41d4-a716-446655440004',
      ],
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
