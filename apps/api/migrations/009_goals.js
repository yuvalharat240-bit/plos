/* docs/04-database-schema.md §3.4. Moved ahead of events (010) — out of
 * the doc's own section order — because event_task.parent_goal_id
 * references goals(id). */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE goal_type AS ENUM ('outcome', 'habit', 'milestone');

    CREATE TABLE goals (
      id             UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
      user_id        UUID NOT NULL REFERENCES users(id),
      domain         TEXT NOT NULL,
      goal_type      goal_type NOT NULL DEFAULT 'outcome',
      parent_goal_id UUID REFERENCES goals(id),
      title          TEXT NOT NULL,
      description    TEXT,
      target_metric  TEXT,
      target_value   NUMERIC,
      target_date    DATE,
      priority       SMALLINT,
      status         TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','paused','completed','abandoned')),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_goals_user_status ON goals (user_id, status);
    CREATE INDEX idx_goals_parent ON goals (parent_goal_id);

    CREATE TRIGGER trg_goals_consistency BEFORE INSERT OR UPDATE ON goals
      FOR EACH ROW EXECUTE FUNCTION enforce_core_object_consistency('goal');

    CREATE TABLE goal_habit_detail (
      goal_id                 UUID PRIMARY KEY REFERENCES goals(id) ON DELETE CASCADE,
      cadence                 TEXT NOT NULL,
      target_count_per_period SMALLINT NOT NULL,
      current_streak          INTEGER NOT NULL DEFAULT 0,
      longest_streak          INTEGER NOT NULL DEFAULT 0
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS goal_habit_detail;
    DROP TABLE IF EXISTS goals;
    DROP TYPE IF EXISTS goal_type;
  `);
};
