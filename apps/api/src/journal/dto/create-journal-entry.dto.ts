import { IsArray, IsIn, IsISO8601, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateJournalEntryDto {
  @IsIn(['free_text', 'structured_checkin'])
  entryKind!: 'free_text' | 'structured_checkin';

  @IsString()
  @IsOptional()
  entryText?: string;

  @IsNumber()
  @IsOptional()
  moodScore?: number;

  @IsNumber()
  @IsOptional()
  stressScore?: number;

  @IsNumber()
  @IsOptional()
  energyScore?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsISO8601()
  @IsOptional()
  observedAt?: string;
}
