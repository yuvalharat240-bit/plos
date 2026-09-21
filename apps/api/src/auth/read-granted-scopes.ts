import { PoolClient } from 'pg';

/** The one query for "which scopes does this user's self_app grant
 * currently hold" — shared by ScopeGuard, ConsentService, and
 * AgentActionsService so the WHERE clause (grantee_type='self_app',
 * revoked_at IS NULL) can't drift between call sites (ponytail-audit,
 * pre-Milestone-8 pass, 2026-09-21: was duplicated 3x). A plain function,
 * not an injectable service method, so it has no module-DI direction to
 * worry about — auth/, agent/, and privacy/ can all import it directly. */
export async function readGrantedScopes(client: PoolClient, userId: string): Promise<string[]> {
  const result = await client.query(
    `SELECT scope FROM permission_grants WHERE user_id = $1 AND grantee_type = 'self_app' AND revoked_at IS NULL`,
    [userId],
  );
  return result.rows.map((r) => r.scope as string);
}
