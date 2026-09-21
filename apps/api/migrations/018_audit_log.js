/* docs/04-database-schema.md §11 — append-only by construction, not
 * convention: plos_app/plos_worker (created in 001) never get UPDATE/
 * DELETE on this table at all, backed by a rejection trigger as
 * defense-in-depth. Monthly partition created for the current month;
 * a real deployment needs a scheduled job creating future partitions
 * ahead of need — out of scope for Milestone 1's schema bootstrap. */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE audit_log (
      id                BIGINT GENERATED ALWAYS AS IDENTITY,
      occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      actor_type        TEXT NOT NULL CHECK (actor_type IN ('user','agent','system','professional','admin')),
      actor_id          UUID,
      acting_as_user_id UUID,
      action            TEXT NOT NULL,
      resource_type     TEXT,
      resource_id       UUID,
      risk_tier         SMALLINT CHECK (risk_tier BETWEEN 0 AND 4),
      request_id        UUID,
      agent_version     TEXT,
      model_version     TEXT,
      args_hash         TEXT,
      result            TEXT NOT NULL CHECK (result IN ('success','denied','error')),
      ip_hash           TEXT,
      metadata          JSONB,
      PRIMARY KEY (id, occurred_at)
    ) PARTITION BY RANGE (occurred_at);

    -- Current month's partition; extend with a scheduled job in a real
    -- deployment (Milestone 8), not hand-created per month.
    CREATE TABLE audit_log_current PARTITION OF audit_log
      FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

    REVOKE UPDATE, DELETE ON audit_log FROM plos_app, plos_worker;
    GRANT INSERT, SELECT ON audit_log TO plos_app, plos_worker;

    CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'audit_log is append-only';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

    ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
    ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
    CREATE POLICY audit_log_read_own ON audit_log
      FOR SELECT
      USING (acting_as_user_id = current_setting('app.current_user_id', true)::uuid);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS audit_log;
    DROP FUNCTION IF EXISTS reject_audit_mutation();
  `);
};
