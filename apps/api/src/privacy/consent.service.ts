import { BadRequestException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { AuditLogService } from '../audit/audit-log.service';
import { AccountDeletionService } from './account-deletion.service';
import { readGrantedScopes } from '../auth/read-granted-scopes';

/** docs/07-privacy-model.md §4.1 — the three consent types actually
 * exercised at MVP (docs/08 §7); `financial_data_processing`/`marketing`
 * exist in the catalog but are never presented to an MVP user. */
export const MVP_CONSENT_TYPES = ['tos', 'health_data_processing', 'mental_health_data_processing'] as const;
export type MvpConsentType = (typeof MVP_CONSENT_TYPES)[number];

const CONSENT_VERSION = '2026-09-21';

/** §4.1's "effect of withdrawal" column, made concrete as scope prefixes
 * to revoke. `tos` has no scope list — its withdrawal is handled as a
 * full deletion trigger, not a scope revocation, per the same table. */
const WITHDRAWAL_SCOPE_PREFIXES: Partial<Record<MvpConsentType, string[]>> = {
  health_data_processing: ['health.', 'fitness.'],
  mental_health_data_processing: ['mental_health.'],
};

@Injectable()
export class ConsentService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly auditLog: AuditLogService,
    private readonly accountDeletion: AccountDeletionService,
  ) {}

  async list(
    userId: string,
  ): Promise<Array<{ consentType: string; granted: boolean; grantedAt: Date | null; revokedAt: Date | null; version: string | null }>> {
    return this.db.runAsUser(userId, async (client) => {
      const consentRows = await client.query(
        `SELECT DISTINCT ON (consent_type) consent_type, granted_at, revoked_at, version
         FROM consent_records WHERE user_id = $1 AND consent_type = ANY($2)
         ORDER BY consent_type, granted_at DESC`,
        [userId, MVP_CONSENT_TYPES],
      );
      const byType = new Map(consentRows.rows.map((r) => [r.consent_type as string, r]));

      const scopeSet = new Set<string>(await readGrantedScopes(client, userId));

      return MVP_CONSENT_TYPES.map((consentType) => {
        const row = byType.get(consentType);
        if (row) {
          return {
            consentType,
            granted: row.revoked_at === null,
            grantedAt: row.granted_at,
            revokedAt: row.revoked_at,
            version: row.version,
          };
        }
        // No explicit consent record has ever been made for this type
        // (no onboarding consent-selection UI exists yet, docs/10's own
        // gap-audit finding) — fall back to whether the equivalent scope
        // is currently active, rather than reporting a misleading "not
        // granted" for a user already using the feature.
        const prefixes = WITHDRAWAL_SCOPE_PREFIXES[consentType] ?? [];
        const impliedGranted = consentType === 'tos' ? true : prefixes.some((p) => Array.from(scopeSet).some((s) => s.startsWith(p)));
        return { consentType, granted: impliedGranted, grantedAt: null, revokedAt: null, version: null };
      });
    });
  }

  async grant(userId: string, consentType: MvpConsentType): Promise<void> {
    if (!MVP_CONSENT_TYPES.includes(consentType)) {
      throw new BadRequestException(`unrecognized consent type: ${consentType}`);
    }
    await this.db.runAsUser(userId, async (client) => {
      await client.query(
        `INSERT INTO consent_records (user_id, consent_type, version, granted_at) VALUES ($1, $2, $3, now())`,
        [userId, consentType, CONSENT_VERSION],
      );
      await this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: userId,
        action: 'consent.grant',
        resourceType: 'consent_records',
        result: 'success',
        metadata: { consentType },
      });
    });
  }

  /** docs/07 §4.1's withdrawal effects, applied for real: health/mental-
   * health withdrawal revokes the matching `permission_grants` rows
   * (so the affected specialist pairs are structurally never dispatched
   * again — ScopeGuard/ToolExecutorService read `permission_grants`
   * directly, not `consent_records`); `tos` withdrawal is treated as an
   * account-deletion trigger, not a feature toggle, per the same table.
   *
   * SCOPE OF THIS GUARANTEE (security review, docs/09 Milestone 7):
   * "structurally never dispatched again" covers every path gated by
   * `ScopeGuard`/`ToolExecutorService` — the agent tool registry, and
   * `JournalController`'s own `@RequiredScope('mental_health.write')`.
   * It does NOT cover `PATCH /v1/users/me` (`UsersController`) —
   * that endpoint was deliberately scoped, from Milestone 2, as first-
   * party profile ownership (a goal *title* like "Manage stress"), not
   * domain content, and was never gated by any scope at all, mental-
   * health or otherwise (see that controller's own comment). A user who
   * has revoked mental_health_data_processing can still select "Manage
   * stress" as their named goal — a real, deliberate, narrow gap between
   * this comment's "structurally never" and that one endpoint, flagged
   * here rather than silently left for someone to trip over later. */
  async revoke(userId: string, consentType: MvpConsentType): Promise<{ triggeredDeletion: boolean }> {
    if (!MVP_CONSENT_TYPES.includes(consentType)) {
      throw new BadRequestException(`unrecognized consent type: ${consentType}`);
    }

    if (consentType === 'tos') {
      await this.db.runAsUser(userId, (client) => this.recordRevocation(client, userId, consentType));
      await this.accountDeletion.requestDeletion(userId, { immediate: false, reason: 'tos_withdrawn' });
      return { triggeredDeletion: true };
    }

    await this.db.runAsUser(userId, async (client) => {
      await this.recordRevocation(client, userId, consentType);

      const prefixes = WITHDRAWAL_SCOPE_PREFIXES[consentType] ?? [];
      let revokedScopes: string[] = [];
      if (prefixes.length > 0) {
        const result = await client.query(
          `UPDATE permission_grants SET revoked_at = now()
           WHERE user_id = $1 AND grantee_type = 'self_app' AND revoked_at IS NULL
             AND scope LIKE ANY($2)
           RETURNING scope`,
          [userId, prefixes.map((p) => `${p}%`)],
        );
        revokedScopes = result.rows.map((r) => r.scope as string);
      }

      await this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: userId,
        action: 'consent.revoke',
        resourceType: 'consent_records',
        result: 'success',
        metadata: { consentType, revokedScopes },
      });
    });

    return { triggeredDeletion: false };
  }

  private async recordRevocation(client: PoolClient, userId: string, consentType: MvpConsentType): Promise<void> {
    await client.query(
      `UPDATE consent_records SET revoked_at = now()
       WHERE user_id = $1 AND consent_type = $2 AND revoked_at IS NULL`,
      [userId, consentType],
    );
  }
}
