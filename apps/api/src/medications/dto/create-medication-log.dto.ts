import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class CreateMedicationLogDto {
  @IsString()
  medicationName!: string;

  @IsString()
  @IsOptional()
  dose?: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsISO8601()
  takenAt!: string;

  @IsString()
  @IsOptional()
  adherenceStatus?: string;
}
