/* docs/04-database-schema.md §8 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE permission_scopes (
      scope       TEXT PRIMARY KEY,
      resource    TEXT NOT NULL,
      action      TEXT NOT NULL,
      risk_tier   SMALLINT NOT NULL CHECK (risk_tier BETWEEN 0 AND 4),
      description TEXT NOT NULL
    );

    CREATE TABLE permission_grants (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL REFERENCES users(id),
      grantee_type  TEXT NOT NULL CHECK (grantee_type IN ('self_app','professional','integration','support')),
      grantee_id    UUID,
      scope         TEXT NOT NULL REFERENCES permission_scopes(scope),
      purpose       TEXT NOT NULL,
      granted_via   TEXT NOT NULL,
      granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at    TIMESTAMPTZ
    );

    CREATE UNIQUE INDEX uq_active_grant ON permission_grants (
      user_id, grantee_type, COALESCE(grantee_id, '00000000-0000-0000-0000-000000000000'), scope
    ) WHERE revoked_at IS NULL;

    CREATE INDEX idx_grants_user ON permission_grants (user_id) WHERE revoked_at IS NULL;

    CREATE TABLE consent_records (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID NOT NULL REFERENCES users(id),
      consent_type TEXT NOT NULL,
      version      TEXT NOT NULL,
      granted_at   TIMESTAMPTZ,
      revoked_at   TIMESTAMPTZ
    );

    -- docs/07-privacy-model.md §3.2 catalog, MVP-relevant scopes only
    -- (07 §3.3 reconciles vision §15's examples with this catalog).
    INSERT INTO permission_scopes (scope, resource, action, risk_tier, description) VALUES
      ('health.read',            'health',        'read',       0, 'Read derived and raw health data'),
      ('health.read_raw',        'health',        'read_raw',   0, 'Read raw health observations'),
      ('health.write',           'health',        'write',      1, 'Write user-entered health data'),
      ('fitness.read',           'fitness',       'read',       0, 'Read derived and raw fitness data'),
      ('fitness.read_raw',       'fitness',       'read_raw',   0, 'Read raw fitness observations'),
      ('fitness.write',          'fitness',       'write',      2, 'Write/modify fitness plans or sessions'),
      ('mental_health.read',     'mental_health', 'read',       0, 'Read derived mental/emotional context'),
      ('mental_health.read_raw', 'mental_health', 'read_raw',   0, 'Read raw journal text'),
      ('productivity.read',      'productivity',  'read',       0, 'Read calendar density signal'),
      ('professional.share',     'professional',  'share',      3, 'Share data with a named professional'),
      ('account.export',         'account',       'export',     0, 'Export account data'),
      ('account.delete',         'account',       'delete',     2, 'Delete account'),
      ('consent.manage',         'consent',       'manage',     0, 'Manage consent records');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS consent_records;
    DROP TABLE IF EXISTS permission_grants;
    DROP TABLE IF EXISTS permission_scopes;
  `);
};
