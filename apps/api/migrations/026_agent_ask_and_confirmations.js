/* docs/09 Milestone 5. Two additions the agent orchestration surface
 * needs that no earlier migration provided:
 *
 * 1. `agent.ask` scope — docs/03-system-architecture.md §2.3's worked
 *    example names it explicitly ("ScopeGuard confirms the agent.ask
 *    scope") but 007_permissions_and_consent.js's catalog never seeded
 *    it, the same category of gap 024/025 already found and fixed for
 *    mental_health.write/productivity.write. risk_tier 0: producing an
 *    answer is Tier 0 (informational, docs/05-agent-architecture.md §9.4)
 *    regardless of what a follow-up action might cost.
 *
 * 2. `agent_confirmations` — docs/06-threat-model.md T7's must-fix
 *    ("confirmation-token binding: scoped, single-use, time-boxed HMAC")
 *    needs somewhere durable to enforce single-use, since a signature
 *    alone only proves a token wasn't forged, not that it hasn't already
 *    been redeemed. Not in docs/04-database-schema.md — a narrow, real
 *    schema addition this milestone's own must-fix requires, following
 *    the same "add it explicitly, following the existing catalog/table
 *    shape" resolution 024 used for the missing write scope. RLS'd and
 *    granted the same way every other tenant-scoped table added after
 *    021_role_grants.js's blanket grant must be (that grant only covers
 *    tables that existed when it ran).
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO permission_scopes (scope, resource, action, risk_tier, description) VALUES
      ('agent.ask', 'agent', 'ask', 0, 'Ask the Life Master Agent a question');

    CREATE TABLE agent_confirmations (
      nonce      UUID PRIMARY KEY,
      user_id    UUID NOT NULL REFERENCES users(id),
      tool_name  TEXT NOT NULL,
      args_hash  TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_agent_confirmations_user ON agent_confirmations (user_id);

    GRANT SELECT, INSERT, UPDATE, DELETE ON agent_confirmations TO plos_app, plos_worker;

    ALTER TABLE agent_confirmations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE agent_confirmations FORCE ROW LEVEL SECURITY;
    CREATE POLICY agent_confirmations_tenant_isolation ON agent_confirmations
      USING (user_id = current_setting('app.current_user_id', true)::uuid)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS agent_confirmations;
    DELETE FROM permission_scopes WHERE scope = 'agent.ask';
  `);
};
