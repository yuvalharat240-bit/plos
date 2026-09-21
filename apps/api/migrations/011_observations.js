/* docs/04-database-schema.md §3.3. observation_vital/_sleep/_symptom/
 * _injury_flag/_lab_result/_nutrition_log/_journal_entry/_financial_snapshot
 * are given as column summaries, not full DDL — constructed to the same
 * 1:1-extension pattern used everywhere else. Note: §3.3 says "a
 * correction is a new row with supersedes_id... added on the extension
 * table, not here, since only some observation kinds are ever corrected"
 * but never names which kinds — not guessed here; left out until a real
 * correction requirement names the specific table. */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE observations (
      id                UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
      user_id           UUID NOT NULL REFERENCES users(id),
      domain            TEXT NOT NULL,
      observation_type  TEXT NOT NULL,
      subject_entity_id UUID REFERENCES entities(id),
      observed_at       TIMESTAMPTZ NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_observations_user_time ON observations (user_id, observed_at DESC);
    CREATE INDEX idx_observations_user_type ON observations (user_id, domain, observation_type);

    CREATE TRIGGER trg_observations_consistency BEFORE INSERT OR UPDATE ON observations
      FOR EACH ROW EXECUTE FUNCTION enforce_core_object_consistency('observation');

    -- Mutable state tables (docs/04 §3.3) — not append-only, versioned via
    -- *_history tables (019).
    CREATE TABLE health_profile (
      user_id             UUID PRIMARY KEY REFERENCES users(id),
      allergies           TEXT[] NOT NULL DEFAULT '{}',
      chronic_conditions  TEXT[] NOT NULL DEFAULT '{}',
      medications_current JSONB NOT NULL DEFAULT '[]',
      blood_type          TEXT,
      is_user_entered     BOOLEAN NOT NULL DEFAULT true,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE financial_accounts (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id               UUID NOT NULL REFERENCES users(id),
      account_name          TEXT NOT NULL,
      account_type          TEXT NOT NULL,
      institution_entity_id UUID REFERENCES entities(id),
      currency              CHAR(3) NOT NULL,
      risk_tolerance        TEXT,
      is_active             BOOLEAN NOT NULL DEFAULT true,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Health (MVP domain)
    CREATE TABLE observation_vital (
      observation_id UUID PRIMARY KEY REFERENCES observations(id) ON DELETE CASCADE,
      vital_type     TEXT NOT NULL CHECK (vital_type IN
                       ('resting_hr','hrv','steps','active_energy_kcal','spo2',
                        'weight_kg','blood_pressure_sys','blood_pressure_dia','blood_glucose')),
      value_numeric  NUMERIC NOT NULL,
      unit           TEXT NOT NULL
    );

    CREATE TABLE observation_sleep (
      observation_id UUID PRIMARY KEY REFERENCES observations(id) ON DELETE CASCADE,
      sleep_start    TIMESTAMPTZ NOT NULL,
      sleep_end      TIMESTAMPTZ NOT NULL,
      duration_min   INTEGER,
      deep_min       INTEGER,
      rem_min        INTEGER,
      light_min      INTEGER,
      awake_min      INTEGER,
      sleep_score    NUMERIC
    );

    CREATE TABLE observation_symptom (
      observation_id UUID PRIMARY KEY REFERENCES observations(id) ON DELETE CASCADE,
      symptom_name   TEXT NOT NULL,
      severity       SMALLINT CHECK (severity BETWEEN 1 AND 5),
      duration_min   INTEGER,
      notes          TEXT
    );

    -- Fitness (MVP domain) — backs get_active_injury_flags, docs/03 §2.7
    CREATE TABLE observation_injury_flag (
      observation_id UUID PRIMARY KEY REFERENCES observations(id) ON DELETE CASCADE,
      body_part      TEXT NOT NULL,
      severity       SMALLINT,
      flagged_by     TEXT NOT NULL CHECK (flagged_by IN ('user','clinician')),
      active         BOOLEAN NOT NULL DEFAULT true,
      started_at     TIMESTAMPTZ,
      resolved_at    TIMESTAMPTZ
    );

    -- Health, post-MVP write path (docs/08 §4.2) — schema exists now
    CREATE TABLE observation_lab_result (
      observation_id             UUID PRIMARY KEY REFERENCES observations(id) ON DELETE CASCADE,
      test_name                  TEXT NOT NULL,
      value_numeric              NUMERIC,
      value_text                 TEXT,
      unit                       TEXT,
      reference_low              NUMERIC,
      reference_high             NUMERIC,
      abnormal_flag              BOOLEAN,
      ordering_professional_id   UUID REFERENCES professionals(id),
      document_id                UUID REFERENCES documents(id)
    );

    -- Nutrition, post-MVP (docs/08 §8)
    CREATE TABLE observation_nutrition_log (
      observation_id UUID PRIMARY KEY REFERENCES observations(id) ON DELETE CASCADE,
      meal_type      TEXT,
      total_calories NUMERIC,
      protein_g      NUMERIC,
      carbs_g        NUMERIC,
      fat_g          NUMERIC,
      fiber_g        NUMERIC
    );

    CREATE TABLE nutrition_log_item (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      observation_id UUID NOT NULL REFERENCES observation_nutrition_log(observation_id) ON DELETE CASCADE,
      food_name      TEXT NOT NULL,
      food_entity_id UUID REFERENCES entities(id),
      quantity       NUMERIC,
      unit           TEXT,
      calories       NUMERIC
    );
    CREATE INDEX idx_nutrition_log_item_observation ON nutrition_log_item (observation_id);

    -- Mental/Emotional (MVP domain)
    CREATE TABLE observation_journal_entry (
      observation_id UUID PRIMARY KEY REFERENCES observations(id) ON DELETE CASCADE,
      entry_kind     TEXT NOT NULL CHECK (entry_kind IN ('free_text','structured_checkin')),
      entry_text     TEXT,
      mood_score     NUMERIC,
      stress_score   NUMERIC,
      energy_score   NUMERIC,
      tags           TEXT[] NOT NULL DEFAULT '{}'
    );

    -- Finance, post-MVP (docs/08 §8)
    CREATE TABLE observation_financial_snapshot (
      observation_id       UUID PRIMARY KEY REFERENCES observations(id) ON DELETE CASCADE,
      financial_account_id UUID REFERENCES financial_accounts(id),
      balance_cents        BIGINT NOT NULL,
      currency             CHAR(3) NOT NULL,
      snapshot_type        TEXT NOT NULL CHECK (snapshot_type IN ('balance','net_worth'))
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS observation_financial_snapshot;
    DROP TABLE IF EXISTS observation_journal_entry;
    DROP TABLE IF EXISTS nutrition_log_item;
    DROP TABLE IF EXISTS observation_nutrition_log;
    DROP TABLE IF EXISTS observation_lab_result;
    DROP TABLE IF EXISTS observation_injury_flag;
    DROP TABLE IF EXISTS observation_symptom;
    DROP TABLE IF EXISTS observation_sleep;
    DROP TABLE IF EXISTS observation_vital;
    DROP TABLE IF EXISTS financial_accounts;
    DROP TABLE IF EXISTS health_profile;
    DROP TABLE IF EXISTS observations;
  `);
};
