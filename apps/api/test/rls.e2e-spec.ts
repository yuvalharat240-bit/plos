/**
 * Milestone 1's actual verification goal (docs/09-phase1-implementation-plan.md):
 * "confirm a query for another user_id returns zero rows (not an error)
 * with RLS forced." This is that test, run for real against a real
 * Postgres — no Docker, no system Postgres install (neither is available
 * in this environment) — via `embedded-postgres`, which downloads and
 * runs an actual Postgres binary. This is genuine verification, not a
 * mock: real migrations, real roles, real RLS policies, real queries.
 *
 * Connects as `plos_app` (the least-privilege role from 001), never the
 * migration-owner superuser — FORCE ROW LEVEL SECURITY specifically
 * matters because plos_app is not the table owner, and Postgres
 * superusers bypass RLS entirely regardless of FORCE. Seed data is
 * inserted as the superuser precisely so it isn't itself subject to RLS
 * during setup.
 */
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TenantDatabaseService } from '../src/database/tenant-database.service';
import { bootstrapTestPostgres, teardownTestPostgres, testSuperuserUrl, TEST_DB_NAME } from './support/postgres-test-harness';

const PORT = 55433;
const APP_ROLE = 'plos_app';
const APP_ROLE_PASSWORD = 'plos_app_dev_only'; // matches 001_roles_and_extensions.js

describe('RLS tenant isolation (docs/04-database-schema.md §10)', () => {
  let pg: InstanceType<typeof import('embedded-postgres').default>;
  let superuserClient: Client;
  let appService: TenantDatabaseService;
  let dataDir: string;

  const appUrl = `postgres://${APP_ROLE}:${APP_ROLE_PASSWORD}@localhost:${PORT}/${TEST_DB_NAME}`;

  beforeAll(async () => {
    ({ pg, dataDir } = await bootstrapTestPostgres(PORT));

    superuserClient = new Client({ connectionString: testSuperuserUrl(PORT) });
    await superuserClient.connect();

    process.env.DATABASE_URL = appUrl;
    appService = new TenantDatabaseService();
  }, 120_000);

  afterAll(async () => {
    await superuserClient?.end();
    await appService?.onModuleDestroy();
    await teardownTestPostgres(pg, dataDir);
  });

  let userA: string;
  let userB: string;
  let eventId: string;

  beforeAll(async () => {
    // Seed as the superuser — bypasses RLS entirely (a Postgres
    // superuser always bypasses RLS, FORCE or not), which is exactly
    // what setup should do: insert fixture data unconditionally, then
    // verify the RESTRICTED role's view of it.
    userA = randomUUID();
    userB = randomUUID();
    eventId = randomUUID();

    await superuserClient.query(
      `INSERT INTO users (id, apple_sub, display_name) VALUES ($1, $2, 'User A'), ($3, $4, 'User B')`,
      [userA, `apple-sub-a-${userA}`, userB, `apple-sub-b-${userB}`],
    );

    await superuserClient.query(
      `INSERT INTO core_objects (id, user_id, object_type, source) VALUES ($1, $2, 'event', 'test_seed')`,
      [eventId, userA],
    );
    await superuserClient.query(
      `INSERT INTO events (id, user_id, domain, event_type, starts_at) VALUES ($1, $2, 'fitness', 'workout', now())`,
      [eventId, userA],
    );
    // Exercises the join-based policy on a domain extension table — the
    // real gap this implementation found and resolved (020's header
    // comment) rather than the doc's literal (but schema-inconsistent)
    // direct-user_id claim.
    await superuserClient.query(
      `INSERT INTO event_fitness_session (event_id, sport_type) VALUES ($1, 'run')`,
      [eventId],
    );
  });

  it('lets a user read their own core_objects/events/extension row', async () => {
    const rows = await appService.runAsUser(userA, (client) =>
      client
        .query('SELECT id FROM events WHERE id = $1', [eventId])
        .then((r) => r.rows),
    );
    expect(rows).toHaveLength(1);

    const fitnessRows = await appService.runAsUser(userA, (client) =>
      client
        .query(
          'SELECT event_id, sport_type FROM event_fitness_session WHERE event_id = $1',
          [eventId],
        )
        .then((r) => r.rows),
    );
    expect(fitnessRows).toHaveLength(1);
    expect(fitnessRows[0].sport_type).toBe('run');
  });

  it("blocks a different user from reading user A's events row (direct-user_id policy)", async () => {
    const rows = await appService.runAsUser(userB, (client) =>
      client
        .query('SELECT id FROM events WHERE id = $1', [eventId])
        .then((r) => r.rows),
    );
    expect(rows).toHaveLength(0); // zero rows, not an error — the exact bar Milestone 1 set
  });

  it("blocks a different user from reading user A's event_fitness_session row (join-based policy, the resolved gap)", async () => {
    const rows = await appService.runAsUser(userB, (client) =>
      client
        .query(
          'SELECT event_id FROM event_fitness_session WHERE event_id = $1',
          [eventId],
        )
        .then((r) => r.rows),
    );
    expect(rows).toHaveLength(0);
  });

  it('fails safe with zero rows when app.current_user_id is never set at all', async () => {
    const bareClient = new Client({ connectionString: appUrl });
    await bareClient.connect();
    try {
      const result = await bareClient.query(
        'SELECT id FROM events WHERE id = $1',
        [eventId],
      );
      expect(result.rows).toHaveLength(0);
    } finally {
      await bareClient.end();
    }
  });

  it('rejects an INSERT that claims a different user_id than the session is scoped to (WITH CHECK)', async () => {
    const rogueId = randomUUID();
    await expect(
      appService.runAsUser(userA, (client) =>
        client.query(
          `INSERT INTO core_objects (id, user_id, object_type, source) VALUES ($1, $2, 'event', 'rogue')`,
          [rogueId, userB], // claims to belong to B while session is scoped to A
        ),
      ),
    ).rejects.toThrow();

    // And confirm nothing was actually written under either identity.
    const asA = await appService.runAsUser(userA, (client) =>
      client
        .query('SELECT id FROM core_objects WHERE id = $1', [rogueId])
        .then((r) => r.rows),
    );
    const asB = await appService.runAsUser(userB, (client) =>
      client
        .query('SELECT id FROM core_objects WHERE id = $1', [rogueId])
        .then((r) => r.rows),
    );
    expect(asA).toHaveLength(0);
    expect(asB).toHaveLength(0);
  });

  it('keeps audit_log append-only for plos_app even after the broad 021 grant', async () => {
    await superuserClient.query(
      `INSERT INTO audit_log (actor_type, acting_as_user_id, action, result) VALUES ('user', $1, 'test.seed', 'success')`,
      [userA],
    );
    await expect(
      appService.runAsUser(userA, (client) =>
        client.query(`UPDATE audit_log SET result = 'error' WHERE acting_as_user_id = $1`, [
          userA,
        ]),
      ),
    ).rejects.toThrow();
  });
});
