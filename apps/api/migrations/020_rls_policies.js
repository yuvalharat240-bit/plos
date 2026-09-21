/* docs/04-database-schema.md §10 — tenant isolation.
 *
 * FINDING, resolved here rather than silently: §10.2 states the standard
 * policy is "applied identically... to every domain extension table
 * (joined transitively through their 1:1 parent's user_id, which every
 * extension table also carries)". But the actual DDL given for these
 * tables — including event_fitness_session, given as "full DDL" in §3.2,
 * not just a column summary — has NO user_id column, only the FK to its
 * 1:1 parent (event_id/observation_id/action_id/goal_id/memory_id/
 * entity_id). The concrete, explicit DDL is trusted over the summary
 * prose where they conflict (same resolution approach as 022's
 * embeddings policy, which has the identical shape of problem). Adding
 * an undocumented denormalized user_id column to ~25 tables was
 * rejected: it contradicts the one piece of literal "full DDL" evidence
 * available, and a join-based policy achieves the same isolation
 * guarantee without inventing schema the doc never specified. This is a
 * real doc/implementation gap worth folding back into docs/04, not a
 * Milestone 1 shortcut.
 *
 * Two loops below: tables with a real user_id column get the doc's
 * literal standard policy; tables without one get a join-based
 * equivalent to their immediate 1:1 parent. clinical_memories gets its
 * own explicit dual policy per §10.3 (extended, not standard).
 * embeddings (022, deliberately run last — see that file's header) and
 * audit_log (018) already have their own policies.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      t TEXT;
    BEGIN
      FOREACH t IN ARRAY ARRAY[
        'core_objects', 'entities', 'events', 'observations', 'goals',
        'actions', 'decisions', 'outcomes', 'relationships', 'memories',
        'agent_outputs', 'agent_conversations', 'documents', 'baselines',
        'timeline_entries', 'health_profile', 'financial_accounts',
        'sessions', 'webauthn_credentials', 'subscriptions', 'integrations',
        'permission_grants', 'consent_records'
      ]
      LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
          'CREATE POLICY %I ON %I USING (user_id = current_setting(''app.current_user_id'', true)::uuid) WITH CHECK (user_id = current_setting(''app.current_user_id'', true)::uuid)',
          t || '_tenant_isolation', t
        );
      END LOOP;
    END
    $$;

    DO $$
    DECLARE
      rec RECORD;
    BEGIN
      FOR rec IN SELECT * FROM (VALUES
        ('event_participants',             'event_id',       'events'),
        ('event_fitness_session',          'event_id',       'events'),
        ('fitness_session_set',            'event_id',       'events'),
        ('event_calendar_item',            'event_id',       'events'),
        ('event_task',                     'event_id',       'events'),
        ('event_travel_trip',              'event_id',       'events'),
        ('event_learning_session',         'event_id',       'events'),
        ('event_social_activity',          'event_id',       'events'),
        ('event_career_milestone',         'event_id',       'events'),
        ('entity_person_detail',           'entity_id',      'entities'),
        ('observation_vital',              'observation_id', 'observations'),
        ('observation_sleep',              'observation_id', 'observations'),
        ('observation_symptom',            'observation_id', 'observations'),
        ('observation_injury_flag',        'observation_id', 'observations'),
        ('observation_lab_result',         'observation_id', 'observations'),
        ('observation_nutrition_log',      'observation_id', 'observations'),
        ('nutrition_log_item',             'observation_id', 'observations'),
        ('observation_journal_entry',      'observation_id', 'observations'),
        ('observation_financial_snapshot', 'observation_id', 'observations'),
        ('goal_habit_detail',              'goal_id',        'goals'),
        ('action_financial_transaction',   'action_id',      'actions'),
        ('action_medication_log',          'action_id',      'actions'),
        ('memory_reasons',                 'memory_id',      'memories'),
        ('agent_turns',                    'conversation_id','agent_conversations'),
        ('document_links',                 'document_id',    'documents')
      ) AS x(child_table, fk_column, parent_table)
      LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', rec.child_table);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', rec.child_table);
        EXECUTE format(
          'CREATE POLICY %I ON %I USING (EXISTS (SELECT 1 FROM %I p WHERE p.id = %I.%I AND p.user_id = current_setting(''app.current_user_id'', true)::uuid)) WITH CHECK (EXISTS (SELECT 1 FROM %I p WHERE p.id = %I.%I AND p.user_id = current_setting(''app.current_user_id'', true)::uuid))',
          rec.child_table || '_tenant_isolation', rec.child_table,
          rec.parent_table, rec.child_table, rec.fk_column,
          rec.parent_table, rec.child_table, rec.fk_column
        );
      END LOOP;
    END
    $$;

    -- docs/04 §10.3 — clinical_memories' extended policy: owner OR a
    -- named professional with an active, non-revoked grant. Two policies
    -- on the same table combine with OR by default.
    ALTER TABLE clinical_memories ENABLE ROW LEVEL SECURITY;
    ALTER TABLE clinical_memories FORCE ROW LEVEL SECURITY;

    CREATE POLICY clinical_memories_owner ON clinical_memories
      USING (user_id = current_setting('app.current_user_id', true)::uuid)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

    CREATE POLICY clinical_memories_shared_professional ON clinical_memories
      FOR SELECT
      USING (
        visibility = 'user_and_named_professional'
        AND EXISTS (
          SELECT 1 FROM permission_grants pg
          JOIN professionals p ON p.id = pg.grantee_id
          WHERE pg.id = clinical_memories.shared_via_grant_id
            AND pg.grantee_type = 'professional'
            AND pg.revoked_at IS NULL
            AND p.user_id = current_setting('app.current_professional_id', true)::uuid
        )
      );
  `);
};

exports.down = (pgm) => {
  // Policies drop automatically when their tables are dropped by earlier
  // migrations' down(). Nothing to do here in a full rollback; listed
  // explicitly only if this migration is rolled back in isolation.
  pgm.sql(`
    DROP POLICY IF EXISTS clinical_memories_shared_professional ON clinical_memories;
    DROP POLICY IF EXISTS clinical_memories_owner ON clinical_memories;
  `);
};
