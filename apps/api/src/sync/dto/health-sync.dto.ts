import { Type } from 'class-transformer';
import { IsArray, IsIn, IsISO8601, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

/** Must match observation_vital's CHECK constraint exactly (docs/04 §3.3).
 * Exported for reuse by the agent tool registry's own vitalType validation
 * (src/agent/tools/health-tools.ts) — one source of truth, not a second
 * copy that could drift from this DTO's own @IsIn list. */
export const VITAL_TYPES = [
  'resting_hr',
  'hrv',
  'steps',
  'active_energy_kcal',
  'spo2',
  'weight_kg',
  'blood_pressure_sys',
  'blood_pressure_dia',
  'blood_glucose',
];

export class SleepSampleDto {
  /** HKObject.uuid.uuidString — the idempotency key. */
  @IsString()
  sourceId!: string;

  @IsISO8601()
  sleepStart!: string;

  @IsISO8601()
  sleepEnd!: string;

  @IsNumber()
  @IsOptional()
  durationMin?: number;
}

export class VitalSampleDto {
  @IsString()
  sourceId!: string;

  @IsIn(VITAL_TYPES)
  vitalType!: string;

  @IsNumber()
  valueNumeric!: number;

  @IsString()
  unit!: string;

  @IsISO8601()
  observedAt!: string;
}

export class WorkoutSampleDto {
  @IsString()
  sourceId!: string;

  @IsString()
  sportType!: string;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  @IsOptional()
  endsAt?: string;

  @IsNumber()
  @IsOptional()
  durationMin?: number;

  @IsNumber()
  @IsOptional()
  calories?: number;
}

export class HealthSyncDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SleepSampleDto)
  @IsOptional()
  sleepSamples?: SleepSampleDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VitalSampleDto)
  @IsOptional()
  vitalSamples?: VitalSampleDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkoutSampleDto)
  @IsOptional()
  workouts?: WorkoutSampleDto[];
}
