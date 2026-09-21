/* docs/04-database-schema.md §3.6. A causal_association row must never
 * claim causation (product vision §42) — enforced at the rendering
 * layer via the predicate naming convention, not a schema constraint
 * (the doc is explicit this is out of schema's reach). */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE relationship_class AS ENUM (
      'social', 'causal_association', 'temporal_sequence', 'hierarchy', 'derivation'
    );

    CREATE TABLE relationships (
      id                 UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
      user_id            UUID NOT NULL REFERENCES users(id),
      relationship_class relationship_class NOT NULL,
      subject_id         UUID NOT NULL REFERENCES core_objects(id),
      predicate          TEXT NOT NULL,
      object_id          UUID NOT NULL REFERENCES core_objects(id),
      strength           NUMERIC(4,3),
      valid_from         TIMESTAMPTZ,
      valid_to           TIMESTAMPTZ,
      notes              TEXT
    );
    CREATE INDEX idx_relationships_subject ON relationships (subject_id);
    CREATE INDEX idx_relationships_object  ON relationships (object_id);

    CREATE TRIGGER trg_relationships_consistency BEFORE INSERT OR UPDATE ON relationships
      FOR EACH ROW EXECUTE FUNCTION enforce_core_object_consistency('relationship');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS relationships;
    DROP TYPE IF EXISTS relationship_class;
  `);
};
