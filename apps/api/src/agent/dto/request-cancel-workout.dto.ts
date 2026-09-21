import { IsUUID } from 'class-validator';

export class RequestCancelWorkoutDto {
  @IsUUID()
  sessionId!: string;
}
