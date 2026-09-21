/* docs/04-database-schema.md §0, §11 — gen_random_uuid() is built into
 * Postgres >=13 (no pgcrypto needed). Least-privilege app/worker roles
 * created here because §11's audit_log GRANT/REVOKE statements need them
 * to exist, and because testing RLS meaningfully means connecting AS one
 * of these roles, not as the migration-owner/superuser (FORCE ROW LEVEL
 * SECURITY matters most precisely because these roles are not the table
 * owner). Dev-only passwords below; production credentials come from
 * Secrets Manager per ADR D4, never a literal in a migration file — this
 * is Milestone 1's local/CI bootstrap, not the production provisioning
 * path (that's Milestone 8).
 */
exports.shorthands = undefined;

// FINDING (Milestone 8 IaC pass, 2026-09-22): this file's own header
// comment already said "production credentials come from Secrets Manager
// ... never a literal in a migration file" — but the CREATE ROLE
// statements below were still hardcoded literals regardless of
// environment. Applying this migration verbatim against a real RDS
// instance would have given the production plos_app/plos_worker roles
// these exact, public, repo-visible passwords. Now read from the
// environment (infra/ecs.tf's one-off migrate task injects real
// Secrets-Manager-backed values there), falling back to the original
// dev-only literals so local dev/CI/the test suite — none of which set
// these — keep working exactly as before.
function sqlStringLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

exports.up = (pgm) => {
  const appPassword = sqlStringLiteral(process.env.PLOS_APP_ROLE_PASSWORD ?? 'plos_app_dev_only');
  const workerPassword = sqlStringLiteral(process.env.PLOS_WORKER_ROLE_PASSWORD ?? 'plos_worker_dev_only');
  pgm.sql(`
    DO $roles$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'plos_app') THEN
        CREATE ROLE plos_app LOGIN PASSWORD ${appPassword};
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'plos_worker') THEN
        CREATE ROLE plos_worker LOGIN PASSWORD ${workerPassword};
      END IF;
    END
    $roles$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP ROLE IF EXISTS plos_app;`);
  pgm.sql(`DROP ROLE IF EXISTS plos_worker;`);
};
