/* docs/04-database-schema.md §6. Not core_objects subtypes — see §6.1's
 * rationale (continuously-upserted cache, not a discrete accumulated
 * fact). timeline_entries is a post-MVP UI feature (strategy doc "Life
 * Timeline") but cheap for the worker to populate now. */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE baseline_classification AS ENUM (
      'normal', 'improving', 'deteriorating', 'anomalous', 'repeated_pattern', 'new_pattern'
    );

    CREATE TABLE baselines (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        UUID NOT NULL REFERENCES users(id),
      domain         TEXT NOT NULL,
      metric         TEXT NOT NULL,
      window_days    SMALLINT NOT NULL,
      mean           NUMERIC,
      stddev         NUMERIC,
      current_value  NUMERIC,
      deviation_z    NUMERIC,
      classification baseline_classification NOT NULL,
      source         TEXT NOT NULL DEFAULT 'context_engine_worker',
      is_ai_derived  BOOLEAN NOT NULL DEFAULT false,
      computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, domain, metric, window_days)
    );

    CREATE TABLE timeline_entries (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID NOT NULL REFERENCES users(id),
      core_object_id   UUID NOT NULL REFERENCES core_objects(id) ON DELETE CASCADE,
      domain           TEXT NOT NULL,
      occurred_at      TIMESTAMPTZ NOT NULL,
      headline         TEXT NOT NULL,
      importance_score NUMERIC(3,2),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_timeline_user_time ON timeline_entries (user_id, occurred_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS timeline_entries;
    DROP TABLE IF EXISTS baselines;
    DROP TYPE IF EXISTS baseline_classification;
  `);
};
