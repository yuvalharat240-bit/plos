import { IsString, IsUUID } from 'class-validator';

export class ConfirmCancelWorkoutDto {
  @IsUUID()
  sessionId!: string;

  @IsString()
  confirmationToken!: string;
}
