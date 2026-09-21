/* docs/04-database-schema.md §3.1 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE entity_type AS ENUM (
      'person', 'organization', 'place', 'pet',
      'financial_institution', 'brand', 'project', 'skill', 'medication', 'other'
    );

    CREATE TABLE entities (
      id           UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
      user_id      UUID NOT NULL REFERENCES users(id),
      entity_type  entity_type NOT NULL,
      display_name TEXT NOT NULL,
      attributes   JSONB NOT NULL DEFAULT '{}',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_entities_user_type ON entities (user_id, entity_type);
    CREATE INDEX idx_entities_attributes_gin ON entities USING GIN (attributes);

    CREATE TRIGGER trg_entities_consistency BEFORE INSERT OR UPDATE ON entities
      FOR EACH ROW EXECUTE FUNCTION enforce_core_object_consistency('entity');

    -- docs/04 §3.1: entity_person_detail, 1:1 with entities where entity_type='person'
    CREATE TABLE entity_person_detail (
      entity_id            UUID PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
      relationship_to_user TEXT,
      is_emergency_contact BOOLEAN NOT NULL DEFAULT false,
      birthday             DATE,
      contact_channel_ref  TEXT
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS entity_person_detail;
    DROP TABLE IF EXISTS entities;
    DROP TYPE IF EXISTS entity_type;
  `);
};
