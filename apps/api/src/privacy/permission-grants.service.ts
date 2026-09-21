import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { AuditLogService } from '../audit/audit-log.service';

export interface PermissionGrantRow {
  scope: string;
  purpose: string;
  grantedVia: string;
  grantedAt: Date;
}

/** docs/09 Milestone 6: "Permission-grant listing + revoke" — the Privacy
 * & Data Control Center's own view onto `permission_grants` (docs/04
 * §8.2), scoped to this user's `self_app` grants (the only grantee_type
 * that exists at MVP, docs/08 §4.1). */
@Injectable()
export class PermissionGrantsService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(userId: string): Promise<PermissionGrantRow[]> {
    return this.db.runAsUser(userId, async (client) => {
      const result = await client.query(
        `SELECT scope, purpose, granted_via, granted_at FROM permission_grants
         WHERE user_id = $1 AND grantee_type = 'self_app' AND revoked_at IS NULL
         ORDER BY granted_at`,
        [userId],
      );
      return result.rows.map((r) => ({
        scope: r.scope,
        purpose: r.purpose,
        grantedVia: r.granted_via,
        grantedAt: r.granted_at,
      }));
    });
  }

  async revoke(userId: string, scope: string): Promise<void> {
    await this.db.runAsUser(userId, async (client) => {
      const result = await client.query(
        `UPDATE permission_grants SET revoked_at = now()
         WHERE user_id = $1 AND grantee_type = 'self_app' AND scope = $2 AND revoked_at IS NULL
         RETURNING id`,
        [userId, scope],
      );
      if (result.rowCount === 0) {
        throw new NotFoundException(`no active grant for scope: ${scope}`);
      }
      await this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: userId,
        action: 'permission.revoke',
        resourceType: 'permission_grants',
        result: 'success',
        metadata: { scope },
      });
    });
  }
}
