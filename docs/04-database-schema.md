# plos — Database Schema (Phase 0-C)

> This is Phase 0-C of the sequence fixed in
> [00-product-vision-master-prompt.md](00-product-vision-master-prompt.md) §60
> (A. ADR — B. System architecture — C. **Database schema** — D. Agent
> architecture — E. Threat model — F. Privacy model — G. MVP). It takes the
> stack fixed in [02-architecture-decision-record.md](02-architecture-decision-record.md)
> (PostgreSQL on RDS, sole source of truth, `pgvector` in the same instance —
> D5) and the request pipeline fixed in
> [03-system-architecture.md](03-system-architecture.md) as given, and answers
> the question both left open: what the tables actually are. It also resolves
> the numbering [03-system-architecture.md](03-system-architecture.md) §8
> flagged — this document is `04-`, not the `02-database-schema.md` that
> [00-strategy-moat-and-hazards.md](00-strategy-moat-and-hazards.md) links to;
> that stale link is noted in §14, not silently fixed, per `CLAUDE.md`.
>
> Out of scope here: migration tooling/ORM choice, exact column widths for
> every free-text field, and the Scoped Tool function signatures themselves
> (Phase 0-D) — this document defines the tables those tools read and write,
> and cross-checks its own design against the tool names
> [03-system-architecture.md](03-system-architecture.md) §2.7 already
> committed to (§6.3 below), but does not define the tool contracts.

## 0. Conventions

- **IDs**: `UUID` everywhere except `audit_log` (see §11) and pure reference/
  enum-like catalog tables. Postgres ≥13 has `gen_random_uuid()` built in
  (no `pgcrypto` needed); `CREATE EXTENSION IF NOT EXISTS vector;` for
  `pgvector` (ADR D5).
- **Time**: `TIMESTAMPTZ` always, stored UTC. Every fact-bearing row
  distinguishes `original_timestamp` (when it happened/was recorded at the
  source) from `import_timestamp` (when plos ingested it) — product vision
  §8; these are frequently different (a HealthKit sync can land a night's
  sleep hours after it ended; a bank statement import can land weeks after
  the transaction).
- **Money**: `BIGINT` minor units (cents) + a separate `currency CHAR(3)`
  (ISO 4217) column. Never `NUMERIC`/`FLOAT` for money.
- **Soft delete**: used only where the product needs an undo window
  (`users.status`, see §7.1). It is explicitly **not** how account deletion
  (product vision §24) works — that is a real workflow (revoke
  integrations, invalidate sessions, delete active + derived data, object
  storage, vector rows, audit the deletion) that this schema supports but
  does not itself implement; Phase 0-F (privacy model) owns that workflow's
  steps and retention exceptions.
- **DDL ordering**: sections below are grouped conceptually (spine → core
  primitives → memory → account infra → permissions), not in migration
  dependency order. `users` (§7.1) is the first table any real migration
  creates — `core_objects` and every table in §3–9 references it — and
  `agent_outputs` (§5) must exist before `decisions` (§3.5), which
  references it. Treat this document as the schema's design, not a
  literal top-to-bottom migration script.
- **Naming**: tables plural snake_case; a domain **extension table** is
  named `<core_table_singular>_<domain_or_kind>` (e.g. `event_fitness_session`,
  `observation_sleep`) and shares its primary key with the row it extends
  (1:1, `ON DELETE CASCADE`) — never a second surrogate key.

## 1. Normalization strategy: reconciling the two source models

Two documents specify overlapping but differently-shaped data models, and
reconciling them **is** the first deliverable of this document
([00-strategy-moat-and-hazards.md](00-strategy-moat-and-hazards.md), "Where
this document plugs into Phase 0"):

- The **strategy doc**'s universal primitives — Person, Event, Entity, Goal,
  Observation, Relationship, Decision, Action, Outcome, Memory — model the
  product as one graph, not ten silos.
- The **product vision**'s object list (§9-10: User, Identity, Permissions,
  Goals, Habits, Journal, Health observations, Fitness sessions, Nutrition
  records, Sleep records, Calendar events, Financial records, Relationships,
  Trips, Documents, Professional access, AI memories, AI-derived insights,
  Agent outputs, Integrations, Consent, Audit logs, Subscription status) and
  its per-domain attribute lists (§4) are concrete and domain-specific.

**Decision**: three layers, not one bespoke table per domain and not a
single denormalized blob (both explicitly rejected by the strategy doc):

1. **The spine** — one identity table, `core_objects` (§2), that every
   fact-bearing primitive shares. It carries `user_id`, `object_type`, and
   the full provenance/epistemic-status columns exactly once. This is a
   textbook **class-table-inheritance / shared-supertype** pattern: every
   concrete table's primary key is also a foreign key to `core_objects.id`.
2. **Core primitive tables** (§3–5) — one table per universal primitive
   (`entities`, `events`, `observations`, `goals`, `actions`, `decisions`,
   `outcomes`, `relationships`, `memories`) holding the columns common to
   *every* instance of that primitive regardless of domain (an `events` row
   has `starts_at` whether it's a workout or a flight).
3. **Domain extension tables** (§3.2–3.5, rosters) — one table per
   *domain-specific attribute cluster* from vision §4, 1:1 with the core row
   it extends. A workout's `event_fitness_session` row carries
   `training_load`; a flight's `event_travel_trip` row carries
   `destination_entity_id`. Neither table knows about the other's domain.

This gives vision §9-10's object list a home without either extreme:

| Vision §9-10 object | Where it lives |
|---|---|
| User, Identity | `users`, `webauthn_credentials` (§7.1) — deliberately **off** the spine |
| Permissions | `permission_scopes`, `permission_grants` (§8) — off the spine |
| Goals, Habits | `goals` + `goal_habit_detail` (§3.4) — spine (`object_type='goal'`) |
| Journal | `observation_journal_entry` extends `observations` (§3.3) |
| Health observations, Sleep records | `observation_vital`, `observation_sleep`, `observation_symptom`, `observation_injury_flag`, `observation_lab_result` (§3.3) |
| Fitness sessions | `event_fitness_session` + `fitness_session_set` (§3.2) |
| Nutrition records | `observation_nutrition_log` + `nutrition_log_item` (§3.3) |
| Calendar events | `event_calendar_item`, `event_task` (§3.2) |
| Financial records | `action_financial_transaction`, `observation_financial_snapshot`, `financial_accounts` (§3.3/3.5) |
| Relationships (people) | `entities` (`entity_type='person'`) + `entity_person_detail`, linked via `relationships` (§3.6/3.8) |
| Trips | `event_travel_trip` (§3.2) |
| Documents | `documents` (§9) — spine (`object_type='document'`) |
| Professional access | `permission_grants` filtered to `grantee_type='professional'` — **not** a separate table (§8.3) |
| AI memories | `memories` + `memory_reasons`, `clinical_memories` (§4) |
| AI-derived insights, Agent outputs | `agent_outputs` (§5) — spine (`object_type='agent_output'`) |
| Integrations | `integrations` (§7.4) — off the spine |
| Consent | `consent_records` (§8.4) — off the spine |
| Audit logs | `audit_log` (§11) — deliberately off the spine (append-only, different lifecycle) |
| Subscription status | `subscriptions` (§7.3) — off the spine |

**Why some things are deliberately off the spine**: `core_objects` is
designed around discrete, individually-provenanced *facts about a person's
life*. Account/security/billing/operational rows (`users`, `sessions`,
`permission_grants`, `audit_log`, `subscriptions`, `integrations`) aren't
that — they don't carry FACT/DERIVED FACT/AI INFERENCE/RECOMMENDATION
epistemic status, most are never AI-derived, and several (`audit_log`) need
an append-only lifecycle the spine's `updated_at`-bearing rows don't have.
Forcing them onto the spine would blur exactly the distinction the spine
exists to make precise. Same reasoning excludes `baselines`/`timelines`
(§6) — those are continuously-recomputed materialized artifacts, not
discrete accumulated facts (§6.1 justifies this in detail).

The **user themselves is the implicit root of the graph, not a node in
it**: every core object already carries `user_id`, so "whose life is this"
never needs an edge. `relationships` (§3.8) connects the *other* primitives
within one user's graph (their friend Entity to their spouse Entity; one
Observation to another) — there is no self-referential "Entity for the
account holder" hack.

