/* docs/04-database-schema.md §7.2, §7.3, §7.4 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE professionals (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        UUID REFERENCES users(id),
      full_name      TEXT NOT NULL,
      license_number TEXT,
      license_type   TEXT,
      specialty      TEXT,
      verified_at    TIMESTAMPTZ
    );

    CREATE TABLE subscriptions (
      user_id            UUID PRIMARY KEY REFERENCES users(id),
      revenuecat_id      TEXT,
      product_id         TEXT,
      status             TEXT NOT NULL CHECK (status IN ('active','grace_period','expired','none')),
      current_period_end TIMESTAMPTZ,
      last_synced_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE integrations (
      id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id                UUID NOT NULL REFERENCES users(id),
      provider               TEXT NOT NULL,
      status                 TEXT NOT NULL CHECK (status IN ('connected','disconnected','error','revoked')),
      external_account_id    TEXT,
      scopes_granted         TEXT[] NOT NULL DEFAULT '{}',
      credentials_secret_ref TEXT,
      connected_at           TIMESTAMPTZ,
      last_sync_at           TIMESTAMPTZ,
      last_sync_status       TEXT
    );
    CREATE UNIQUE INDEX uq_integrations_user_provider ON integrations (user_id, provider);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS integrations;
    DROP TABLE IF EXISTS subscriptions;
    DROP TABLE IF EXISTS professionals;
  `);
};
