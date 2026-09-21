import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class WorkoutSetDto {
  @IsString()
  exerciseName!: string;

  @IsInt()
  setNumber!: number;

  @IsInt()
  @IsOptional()
  reps?: number;

  @IsNumber()
  @IsOptional()
  weightKg?: number;

  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  rpe?: number;
}

/** docs/09 Milestone 2: workout logging → event_fitness_session, executed_by the user directly (docs/04 §3.2). */
export class CreateWorkoutDto {
  @IsString()
  sportType!: string;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  @IsOptional()
  endsAt?: string;

  @IsInt()
  @IsOptional()
  durationMin?: number;

  @IsNumber()
  @IsOptional()
  distanceKm?: number;

  @IsInt()
  @IsOptional()
  avgHr?: number;

  @IsInt()
  @IsOptional()
  maxHr?: number;

  @IsInt()
  @IsOptional()
  calories?: number;

  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  perceivedExertion?: number;

  @IsNumber()
  @IsOptional()
  trainingLoad?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkoutSetDto)
  @IsOptional()
  sets?: WorkoutSetDto[];
}
