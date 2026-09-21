/* docs/04-database-schema.md §4.1 — the relational-memory requirement:
 * memory_reasons carries the qualities/reasons a preference needs to be
 * useful for a future recommendation, not just a subject and a polarity. */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE memory_class AS ENUM ('episodic', 'semantic', 'behavioral', 'goal_related', 'preference');
    CREATE TYPE memory_status AS ENUM ('active', 'superseded', 'retracted', 'user_edited');
    CREATE TYPE polarity AS ENUM ('positive', 'negative', 'neutral', 'mixed');

    CREATE TABLE memories (
      id                     UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
      user_id                UUID NOT NULL REFERENCES users(id),
      memory_class           memory_class NOT NULL,
      subject_core_object_id UUID REFERENCES core_objects(id),
      polarity               polarity,
      statement              TEXT NOT NULL,
      status                 memory_status NOT NULL DEFAULT 'active',
      superseded_by_id       UUID REFERENCES memories(id),
      editable_by_user       BOOLEAN NOT NULL DEFAULT true,
      visible_to_user        BOOLEAN NOT NULL DEFAULT true,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_memories_user_class ON memories (user_id, memory_class, status);
    CREATE INDEX idx_memories_subject    ON memories (subject_core_object_id);

    CREATE TRIGGER trg_memories_consistency BEFORE INSERT OR UPDATE ON memories
      FOR EACH ROW EXECUTE FUNCTION enforce_core_object_consistency('memory');

    CREATE TABLE memory_reasons (
      id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      memory_id                 UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      reason_type               TEXT NOT NULL CHECK (reason_type IN ('quality','constraint','context','counter_example')),
      reason_text               TEXT NOT NULL,
      polarity                  polarity NOT NULL,
      weight                    NUMERIC(3,2),
      supporting_core_object_id UUID REFERENCES core_objects(id)
    );
    CREATE INDEX idx_memory_reasons_memory ON memory_reasons (memory_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS memory_reasons;
    DROP TABLE IF EXISTS memories;
    DROP TYPE IF EXISTS polarity;
    DROP TYPE IF EXISTS memory_status;
    DROP TYPE IF EXISTS memory_class;
  `);
};
