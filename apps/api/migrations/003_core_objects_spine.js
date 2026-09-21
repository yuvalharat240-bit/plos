/* docs/04-database-schema.md §2 — the spine. Every fact-bearing primitive
 * table's PK is also an FK into this table (class-table-inheritance). The
 * two CHECK constraints are what make FACT/DERIVED FACT/AI INFERENCE/
 * RECOMMENDATION real schema, not convention. */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE core_object_type AS ENUM (
      'entity', 'event', 'observation', 'goal', 'relationship',
      'decision', 'action', 'outcome', 'memory', 'clinical_memory',
      'document', 'agent_output'
    );

    CREATE TYPE epistemic_status AS ENUM (
      'fact', 'derived_fact', 'ai_inference', 'recommendation'
    );

    CREATE TABLE core_objects (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      object_type         core_object_type NOT NULL,
      epistemic_status    epistemic_status NOT NULL DEFAULT 'fact',

      source              TEXT NOT NULL,
      source_id           TEXT,
      original_timestamp  TIMESTAMPTZ,
      import_timestamp    TIMESTAMPTZ NOT NULL DEFAULT now(),
      provider            TEXT,
      transformation      TEXT,
      is_user_entered     BOOLEAN NOT NULL DEFAULT false,
      is_imported         BOOLEAN NOT NULL DEFAULT false,
      is_ai_derived       BOOLEAN NOT NULL DEFAULT false,
      confidence          NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
      agent_version       TEXT,

      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT chk_fact_not_ai_derived CHECK (
        epistemic_status <> 'fact' OR is_ai_derived = false
      ),
      CONSTRAINT chk_ai_status_requires_metadata CHECK (
        epistemic_status = 'fact'
        OR (is_ai_derived AND confidence IS NOT NULL AND agent_version IS NOT NULL)
      )
    );

    CREATE INDEX idx_core_objects_user_type_time
      ON core_objects (user_id, object_type, created_at DESC);

    CREATE UNIQUE INDEX uq_core_objects_provider_source
      ON core_objects (provider, source, source_id)
      WHERE provider IS NOT NULL AND source_id IS NOT NULL;

    CREATE OR REPLACE FUNCTION enforce_core_object_consistency()
    RETURNS TRIGGER AS $$
    DECLARE
      expected core_object_type := TG_ARGV[0]::core_object_type;
      co core_objects%ROWTYPE;
    BEGIN
      SELECT * INTO co FROM core_objects WHERE id = NEW.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'core_objects.% missing; insert the spine row before %', NEW.id, TG_TABLE_NAME;
      ELSIF co.object_type <> expected THEN
        RAISE EXCEPTION '% has object_type=%, expected % for %', NEW.id, co.object_type, expected, TG_TABLE_NAME;
      ELSIF co.user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'user_id mismatch: core_objects=%, %=%', co.user_id, TG_TABLE_NAME, NEW.user_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    -- docs/04 §2: a variant for polymorphic references (relationships.subject_id/
    -- object_id, outcomes.outcome_of_id) that only accept certain object_types.
    -- The FK to core_objects(id) already guarantees the row exists; this only
    -- narrows which object_type is acceptable at that reference site.
    CREATE OR REPLACE FUNCTION enforce_referenced_object_type()
    RETURNS TRIGGER AS $$
    DECLARE
      col_name TEXT := TG_ARGV[0];
      allowed TEXT[] := string_to_array(TG_ARGV[1], ',');
      ref_id UUID;
      ref_type core_object_type;
    BEGIN
      EXECUTE format('SELECT ($1).%I', col_name) INTO ref_id USING NEW;
      SELECT object_type INTO ref_type FROM core_objects WHERE id = ref_id;
      IF ref_type IS NULL OR NOT (ref_type::TEXT = ANY(allowed)) THEN
        RAISE EXCEPTION '% references core_objects.% with object_type=%, expected one of %',
          TG_TABLE_NAME, col_name, ref_type, allowed;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS enforce_referenced_object_type();
    DROP FUNCTION IF EXISTS enforce_core_object_consistency();
    DROP TABLE IF EXISTS core_objects;
    DROP TYPE IF EXISTS epistemic_status;
    DROP TYPE IF EXISTS core_object_type;
  `);
};
