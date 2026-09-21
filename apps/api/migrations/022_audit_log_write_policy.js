/* FINDING, resolved here rather than silently, and only discovered while
 * implementing Milestone 2 (docs/09 §Milestone 2) — the first code that
 * actually needs to INSERT into audit_log as plos_app.
 *
 * 018_audit_log.js gave audit_log exactly one RLS policy,
 * `audit_log_read_own`, declared `FOR SELECT`. Postgres RLS is deny-by-
 * default per command: a policy scoped to one command (SELECT) grants
 * nothing for any other command. With FORCE ROW LEVEL SECURITY set and no
 * policy at all covering INSERT, every INSERT attempted by plos_app
 * (a non-owner, non-superuser role) is rejected — regardless of the
 * plos_app/plos_worker GRANT INSERT privilege from 018/021, which governs
 * table-level privilege, not row-level policy. Milestone 1's test suite
 * never caught this because its one audit_log test seeded the row as the
 * superuser (which bypasses RLS entirely) and only exercised the UPDATE
 * rejection — it never inserted as plos_app. This migration adds the
 * missing INSERT policy so real application code (auth, journal/workout/
 * medication CRUD) can actually write audit rows at all.
 *
 * Mirrors the existing SELECT policy's scoping rule: an inserted row must
 * claim `acting_as_user_id` equal to the session's own tenant variable —
 * the same non-negotiable a domain-table WITH CHECK enforces (04 §10.1),
 * applied here to the audit trail itself.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE POLICY audit_log_insert_own ON audit_log
      FOR INSERT
      WITH CHECK (acting_as_user_id = current_setting('app.current_user_id', true)::uuid);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP POLICY IF EXISTS audit_log_insert_own ON audit_log;`);
};
