/* docs/04-database-schema.md §4.3, §5. agent_turns before agent_outputs
 * (conversation_turn_id FK); agent_outputs before decisions (012) which
 * references it — see §0's DDL-ordering note. */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE agent_conversations (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id),
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ended_at   TIMESTAMPTZ
    );

    CREATE TABLE agent_turns (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
      content         TEXT,
      tool_calls      JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_agent_turns_conversation ON agent_turns (conversation_id, created_at);

    CREATE TABLE agent_outputs (
      id                         UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
      user_id                    UUID NOT NULL REFERENCES users(id),
      conversation_turn_id       UUID REFERENCES agent_turns(id),
      agent_name                 TEXT NOT NULL,
      model_version              TEXT NOT NULL,
      prompt_version             TEXT NOT NULL,
      finding                    TEXT NOT NULL,
      evidence                   JSONB NOT NULL DEFAULT '[]',
      uncertainty                TEXT[] NOT NULL DEFAULT '{}',
      recommendation             TEXT,
      requires_human_review      BOOLEAN NOT NULL DEFAULT false,
      requires_user_confirmation BOOLEAN NOT NULL DEFAULT false,
      risk_tier                  SMALLINT CHECK (risk_tier BETWEEN 0 AND 4),
      data_timestamp             TIMESTAMPTZ,
      tools_used                 TEXT[] NOT NULL DEFAULT '{}',
      disagrees_with_output_id   UUID REFERENCES agent_outputs(id)
    );

    CREATE TRIGGER trg_agent_outputs_consistency BEFORE INSERT OR UPDATE ON agent_outputs
      FOR EACH ROW EXECUTE FUNCTION enforce_core_object_consistency('agent_output');

    CREATE TABLE agent_output_sources (
      output_id        UUID NOT NULL REFERENCES agent_outputs(id) ON DELETE CASCADE,
      source_output_id UUID NOT NULL REFERENCES agent_outputs(id),
      PRIMARY KEY (output_id, source_output_id)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS agent_output_sources;
    DROP TABLE IF EXISTS agent_outputs;
    DROP TABLE IF EXISTS agent_turns;
    DROP TABLE IF EXISTS agent_conversations;
  `);
};
