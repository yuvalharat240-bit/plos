import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runner } from 'node-pg-migrate';

/**
 * The embedded-postgres boot/migrate sequence every e2e spec in this
 * suite needs — was hand-duplicated across all 8 files (ponytail-audit,
 * Milestone 8 follow-up, 2026-09-22). Each spec still owns its own port,
 * its own post-migration setup (a plain `Client`, a full Nest app,
 * provider overrides, seed data), and its own teardown call site — only
 * the truly-identical "start a real Postgres, apply every migration"
 * part lives here.
 *
 * Each caller MUST use its own dedicated port (rls.e2e-spec.ts: 55433,
 * auth-and-crud: 55434, sync: 55435, worker: 55436, agent: 55437,
 * privacy: 55438, idor: 55439, health: 55440) — FOUND in Milestone 3,
 * once a third e2e spec file existed: running multiple spec files
 * together under Jest's `--runInBand` (one shared OS process)
 * intermittently threw "Test environment has been torn down" from
 * INSIDE one file's stack trace while pointing at a DIFFERENT file's
 * dynamic-import shim — i.e. one file's shim got invoked against
 * another, already-torn-down file's Jest environment. Each spec having
 * its own port and fully independent embedded-postgres lifecycle is
 * what makes running them as separate worker processes (no
 * `--runInBand`, package.json's `test:rls`) safe. Don't reintroduce
 * `--runInBand` without re-verifying this holds.
 *
 * One caller (rls.e2e-spec.ts, the original suite) used to log a
 * console.warn when the pgvector-missing tolerance branch below fired,
 * naming exactly which migrations still committed and why RDS doesn't
 * have this problem (ADR D5). Folded into this comment instead of a
 * per-caller warn callback: the branch has never actually fired in a
 * real run this project has seen, and the underlying tolerance behavior
 * (swallow the pgvector-extension error, let 001-020/022+ commit
 * independently, since embeddings is unused at MVP regardless per
 * docs/08 §9.1) is unchanged and identical for every caller.
 */
export const TEST_SUPERUSER = 'postgres';
export const TEST_SUPERUSER_PASSWORD = 'postgres_test_only';
export const TEST_DB_NAME = 'plos_test';

export function testSuperuserUrl(port: number): string {
  return `postgres://${TEST_SUPERUSER}:${TEST_SUPERUSER_PASSWORD}@localhost:${port}/${TEST_DB_NAME}`;
}

export async function bootstrapTestPostgres(
  port: number,
): Promise<{ pg: InstanceType<typeof import('embedded-postgres').default>; dataDir: string }> {
  // embedded-postgres is a pure-ESM package; see rls.e2e-spec.ts's
  // original comment (kept there) for exactly why this indirection
  // through `Function` is needed under ts-jest/CommonJS.
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<{ default: typeof import('embedded-postgres').default }>;
  const { default: EmbeddedPostgres } = await dynamicImport('embedded-postgres');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plos-pg-test-'));

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: TEST_SUPERUSER,
    password: TEST_SUPERUSER_PASSWORD,
    port,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(TEST_DB_NAME);

  try {
    await runner({
      databaseUrl: testSuperuserUrl(port),
      dir: path.join(__dirname, '..', '..', 'migrations'),
      direction: 'up',
      migrationsTable: 'pgmigrations',
      singleTransaction: false,
      log: () => {},
    });
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    if (!/extension "vector"|vector\.control|could not open extension control file/i.test(message)) {
      throw err;
    }
  }

  return { pg, dataDir };
}

export async function teardownTestPostgres(
  pg: InstanceType<typeof import('embedded-postgres').default> | undefined,
  dataDir: string | undefined,
): Promise<void> {
  await pg?.stop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
}
