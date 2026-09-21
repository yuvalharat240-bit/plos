/* docs/04-database-schema.md §7.1 — users first: core_objects and every
 * table in §3-9 references it. */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE users (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      apple_sub    TEXT UNIQUE NOT NULL,
      email        TEXT,
      display_name TEXT,
      status       TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','pending_deletion','deleted')),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at   TIMESTAMPTZ
    );

    CREATE TYPE user_role AS ENUM ('USER','PROFESSIONAL','ADMIN','SUPPORT','SYSTEM');

    CREATE TABLE user_roles (
      user_id    UUID NOT NULL REFERENCES users(id),
      role       user_role NOT NULL,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, role)
    );

    CREATE TABLE webauthn_credentials (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL REFERENCES users(id),
      credential_id BYTEA NOT NULL UNIQUE,
      public_key    BYTEA NOT NULL,
      sign_count    BIGINT NOT NULL DEFAULT 0,
      device_name   TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at  TIMESTAMPTZ
    );

    CREATE TABLE sessions (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id            UUID NOT NULL REFERENCES users(id),
      refresh_token_hash TEXT NOT NULL UNIQUE,
      device_info        JSONB,
      ip_hash            TEXT,
      issued_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at         TIMESTAMPTZ,
      revoked_reason     TEXT
    );
    CREATE INDEX idx_sessions_user ON sessions (user_id) WHERE revoked_at IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS webauthn_credentials;
    DROP TABLE IF EXISTS user_roles;
    DROP TYPE IF EXISTS user_role;
    DROP TABLE IF EXISTS users;
  `);
};
