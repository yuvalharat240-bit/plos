/* docs/04-database-schema.md §3.5 — the Outcome Learning Loop. Tier 4
 * (money movement, medication changes) is enforced by "no tool ever
 * writes it" (docs/03 §2.7), not a schema constraint — risk_tier=4 is
 * allowed here only for completeness/audit, per the doc's own note. */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE actions (
      id                      UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
      user_id                 UUID NOT NULL REFERENCES users(id),
      domain                  TEXT NOT NULL,
      action_type             TEXT NOT NULL,
      executed_by             TEXT NOT NULL CHECK (executed_by IN ('user','agent_on_behalf_of_user','system')),
      risk_tier               SMALLINT NOT NULL CHECK (risk_tier BETWEEN 0 AND 4),
      status                  TEXT NOT NULL DEFAULT 'completed'
                                CHECK (status IN ('planned','completed','failed','reversed')),
      confirmation_token_hash TEXT,
      executed_at             TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_actions_user_time ON actions (user_id, executed_at DESC);

    CREATE TRIGGER trg_actions_consistency BEFORE INSERT OR UPDATE ON actions
      FOR EACH ROW EXECUTE FUNCTION enforce_core_object_consistency('action');

    -- Finance, post-MVP (docs/08 §8)
    CREATE TABLE action_financial_transaction (
      action_id           UUID PRIMARY KEY REFERENCES actions(id) ON DELETE CASCADE,
      amount_cents         BIGINT NOT NULL,
      currency             CHAR(3) NOT NULL,
      category             TEXT,
      merchant_entity_id   UUID REFERENCES entities(id),
      financial_account_id UUID REFERENCES financial_accounts(id),
      transaction_type     TEXT NOT NULL CHECK (transaction_type IN ('income','expense','transfer','investment'))
    );

    -- Health-adjacent, Milestone 2 (Phase 1 plan) — log-only, executed_by
    -- must be 'user' in practice; no Scoped Tool is ever registered to
    -- write this table on an agent's behalf (docs/04 §14's flagged
    -- cross-check — confirmed, not just noted, by the absence of any such
    -- tool in docs/05-agent-architecture.md's MVP tool list).
    CREATE TABLE action_medication_log (
      action_id                  UUID PRIMARY KEY REFERENCES actions(id) ON DELETE CASCADE,
      medication_name            TEXT NOT NULL,
      dose                       TEXT,
      unit                       TEXT,
      taken_at                   TIMESTAMPTZ NOT NULL,
      prescribing_professional_id UUID REFERENCES professionals(id),
      adherence_status           TEXT
    );

    CREATE TABLE decisions (
      id                     UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
      user_id                UUID NOT NULL REFERENCES users(id),
      prompted_by_output_id  UUID REFERENCES agent_outputs(id),
      chosen_action_id       UUID REFERENCES actions(id),
      alternatives_considered TEXT[],
      user_confirmed         BOOLEAN NOT NULL DEFAULT true,
      decided_at             TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TRIGGER trg_decisions_consistency BEFORE INSERT OR UPDATE ON decisions
      FOR EACH ROW EXECUTE FUNCTION enforce_core_object_consistency('decision');

    CREATE TABLE outcomes (
      id            UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
      user_id       UUID NOT NULL REFERENCES users(id),
      outcome_of_id UUID NOT NULL REFERENCES core_objects(id),
      outcome_type  TEXT NOT NULL,
      success_signal NUMERIC,
      measured_at   TIMESTAMPTZ NOT NULL,
      notes         TEXT
    );
    CREATE INDEX idx_outcomes_of ON outcomes (outcome_of_id);

    CREATE TRIGGER trg_outcomes_consistency BEFORE INSERT OR UPDATE ON outcomes
      FOR EACH ROW EXECUTE FUNCTION enforce_core_object_consistency('outcome');

    -- docs/04 §2's polymorphic-reference trigger variant, applied here:
    -- outcome_of_id may only point at an action or a decision.
    CREATE TRIGGER trg_outcomes_of_type BEFORE INSERT OR UPDATE ON outcomes
      FOR EACH ROW EXECUTE FUNCTION enforce_referenced_object_type('outcome_of_id', 'action,decision');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS outcomes;
    DROP TABLE IF EXISTS decisions;
    DROP TABLE IF EXISTS action_medication_log;
    DROP TABLE IF EXISTS action_financial_transaction;
    DROP TABLE IF EXISTS actions;
  `);
};
