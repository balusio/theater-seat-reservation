import { IsUUID, IsArray, ArrayMinSize } from 'class-validator';

export class CreateReservationDto {
  @IsUUID()
  idempotencyKey: string;

  @IsUUID()
  eventId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  seatIds: string[];
}
