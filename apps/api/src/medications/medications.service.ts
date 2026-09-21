import { Injectable } from '@nestjs/common';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { insertUserEnteredSpine } from '../database/insert-user-entered-spine';
import { AuditLogService } from '../audit/audit-log.service';
import { CreateMedicationLogDto } from './dto/create-medication-log.dto';

/**
 * docs/09 Milestone 2's plain CRUD surface (health-adjacent,
 * action_medication_log — docs/04 §3.5/§14). `actions.executed_by` is
 * hardcoded to 'user' here, never settable by the caller — this is the
 * MVP tool registry's one concrete confirmation of 04 §14's flagged
 * cross-check: as of this milestone there is zero agent-tool code in
 * this repository (Milestone 5 hasn't started), so it's trivially true
 * that "no Scoped Tool ever writes this table" today. Re-verify this
 * comment's claim once Milestone 5 adds the Scoped Tool registry — don't
 * assume it's still true by then just because it's written here.
 * `risk_tier` is set to 1, matching `health.write`'s catalog risk_tier
 * (docs/07 §3.2) — this is a log of a dose taken, not a prescribing
 * action, so it doesn't warrant a higher tier.
 */
@Injectable()
export class MedicationsService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly auditLog: AuditLogService,
  ) {}

  async logDose(userId: string, dto: CreateMedicationLogDto): Promise<{ id: string }> {
    return this.db.runAsUser(userId, async (client) => {
      const actionId = await insertUserEnteredSpine(client, userId, 'action');

      await client.query(
        `INSERT INTO actions (id, user_id, domain, action_type, executed_by, risk_tier, status)
         VALUES ($1, $2, 'health', 'medication_log', 'user', 1, 'completed')`,
        [actionId, userId],
      );

      await client.query(
        `INSERT INTO action_medication_log (action_id, medication_name, dose, unit, taken_at, adherence_status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [actionId, dto.medicationName, dto.dose ?? null, dto.unit ?? null, dto.takenAt, dto.adherenceStatus ?? null],
      );

      await this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: userId,
        action: 'medication.log',
        resourceType: 'action_medication_log',
        resourceId: actionId,
        riskTier: 1,
        result: 'success',
      });

      return { id: actionId };
    });
  }
}
