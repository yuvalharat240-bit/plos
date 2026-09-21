/* docs/04-database-schema.md §12 — one _history shadow table per mutable
 * current-state table, all following the identical goal_history template
 * given in full in the doc ("each following the goal_history template
 * above with the table name substituted"). Written out explicitly per
 * table rather than via a generic helper — the table-name-to-history-
 * name mapping isn't a simple suffix rule (memories -> memory_history,
 * financial_accounts -> financial_account_history, documents ->
 * document_history, clinical_memories -> clinical_memory_history), and a
 * clever generic version of this was worse to read and got the mapping
 * wrong; six explicit, boring blocks is the correct amount of code here.
 * health_profile_history is adapted because health_profile's primary key
 * column is literally named user_id, not id. */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- goals -> goal_history
    CREATE TABLE goal_history (
      history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      id         UUID NOT NULL,
      user_id    UUID NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      changed_by UUID,
      operation  TEXT NOT NULL CHECK (operation IN ('update','delete')),
      snapshot   JSONB NOT NULL
    );
    CREATE INDEX idx_goal_history_id ON goal_history (id, changed_at DESC);

    CREATE OR REPLACE FUNCTION capture_goal_history() RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO goal_history (id, user_id, changed_by, operation, snapshot)
      VALUES (OLD.id, OLD.user_id, current_setting('app.current_user_id', true)::uuid,
              lower(TG_OP), to_jsonb(OLD));
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_goal_history BEFORE UPDATE OR DELETE ON goals
      FOR EACH ROW EXECUTE FUNCTION capture_goal_history();

    -- memories -> memory_history
    CREATE TABLE memory_history (
      history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      id         UUID NOT NULL,
      user_id    UUID NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      changed_by UUID,
      operation  TEXT NOT NULL CHECK (operation IN ('update','delete')),
      snapshot   JSONB NOT NULL
    );
    CREATE INDEX idx_memory_history_id ON memory_history (id, changed_at DESC);

    CREATE OR REPLACE FUNCTION capture_memory_history() RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO memory_history (id, user_id, changed_by, operation, snapshot)
      VALUES (OLD.id, OLD.user_id, current_setting('app.current_user_id', true)::uuid,
              lower(TG_OP), to_jsonb(OLD));
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_memory_history BEFORE UPDATE OR DELETE ON memories
      FOR EACH ROW EXECUTE FUNCTION capture_memory_history();

    -- clinical_memories -> clinical_memory_history
    CREATE TABLE clinical_memory_history (
      history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      id         UUID NOT NULL,
      user_id    UUID NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      changed_by UUID,
      operation  TEXT NOT NULL CHECK (operation IN ('update','delete')),
      snapshot   JSONB NOT NULL
    );
    CREATE INDEX idx_clinical_memory_history_id ON clinical_memory_history (id, changed_at DESC);

    CREATE OR REPLACE FUNCTION capture_clinical_memory_history() RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO clinical_memory_history (id, user_id, changed_by, operation, snapshot)
      VALUES (OLD.id, OLD.user_id, current_setting('app.current_user_id', true)::uuid,
              lower(TG_OP), to_jsonb(OLD));
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_clinical_memory_history BEFORE UPDATE OR DELETE ON clinical_memories
      FOR EACH ROW EXECUTE FUNCTION capture_clinical_memory_history();

    -- documents -> document_history
    CREATE TABLE document_history (
      history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      id         UUID NOT NULL,
      user_id    UUID NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      changed_by UUID,
      operation  TEXT NOT NULL CHECK (operation IN ('update','delete')),
      snapshot   JSONB NOT NULL
    );
    CREATE INDEX idx_document_history_id ON document_history (id, changed_at DESC);

    CREATE OR REPLACE FUNCTION capture_document_history() RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO document_history (id, user_id, changed_by, operation, snapshot)
      VALUES (OLD.id, OLD.user_id, current_setting('app.current_user_id', true)::uuid,
              lower(TG_OP), to_jsonb(OLD));
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_document_history BEFORE UPDATE OR DELETE ON documents
      FOR EACH ROW EXECUTE FUNCTION capture_document_history();

    -- financial_accounts -> financial_account_history
    CREATE TABLE financial_account_history (
      history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      id         UUID NOT NULL,
      user_id    UUID NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      changed_by UUID,
      operation  TEXT NOT NULL CHECK (operation IN ('update','delete')),
      snapshot   JSONB NOT NULL
    );
    CREATE INDEX idx_financial_account_history_id ON financial_account_history (id, changed_at DESC);

    CREATE OR REPLACE FUNCTION capture_financial_account_history() RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO financial_account_history (id, user_id, changed_by, operation, snapshot)
      VALUES (OLD.id, OLD.user_id, current_setting('app.current_user_id', true)::uuid,
              lower(TG_OP), to_jsonb(OLD));
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_financial_account_history BEFORE UPDATE OR DELETE ON financial_accounts
      FOR EACH ROW EXECUTE FUNCTION capture_financial_account_history();

    -- health_profile -> health_profile_history (adapted: health_profile's
    -- PK column is named user_id, not id — no separate id column exists).
    CREATE TABLE health_profile_history (
      history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      changed_by UUID,
      operation  TEXT NOT NULL CHECK (operation IN ('update','delete')),
      snapshot   JSONB NOT NULL
    );
    CREATE INDEX idx_health_profile_history_user ON health_profile_history (user_id, changed_at DESC);

    CREATE OR REPLACE FUNCTION capture_health_profile_history() RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO health_profile_history (user_id, changed_by, operation, snapshot)
      VALUES (OLD.user_id, current_setting('app.current_user_id', true)::uuid,
              lower(TG_OP), to_jsonb(OLD));
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_health_profile_history BEFORE UPDATE OR DELETE ON health_profile
      FOR EACH ROW EXECUTE FUNCTION capture_health_profile_history();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_health_profile_history ON health_profile;
    DROP FUNCTION IF EXISTS capture_health_profile_history();
    DROP TABLE IF EXISTS health_profile_history;

    DROP TRIGGER IF EXISTS trg_financial_account_history ON financial_accounts;
    DROP FUNCTION IF EXISTS capture_financial_account_history();
    DROP TABLE IF EXISTS financial_account_history;

    DROP TRIGGER IF EXISTS trg_document_history ON documents;
    DROP FUNCTION IF EXISTS capture_document_history();
    DROP TABLE IF EXISTS document_history;

    DROP TRIGGER IF EXISTS trg_clinical_memory_history ON clinical_memories;
    DROP FUNCTION IF EXISTS capture_clinical_memory_history();
    DROP TABLE IF EXISTS clinical_memory_history;

    DROP TRIGGER IF EXISTS trg_memory_history ON memories;
    DROP FUNCTION IF EXISTS capture_memory_history();
    DROP TABLE IF EXISTS memory_history;

    DROP TRIGGER IF EXISTS trg_goal_history ON goals;
    DROP FUNCTION IF EXISTS capture_goal_history();
    DROP TABLE IF EXISTS goal_history;
  `);
};
