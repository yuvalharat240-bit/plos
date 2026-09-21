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
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runner } from 'node-pg-migrate';
import { TenantDatabaseService } from '../src/database/tenant-database.service';

const PORT = 55433;
const DB_NAME = 'plos_test';
const SUPERUSER = 'postgres';
const SUPERUSER_PASSWORD = 'postgres_test_only';
const APP_ROLE = 'plos_app';
const APP_ROLE_PASSWORD = 'plos_app_dev_only'; // matches 001_roles_and_extensions.js

describe('RLS tenant isolation (docs/04-database-schema.md §10)', () => {
  let pg: InstanceType<typeof import('embedded-postgres').default>;
  let superuserClient: Client;
  let appService: TenantDatabaseService;
  let dataDir: string;

  const superuserUrl = `postgres://${SUPERUSER}:${SUPERUSER_PASSWORD}@localhost:${PORT}/${DB_NAME}`;
  const appUrl = `postgres://${APP_ROLE}:${APP_ROLE_PASSWORD}@localhost:${PORT}/${DB_NAME}`;

  beforeAll(async () => {
    // embedded-postgres is a pure-ESM package ("type": "module"). ts-jest
    // compiling to CommonJS downlevels a literal `await import(...)` into
    // a `require()` call, which cannot load an ESM module and fails with
    // "Cannot use import statement outside a module". Constructing the
    // import at runtime via `Function` bypasses TypeScript's static
    // rewrite (it never sees a literal `import(...)` token to transform)
    // — the standard workaround for this CJS-consumes-ESM combination.
    //
    // FOUND in Milestone 3, once a third e2e spec file used this same
    // pattern: running multiple such spec files together under Jest's
    // `--runInBand` (one shared OS process) intermittently threw "Test
    // environment has been torn down" from INSIDE one file's stack trace
    // while pointing at a DIFFERENT file's `new Function(...)` — i.e. one
    // file's dynamically-compiled import shim got invoked against
    // another, already-torn-down file's Jest environment. Each spec file
    // has its own dedicated port and fully independent embedded-postgres
    // lifecycle, so there was never a real reason to force them into one
    // process — removing `--runInBand` (package.json's `test:rls`) so
    // Jest runs each file as a genuinely separate worker process fixed
    // it reliably. If a fourth e2e spec file is ever added, don't
    // reintroduce `--runInBand` without re-verifying this.
    const dynamicImport = new Function(
      'specifier',
      'return import(specifier)',
    ) as (specifier: string) => Promise<{ default: typeof import('embedded-postgres').default }>;
    const { default: EmbeddedPostgres } = await dynamicImport('embedded-postgres');
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plos-pg-'));

    pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: SUPERUSER,
      password: SUPERUSER_PASSWORD,
      port: PORT,
      persistent: false,
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase(DB_NAME);

    try {
      await runner({
        databaseUrl: superuserUrl,
        dir: path.join(__dirname, '..', 'migrations'),
        direction: 'up',
        migrationsTable: 'pgmigrations',
        // Test-only override — production/dev migration runs keep the
        // default (true): all-or-nothing. Here it lets every other
        // migration commit independently of embeddings/pgvector, which is
        // expected to fail in an embedded test Postgres that doesn't
        // bundle third-party extensions. See 999_embeddings.js's header.
        singleTransaction: false,
        log: () => {
          /* quiet — this test asserts on outcomes, not migration chatter */
        },
      });
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      const isPgvectorMissing =
        /extension "vector"|vector\.control|could not open extension control file/i.test(
          message,
        );
      if (!isPgvectorMissing) {
        throw err; // a real failure — never mask it
      }
      // eslint-disable-next-line no-console
      console.warn(
        '[rls.e2e-spec] pgvector unavailable in this embedded test Postgres — ' +
          'migration 021 (embeddings) did not apply. Migrations 001-020 and 022, ' +
          'including every RLS policy, already committed independently ' +
          '(singleTransaction: false for this test run only). RDS supports ' +
          'pgvector natively (ADR D5); embeddings is unused at MVP regardless ' +
          '(docs/08-mvp-definition.md §9.1). Continuing with RLS verification.',
      );
    }

    superuserClient = new Client({ connectionString: superuserUrl });
    await superuserClient.connect();

    process.env.DATABASE_URL = appUrl;
    appService = new TenantDatabaseService();
  }, 120_000);

  afterAll(async () => {
    await superuserClient?.end();
    await appService?.onModuleDestroy();
    await pg?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
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
