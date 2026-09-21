import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

/**
 * Implements docs/04-database-schema.md §10.1's RLS mechanism: every
 * request-scoped connection sets `app.current_user_id` via `SET LOCAL`
 * (here, the parameterized equivalent `set_config(..., true)`, which
 * avoids string-interpolating a UUID into SQL text) inside the same
 * transaction as the query it's scoping. Never `SET` — `SET LOCAL`/
 * `set_config(..., is_local=true)` is transaction-scoped, so connection-
 * pool reuse between requests can never leak a stale value (§10.1's own
 * stated reason).
 *
 * `runAsUser` is the ONLY sanctioned way application code touches a
 * TENANT-SCOPED table (any table 020_rls_policies.js enables RLS on).
 *
 * `runPreAuth` (below) is the one deliberate exception, added in
 * Milestone 2, and it does not weaken that rule: it exists only for the
 * identity-resolution step that necessarily runs *before* a user_id is
 * known at all — looking up `users` by `apple_sub` (a table with no RLS
 * by design, since you must identify yourself before you have a tenant),
 * and calling the two SECURITY DEFINER lookup functions from
 * 024_auth_lookup_functions.js, which enforce their own narrow scoping
 * inside the function body rather than via this service's session GUC.
 * `runPreAuth` must never be used to touch an RLS-forced table directly.
 *
 * The `worker` Fargate task (docs/03-system-architecture.md §2.5, T9's
 * must-fix in docs/06-threat-model.md) uses this same method, one user at
 * a time within a batch, never a pooled connection carrying one user's
 * setting into another user's transaction — enforced here structurally,
 * since every call opens its own transaction and resets the setting.
 * Worker-specific batching logic is Milestone 4's job; this service is
 * the primitive both the api and worker code paths share.
 */
@Injectable()
export class TenantDatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }

  async runAsUser<T>(
    userId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', [
        'app.current_user_id',
        userId,
      ]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * For the professional-access RLS policy (docs/04 §10.3), which reads
   * `app.current_professional_id` alongside `app.current_user_id`. Not
   * used by any MVP tool (professional sharing is out of scope per
   * docs/08-mvp-definition.md §8) — included now because the schema
   * already requires it and leaving the primitive unbuilt would just move
   * this same code into whichever later milestone needs it first.
   *
   * `professionalId` here MUST be `professionals.user_id` (the login
   * account backing that professional), NOT `professionals.id` — per
   * docs/05-agent-architecture.md §6.1's own resolution ("resolved
   * server-side from professionals.user_id") and matching exactly what
   * `020_rls_policies.js`'s `clinical_memories_shared_professional`
   * policy compares this session variable against (`p.user_id =
   * current_setting('app.current_professional_id')`). Flagged explicitly
   * here (security review, docs/09 Milestone 7) because this whole path
   * has never had a real caller yet — nothing has verified this
   * convention against a live RLS check, so whoever builds the first one
   * should re-verify it then, not just trust this comment.
   */
  async runAsProfessional<T>(
    professionalId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', [
        'app.current_professional_id',
        professionalId,
      ]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * See the class header. ONLY for: (1) `users` lookups/upserts by
   * `apple_sub` (no RLS on that table), (2) the two SECURITY DEFINER
   * functions in 024_auth_lookup_functions.js, (3) the Milestone 4
   * worker's need to enumerate which users exist at all before it can
   * call `runAsUser` once per user — the same "no tenant context makes
   * sense yet" justification as (1), just at the start of a batch job
   * instead of a login, and (4) the Milestone 5 tool registry's
   * build-time tier-consistency assertion (docs/05-agent-architecture.md
   * section 6 step 5), which reads the global permission_scopes catalog
   * once at process startup, before any request (and therefore any
   * tenant) exists. permission_scopes carries no RLS policy of its own
   * (020's table list omits it; it is a shared catalog, not tenant
   * data), so this is the same "nothing to scope yet" shape as case (1),
   * just at boot instead of login. Runs in its own transaction like the scoped
   * methods, but never sets `app.current_user_id` — there is nothing to
   * set it to yet.
   */
  async runPreAuth<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
