/**
 * FOUND during the Phase 0/1/2 gap audit (2026-09-21): docs/09's
 * Milestone 1 plan assumed "Local Postgres via Docker Compose for
 * iteration," but this environment has never had Docker (established
 * back in Milestone 1). Milestone 1 solved that only for *tests*
 * (embedded-postgres, torn down after every run in rls.e2e-spec.ts /
 * auth-and-crud.e2e-spec.ts) — there was never a way to run `apps/api`
 * as a live, persistent server at all. Without this script, "start the
 * app and point a real client (iOS, curl, anything) at it" was simply
 * not possible in this environment, despite `npm start` existing and
 * looking like it should work.
 *
 * This starts the same embedded-postgres binary the tests use, but
 * `persistent: true` at a fixed data directory (`.embedded-postgres/`,
 * already `.gitignore`d from Milestone 1 — that entry anticipated this
 * exact need and was never followed through on until now) so data
 * survives restarts, applies all migrations, and stays running in the
 * foreground until Ctrl+C. Run this in one terminal, `npm run start:dev`
 * (with the printed DATABASE_URL) in another.
 */
const path = require('path');
const fs = require('fs');
const { runner } = require('node-pg-migrate');

const PORT = 55556; // distinct from the two test suites' 55433/55434
const DB_NAME = 'plos_dev';
const SUPERUSER = 'postgres';
const SUPERUSER_PASSWORD = 'postgres_dev_only';
const DATA_DIR = path.join(__dirname, '..', '.embedded-postgres');

async function main() {
  const dynamicImport = new Function('specifier', 'return import(specifier)');
  const { default: EmbeddedPostgres } = await dynamicImport('embedded-postgres');

  const isFirstRun = !fs.existsSync(DATA_DIR);

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: SUPERUSER,
    password: SUPERUSER_PASSWORD,
    port: PORT,
    persistent: true,
  });

  // FOUND while restarting this for Milestone 3: `initialise()` runs
  // `initdb`, which refuses to touch a non-empty data directory — it
  // must only run once, the very first time, never on a restart against
  // an already-initialized cluster.
  if (isFirstRun) {
    await pg.initialise();
  }
  await pg.start();
  if (isFirstRun) {
    await pg.createDatabase(DB_NAME);
  }

  const superuserUrl = `postgres://${SUPERUSER}:${SUPERUSER_PASSWORD}@localhost:${PORT}/${DB_NAME}`;
  try {
    await runner({
      databaseUrl: superuserUrl,
      dir: path.join(__dirname, '..', 'migrations'),
      direction: 'up',
      migrationsTable: 'pgmigrations',
      singleTransaction: false, // tolerate 025 (pgvector) failing, same as both test suites
    });
  } catch (err) {
    const message = String((err && err.message) || err);
    if (!/extension "vector"|vector\.control|could not open extension control file/i.test(message)) {
      throw err;
    }
    console.warn(
      '[dev-db] pgvector unavailable in this embedded Postgres — embeddings migration skipped. ' +
        'Everything else applied (matches both e2e suites\' tolerance for the same gap).',
    );
  }

  const appUrl = `postgres://plos_app:plos_app_dev_only@localhost:${PORT}/${DB_NAME}`;
  console.log('\n=== plos dev Postgres is running (persistent — Ctrl+C stops it, data survives) ===');
  console.log(`\n  DATABASE_URL=${appUrl}\n`);
  console.log('In another terminal:');
  console.log(`  DATABASE_URL=${appUrl} npm run start:dev\n`);

  const shutdown = async () => {
    console.log('\n[dev-db] stopping...');
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[dev-db] failed to start:', err);
  process.exit(1);
});
