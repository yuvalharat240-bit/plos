/* Not derived from docs/04-database-schema.md directly — the doc only
 * shows the audit_log GRANT/REVOKE as a worked example (§11), not the
 * full privilege set every other table needs. Without this migration,
 * plos_app/plos_worker (created in 001) can connect but every query
 * fails with "permission denied for table X" before RLS ever gets a
 * chance to filter anything — a real, necessary gap, not a Milestone 1
 * nice-to-have: the app cannot function at all without it, and RLS
 * cannot be meaningfully tested by connecting as the migration-owner
 * superuser (FORCE ROW LEVEL SECURITY matters precisely because plos_app
 * is not the table owner).
 *
 * Deliberately broad-but-functional for Milestone 1: both roles get the
 * same CRUD grant on every table that exists at this point (via ALL
 * TABLES IN SCHEMA). Finer-grained separation — plos_worker probably
 * doesn't need DELETE on most tables, permission_scopes should probably
 * be plos_app-read-only since it's a seed-once catalog — is exactly the
 * kind of thing docs/09-phase1-implementation-plan.md's Milestone 7
 * (security/ops hardening, least-privilege DB roles) exists to tighten.
 * Recorded here so it's a deliberate, tracked simplification, not an
 * oversight.
 *
 * Deliberately numbered to run BEFORE 999_embeddings.js (renumbered from
 * 022 in Milestone 2 to make room for 022-024's auth-related migrations,
 * then fixed at 999 in Milestone 7 so it never needs renumbering again —
 * see that file's own header), not after, even
 * though "ALL TABLES IN SCHEMA public" would more naturally run last to
 * see every table: node-pg-migrate's runner halts the whole migration
 * batch on the first failure, even with singleTransaction: false (that
 * option only changes whether migrations share one transaction, not
 * whether the runner keeps going past a failed one). The embeddings
 * migration is expected to fail in a local/embedded test Postgres without
 * pgvector, so anything meant to run unconditionally — this grant, and
 * every other Milestone 2 migration — has to come before it, not after.
 * It grants its own table access to itself once it's created.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    GRANT USAGE ON SCHEMA public TO plos_app, plos_worker;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO plos_app, plos_worker;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO plos_app, plos_worker;

    -- Re-affirm audit_log's append-only guarantee after the blanket
    -- grant above, which would otherwise silently undo 018's REVOKE.
    REVOKE UPDATE, DELETE ON audit_log FROM plos_app, plos_worker;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM plos_app, plos_worker;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM plos_app, plos_worker;
    REVOKE USAGE ON SCHEMA public FROM plos_app, plos_worker;
  `);
};
