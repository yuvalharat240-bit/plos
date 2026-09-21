import { Injectable } from '@nestjs/common';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { insertUserEnteredSpine } from '../database/insert-user-entered-spine';
import { AuditLogService } from '../audit/audit-log.service';
import { CreateWorkoutDto } from './dto/create-workout.dto';

/**
 * docs/09 Milestone 2's plain CRUD surface (fitness domain,
 * event_fitness_session — docs/04 §3.2, already-in-scope MVP domain).
 * There is no `executed_by` column on `events` (that's an `actions`-only
 * column, docs/04 §3.5) — user-authorship of this event is recorded the
 * way every user-entered fact is: `core_objects.is_user_entered = true`,
 * `source = 'user_entry'`.
 */
@Injectable()
export class WorkoutsService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly auditLog: AuditLogService,
  ) {}

  async createWorkout(userId: string, dto: CreateWorkoutDto): Promise<{ id: string }> {
    return this.db.runAsUser(userId, async (client) => {
      const eventId = await insertUserEnteredSpine(client, userId, 'event');

      await client.query(
        `INSERT INTO events (id, user_id, domain, event_type, starts_at, ends_at, status)
         VALUES ($1, $2, 'fitness', 'workout', $3, $4, 'completed')`,
        [eventId, userId, dto.startsAt, dto.endsAt ?? null],
      );

      await client.query(
        `INSERT INTO event_fitness_session
           (event_id, sport_type, duration_min, distance_km, avg_hr, max_hr, calories,
            perceived_exertion, training_load)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          eventId,
          dto.sportType,
          dto.durationMin ?? null,
          dto.distanceKm ?? null,
          dto.avgHr ?? null,
          dto.maxHr ?? null,
          dto.calories ?? null,
          dto.perceivedExertion ?? null,
          dto.trainingLoad ?? null,
        ],
      );

      for (const set of dto.sets ?? []) {
        await client.query(
          `INSERT INTO fitness_session_set (event_id, exercise_name, set_number, reps, weight_kg, rpe)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [eventId, set.exerciseName, set.setNumber, set.reps ?? null, set.weightKg ?? null, set.rpe ?? null],
        );
      }

      await this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: userId,
        action: 'workout.create',
        resourceType: 'event_fitness_session',
        resourceId: eventId,
        result: 'success',
        metadata: { setCount: dto.sets?.length ?? 0 },
      });

      return { id: eventId };
    });
  }
}
