import { Injectable } from '@nestjs/common';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { AuditLogService } from '../audit/audit-log.service';
import { ImportService } from './import.service';
import { HealthSyncDto } from './dto/health-sync.dto';

export interface SyncResult {
  inserted: number;
  skipped: number;
}

/**
 * docs/09 Milestone 3 / ADR D4, docs/03 §2.1: Apple Health is
 * client-driven — the app itself reads HealthKit and posts normalized
 * samples here, no server-side OAuth. `is_imported=true`,
 * `provider='healthkit'` on every spine row (docs/03's stated
 * provenance requirement for this milestone).
 */
@Injectable()
export class HealthSyncService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly importSvc: ImportService,
    private readonly auditLog: AuditLogService,
  ) {}

  async sync(userId: string, dto: HealthSyncDto): Promise<SyncResult> {
    return this.db.runAsUser(userId, async (client) => {
      let inserted = 0;
      let skipped = 0;

      for (const s of dto.sleepSamples ?? []) {
        const id = await this.importSvc.insertSpineIfNew(
          client,
          userId,
          'observation',
          'sleep_analysis',
          'healthkit',
          s.sourceId,
          s.sleepStart,
        );
        if (!id) {
          skipped++;
          continue;
        }
        await client.query(
          `INSERT INTO observations (id, user_id, domain, observation_type, observed_at)
           VALUES ($1, $2, 'health', 'sleep', $3)`,
          [id, userId, s.sleepStart],
        );
        await client.query(
          `INSERT INTO observation_sleep (observation_id, sleep_start, sleep_end, duration_min)
           VALUES ($1, $2, $3, $4)`,
          [id, s.sleepStart, s.sleepEnd, s.durationMin ?? null],
        );
        inserted++;
      }

      for (const v of dto.vitalSamples ?? []) {
        const id = await this.importSvc.insertSpineIfNew(
          client,
          userId,
          'observation',
          v.vitalType,
          'healthkit',
          v.sourceId,
          v.observedAt,
        );
        if (!id) {
          skipped++;
          continue;
        }
        await client.query(
          `INSERT INTO observations (id, user_id, domain, observation_type, observed_at)
           VALUES ($1, $2, 'health', 'vital', $3)`,
          [id, userId, v.observedAt],
        );
        await client.query(
          `INSERT INTO observation_vital (observation_id, vital_type, value_numeric, unit)
           VALUES ($1, $2, $3, $4)`,
          [id, v.vitalType, v.valueNumeric, v.unit],
        );
        inserted++;
      }

      for (const w of dto.workouts ?? []) {
        const id = await this.importSvc.insertSpineIfNew(
          client,
          userId,
          'event',
          'workout',
          'healthkit',
          w.sourceId,
          w.startsAt,
        );
        if (!id) {
          skipped++;
          continue;
        }
        await client.query(
          `INSERT INTO events (id, user_id, domain, event_type, starts_at, ends_at, status)
           VALUES ($1, $2, 'fitness', 'workout', $3, $4, 'completed')`,
          [id, userId, w.startsAt, w.endsAt ?? null],
        );
        await client.query(
          `INSERT INTO event_fitness_session (event_id, sport_type, duration_min, calories)
           VALUES ($1, $2, $3, $4)`,
          [id, w.sportType, w.durationMin ?? null, w.calories ?? null],
        );
        inserted++;
      }

      // FINDING (found while building Milestone 6's account-deletion
      // workflow, docs/07 §7 step 1): docs/08 §4.1 claims `integrations`
      // is "Populated at MVP: Apple Health + Apple Calendar rows only",
      // but nothing ever wrote one — a real sync would leave the
      // deletion workflow's "revoke every integrations row" step with
      // nothing to revoke. Upserted here, on every successful sync, as
      // the natural place "this provider is connected" becomes true.
      await client.query(
        `INSERT INTO integrations (user_id, provider, status, connected_at, last_sync_at, last_sync_status)
         VALUES ($1, 'apple_health', 'connected', now(), now(), 'success')
         ON CONFLICT (user_id, provider)
         DO UPDATE SET status = 'connected', last_sync_at = now(), last_sync_status = 'success'`,
        [userId],
      );

      await this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: userId,
        action: 'sync.health',
        resourceType: 'observations',
        result: 'success',
        metadata: {
          inserted,
          skipped,
          sleepCount: dto.sleepSamples?.length ?? 0,
          vitalCount: dto.vitalSamples?.length ?? 0,
          workoutCount: dto.workouts?.length ?? 0,
        },
      });

      return { inserted, skipped };
    });
  }
}
