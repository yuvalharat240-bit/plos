/* docs/09 Milestone 6 / docs/07-privacy-model.md §7's preamble: a
 * configurable grace period (default 14 days) between requesting
 * deletion and steps 3-8 actually running, with a cancel path in
 * between. Neither docs/04-database-schema.md nor docs/07 names a column
 * that records *when* the grace period started — `users.status` alone
 * can't answer "is this account still within its window" once more than
 * one pending_deletion request could ever exist over time, and a future
 * scheduled finalize-job (not built until real ops infra exists) needs
 * exactly this column to find accounts whose window has elapsed. A real,
 * narrow schema addition this milestone's own workflow requires, found
 * the same way 020/024/025/026 found theirs: while actually building the
 * feature the doc assumes exists.
 *
 * Deliberately numbered before the embeddings migration (since fixed at
 * `999_embeddings.js`, Milestone 7 — see that file's header for why) for
 * the reason 021's own header comment already explains: embeddings is
 * deliberately last because a missing pgvector extension halts the whole
 * migration batch, so anything meant to run unconditionally must come
 * before it.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users ADD COLUMN deletion_requested_at TIMESTAMPTZ;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE users DROP COLUMN IF EXISTS deletion_requested_at;
  `);
};
