import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsISO8601, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

/**
 * Deliberately no `title`/event-content field anywhere in this DTO —
 * docs/08 §2.4 frames calendar as "a data source, not a specialist
 * domain," a busy/free density signal. Not importing titles is data
 * minimization by design (CLAUDE.md's non-negotiable: "better at
 * understanding a person without becoming more invasive"), matching
 * the client's own Info.plist usage string.
 */
export class CalendarEventSampleDto {
  /** EKEvent.eventIdentifier — the idempotency key. */
  @IsString()
  sourceId!: string;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  @IsOptional()
  endsAt?: string;

  @IsNumber()
  @IsOptional()
  attendeeCount?: number;

  @IsBoolean()
  @IsOptional()
  isFocusBlock?: boolean;
}

export class CalendarSyncDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CalendarEventSampleDto)
  events!: CalendarEventSampleDto[];
}