## 2. The spine: `core_objects`, provenance, and epistemic status

This is where requirement (2) — every provenance field from product vision
§8 on every fact-bearing table, and FACT/DERIVED FACT/AI INFERENCE/
RECOMMENDATION as real schema — is implemented **once**, not copy-pasted
across a dozen tables.

```sql
CREATE TYPE core_object_type AS ENUM (
  'entity', 'event', 'observation', 'goal', 'relationship',
  'decision', 'action', 'outcome', 'memory', 'clinical_memory',
  'document', 'agent_output'
);

CREATE TYPE epistemic_status AS ENUM (
  'fact', 'derived_fact', 'ai_inference', 'recommendation'
);

CREATE TABLE core_objects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_type         core_object_type NOT NULL,
  epistemic_status    epistemic_status NOT NULL DEFAULT 'fact',

  -- provenance — product vision §8, verbatim field list
  source              TEXT NOT NULL,            -- 'healthkit' | 'manual_entry' | 'strava' | 'life_master_agent' | 'context_engine_worker' | ...
  source_id           TEXT,                     -- provider's own record id (idempotency key for sync)
  original_timestamp  TIMESTAMPTZ,              -- when the fact happened/was recorded at the source
  import_timestamp    TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider             TEXT,                     -- integration/provider name; NULL for user-entered or system-generated
  transformation       TEXT,                     -- normalization/derivation step that produced this row, if any
  is_user_entered      BOOLEAN NOT NULL DEFAULT false,
  is_imported          BOOLEAN NOT NULL DEFAULT false,
  is_ai_derived        BOOLEAN NOT NULL DEFAULT false,
  confidence           NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
  agent_version         TEXT,                     -- product vision §7-8 metadata: which agent/prompt version produced this

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- FACT/DERIVED FACT/AI INFERENCE/RECOMMENDATION is enforced, not just labeled:
  CONSTRAINT chk_fact_not_ai_derived CHECK (
    epistemic_status <> 'fact' OR is_ai_derived = false
  ),
  CONSTRAINT chk_ai_status_requires_metadata CHECK (
    epistemic_status = 'fact'
    OR (is_ai_derived AND confidence IS NOT NULL AND agent_version IS NOT NULL)
  )
);

CREATE INDEX idx_core_objects_user_type_time
  ON core_objects (user_id, object_type, created_at DESC);

-- idempotent upsert on sync: same provider record never lands twice
CREATE UNIQUE INDEX uq_core_objects_provider_source
  ON core_objects (provider, source, source_id)
  WHERE provider IS NOT NULL AND source_id IS NOT NULL;
```

The two `CHECK` constraints are the "real schema, not convention" part:
a row cannot claim `epistemic_status = 'fact'` while also flagging itself
`is_ai_derived`, and nothing above `'fact'` can exist without the
confidence + agent version that make it auditable. `derived_fact` is
**not** the same as `ai_inference` — this distinction matters and is easy
to blur:

