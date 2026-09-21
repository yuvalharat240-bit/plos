/* docs/04-database-schema.md §3.2. event_fitness_session and
 * fitness_session_set are given as full DDL in the doc (transcribed
 * exactly); the other 6 extension tables are given as a column summary
 * table only (not full DDL) — constructed here following the identical
 * 1:1-extension pattern and the doc's own column list. */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE events (
      id                  UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
      user_id             UUID NOT NULL REFERENCES users(id),
      domain              TEXT NOT NULL,
      event_type          TEXT NOT NULL,
      title               TEXT,
      location_entity_id  UUID REFERENCES entities(id),
      starts_at           TIMESTAMPTZ NOT NULL,
      ends_at             TIMESTAMPTZ,
      status              TEXT NOT NULL DEFAULT 'completed'
                            CHECK (status IN ('planned','completed','cancelled')),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_events_user_time   ON events (user_id, starts_at DESC);
    CREATE INDEX idx_events_user_domain ON events (user_id, domain, event_type);

    CREATE TRIGGER trg_events_consistency BEFORE INSERT OR UPDATE ON events
      FOR EACH ROW EXECUTE FUNCTION enforce_core_object_consistency('event');

    CREATE TABLE event_participants (
      event_id  UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      entity_id UUID NOT NULL REFERENCES entities(id),
      role      TEXT,
      PRIMARY KEY (event_id, entity_id)
    );

    -- Fitness (MVP domain) — full DDL per docs/04 §3.2
    CREATE TABLE event_fitness_session (
      event_id           UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
      sport_type         TEXT NOT NULL,
      duration_min       INTEGER,
      distance_km        NUMERIC(6,2),
      avg_hr             SMALLINT,
      max_hr             SMALLINT,
      calories           INTEGER,
      perceived_exertion SMALLINT CHECK (perceived_exertion BETWEEN 1 AND 10),
      training_load      NUMERIC(8,2)
    );

    CREATE TABLE fitness_session_set (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id      UUID NOT NULL REFERENCES event_fitness_session(event_id) ON DELETE CASCADE,
      exercise_name TEXT NOT NULL,
      set_number    SMALLINT NOT NULL,
      reps          SMALLINT,
      weight_kg     NUMERIC(6,2),
      rpe           SMALLINT CHECK (rpe BETWEEN 1 AND 10)
    );
    CREATE INDEX idx_fitness_session_set_event ON fitness_session_set (event_id);

    -- Productivity (MVP: calendar is a data source, docs/08 §2.4) — full DDL not
    -- given in the doc beyond the column list; constructed to the same pattern.
    CREATE TABLE event_calendar_item (
      event_id          UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
      calendar_provider TEXT NOT NULL,
      external_event_id TEXT,
      attendee_count    INTEGER,
      is_focus_block    BOOLEAN NOT NULL DEFAULT false
    );

    CREATE TABLE event_task (
      event_id       UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
      due_at         TIMESTAMPTZ,
      completed_at   TIMESTAMPTZ,
      priority       SMALLINT,
      parent_goal_id UUID REFERENCES goals(id)
    );

    -- Post-MVP domains (docs/08 §8) — schema exists, zero MVP write path.
    CREATE TABLE event_travel_trip (
      event_id             UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
      destination_entity_id UUID REFERENCES entities(id),
      trip_purpose         TEXT,
      transport_mode       TEXT
    );

    CREATE TABLE event_learning_session (
      event_id           UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
      subject            TEXT NOT NULL,
      activity_type      TEXT NOT NULL CHECK (activity_type IN ('study','exam','course_module')),
      score              NUMERIC,
      knowledge_gap_tags TEXT[] NOT NULL DEFAULT '{}'
    );

    CREATE TABLE event_social_activity (
      event_id      UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
      activity_type TEXT NOT NULL
    );

    CREATE TABLE event_career_milestone (
      event_id              UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
      milestone_type        TEXT NOT NULL CHECK (milestone_type IN ('promotion','project','certification')),
      organization_entity_id UUID REFERENCES entities(id)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS event_career_milestone;
    DROP TABLE IF EXISTS event_social_activity;
    DROP TABLE IF EXISTS event_learning_session;
    DROP TABLE IF EXISTS event_travel_trip;
    DROP TABLE IF EXISTS event_task;
    DROP TABLE IF EXISTS event_calendar_item;
    DROP TABLE IF EXISTS fitness_session_set;
    DROP TABLE IF EXISTS event_fitness_session;
    DROP TABLE IF EXISTS event_participants;
    DROP TABLE IF EXISTS events;
  `);
};
