/* docs/04-database-schema.md §9. Moved ahead of §3.3's observations
 * migration (out of the doc's own section order) because
 * observation_lab_result.document_id references documents(id) — see
 * §0's own note that section order is conceptual, not migration order. */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE documents (
      id              UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
      user_id         UUID NOT NULL REFERENCES users(id),
      document_type   TEXT NOT NULL CHECK (document_type IN
                        ('lab_result','professional_report','imported_record','export_bundle','consent_form','other')),
      s3_bucket       TEXT NOT NULL,
      s3_key          TEXT NOT NULL,
      s3_version_id   TEXT NOT NULL,
      mime_type       TEXT NOT NULL,
      filename        TEXT NOT NULL,
      size_bytes      BIGINT,
      checksum_sha256 TEXT,
      uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TRIGGER trg_documents_consistency BEFORE INSERT OR UPDATE ON documents
      FOR EACH ROW EXECUTE FUNCTION enforce_core_object_consistency('document');

    CREATE TABLE document_links (
      document_id    UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      core_object_id UUID NOT NULL REFERENCES core_objects(id) ON DELETE CASCADE,
      PRIMARY KEY (document_id, core_object_id)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS document_links;
    DROP TABLE IF EXISTS documents;
  `);
};