| Example | `epistemic_status` | `is_ai_derived` | Why |
|---|---|---|---|
| "Slept 6h12m last night" (HealthKit) | `fact` | false | Directly reported by the source |
| "Sleep is 1h18m below your 30-day baseline" (Personal Baseline Engine, plain mean/stddev) | `derived_fact` | false | Deterministic statistics over facts — no model judgment involved (ADR D2's own trade-off note: this is rolling mean/z-score, not an LLM call) |
| "Your stress appears elevated when sleep drops this much" (specialist agent pattern-read) | `ai_inference` | true | A model's interpretive judgment over derived facts |
| "Consider moving tonight's session to tomorrow" | `recommendation` | true | An actionable suggestion, never presented as settled |

A consistency trigger keeps every concrete subtype table honest against its
own spine row (both its declared `object_type` and its `user_id`):

```sql
CREATE OR REPLACE FUNCTION enforce_core_object_consistency()
RETURNS TRIGGER AS $$
DECLARE
  expected core_object_type := TG_ARGV[0]::core_object_type;
  co core_objects%ROWTYPE;
BEGIN
  SELECT * INTO co FROM core_objects WHERE id = NEW.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'core_objects.% missing; insert the spine row before %', NEW.id, TG_TABLE_NAME;
  ELSIF co.object_type <> expected THEN
    RAISE EXCEPTION '% has object_type=%, expected % for %', NEW.id, co.object_type, expected, TG_TABLE_NAME;
  ELSIF co.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'user_id mismatch: core_objects=%, %=%', co.user_id, TG_TABLE_NAME, NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- applied per subtype, e.g.:
CREATE TRIGGER trg_events_consistency BEFORE INSERT OR UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION enforce_core_object_consistency('event');
```

The same function (parameterized per call site) is attached to `entities`,
`observations`, `goals`, `actions`, `decisions`, `outcomes`, `memories`,
`clinical_memories`, `documents`, and `agent_outputs`. A variant,
`enforce_referenced_object_type(text[])`, is applied where a column
references *another* core object polymorphically and only certain types are
valid — e.g. `relationships.subject_id`/`object_id` (any type),
`outcomes.outcome_of_id` (`action` or `decision` only). The FK to
`core_objects(id)` already guarantees the referenced row exists; the
trigger only narrows which `object_type` is acceptable there.

## 3. Core primitive tables

### 3.1 `entities` — Person (other than the account holder), Entity

```sql
CREATE TYPE entity_type AS ENUM (
  'person', 'organization', 'place', 'pet',
  'financial_institution', 'brand', 'project', 'skill', 'medication', 'other'
);

CREATE TABLE entities (
  id           UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id),
  entity_type  entity_type NOT NULL,
  display_name TEXT NOT NULL,
  attributes   JSONB NOT NULL DEFAULT '{}',  -- descriptive, not fact-bearing (see note)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_entities_user_type ON entities (user_id, entity_type);
CREATE INDEX idx_entities_attributes_gin ON entities USING GIN (attributes);
```

`attributes JSONB` here is the schema's **one** deliberate, narrow use of a
semi-structured column, and it is not in tension with the "no denormalized
blob" rule: it holds *descriptive* properties of a named thing (an
address, a birthday-adjacent note, a place's category) that vary hugely by
`entity_type` and are never independently measured, timestamped, or
audited the way an Observation is. Anything that needs confidence,
provenance, or independent history — a fact *about* the person, not the
person's name — is a `relationship` or `observation` row instead, with its
own `core_objects` spine row. `entity_person_detail` (1:1, `entity_type =
'person'`) holds the columns that recur for every named person: `
relationship_to_user TEXT, is_emergency_contact BOOLEAN, birthday DATE,
contact_channel_ref TEXT` (a pointer to a contacts/integration record —
never a raw phone number/email duplicated here).

### 3.2 `events` — Event

```sql
CREATE TABLE events (
  id                  UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id),
  domain              TEXT NOT NULL,   -- 'fitness'|'travel'|'learning'|'productivity'|'social'|'career'
  event_type          TEXT NOT NULL,   -- 'workout'|'trip'|'exam'|'meeting'|'task'|'dinner'|'milestone'
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

CREATE TABLE event_participants (   -- normalizes "who else was there" instead of an array-of-FKs
  event_id  UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES entities(id),
  role      TEXT,   -- 'attendee'|'coach'|'training_partner'|'host'
  PRIMARY KEY (event_id, entity_id)
);
```

Domain extension tables (1:1 with `events.id`), drawn directly from vision
§4's per-domain attribute lists:

| Table | Domain / vision §4 source | Key columns |
|---|---|---|
| `event_fitness_session` | Fitness: "training, exercises, volume, intensity, progression, recovery, performance" | `sport_type, duration_min, distance_km, avg_hr, max_hr, calories, perceived_exertion, training_load` |
| `fitness_session_set` (child, not spine) | volume/intensity detail | `event_id, exercise_name, set_number, reps, weight_kg, tempo, rpe` |
| `event_travel_trip` | Travel: "trips, destinations, preferences, travel history" | `destination_entity_id, trip_purpose, transport_mode` |
| `event_learning_session` | Learning: "subjects, courses, exams, study sessions, knowledge gaps" | `subject, activity_type ('study'\|'exam'\|'course_module'), score, knowledge_gap_tags TEXT[]` |
| `event_calendar_item` | Productivity: "calendar, tasks, meetings" | `calendar_provider, external_event_id, attendee_count, is_focus_block` |
| `event_task` | Productivity: "tasks, focus, routines, workload" | `due_at, completed_at, priority SMALLINT, parent_goal_id → goals(id)` |
| `event_social_activity` | Social: "family, friends, social activities" | `activity_type` (participants via `event_participants`) |
| `event_career_milestone` | Career: "professional goals, projects, development" | `milestone_type ('promotion'\|'project'\|'certification'), organization_entity_id` |

Two representative DDLs (the pattern is identical for the rest):

```sql
CREATE TABLE event_fitness_session (
  event_id          UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  sport_type        TEXT NOT NULL,
  duration_min      INTEGER,
  distance_km       NUMERIC(6,2),
  avg_hr            SMALLINT,
  max_hr            SMALLINT,
  calories          INTEGER,
  perceived_exertion SMALLINT CHECK (perceived_exertion BETWEEN 1 AND 10),
  training_load     NUMERIC(8,2)
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
```

### 3.3 `observations` — Observation

```sql
CREATE TABLE observations (
  id             UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id),
  domain         TEXT NOT NULL,          -- 'health'|'nutrition'|'mental_health'|'finance'|'productivity'
  observation_type TEXT NOT NULL,        -- 'vital'|'sleep'|'symptom'|'lab_result'|'nutrition_log'|'journal'|'financial_snapshot'|'injury_flag'
  subject_entity_id UUID REFERENCES entities(id),  -- NULL = about the user themselves (the default)
  observed_at    TIMESTAMPTZ NOT NULL,   -- when the underlying reality occurred (may differ from original_timestamp if reported after the fact)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_observations_user_time ON observations (user_id, observed_at DESC);
CREATE INDEX idx_observations_user_type ON observations (user_id, domain, observation_type);
```

Observations are immutable once written — see §12's append-only-fact
principle; a correction is a new row with `supersedes_id` (added on the
extension table, not here, since only some observation kinds are ever
corrected), never an `UPDATE` of the original reading.

| Table | Domain / vision §4 source | Key columns |
|---|---|---|
| `observation_vital` | Health: "resting heart rate, HRV where available, activity" | `vital_type ('resting_hr'\|'hrv'\|'steps'\|'active_energy_kcal'\|'spo2'\|'weight_kg'\|'blood_pressure_sys'\|'blood_pressure_dia'\|'blood_glucose'), value_numeric, unit` |
| `observation_sleep` | Health: "sleep" | `sleep_start, sleep_end, duration_min, deep_min, rem_min, light_min, awake_min, sleep_score` |
| `observation_symptom` | Health: "symptoms" | `symptom_name, severity SMALLINT (1-5), duration_min, notes` |
| `observation_injury_flag` | Fitness: "recovery" / backs [03-system-architecture.md](03-system-architecture.md) §2.7's `get_active_injury_flags` | `body_part, severity, flagged_by ('user'\|'clinician'), active BOOLEAN, started_at, resolved_at` |
| `observation_lab_result` | Health: "blood tests, medical records, clinical information" | `test_name, value_numeric, value_text, unit, reference_low, reference_high, abnormal_flag, ordering_professional_id, document_id → documents(id)` |
| `observation_nutrition_log` | Nutrition: "calories, macronutrients, meal timing" | `meal_type, total_calories, protein_g, carbs_g, fat_g, fiber_g` |
| `nutrition_log_item` (child) | Nutrition: "food logs" | `observation_id, food_name, food_entity_id, quantity, unit, calories` |
| `observation_journal_entry` | Mental/Emotional: "journaling, mood, stress" | `entry_kind ('free_text'\|'structured_checkin'), entry_text, mood_score, stress_score, energy_score, tags TEXT[]` |
| `observation_financial_snapshot` | Finance: "income, expenses" (point-in-time state) | `financial_account_id, balance_cents BIGINT, currency CHAR(3), snapshot_type ('balance'\|'net_worth')` |

Two mutable **state** tables don't fit the append-only Observation pattern
— they hold a person's *current* profile, not a timestamped reading, and
are handled separately (own history tables, §12):

```sql
CREATE TABLE health_profile (      -- one row per user; mutable, versioned via health_profile_history
  user_id             UUID PRIMARY KEY REFERENCES users(id),
  allergies           TEXT[] NOT NULL DEFAULT '{}',
  chronic_conditions  TEXT[] NOT NULL DEFAULT '{}',
  medications_current JSONB NOT NULL DEFAULT '[]',  -- [{name, dose, unit, since}], descriptive, not a dosing log
  blood_type          TEXT,
  is_user_entered     BOOLEAN NOT NULL DEFAULT true,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE financial_accounts (  -- mutable reference data, versioned via financial_account_history
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id),
  account_name       TEXT NOT NULL,
  account_type       TEXT NOT NULL,   -- 'checking'|'savings'|'brokerage'|'credit'|'loan'
  institution_entity_id UUID REFERENCES entities(id),
  currency           CHAR(3) NOT NULL,
  risk_tolerance      TEXT,            -- Finance: "risk information" (vision §4)
  is_active          BOOLEAN NOT NULL DEFAULT true,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3.4 `goals` — Goal (covers Goals, Habits, milestones)

```sql
CREATE TYPE goal_type AS ENUM ('outcome', 'habit', 'milestone');

CREATE TABLE goals (
  id             UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id),
  domain         TEXT NOT NULL,   -- any life domain, vision §4
  goal_type      goal_type NOT NULL DEFAULT 'outcome',
  parent_goal_id UUID REFERENCES goals(id),   -- hierarchy: short/medium/long-term, milestones as children
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

CREATE TABLE goal_habit_detail (   -- goal_type = 'habit'
  goal_id            UUID PRIMARY KEY REFERENCES goals(id) ON DELETE CASCADE,
  cadence            TEXT NOT NULL,   -- 'daily'|'weekly'|'custom'
  target_count_per_period SMALLINT NOT NULL,
  current_streak     INTEGER NOT NULL DEFAULT 0,
  longest_streak     INTEGER NOT NULL DEFAULT 0
);
```

Milestones are child goals (`goal_type='milestone'`, `parent_goal_id` set)
rather than a bespoke `milestones` table — same reasoning as the rest of
§1: one shape, reused, not a parallel structure for a special case that
already fits.

### 3.5 `actions`, `decisions`, `outcomes` — the Outcome Learning Loop

These three implement the strategy doc's `Observation → Recommendation →
User decision → Action → Outcome → Feedback → Personal learning` loop.

```sql
CREATE TABLE actions (
  id            UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id),
  domain        TEXT NOT NULL,
  action_type   TEXT NOT NULL,   -- 'financial_transaction'|'medication_log'|'calendar_change'|'professional_share'|...
  executed_by   TEXT NOT NULL CHECK (executed_by IN ('user','agent_on_behalf_of_user','system')),
  risk_tier     SMALLINT NOT NULL CHECK (risk_tier BETWEEN 0 AND 4),  -- strategy doc risk-tier model
  status        TEXT NOT NULL DEFAULT 'completed'
                  CHECK (status IN ('planned','completed','failed','reversed')),
  confirmation_token_hash TEXT,     -- server-side proof a required confirmation actually happened (system arch §2.7)
  executed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_actions_user_time ON actions (user_id, executed_at DESC);
```

Per [03-system-architecture.md](03-system-architecture.md) §2.7, **no Tier
4 action can exist here by construction**: there is no Scoped Tool that
writes a Tier-4 `actions` row (money movement, medication changes), so
`risk_tier = 4` should never actually appear — the CHECK allows the value
for completeness/audit if a future tier definition changes, but the
enforcement is "no tool exists," matching the system architecture's own
phrasing, not a value this table is expected to hold in practice.

Extension tables: `action_financial_transaction` (`amount_cents BIGINT,
currency, category, merchant_entity_id, financial_account_id,
transaction_type ('income'|'expense'|'transfer'|'investment')`),
`action_medication_log` (`medication_name, dose, unit, taken_at,
prescribing_professional_id, adherence_status` — a **log** of a dose taken,
never an autonomous prescribing/dispensing action; see §14 for the
cross-reference this needs from Phase 0-D).

```sql
CREATE TABLE decisions (
  id                        UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
  user_id                   UUID NOT NULL REFERENCES users(id),
  prompted_by_output_id     UUID REFERENCES agent_outputs(id),  -- the recommendation, if any, that prompted this
  chosen_action_id          UUID REFERENCES actions(id),
  alternatives_considered    TEXT[],
  user_confirmed            BOOLEAN NOT NULL DEFAULT true,
  decided_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outcomes (
  id               UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id),
  outcome_of_id    UUID NOT NULL REFERENCES core_objects(id),  -- an action or a decision (enforced by trigger, §2)
  outcome_type     TEXT NOT NULL,
  success_signal   NUMERIC,      -- domain-defined scale; the Baseline Engine interprets it, this table just records it
  measured_at      TIMESTAMPTZ NOT NULL,
  notes            TEXT
);
CREATE INDEX idx_outcomes_of ON outcomes (outcome_of_id);
```

### 3.6 `relationships` — Relationship (social graph + discovered associations)

One table, two uses, disambiguated by `relationship_class` — a stable
social fact ("married to") and a discovered statistical association
("sleep↓ associated with stress↑", product vision §42) are structurally
the same thing (a typed, evidenced edge between two things in one user's
graph), so they get one table, not two:

```sql
CREATE TYPE relationship_class AS ENUM (
  'social', 'causal_association', 'temporal_sequence', 'hierarchy', 'derivation'
);

CREATE TABLE relationships (
  id                 UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id),
  relationship_class relationship_class NOT NULL,
  subject_id         UUID NOT NULL REFERENCES core_objects(id),
  predicate          TEXT NOT NULL,     -- 'spouse_of'|'coach_of'|'appears_associated_with'|'precedes'|'derived_from'
  object_id          UUID NOT NULL REFERENCES core_objects(id),
  strength           NUMERIC(4,3),      -- correlation/confidence magnitude for statistical classes; NULL for 'social'
  valid_from         TIMESTAMPTZ,
  valid_to           TIMESTAMPTZ,       -- NULL = still current
  notes              TEXT
);
CREATE INDEX idx_relationships_subject ON relationships (subject_id);
CREATE INDEX idx_relationships_object  ON relationships (object_id);
```

A `causal_association` row **must never claim causation** — product vision
§42 requires "appears associated with"/"correlates with" language, never a
causal claim, without evidence. This is enforced where it actually matters
(user-facing copy generation), not by a schema constraint on `predicate`
being free text; the schema's job is only to make `relationship_class`
explicit enough that the rendering layer knows which predicates need
hedged language — a naming convention (`appears_associated_with`, never
`causes`) is documented here as the contract the agent/rendering layer
relies on.

## 4. Memory architecture (product vision §11)

### 4.1 `memories` and the relational-memory requirement

Vision §11 requires episodic, semantic, behavioral, and goal memory, all
attributable/editable/auditable/deletable and never silently promoted from
speculation to permanent fact. The strategy doc adds a sharper requirement
on top: a memory record must carry **structured reasons/qualities**, not
just a subject and a polarity — "enjoyed destination X because it combined
beaches + nightlife + food + nature + flexibility, disliked the long
transfers," not "likes destination X."

```sql
CREATE TYPE memory_class AS ENUM ('episodic', 'semantic', 'behavioral', 'goal_related', 'preference');
CREATE TYPE memory_status AS ENUM ('active', 'superseded', 'retracted', 'user_edited');
CREATE TYPE polarity AS ENUM ('positive', 'negative', 'neutral', 'mixed');

