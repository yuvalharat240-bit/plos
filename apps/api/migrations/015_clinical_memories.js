/* docs/04-database-schema.md §4.2 — separately permissioned, own table
 * (not a flag on memories) so no general-memory query can accidentally
 * include clinical content. RLS for this table is the extended policy in
 * 020_rls_policies.js (§10.3), not the standard single-owner policy. */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE clinical_memories (
      id                          UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
      user_id                     UUID NOT NULL REFERENCES users(id),
      memory_class                memory_class NOT NULL,
      subject_core_object_id      UUID REFERENCES core_objects(id),
      statement                   TEXT NOT NULL,
      authored_by_professional_id UUID REFERENCES professionals(id),
      status                      memory_status NOT NULL DEFAULT 'active',
      visibility                  TEXT NOT NULL DEFAULT 'user_only'
                                    CHECK (visibility IN ('user_only','user_and_named_professional')),
      shared_via_grant_id         UUID REFERENCES permission_grants(id),
      created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TRIGGER trg_clinical_memories_consistency BEFORE INSERT OR UPDATE ON clinical_memories
      FOR EACH ROW EXECUTE FUNCTION enforce_core_object_consistency('clinical_memory');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS clinical_memories;`);
};
