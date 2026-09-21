import { Injectable } from '@nestjs/common';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { insertUserEnteredSpine } from '../database/insert-user-entered-spine';
import { AuditLogService } from '../audit/audit-log.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';

/**
 * docs/09 Milestone 2's plain CRUD surface (mental_health domain,
 * observation_journal_entry — docs/04 §3.3). Every write is: spine row
 * (core_objects, object_type='observation') → domain row (observations)
 * → extension row (observation_journal_entry) → audit_log, all on the
 * same runAsUser transaction, so a failure anywhere rolls the whole
 * thing back rather than leaving an orphaned spine row.
 */
@Injectable()
export class JournalService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly auditLog: AuditLogService,
  ) {}

  async createEntry(userId: string, dto: CreateJournalEntryDto): Promise<{ id: string }> {
    return this.db.runAsUser(userId, async (client) => {
      const observedAt = dto.observedAt ?? new Date().toISOString();
      const observationId = await insertUserEnteredSpine(client, userId, 'observation');

      await client.query(
        `INSERT INTO observations (id, user_id, domain, observation_type, observed_at)
         VALUES ($1, $2, 'mental_health', 'journal_entry', $3)`,
        [observationId, userId, observedAt],
      );

      await client.query(
        `INSERT INTO observation_journal_entry
           (observation_id, entry_kind, entry_text, mood_score, stress_score, energy_score, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          observationId,
          dto.entryKind,
          dto.entryText ?? null,
          dto.moodScore ?? null,
          dto.stressScore ?? null,
          dto.energyScore ?? null,
          dto.tags ?? [],
        ],
      );

      await this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: userId,
        action: 'journal.create',
        resourceType: 'observation_journal_entry',
        resourceId: observationId,
        result: 'success',
      });

      return { id: observationId };
    });
  }
}
