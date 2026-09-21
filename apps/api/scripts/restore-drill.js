/**
 * Milestone 7 (docs/09-phase1-implementation-plan.md): "one verified
 * restore test (backups only 'count' once restored, per CLAUDE.md)."
 *
 * REAL LIMITATION, found while trying to do this the documented way, not
 * assumed: docs/07-privacy-model.md §5 and docs/02 ADR D4 both describe
 * RDS automated backups/snapshots, restored via AWS's own tooling — this
 * environment has no AWS account (Milestone 8 is the first time one will
 * exist), and this host has no Postgres client tools at all
 * (`pg_dump`/`pg_restore`/`psql` — checked, none installed; the
 * `embedded-postgres` package itself only bundles the server binaries
 * `initdb`/`pg_ctl`/`postgres`, no client tools). A literal
 * pg_dump-and-restore drill is not possible here.
 *
 * What this script does instead, and why it's still a real, meaningful
 * verification rather than a stand-in that proves nothing: PostgreSQL's
 * own plain file-level physical backup method — stop the server cleanly,
 * copy its entire data directory, that copy IS a valid backup; to
 * restore, point a fresh `postgres` process at a copy of that directory
 * and start it. This is a legitimate, standard Postgres backup mechanism
 * (the basis real tools like pgBackRest build on), not an invented
 * substitute. The drill below:
 *   1. Boots a real Postgres, migrates it, writes a marker row.
 *   2. Stops it cleanly and copies its data directory — "the backup."
 *   3. Restarts the original and deletes the marker row — a real,
 *      irreversible-in-place data loss event ("the disaster").
 *   4. Starts a SEPARATE Postgres process against the BACKUP COPY of the
 *      directory (not the live, now-damaged one) and queries it for the
 *      marker row.
 * If the marker is found in step 4, the restore is genuinely proven: not
 * "the file exists," but "the exact pre-disaster data is queryable again
 * through a real, independently-started Postgres server." Logged output
 * from an actual run of this script is the artifact this milestone's
 * verification step asks for.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Client } = require('pg');
const { runner } = require('node-pg-migrate');

const PORT_PRIMARY = 55557;
const PORT_RESTORED = 55558;
const DB_NAME = 'plos_restore_drill';
const SUPERUSER = 'postgres';
const SUPERUSER_PASSWORD = 'postgres_test_only';
const MARKER_APPLE_SUB = 'apple-sub-restore-drill-marker';

async function main() {
  const dynamicImport = new Function('specifier', 'return import(specifier)');
  const { default: EmbeddedPostgres } = await dynamicImport('embedded-postgres');

  const primaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plos-restore-drill-primary-'));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plos-restore-drill-backup-'));

  console.log('[restore-drill] step 1: booting primary Postgres and writing a marker row');
  let primary = new EmbeddedPostgres({
    databaseDir: primaryDir,
    user: SUPERUSER,
    password: SUPERUSER_PASSWORD,
    port: PORT_PRIMARY,
    persistent: true,
  });
  await primary.initialise();
  await primary.start();
  await primary.createDatabase(DB_NAME);

  const primaryUrl = `postgres://${SUPERUSER}:${SUPERUSER_PASSWORD}@localhost:${PORT_PRIMARY}/${DB_NAME}`;
  try {
    await runner({
      databaseUrl: primaryUrl,
      dir: path.join(__dirname, '..', 'migrations'),
      direction: 'up',
      migrationsTable: 'pgmigrations',
      singleTransaction: false,
      log: () => {},
    });
  } catch (err) {
    const message = String((err && err.message) || err);
    if (!/extension "vector"|vector\.control|could not open extension control file/i.test(message)) {
      throw err;
    }
  }

  let client = new Client({ connectionString: primaryUrl });
  await client.connect();
  const inserted = await client.query(
    `INSERT INTO users (apple_sub, display_name) VALUES ($1, 'Restore Drill Marker') RETURNING id`,
    [MARKER_APPLE_SUB],
  );
  const markerUserId = inserted.rows[0].id;
  await client.end();
  console.log(`[restore-drill] marker user written: ${markerUserId}`);

  console.log('[restore-drill] step 2: stopping primary and copying its data directory (the "backup")');
  await primary.stop();
  fs.cpSync(primaryDir, backupDir, { recursive: true });
  console.log(`[restore-drill] backup copy taken at ${backupDir}`);

  console.log('[restore-drill] step 3: restarting primary and deleting the marker row (the "disaster")');
  primary = new EmbeddedPostgres({
    databaseDir: primaryDir,
    user: SUPERUSER,
    password: SUPERUSER_PASSWORD,
    port: PORT_PRIMARY,
    persistent: true,
  });
  await primary.start();
  client = new Client({ connectionString: primaryUrl });
  await client.connect();
  await client.query(`DELETE FROM users WHERE id = $1`, [markerUserId]);
  const goneCheck = await client.query(`SELECT count(*)::int AS n FROM users WHERE id = $1`, [markerUserId]);
  await client.end();
  await primary.stop();
  if (goneCheck.rows[0].n !== 0) {
    throw new Error('[restore-drill] disaster simulation failed — marker row still present in primary');
  }
  console.log('[restore-drill] confirmed: marker row is gone from the live (post-disaster) database');

  console.log('[restore-drill] step 4: starting a separate Postgres against the BACKUP COPY and querying it');
  const restored = new EmbeddedPostgres({
    databaseDir: backupDir,
    user: SUPERUSER,
    password: SUPERUSER_PASSWORD,
    port: PORT_RESTORED,
    persistent: true,
  });
  await restored.start();
  const restoredUrl = `postgres://${SUPERUSER}:${SUPERUSER_PASSWORD}@localhost:${PORT_RESTORED}/${DB_NAME}`;
  const restoredClient = new Client({ connectionString: restoredUrl });
  await restoredClient.connect();
  const recovered = await restoredClient.query(
    `SELECT id, apple_sub, display_name FROM users WHERE apple_sub = $1`,
    [MARKER_APPLE_SUB],
  );
  await restoredClient.end();
  await restored.stop();

  fs.rmSync(primaryDir, { recursive: true, force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });

  if (recovered.rows.length !== 1 || recovered.rows[0].id !== markerUserId) {
    throw new Error('[restore-drill] FAILED — marker row not recovered from the backup copy');
  }

  console.log('[restore-drill] RESTORE VERIFIED: marker row recovered from the backup copy:');
  console.log(`  ${JSON.stringify(recovered.rows[0])}`);
  console.log('[restore-drill] a backup that has never been restored is not verified — this one now has been.');
}

main().catch((err) => {
  console.error('[restore-drill] FAILED:', err);
  process.exit(1);
});
