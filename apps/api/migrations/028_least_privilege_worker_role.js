/* docs/09 Milestone 7: "least-privilege DB roles (no interactive
 * superuser shell for routine prod ops)" — the specific item
 * 021_role_grants.js's own header flagged and deferred here explicitly:
 * "plos_worker probably doesn't need DELETE on most tables,
 * permission_scopes should probably be plos_app-read-only... exactly the
 * kind of thing Milestone 7 exists to tighten."
 *
 * FINDING, found while actually doing this tightening, not assumed: no
 * application code anywhere (`src/worker-main.ts` included) ever connects
 * as `plos_worker` — every dev/test run this project has done, including
 * every "ran the real worker against the live dev database" verification
 * in Milestones 4-6, used `plos_app` credentials for the worker too.
 * `plos_worker` has existed since Migration 001 with full CRUD on every
 * table and has never actually been exercised. This migration is
 * therefore the first time `plos_worker`'s privileges are made to match
 * what the worker's real code (`BaselineService`, `CalendarDensityService`)
 * actually does: read `users` (enumeration), read the handful of
 * domain/extension tables its metric queries join across, and
 * insert/update `baselines` — nothing else, no DELETE anywhere. Verified
 * by actually running the worker connected AS `plos_worker` against the
 * live dev database after this migration (docs/10), and by pointing
 * `test/worker.e2e-spec.ts` at the `plos_worker` role instead of
 * `plos_app` so the tightened grant is proven sufficient, not just
 * written and assumed.
 *
 * `permission_scopes` is a seed-once catalog — every existing INSERT into
 * it happens in a migration file, run as the superuser/table owner, never
 * by application code — so revoking write access from both app roles
 * costs nothing at runtime and closes the exact gap 021 named.
 */
exports.shorthands = undefined;

const WORKER_SELECT_TABLES = [
  'users',
  'observations',
  'observation_sleep',
  'observation_journal_entry',
  'events',
  'event_fitness_session',
  'event_calendar_item',
  'baselines',
];

exports.up = (pgm) => {
  pgm.sql(`
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM plos_worker;
    GRANT USAGE ON SCHEMA public TO plos_worker;

    GRANT SELECT ON ${WORKER_SELECT_TABLES.join(', ')} TO plos_worker;
    GRANT INSERT, UPDATE ON baselines TO plos_worker;

    REVOKE INSERT, UPDATE, DELETE ON permission_scopes FROM plos_app, plos_worker;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    GRANT INSERT, UPDATE, DELETE ON permission_scopes TO plos_app, plos_worker;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO plos_worker;
  `);
};