CREATE TABLE memories (
  id                    UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES users(id),
  memory_class          memory_class NOT NULL,
  subject_core_object_id UUID REFERENCES core_objects(id),  -- what/who this is about (an entity, goal, event...); NULL for a general behavioral pattern
  polarity              polarity,
  statement             TEXT NOT NULL,   -- the natural-language memory as surfaced to the user
  status                memory_status NOT NULL DEFAULT 'active',
  superseded_by_id      UUID REFERENCES memories(id),
  editable_by_user      BOOLEAN NOT NULL DEFAULT true,
  visible_to_user       BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_memories_user_class ON memories (user_id, memory_class, status);
CREATE INDEX idx_memories_subject    ON memories (subject_core_object_id);
```

`memory_reasons` is the schema change the strategy doc's Identity Graph
note actually demands — the qualities/reasons that make a memory useful for
a *future* recommendation instead of a shallow lookup:

```sql
CREATE TABLE memory_reasons (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id                UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  reason_type              TEXT NOT NULL CHECK (reason_type IN ('quality','constraint','context','counter_example')),
  reason_text              TEXT NOT NULL,          -- 'beaches', 'nightlife', 'the long transfers'
  polarity                 polarity NOT NULL,
  weight                   NUMERIC(3,2),            -- relative salience, 0-1
  supporting_core_object_id UUID REFERENCES core_objects(id)  -- the Outcome/Event/Observation this reason is evidenced by
);
CREATE INDEX idx_memory_reasons_memory ON memory_reasons (memory_id);
```

Worked example (the strategy doc's own case): `memories` row
`(memory_class='preference', subject_core_object_id=<Entity: destination X>,
polarity='mixed', statement='Enjoys destination X overall, dislikes the
transfers')`, with `memory_reasons` rows `('quality','beaches','positive')`,
`('quality','nightlife','positive')`, `('quality','food','positive')`,
`('quality','nature','positive')`, `('quality','flexibility','positive')`,
`('constraint','long transfers','negative')` — each optionally pointing at
the specific past `event_travel_trip`/`outcome` row that is its evidence.
A later travel recommendation can now filter destinations by the specific
qualities that matter to *this* person, not just re-suggest "destination
X" or generic popular places.

Because `memories` is a `core_objects` subtype, editability/auditability/
deletability and the never-silently-a-fact rule are already satisfied:
`epistemic_status` is `ai_inference` (never `fact`) for anything the system
inferred rather than the user stated outright, `status='user_edited'`
records that a person corrected it, and `superseded_by_id` plus
`memory_history` (§12) give the full "what did the AI believe before"
trail.

### 4.2 `clinical_memories` — separately permissioned

Product vision §11 requires professional/clinical memory to have
*stricter* permissions, not just a different label. It gets its own table
(mirroring `memories`'s shape) rather than a flag on `memories`, because
its **RLS policy is structurally different** (§10.3) and because keeping
it out of `memories` means no query against general memory can ever
accidentally include clinical content by forgetting a `WHERE` clause.

```sql
CREATE TABLE clinical_memories (
  id                     UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
  user_id                UUID NOT NULL REFERENCES users(id),
  memory_class           memory_class NOT NULL,
  subject_core_object_id UUID REFERENCES core_objects(id),
  statement              TEXT NOT NULL,
  authored_by_professional_id UUID REFERENCES professionals(id),  -- NULL if system/agent-authored, pending professional review
  status                 memory_status NOT NULL DEFAULT 'active',
  visibility             TEXT NOT NULL DEFAULT 'user_only'
                           CHECK (visibility IN ('user_only','user_and_named_professional')),
  shared_via_grant_id    UUID REFERENCES permission_grants(id),  -- which active grant, if any, currently permits professional visibility
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`shared_via_grant_id` is what makes visibility revocable in one place:
revoke the `permission_grants` row (§8.2) and the RLS policy (§10.3) that
joins through it stops matching immediately, without touching this table.

### 4.3 Short-term (session) memory — disambiguated from auth sessions

Vision §11 lists "short-term (session)" memory alongside episodic/
semantic/behavioral/goal. This is the current conversation's working
context, not a durable memory class, and it is **not** the same object as
ADR D7's `sessions` table (device/refresh-token session) — same English
word, two different things, worth stating explicitly since the two are
easy to conflate:

```sql
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
  tool_calls      JSONB,     -- structured record of which Scoped Tools were invoked this turn
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agent_turns_conversation ON agent_turns (conversation_id, created_at);
```

This is retained for traceability/audit (it's the source `agent_outputs`
rows point back to, §5) and is not itself long-term memory — the Life
Master Agent never re-reads an old conversation's turns as "memory";
anything worth remembering across sessions gets promoted into a `memories`
row explicitly. Retention/purge policy for this table is a Phase 0-F
(privacy model) decision, not fixed here.

### 4.4 `embeddings` — pgvector, ADR D5

```sql
CREATE TABLE embeddings (
  core_object_id UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
  model          TEXT NOT NULL,     -- embedding model identifier (see §14 — not yet fixed by the ADR)
  embedding      VECTOR(1536) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_embeddings_hnsw ON embeddings
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
```

One row per embedded core object (memory, observation, or document text) —
reusing the spine's `id` again means no separate join table is needed to
know what an embedding is "of." Per ADR D5, this table is never queried as
a source of truth on its own — every retrieval joins back to the owning
`core_objects` row and respects that row's RLS policy (§10), so semantic
search cannot surface a row across a tenant boundary or past a revoked
`clinical_memories` grant.

## 5. Agent outputs and the recommendation trail

Product vision §7's specialist contract (`finding, evidence[], confidence,
uncertainty[], recommendation, requires_human_review,
requires_user_confirmation` + `agent_version, model_version, prompt_version,
data_timestamp, sources[], tools_used[]`) needs to be a persisted row, not
just an in-flight object — otherwise "every AI output traceable to model/
agent/prompt version" (vision §45-46) has nothing to point at later.

```sql
CREATE TABLE agent_outputs (
  id                        UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
  user_id                   UUID NOT NULL REFERENCES users(id),
  conversation_turn_id      UUID REFERENCES agent_turns(id),
  agent_name                TEXT NOT NULL,     -- 'life_master_agent' | 'health_analysis' | 'training_safety' | ...
  model_version             TEXT NOT NULL,
  prompt_version            TEXT NOT NULL,
  finding                   TEXT NOT NULL,
  evidence                  JSONB NOT NULL DEFAULT '[]',  -- [{core_object_id, description}], heterogeneous by nature
  uncertainty               TEXT[] NOT NULL DEFAULT '{}',
  recommendation            TEXT,
  requires_human_review     BOOLEAN NOT NULL DEFAULT false,
  requires_user_confirmation BOOLEAN NOT NULL DEFAULT false,
  risk_tier                 SMALLINT CHECK (risk_tier BETWEEN 0 AND 4),
  data_timestamp            TIMESTAMPTZ,
  tools_used                TEXT[] NOT NULL DEFAULT '{}',
  disagrees_with_output_id  UUID REFERENCES agent_outputs(id)  -- surfaced disagreement (CLAUDE.md non-negotiable), never silently dropped
);

CREATE TABLE agent_output_sources (   -- which specialist outputs a composed Life Master Agent answer aggregated
  output_id        UUID NOT NULL REFERENCES agent_outputs(id) ON DELETE CASCADE,
  source_output_id UUID NOT NULL REFERENCES agent_outputs(id),
  PRIMARY KEY (output_id, source_output_id)
);
```

Every `agent_outputs` row is a `core_objects` subtype with `object_type =
'agent_output'`, so it inherits `epistemic_status` (always `ai_inference`
or `recommendation`, never `fact` — enforced by §2's constraint),
`confidence`, and `agent_version` for free. `evidence JSONB` is the one
place this document accepts a heterogeneous array instead of a join table,
because the evidence for one finding can legitimately span rows from
`observations`, `baselines` (§6, not `core_objects`-backed, so not always
FK-able the same way), and other `agent_outputs` — a strict join table
would need a `source_kind` discriminator per row anyway with no real
integrity gain; `agent_output_sources` above *is* the strict join table for
the one case (aggregating other agent outputs) that both matters most for
the disagreement-surfacing requirement and is homogeneous enough to
warrant it.

## 6. Context Engine outputs: `baselines` and `timeline_entries`

[03-system-architecture.md](03-system-architecture.md) §2.5 and §2.7 assume
these tables already exist (`get_sleep_baseline_deviation`,
`get_training_load_baseline` read "a `baselines`/`timelines` row the
Context Engine already wrote") — this section makes them concrete.

### 6.1 Why these are *not* `core_objects` subtypes

A `baselines` row is a **continuously recomputed, upserted** artifact for
a given `(user, domain, metric, window)` — the worker overwrites it on
every recompute — not a discrete, individually-provenanced fact that
accumulates a new immutable row each time the way an `observations` row
does. Putting it on the spine would mean either accumulating one
`core_objects` row per recompute (unbounded growth for something that's
supposed to be a cheap cache) or violating the spine's own immutability
convention by updating a "fact" in place. Keeping it off the spine with a
plain upsert is the simpler, more honest design:

```sql
CREATE TYPE baseline_classification AS ENUM (
  'normal', 'improving', 'deteriorating', 'anomalous', 'repeated_pattern', 'new_pattern'
);

CREATE TABLE baselines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  domain          TEXT NOT NULL,
  metric          TEXT NOT NULL,           -- 'sleep_duration'|'training_load'|'mood_score'|'spend_rate'|...
  window_days     SMALLINT NOT NULL,
  mean            NUMERIC,                 -- NULL for a non-statistical derived flag (e.g. calendar density)
  stddev          NUMERIC,
  current_value   NUMERIC,
  deviation_z     NUMERIC,
  classification  baseline_classification NOT NULL,
  source          TEXT NOT NULL DEFAULT 'context_engine_worker',
  is_ai_derived   BOOLEAN NOT NULL DEFAULT false,  -- plain statistics by default — see §2's derived_fact vs ai_inference table
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, domain, metric, window_days)
);

CREATE TABLE timeline_entries (   -- post-MVP UI feature (strategy doc "Life Timeline"); table exists now because the worker can populate it cheaply
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  core_object_id  UUID NOT NULL REFERENCES core_objects(id) ON DELETE CASCADE,
  domain          TEXT NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL,
  headline        TEXT NOT NULL,
  importance_score NUMERIC(3,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_timeline_user_time ON timeline_entries (user_id, occurred_at DESC);
```

If a genuine need for *historical* baseline values (not just the current
one) emerges later — e.g. "how has my baseline sleep changed over the
year" — the natural extension is a periodic `baseline_snapshots` append-only
table fed by the same worker, not a redesign of `baselines` itself.

### 6.2 `document_history`'s free-standing kin — none needed here

`baselines`/`timeline_entries` are explicitly excluded from the versioning
requirement (§12) — they're a cache, not one of the six vision §27 objects,
and re-derivable at any time from the append-only Observations underneath
them.

### 6.3 Traceability check against the system architecture's tool names

| Tool ([03-system-architecture.md](03-system-architecture.md) §2.7) | Backed by |
|---|---|
| `get_sleep_baseline_deviation(user_id, window)` | `baselines` (`domain='health', metric='sleep_duration'`) |
| `get_recent_sleep_raw(user_id, nights≤N)` | `observation_sleep` joined to `observations` |
| `get_training_load_baseline(user_id)` | `baselines` (`domain='fitness', metric='training_load'`) |
| `get_active_injury_flags(user_id)` | `observation_injury_flag` (`active = true`) |
| `get_calendar_density_tomorrow(user_id)` | `baselines` (`domain='productivity', metric='calendar_density_next_day'`, `mean`/`stddev` NULL — a derived flag, not a statistical baseline) or computed live from `events`/`event_calendar_item`; either is schema-compatible, left as a Phase 0-D implementation choice |
| `get_recent_training_summary` | `event_fitness_session` joined to `events`, recent `starts_at` |
| `move_calendar_event`, `cancel_scheduled_workout` | write `actions` rows (`action_type='calendar_change'`/`'workout_cancellation'`) + mutate `event_calendar_item`/`events.status` |

Every read tool in that table resolves to a real table above; nothing in
the system architecture's worked example (§4) requires a table this
document doesn't have.

## 7. Identity, roles, and account infrastructure (off the spine, §1)

### 7.1 `users`, `webauthn_credentials`, `sessions`

```sql
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apple_sub    TEXT UNIQUE NOT NULL,     -- Sign in with Apple subject (ADR D7)
  email        TEXT,
  display_name TEXT,
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','pending_deletion','deleted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

CREATE TYPE user_role AS ENUM ('USER','PROFESSIONAL','ADMIN','SUPPORT','SYSTEM');

CREATE TABLE user_roles (   -- an account can hold more than one role (e.g. a therapist who is also a plos user)
  user_id    UUID NOT NULL REFERENCES users(id),
  role       user_role NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE webauthn_credentials (   -- Passkeys, ADR D7
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  credential_id BYTEA NOT NULL UNIQUE,
  public_key    BYTEA NOT NULL,
  sign_count    BIGINT NOT NULL DEFAULT 0,
  device_name   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);

CREATE TABLE sessions (   -- device/auth session, ADR D7 — distinct from agent_conversations (§4.3)
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
```

### 7.2 `professionals`

```sql
CREATE TABLE professionals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES users(id),   -- set only if they also hold a plos account with PROFESSIONAL role
  full_name      TEXT NOT NULL,
  license_number TEXT,
  license_type   TEXT,
  specialty      TEXT,
  verified_at    TIMESTAMPTZ
);
```

### 7.3 `subscriptions` (ADR D8)

```sql
CREATE TABLE subscriptions (
  user_id            UUID PRIMARY KEY REFERENCES users(id),
  revenuecat_id      TEXT,
  product_id         TEXT,
  status             TEXT NOT NULL CHECK (status IN ('active','grace_period','expired','none')),
  current_period_end TIMESTAMPTZ,
  last_synced_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Cached last-known-good entitlement per ADR D8's own trade-off note — a
RevenueCat outage degrades to this row, not to locking out paying users.

### 7.4 `integrations` (vision §17-20 adapter contract)

```sql
CREATE TABLE integrations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES users(id),
  provider               TEXT NOT NULL,   -- 'apple_health'|'apple_calendar'|'strava'|...
  status                 TEXT NOT NULL CHECK (status IN ('connected','disconnected','error','revoked')),
  external_account_id    TEXT,
  scopes_granted         TEXT[] NOT NULL DEFAULT '{}',
  credentials_secret_ref TEXT,   -- pointer into Secrets Manager; never a raw token in Postgres (ADR D4, vision §12)
  connected_at           TIMESTAMPTZ,
  last_sync_at           TIMESTAMPTZ,
  last_sync_status       TEXT
);
CREATE UNIQUE INDEX uq_integrations_user_provider ON integrations (user_id, provider);
```

## 8. Permission scope model (product vision §15)

### 8.1 Roles vs. scopes

`user_roles` (§7.1) is coarse — it says what *kind* of access an account
can ever be granted (only a `PROFESSIONAL`-role account can be the
`grantee` of a professional-access grant). `permission_scopes` /
`permission_grants` below are fine-grained — they say which specific
`resource.action` a specific grantee currently has, for what purpose, on
whose data. Both are required together; neither alone matches vision §15's
"role-based **and** resource/consent/purpose-based."

```sql
CREATE TABLE permission_scopes (   -- catalog, not tenant-scoped
  scope       TEXT PRIMARY KEY,     -- 'journal.read'|'health.write'|'mental_health.read'|'finance.execute'|'professional.share'
  resource    TEXT NOT NULL,
  action      TEXT NOT NULL,
  risk_tier   SMALLINT NOT NULL CHECK (risk_tier BETWEEN 0 AND 4),
  description TEXT NOT NULL
);
```

### 8.2 `permission_grants` — also §12's example of append-only-by-design

```sql
CREATE TABLE permission_grants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),      -- whose data
  grantee_type  TEXT NOT NULL CHECK (grantee_type IN ('self_app','professional','integration','support')),
  grantee_id    UUID,      -- professionals.id | integrations.id | NULL for 'self_app'
  scope         TEXT NOT NULL REFERENCES permission_scopes(scope),
  purpose       TEXT NOT NULL,      -- purpose-based consent: the feature/reason this scope was requested for
  granted_via   TEXT NOT NULL,      -- 'onboarding_flow'|'feature_prompt'|'professional_invite'
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);

-- exactly one ACTIVE grant per (user, grantee, scope); revoked rows are kept, not deleted —
-- this IS the permission version history vision §27 asks for, with no separate _history table (§12)
CREATE UNIQUE INDEX uq_active_grant ON permission_grants (
  user_id, grantee_type, COALESCE(grantee_id, '00000000-0000-0000-0000-000000000000'), scope
) WHERE revoked_at IS NULL;

CREATE INDEX idx_grants_user ON permission_grants (user_id) WHERE revoked_at IS NULL;
```

**"Professional access" (vision §9-10) is not a separate table.** It is
`permission_grants` filtered to `grantee_type = 'professional'`. A second
table for the same grant/revoke concept would let the two diverge (a scope
revoked in one but not the other) — exactly the kind of duplicated,
domain-specific table this document's normalization principle (§1) rejects.

### 8.3 `consent_records` — legal basis, distinct from feature permission

`permission_grants` answers "can this agent/professional/integration touch
this resource right now." `consent_records` answers a different, broader
question: "does plos have a lawful basis to process this category of data
at all" (ToS acceptance, health-data-processing consent, marketing
consent) — Phase 0-F (privacy model) and legal review own the actual
consent taxonomy; this table just gives it a durable home:

```sql
CREATE TABLE consent_records (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  consent_type TEXT NOT NULL,    -- 'tos'|'health_data_processing'|'marketing'|...
  version      TEXT NOT NULL,    -- which version of the policy text was consented to
  granted_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
```

## 9. Documents (S3 metadata, ADR D6)

```sql
CREATE TABLE documents (
  id             UUID PRIMARY KEY REFERENCES core_objects(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id),
  document_type  TEXT NOT NULL CHECK (document_type IN
                   ('lab_result','professional_report','imported_record','export_bundle','consent_form','other')),
  s3_bucket      TEXT NOT NULL,
  s3_key         TEXT NOT NULL,
  s3_version_id  TEXT NOT NULL,     -- S3 versioning (ADR D6) tracks the binary; this row tracks metadata (§12)
  mime_type      TEXT NOT NULL,
  filename       TEXT NOT NULL,
  size_bytes     BIGINT,
  checksum_sha256 TEXT,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE document_links (   -- many-to-many: a document can be evidence for several core objects
  document_id    UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  core_object_id UUID NOT NULL REFERENCES core_objects(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, core_object_id)
);
```

## 10. Tenant isolation via row-level security (requirement 4)

### 10.1 Mechanism

The API layer never issues a query with a client-supplied `user_id`
([03-system-architecture.md](03-system-architecture.md) §2.3's
`RequestContext`, resolved server-side from the verified JWT). RLS is the
second, independent enforcement layer required by product vision §12
("multi-tenant isolation must be enforced independently of UI logic") —
even a bug that forgets a `WHERE user_id = ...` clause in application code
cannot leak another tenant's row, because the database itself refuses to
return it.

Every request-scoped database connection sets one session-local variable,
inside the same transaction as the query, from `RequestContext.user_id`:

```sql
SET LOCAL app.current_user_id = '3fa8...';
```

`SET LOCAL` (not `SET`) scopes it to the current transaction only, so
connection-pool reuse between requests can never leak a stale value — each
request's transaction sets it fresh before touching any tenant table.

### 10.2 The standard policy (applied verbatim to every tenant-scoped table)

```sql
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;   -- FORCE: even the table owner role is subject to it

CREATE POLICY events_tenant_isolation ON events
  USING      (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);
```

Applied identically (same two-statement `ENABLE`/`FORCE` + one `USING` +
`WITH CHECK` policy, table name substituted) to: `core_objects`,
`entities`, `events`, `event_participants`, `observations`,
`goals`, `goal_habit_detail`, `actions`, `decisions`, `outcomes`,
`relationships`, `memories`, `agent_outputs`, `agent_conversations`,
`agent_turns`, `embeddings`, `documents`, `document_links`, `baselines`,
`timeline_entries`, `health_profile`, `financial_accounts`, `sessions`,
`webauthn_credentials`, `subscriptions`, `integrations`,
`permission_grants`, `consent_records`, and every domain extension table
(joined transitively through their 1:1 parent's `user_id`, which every
extension table also carries — see §2's consistency trigger).

**The `worker` Fargate task** ([03-system-architecture.md](03-system-architecture.md)
§1) is not exempt from this — it is not given a `BYPASSRLS` role, which
would defeat the isolation guarantee for the component that writes the
most rows. Instead the worker processes users one at a time within a
batch, issuing `SET LOCAL app.current_user_id = '<that user>'` at the start
of each user's transaction, exactly like the request path. This is a
concrete implementation obligation flagged for whoever builds the worker
(§14) — it constrains connection-pool reuse (never carry one user's
setting into another user's transaction).

### 10.3 The extended policy: professional access to shared clinical content

`clinical_memories` (and any future table a professional can be granted
visibility into) needs a second `USING` clause, because the *viewer* is
sometimes not the row's owner:

```sql
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
```

Two Postgres policies on the same table combine with `OR` by default, so a
row is visible if either the owner policy or the shared-professional
policy matches. `app.current_professional_id` is set only on requests
authenticated as a `PROFESSIONAL`-role account, distinct from
`app.current_user_id` — this requires `RequestContext` (system architecture
§2.3) to carry a professional identity claim as a separate field when the
caller is a professional, which that document doesn't currently
distinguish (flagged in §14 for Phase 0-D).

## 11. Audit log (requirement 5)

Append-only by construction, not by convention: the application's database
role is never granted `UPDATE`/`DELETE` on this table at all.

```sql
CREATE TABLE audit_log (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY,
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_type         TEXT NOT NULL CHECK (actor_type IN ('user','agent','system','professional','admin')),
  actor_id           UUID,
  acting_as_user_id  UUID,       -- whose data this action touched/was performed on behalf of
  action             TEXT NOT NULL,     -- 'tool.get_recent_sleep_raw'|'auth.login'|'consent.revoke'|'export.request'
  resource_type      TEXT,
  resource_id        UUID,
  risk_tier          SMALLINT CHECK (risk_tier BETWEEN 0 AND 4),
  request_id         UUID,
  agent_version      TEXT,
  model_version      TEXT,
  args_hash          TEXT,       -- hash only — never the raw arguments/payload (system arch §7)
  result             TEXT NOT NULL CHECK (result IN ('success','denied','error')),
  ip_hash            TEXT,
  metadata           JSONB,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- monthly partitions, created ahead of need by a scheduled job
CREATE TABLE audit_log_2026_09 PARTITION OF audit_log
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

REVOKE UPDATE, DELETE ON audit_log FROM plos_app, plos_worker;
GRANT INSERT, SELECT ON audit_log TO plos_app, plos_worker;

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_log_read_own ON audit_log
  FOR SELECT
  USING (acting_as_user_id = current_setting('app.current_user_id', true)::uuid);
-- no INSERT policy needed beyond the GRANT above; no UPDATE/DELETE policy exists at all
```

Partitioning by month bounds index size and makes retention/archival
(Phase 0-F) a `DETACH PARTITION` rather than a `DELETE` scan across a
monotonically growing table. The trigger is defense in depth, not the
primary control — the primary control is that no application role holds
`UPDATE`/`DELETE` privilege on the table at all; a true database superuser
could still disable the trigger or `ALTER ROLE`, which is a deployment/
operational-access control (least-privilege DB roles, no interactive prod
shell), not something a schema constraint alone can prevent — carried into
Phase 0-E (threat model) as an insider-access item, matching the strategy
doc's hazard register.

## 12. Versioning strategy (product vision §27)

### 12.1 The general principle

Two different things get called "versioning," and conflating them produces
either an over-engineered hot path or a system that can't actually show
"what did this used to say":

- **An append-only fact is already its own history.** A sleep reading, a
  transaction, a workout: once written it is never edited — the row's own
  `observed_at`/`executed_at` time series **is** its version history, and
  a correction is a new row with `supersedes_id`, never an `UPDATE`.
  Nothing extra is needed for these.
- **A mutable current-state object needs an explicit history table.**
  Something a user or professional actively edits over time (a goal's
  target date, a memory's statement, a document's sharing state, an
  account's metadata) has exactly one "current" row, and that row's past
  values matter — that's what needs a `_history` table.

Mechanism for the second kind: a generic `AFTER UPDATE OR DELETE` trigger
that copies the pre-change row into a shadow table, so the live table stays
simple (no `valid_to IS NULL` filter needed on every read — a real risk of
forgetting that filter and leaking a stale row was the reason `valid_from`/
`valid_to` columns on the hot table were rejected as the default here) and
the versioning cost is paid only on writes, which are rare relative to
reads for all six objects below.

Template, shown once for `goals` (identical shape for the others):

```sql
CREATE TABLE goal_history (
  history_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id           UUID NOT NULL,          -- the goals.id this version belonged to
  user_id      UUID NOT NULL,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by   UUID,                   -- actor: user_id or agent identifier
  operation    TEXT NOT NULL CHECK (operation IN ('update','delete')),
  snapshot     JSONB NOT NULL          -- the full pre-change row
);
CREATE INDEX idx_goal_history_id ON goal_history (id, changed_at DESC);

CREATE OR REPLACE FUNCTION capture_goal_history() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO goal_history (id, user_id, changed_by, operation, snapshot)
  VALUES (OLD.id, OLD.user_id, current_setting('app.current_user_id', true)::uuid,
          lower(TG_OP), to_jsonb(OLD));
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_goal_history BEFORE UPDATE OR DELETE ON goals
  FOR EACH ROW EXECUTE FUNCTION capture_goal_history();
```

`snapshot JSONB` (rather than mirroring every column) is deliberate here,
unlike the rejected use of JSONB for live fact data (§3.1) — a history
table's whole job is "what did the row look like before," which is exactly
the kind of undifferentiated, non-independently-queried blob JSONB is
right for; nobody runs an indexed query against `goal_history.snapshot`,
they fetch it by `id` and read it.

### 12.2 The decision, object by object (vision §27's list)

| Object | Mechanism | Why |
|---|---|---|
| Health records | Append-only (`observations`/`events` rows); `health_profile_history` only for the mutable profile summary (§3.3) | Time-series readings are immutable by nature; only the user-edited allergy/condition/medication *summary* is ever revised in place |
| Goals | `goal_history` trigger table | Actively user-edited (status, target date, priority) and read far more often live than historically — keep the hot table simple |
| AI memories | `memory_history`, `clinical_memory_history` trigger tables | Vision §11 requires showing what the AI previously believed before a user correction — the trigger table is exactly that trail |
| Professional reports | `document_history` trigger table (metadata only) | The binary content is already versioned by S3 (ADR D6); the DB only needs to version metadata/sharing-state changes |
| Permissions | **No separate history table** — `permission_grants` rows are never deleted, only `revoked_at`-stamped, and re-granting inserts a new row (§8.2) | The grant/revoke ledger is inherently append-only; a parallel history table would just duplicate it |
| Financial information | Append-only (`action_financial_transaction`, `observation_financial_snapshot`); `financial_account_history` for mutable account metadata (§3.3) | Same append-only-fact principle as health records; only account nicknames/risk-tolerance/active-status are ever edited in place |

Six trigger tables in total — one per mutable current-state table:
`goal_history`, `memory_history`, `clinical_memory_history`,
`document_history`, `financial_account_history`, `health_profile_history`
— each following the `goal_history` template above with the table name
substituted.

## 13. Full table index

| Table | Layer | Tenant-scoped (RLS) | Versioned |
|---|---|---|---|
| `core_objects` | Spine | Yes | — (immutable once written, except `updated_at`) |
| `users`, `user_roles`, `webauthn_credentials`, `sessions` | Account | Yes (own row) | No |
| `professionals` | Account | No (catalog-like; access controlled via `permission_grants`) | No |
| `subscriptions`, `integrations` | Account | Yes | No |
| `entities`, `entity_person_detail` | Core primitive | Yes | No (descriptive; edits are just edits) |
| `events`, `event_participants` + 8 domain extension tables (§3.2) | Core primitive + extension | Yes | No (append-only fact) |
| `observations` + 9 domain extension tables (§3.3) | Core primitive + extension | Yes | No (append-only fact) |
| `health_profile`, `financial_accounts` | Mutable domain state | Yes | Yes (`health_profile_history`, `financial_account_history`) |
| `goals`, `goal_habit_detail` | Core primitive | Yes | Yes (`goal_history`) |
| `actions`, `decisions`, `outcomes` | Core primitive | Yes | No (append-only) |
| `relationships` | Core primitive | Yes | No (`valid_to` marks end of validity in place) |
| `memories`, `memory_reasons` | Memory | Yes | Yes (`memory_history`) |
| `clinical_memories` | Memory (stricter) | Yes, extended policy (§10.3) | Yes (`clinical_memory_history`) |
| `agent_conversations`, `agent_turns` | Short-term memory | Yes | No (ephemeral, retention per Phase 0-F) |
| `embeddings` | Retrieval | Yes (via `core_objects` join) | No |
| `agent_outputs`, `agent_output_sources` | AI output | Yes | No (append-only) |
| `baselines`, `timeline_entries` | Context Engine cache | Yes | No (recomputed, not historical) |
| `documents`, `document_links` | Object storage metadata | Yes | Yes (`document_history`) |
| `permission_scopes` | Catalog | No | — |
| `permission_grants`, `consent_records` | Permissions | Yes | No separate table — append-only by design (§12.2) |
| `audit_log` | Audit | Yes (read-only policy) | N/A — is itself the history |

## 14. Open questions / inconsistencies vs. the ADR and system architecture

- **Embedding model/dimension not fixed upstream.** ADR D3 specifies
  `ModelProvider.embedding()` as part of the abstraction but Anthropic has
  no first-party embeddings endpoint as of this writing — Voyage AI is
  Anthropic's recommended embeddings partner, but neither the ADR nor the
  system architecture names a provider. `embeddings.embedding VECTOR(1536)`
  assumes a dimension; if the eventual model uses a different dimension
  the column (and its HNSW index) needs to change before any embeddings are
  written — cheap now, disruptive later. This should be closed out as an
  ADR addendum or in Phase 0-D, not silently assumed here.
- **`RequestContext` needs a professional-identity field.** §10.3's
  `clinical_memories` shared-access policy requires
  `app.current_professional_id` to be set from a verified claim distinct
  from `app.current_user_id`, but
  [03-system-architecture.md](03-system-architecture.md) §2.3's
  `RequestContext {user_id, scopes, session_id, entitlement_tier}` doesn't
  currently carry one — a professional viewing a patient's shared clinical
  memories is a request shape that document didn't model. Needs a decision
  in Phase 0-D: does a professional authenticate as a `users` row with
  `PROFESSIONAL` role acting on someone else's `user_id`, or as a
  structurally separate principal? This schema works either way but the
  guard/context layer needs to pick one.
- **Worker RLS discipline is a real implementation constraint, not just a
  policy statement.** §10.2 requires the `worker` Fargate task to set
  `app.current_user_id` per user within a batch and never reuse a pooled
  connection across users without resetting it. This is enforceable in
  code review but not by the schema itself — worth a lint/test in Phase
  0-D's actual worker implementation (e.g., a connection-pool wrapper that
  refuses to hand out a connection without an explicit `SET LOCAL` first).
- **`get_calendar_density_tomorrow`'s backing table is left as a choice**
  (§6.3) between a `baselines` row and a live query — both are
  schema-compatible; Phase 0-D should pick one rather than leaving it
  ambiguous once the tool is actually implemented.
- **Stale cross-reference — resolved.** [00-strategy-moat-and-hazards.md](00-strategy-moat-and-hazards.md)'s
  link now correctly points to this document at `04-database-schema.md`;
  flagged as stale when this document was drafted, fixed since.
- **`action_medication_log` needs a Phase 0-D cross-check.** This table
  only ever *logs* a dose the user reports taking — product vision §12/§16
  and the strategy doc's Tier 4 rule mean no Scoped Tool should ever be
  able to write this table as an autonomous agent action (only
  `executed_by IN ('user')`, in practice). The schema doesn't and can't
  fully enforce "only a user-initiated write reaches this table" — that's
  a Scoped Tool registration property (system architecture §2.7's "no tool
  exists" pattern for Tier 4), so Phase 0-D should confirm no
  medication-writing tool is ever registered for agent-initiated calls.
