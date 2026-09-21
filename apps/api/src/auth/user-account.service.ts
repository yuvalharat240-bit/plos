import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { AuditLogService } from '../audit/audit-log.service';

export interface UserRow {
  id: string;
  appleSub: string;
  email: string | null;
  displayName: string | null;
  isNew: boolean;
}

/**
 * `users` carries no RLS (docs/04 §7.1 — you must be identifiable before
 * you have a tenant), so lookups/upserts here run on
 * TenantDatabaseService.runPreAuth's plain connection, never runAsUser.
 */
@Injectable()
export class UserAccountService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findOrCreateByAppleSub(appleSub: string, email?: string): Promise<UserRow> {
    const user = await this.db.runPreAuth(async (client) => {
      const existing = await client.query(
        `SELECT id, apple_sub, email, display_name FROM users WHERE apple_sub = $1`,
        [appleSub],
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        return {
          id: row.id,
          appleSub: row.apple_sub,
          email: row.email,
          displayName: row.display_name,
          isNew: false,
        };
      }

      const inserted = await client.query(
        `INSERT INTO users (apple_sub, email) VALUES ($1, $2)
         RETURNING id, apple_sub, email, display_name`,
        [appleSub, email ?? null],
      );
      const row = inserted.rows[0];
      return {
        id: row.id,
        appleSub: row.apple_sub,
        email: row.email,
        displayName: row.display_name,
        isNew: true,
      };
    });

    if (user.isNew) {
      await this.grantMvpSelfScopes(user.id);
    }

    return user;
  }

  /**
   * docs/09 Context: the CRUD surface and every MVP read path needs the
   * user's own `permission_grants` rows to exist for ScopeGuard to find —
   * there is no onboarding/consent-selection UI yet (that's Milestone 6),
   * so a first-time sign-in self-grants every scope in the catalog except
   * `professional.share` (risk_tier 3, needs an explicit sharing flow
   * this app doesn't have). This is the real, documented interpretation
   * of an area docs/07's privacy model doesn't fully specify yet — revisit
   * once Milestone 6 builds real consent/grant UI.
   */
  private async grantMvpSelfScopes(userId: string): Promise<void> {
    await this.db.runAsUser(userId, async (client: PoolClient) => {
      const scopes = await client.query(
        `SELECT scope FROM permission_scopes WHERE scope <> 'professional.share'`,
      );
      for (const { scope } of scopes.rows) {
        await client.query(
          `INSERT INTO permission_grants (user_id, grantee_type, scope, purpose, granted_via)
           VALUES ($1, 'self_app', $2, 'first-party app access to own data', 'signup')`,
          [userId, scope],
        );
      }
      await this.auditLog.record(client, {
        actorType: 'system',
        actingAsUserId: userId,
        action: 'auth.signup.grant_mvp_scopes',
        resourceType: 'permission_grants',
        result: 'success',
        metadata: { scopeCount: scopes.rows.length },
      });
    });
  }
}
