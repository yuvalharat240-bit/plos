/* docs/04-database-schema.md §4.4, ADR D5. Deferred entirely at MVP
 * (docs/08 §9.1 — "no embedding is generated or stored at MVP... the
 * pgvector extension can be enabled in the database at zero cost, but
 * nothing writes to it"), so this migration's own RLS policy AND its own
 * plos_app/plos_worker grant are both bundled here rather than in
 * 020/021 — the whole file is one skippable unit if pgvector isn't
 * installed (e.g. a local/embedded test Postgres that doesn't bundle
 * third-party extensions; RDS supports it natively, ADR D5).
 *
 * Deliberately numbered to run LAST: node-pg-migrate's runner halts the
 * whole batch on a migration failure even with singleTransaction: false —
 * a migration positioned after this one would never run if pgvector is
 * missing, which is exactly why every other migration has to come before
 * this one, never after.
 *
 * FIXED NUMBERING SCHEME, adopted here after this exact mistake happened
 * three times in a row (016 -> 022 -> 025 -> 026 -> 027 -> 028, each
 * milestone renumbering this file to "one past the current last one" and
 * getting it wrong at least once along the way — Milestone 5's version
 * of the mistake actually ran and produced a confusing tool-registry
 * startup error instead of an obvious ordering failure; Milestone 7's
 * was caught in review before running anything, which is better but
 * still the same root cause). Renumbering this file every milestone is
 * the actual bug: it's an easy, natural-seeming edit that is wrong every
 * time another migration is added in the same milestone after it. Fixed
 * by jumping this file's own number to 999 — a value no realistic amount
 * of future sequential migration growth will reach — so from here on, a
 * new migration numbered in normal sequence (029, 030, ...) is
 * automatically before this file without anyone needing to touch it or
 * even think about it again. Nothing else in the schema references
 * embeddings, so moving it last means a missing extension in a local/
 * embedded test Postgres can never block any other migration.
 * See test/rls.e2e-spec.ts's migration runner for exactly how a missing
 * extension here is tolerated. */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE embeddings (
      core_object_id UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
      model          TEXT NOT NULL,
      embedding      VECTOR(1536) NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_embeddings_hnsw ON embeddings
      USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

    ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE embeddings FORCE ROW LEVEL SECURITY;
    -- Joins back to core_objects for its user_id (docs/04 §10.2 lists
    -- embeddings among the standard-policy tables, but the table itself
    -- has no user_id column — it inherits tenancy from the spine row it
    -- extends, so the policy checks via that join).
    CREATE POLICY embeddings_tenant_isolation ON embeddings
      USING (EXISTS (
        SELECT 1 FROM core_objects co
        WHERE co.id = embeddings.core_object_id
          AND co.user_id = current_setting('app.current_user_id', true)::uuid
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM core_objects co
        WHERE co.id = embeddings.core_object_id
          AND co.user_id = current_setting('app.current_user_id', true)::uuid
      ));

    -- 021's "ALL TABLES IN SCHEMA public" grant ran before this table
    -- existed, so it doesn't cover embeddings — granted explicitly here.
    --
    -- FINDING (security review, docs/09 Milestone 7): this originally
    -- also granted plos_worker full CRUD here, including DELETE —
    -- silently re-widening exactly what 028_least_privilege_worker_role.js
    -- (which runs BEFORE this file) revoked ("nothing else, no DELETE
    -- anywhere" was that migration's own stated invariant for
    -- plos_worker). Nothing at MVP ever touches embeddings
    -- (docs/08 section 9.1 - embeddings are deferred entirely), so
    -- plos_worker gets no grant here at all; plos_app keeps full CRUD
    -- for whenever a real feature needs to write one.
    GRANT SELECT, INSERT, UPDATE, DELETE ON embeddings TO plos_app;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS embeddings;
  `);
};
