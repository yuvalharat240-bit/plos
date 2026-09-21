# plos — Agent Architecture (Phase 0-D)

> This is Phase 0-D of the sequence fixed in
> [00-product-vision-master-prompt.md](00-product-vision-master-prompt.md) §60
> (A. ADR — B. System architecture — C. Database schema — D. **Agent
> architecture** — E. Threat model — F. Privacy model — G. MVP). It takes the
> orchestration decision ([02-architecture-decision-record.md](02-architecture-decision-record.md)
> D3: Claude Agent SDK behind a `ModelProvider` abstraction), the pipeline
> shape ([03-system-architecture.md](03-system-architecture.md) §2.4–2.7: Life
> Master Agent → Specialist Agent pairs → Scoped Tools), and the tables those
> tools read and write ([04-database-schema.md](04-database-schema.md)) as
> given, and answers what those documents deliberately left open: the actual
> 10 named specialist pairs from
> [00-product-vision-master-prompt.md](00-product-vision-master-prompt.md)
> §5–8 with concrete inputs/outputs/permissions/tools; the literal agent
> output contract as a schema, not prose; the risk-tier gate as an
> enforced tool-contract field, not a prompt instruction; the
> compartmentalization rule as a per-agent, per-tool grant list; and how the
> Life Master Agent detects and surfaces specialist disagreement.
>
> **Out of scope here**: the enumerated threat catalogue (Phase 0-E), the
> consent/UX flows for permission requests (Phase 0-F), and which of the 10
> pairs actually ship at MVP vs. later (Phase 0-G) — §11 below states the
> dependency but does not resolve it, since [00-product-vision-master-prompt.md](00-product-vision-master-prompt.md)
> §52's MVP list names only Health, Fitness, and a "Journal/context"
> specialist, and Phase 0-G hasn't been written yet.

## 1. Orchestration mechanism: confirming and completing ADR D3

[03-system-architecture.md](03-system-architecture.md) §9 flagged the Claude
Agent SDK's native subagent/tool-allow-list mechanism as *this document's
assumption* to confirm or revise. **Confirmed**: every named agent below
(the Life Master Agent and all 20 specialists) is a Claude Agent SDK
subagent, not a hand-rolled per-specialist API call. Reasons this is the
right mechanism, not just the path of least resistance:

- The SDK's per-subagent system prompt + tool allow-list is exactly the
  boundary [03-system-architecture.md](03-system-architecture.md) §2.6
  needs for "a specialist never sees the user's raw question in isolation
  with unrestricted tool access" — the allow-list is configuration, not a
  convention the prompt has to restate.
- It keeps ADR D3's `ModelProvider` abstraction intact: subagent dispatch
  still goes through `ModelProvider.generate()`, so swapping the underlying
  model later doesn't touch this document's roster.
- Hand-rolling the equivalent (a bespoke per-specialist dispatch loop)
  would duplicate retry/context-window/tool-parsing logic ADR D3 already
  rejected reinventing.

**New decision this document makes** (unspecified by either ADR D3 or the
system architecture): **pairs run sequentially, not in parallel.** The
primary agent runs first and returns its complete structured output
(§2); the second (safety/verification) agent then runs with that full
output as additional input, on top of the same sub-task and context
snapshot slice the primary agent received. This is what makes "verifies,
checks constraints, offers an alternative interpretation" ([00-product-vision-master-prompt.md](00-product-vision-master-prompt.md)
§5–8) a real review of a concrete claim rather than two independent
guesses that happen to get compared afterward — running both from only the
sub-task in parallel would produce exactly that duplicate-guess shape the
vision doc explicitly says the second agent must not be. The cost is
latency (two sequential model calls instead of two concurrent ones per
dispatched domain); accepted because a pair is only dispatched when the
Life Master Agent decided a *recommendation* (not a pure lookup) is being
produced (§8, §9 below), which is exactly when verification quality matters
more than an extra round-trip.

**Two-level tool scoping, per agent, confirmed from
[03-system-architecture.md](03-system-architecture.md) §2.6**:

1. A **static per-agent tool ceiling** — the maximum set of Scoped Tools an
   agent could ever be configured with, fixed by this document (§4 tables
   below). This is what changing an agent's capabilities means in practice:
   editing its row in §4, not a runtime decision.
2. A **dynamic per-request allow-list** — the subset of that ceiling the
   Life Master Agent actually grants at dispatch time, chosen from which
   domains the intent-classification step decided are relevant ([03-system-architecture.md](03-system-architecture.md)
   §2.4, §4.4). A specialist dispatched for a narrow question gets fewer
   tools than its ceiling, never more.

Both levels are enforced; the ceiling bounds what configuration is even
possible, the per-request list bounds what a given invocation can attempt,
and the tool-provider-side authorization check (§6) re-verifies independent
of either — a compromised or misconfigured allow-list still hits that
third gate.

## 2. The agent output contract

Every specialist call and the Life Master Agent's own composed answer
return **exactly one shape**, matching [00-product-vision-master-prompt.md](00-product-vision-master-prompt.md)
§7–8 verbatim. This is the runtime/wire contract — what a subagent call
returns before persistence:

```typescript
interface AgentOutput {
  // the finding itself
  finding: string;
  evidence: Array<{ core_object_id: string; description: string }>;
  confidence: number;              // 0.0–1.0
  uncertainty: string[];
  recommendation: string | null;
  requires_human_review: boolean;
  requires_user_confirmation: boolean;

  // provenance metadata — vision §7-8, verbatim field list
  agent_version: string;
  model_version: string;
  prompt_version: string;
  data_timestamp: string;          // ISO 8601, oldest data point the finding depends on
  sources: string[];               // see §2.2 — derived, not separately authored
  tools_used: string[];

  // architecture additions, not in the vision's literal list, required by
  // the risk-tier gate (§6) and the disagreement rule (§8) to function:
  risk_tier: 0 | 1 | 2 | 3 | 4;
  disagrees_with_output_id: string | null;
}
```

### 2.1 Persistence mapping — where each field actually lives

[04-database-schema.md](04-database-schema.md) §5 splits this contract
across two tables (the `agent_outputs` row and its shared-PK `core_objects`
spine row, §2 of that document) — a detail worth stating explicitly because
naive code would look for `confidence` and `agent_version` as
`agent_outputs` columns and not find them there:

| Contract field | Persisted at | Why |
|---|---|---|
| `finding` | `agent_outputs.finding` | — |
| `evidence` | `agent_outputs.evidence` (JSONB) | heterogeneous by nature (§5 of the schema doc) |
| `confidence` | `core_objects.confidence` (shared PK) | every `core_objects` subtype gets this for free — no duplicate column |
| `uncertainty` | `agent_outputs.uncertainty` (`TEXT[]`) | — |
| `recommendation` | `agent_outputs.recommendation` (nullable) | — |
| `requires_human_review` | `agent_outputs.requires_human_review` | — |
| `requires_user_confirmation` | `agent_outputs.requires_user_confirmation` | — |
| `agent_version` | `core_objects.agent_version` (shared PK) | same spine inheritance as `confidence` |
| `model_version` | `agent_outputs.model_version` | — |
| `prompt_version` | `agent_outputs.prompt_version` | — |
| `data_timestamp` | `agent_outputs.data_timestamp` | — |
| `sources` | **not a stored column** — computed at read/serialization time | see §2.2 |
| `tools_used` | `agent_outputs.tools_used` (`TEXT[]`) | — |
| `risk_tier` | `agent_outputs.risk_tier` | — |
| `disagrees_with_output_id` | `agent_outputs.disagrees_with_output_id` | — |
| `epistemic_status` (not a contract field, but always attached) | `core_objects.epistemic_status` | always `ai_inference` or `recommendation`, never `fact` — enforced by the schema's own `chk_fact_not_ai_derived` constraint, §2 of that doc |

### 2.2 Resolving `sources[]` — a genuine gap between the vision's contract and the schema

The vision's literal field list includes `sources[]`, but
[04-database-schema.md](04-database-schema.md)'s `agent_outputs` table has
no `sources` column — only `evidence` (JSONB, `{core_object_id,
description}` pairs) and `agent_output_sources` (a strict join table, but
only for the one case of a Life Master Agent output aggregating *other
agent outputs*, per that doc's §5). Two options were possible: add a
redundant `sources TEXT[]` column that duplicates `evidence[].core_object_id`,
or compute it. **Decision: compute it, don't store it** — consistent with
this schema's existing pattern of refusing a second copy of derivable data
(the same reasoning that keeps "professional access" out of a dedicated
table, schema doc §1). Concretely, at serialization time:

```
sources[] = dedupe(
  evidence[].core_object_id
  ∪ (agent_output_sources rows where output_id = this output's id).source_output_id
)
```

For a specialist's own output, `sources` is just its evidence's core object
ids. For the Life Master Agent's composed answer, it additionally includes
every specialist output id that fed the composition — which is exactly the
provenance trail "every AI output traceable to... sources" ([00-product-vision-master-prompt.md](00-product-vision-master-prompt.md)
§45–46) needs, without a redundant column. This resolution is recorded here
because it's a real ambiguity between two already-written documents, not
invented scope — flagged again in §12.

## 3. Specialist roster

Ten domain pairs from [00-product-vision-master-prompt.md](00-product-vision-master-prompt.md)
§5–8, plus the Life Master Agent itself. `domain_key` is the token used
consistently below for scope names (`<domain_key>.read`, `.read_raw`,
`.write`) and for `core_objects`/`events`/`observations`.`domain` column
values.

| # | Domain | `domain_key` | Primary agent (`agent_name`) | Second agent (`agent_name`) | Sequential pair? |
|---|---|---|---|---|---|
| — | (orchestrator) | — | `life_master_agent` | — | — |
| 1 | Health | `health` | `health_analysis` | `health_safety` | Yes |
| 2 | Mental/Emotional | `mental_health` | `mental_context` | `clinical_safety_handoff` | Yes |
| 3 | Nutrition | `nutrition` | `nutrition_analysis` | `nutrition_planning` | Yes |
| 4 | Fitness | `fitness` | `fitness_performance` | `training_safety` | Yes |
| 5 | Learning | `learning` | `knowledge_agent` | `learning_strategy` | Yes |
| 6 | Productivity | `productivity` | `productivity_planning` | `focus_scheduling` | Yes |
| 7 | Finance | `finance` | `financial_analysis` | `financial_risk` | Yes |
| 8 | Social | `social` | `social_context` | `social_planning` | Yes |
| 9 | Travel | `travel` | `travel_research` | `travel_planning` | Yes |
| 10 | Career | `career` | `career_analysis` | `career_planning` | Yes |

**Input pattern, identical shape for every specialist invocation** (stated
once here, not repeated per domain below): (1) the orchestrator's
sub-task — the user's question rephrased and scoped to this domain, never
the full raw conversation history; (2) the domain-relevant slice of the
Life Master Agent's context snapshot (§5), passed down, never re-fetched;
(3) the dynamic tool allow-list for this invocation (§1); (4) **for the
second agent only** — the primary agent's complete `AgentOutput` (§2) as
additional input.

**Output pattern, identical for every specialist**: exactly one `AgentOutput`
(§2) per invocation. Persisted as an `agent_outputs` row (+ spine row) only
once the Life Master Agent finishes composing the final response — an
intermediate draft a specialist revises mid-reasoning before returning is
never separately persisted, only the value actually returned is.

**Permissions pattern**: the scopes listed per agent below are the *ceiling*
that domain could ever require — an individual request's actual authorized
scopes are whatever [04-database-schema.md](04-database-schema.md) §8.2's
`permission_grants` currently has active for that user, which can be
narrower (a user can hold `health.read` without ever having granted
`health.read_raw`). A tool call against a scope the user hasn't granted is
rejected at the authorization step (§6), not silently degraded.

### 3.1 Health — `health_analysis` / `health_safety`

**Responsibilities**: `health_analysis` reads vitals/sleep/lab trends and
produces the primary finding (e.g., "resting HR trending up over 2 weeks").
`health_safety` verifies against active symptoms, injury flags, and the
mutable `health_profile` (allergies, chronic conditions, current
medications) for contraindications or clinically-relevant context the
primary agent's pattern-read might miss, and is the only member of the pair
that can trigger a professional-review flag for a purely physical (non-
mental-health) concern.

**Domain-specific inputs beyond the generic pattern**: none — health
reasoning here is fully served by baselines, raw vitals/sleep, and the
`health_profile` summary.

**Domain-specific output notes**: a `health_safety` finding that
contradicts `health_analysis` sets `disagrees_with_output_id` (§8).
`requires_human_review = true` whenever a lab result carries
`abnormal_flag = true` or a symptom's `severity` crosses a threshold this
document does not fix (a product-tuning parameter, not an architecture
decision) — the flag itself, and that it can never be silently cleared, is
what's fixed here.

**Permissions**: `health.read`, `health.read_raw`.

**Tools**:

| Tool | Signature | Data class | Risk tier | Backing table(s) | Callable by |
|---|---|---|---|---|---|
| `get_sleep_baseline_deviation` | `(user_id, window_days)` | derived | 0 | `baselines` (`domain='health', metric='sleep_duration'`) | both |
| `get_vital_baseline_deviation` | `(user_id, vital_type, window_days)` | derived | 0 | `baselines` (`domain='health', metric=vital_type`) | both |
| `get_recent_sleep_raw` | `(user_id, nights ≤ N)` | raw | 0 (read, logged) | `observation_sleep` ⋈ `observations` | both (matches [03-system-architecture.md](03-system-architecture.md) §2.7's tool table literally) |
| `get_recent_vitals_raw` | `(user_id, vital_type, days ≤ N)` | raw | 0 (read, logged) | `observation_vital` ⋈ `observations` | both |
| `get_active_symptom_flags` | `(user_id)` | derived | 0 | `observation_symptom` (recent, unresolved) | both |
| `get_lab_result_summary` | `(user_id, test_name?)` | derived | 0 | `observation_lab_result` (abnormal-flag counts/trend, no raw values) | both |
| `get_recent_lab_results_raw` | `(user_id, test_name?, results ≤ N)` | raw | 0 (read, logged) | `observation_lab_result` | `health_safety` only |
| `get_health_profile_summary` | `(user_id)` | derived† | 0 | `health_profile` | both |

† `health_profile` is itself a curated summary (allergies, conditions,
current medications by name), not a raw clinical record — see
[04-database-schema.md](04-database-schema.md) §3.3 — so there is no
separate "raw" variant of this tool.

**Escalation**: `requires_human_review` on this pair routes to the user's
own follow-up-with-a-clinician prompt in the UI, **not** to
`clinical_safety_handoff`'s professional-share machinery (§3.2, §10) —
that machinery is specific to mental/behavioral-health disclosure per
vision §16; a physical-health finding needing professional attention is
surfaced to the user as a recommendation to see a doctor, never as an
autonomous share.

### 3.2 Mental/Emotional — `mental_context` / `clinical_safety_handoff`

**Responsibilities**: `mental_context` reads mood/stress/journal signals
and produces the primary read (pattern, trend, or direct answer).
`clinical_safety_handoff` is the pair's crisis-detection and
professional-disclosure gate — it never originates a primary finding, only
verifies `mental_context`'s read against clinical risk signals and, when
warranted, drafts and (only after explicit confirmation) shares a
professional report. This is the pair vision §16 specifically constrains:
plos "may analyze, organize, summarize, and structure information into a
draft report for review by a licensed professional" and "must never
autonomously diagnose, prescribe, change medication, replace therapy, or
make emergency clinical decisions."

**Domain-specific output notes**: `clinical_safety_handoff` sets
`requires_human_review = true` on any crisis-risk signal, unconditionally —
this is the one place in the whole roster where the second agent's
judgment is never treated as advisory-only; a crisis flag is never
downgraded by the Life Master Agent's composition step (§9).

**Permissions**: `mental_health.read`, `mental_health.read_raw`,
`professional.share` (the exact scope name given as an example in vision
§15, reused here rather than inventing a new one).

**Tools**:

| Tool | Signature | Data class | Risk tier | Backing table(s) | Callable by |
|---|---|---|---|---|---|
| `get_mood_stress_baseline_deviation` | `(user_id, window_days)` | derived | 0 | `baselines` (`domain='mental_health', metric ∈ {mood_score, stress_score, energy_score}`) | both |
| `get_recent_journal_summary` | `(user_id, days)` | derived | 0 | `observation_journal_entry` aggregated (tag frequencies, mean scores — no entry text) | both |
| `get_recent_journal_raw` | `(user_id, entries ≤ N)` | raw | 0 (read, logged) | `observation_journal_entry` ⋈ `observations` | both — logged whether or not this is the tool that actually answers the question, mirroring the health-raw pattern |
| `get_clinical_memory_flags` | `(user_id)` | derived, restricted | 0 | `clinical_memories` (active, `visibility` and `status` only — not `statement` text) | `clinical_safety_handoff` only |
| `check_crisis_risk_signals` | `(user_id)` | derived | 0 | composite read over `observation_journal_entry`, `observation_symptom`, `clinical_memories` flags | `clinical_safety_handoff` only |
| `draft_professional_report` | `(user_id, focus_domain)` | write (user-visible only) | 1 | `documents` (`document_type='professional_report'`, `visibility` not yet shared) | `clinical_safety_handoff` only |
| `share_professional_report` | `(document_id, professional_id)` | write | **3** | `permission_grants` (`grantee_type='professional', scope='professional.share'`) + `clinical_memories.shared_via_grant_id` | `clinical_safety_handoff` only, explicit confirmation + reauthentication required |

`draft_professional_report` is Tier 1, not Tier 0, because it writes a new
`documents` row (a real side effect the user should be able to see/delete),
even though nothing leaves the system yet. `share_professional_report` is
the pair's one Tier 3 action — the strategy doc names "professional
disclosures" as its literal Tier 3 example — and per
[03-system-architecture.md](03-system-architecture.md) §2.7's write-tool
rule, the server never executes it on a client "confirm" claim alone; it
re-checks a server-side confirmation token plus the reauthentication step
vision §12 requires for sensitive operations.

**Escalation**: this is the pair the vision's professional-handoff
non-negotiable (§16) is actually implemented by. A crisis signal from
`check_crisis_risk_signals` produces `requires_human_review = true` and a
`recommendation` directing the user toward professional/emergency
resources; it never triggers `share_professional_report` automatically —
sharing is always a separate, explicitly user-confirmed Tier 3 act, even
in a crisis (plos has no emergency-services integration in this
architecture; that would be a distinct, unbuilt capability, not implied by
this document).

### 3.3 Nutrition — `nutrition_analysis` / `nutrition_planning`

**Responsibilities**: `nutrition_analysis` reads macro/calorie logs against
baseline and goals. `nutrition_planning` offers forward-looking
suggestions (meal timing, macro targets) — it is a planning read, not a
safety check, matching vision §5–8's note that the second agent isn't
always a safety agent; here it's the "offers an alternative
interpretation"/planning variant.

**Permissions**: `nutrition.read`, `nutrition.read_raw`.

**Tools**:

| Tool | Signature | Data class | Risk tier | Backing table(s) | Callable by |
|---|---|---|---|---|---|
| `get_nutrition_baseline_deviation` | `(user_id, window_days)` | derived | 0 | `baselines` (`domain='nutrition', metric ∈ {calories, protein_g, ...}`) | both |
| `get_recent_nutrition_summary` | `(user_id, days)` | derived | 0 | `observation_nutrition_log` aggregated | both |
| `get_recent_nutrition_log_raw` | `(user_id, days ≤ N)` | raw | 0 (read, logged) | `observation_nutrition_log` ⋈ `nutrition_log_item` | `nutrition_analysis` only |

No write tool exists for this pair — no Scoped Tool logs a meal on the
agent's behalf; meal logging is a direct user action in the app, matching
the same "no tool exists" pattern used for Tier 4 actions elsewhere,
applied here simply because there is no agent-initiated write use case,
not because of a risk-tier restriction.

### 3.4 Fitness — `fitness_performance` / `training_safety`

**Responsibilities and tools**: as fixed by
[03-system-architecture.md](03-system-architecture.md) §2.7's worked
example, extended here with the raw session-detail tool and the write
tool's full contract.

**Permissions**: `fitness.read`, `fitness.read_raw`, `fitness.write`.

**Tools**:

| Tool | Signature | Data class | Risk tier | Backing table(s) | Callable by |
|---|---|---|---|---|---|
| `get_training_load_baseline` | `(user_id)` | derived | 0 | `baselines` (`domain='fitness', metric='training_load'`) | both (system arch §2.7, literal) |
| `get_recent_training_summary` | `(user_id, sessions ≤ N)` | derived | 0 | `event_fitness_session` ⋈ `events` | both |
| `get_recent_training_raw` | `(user_id, session_id)` | raw | 0 (read, logged) | `fitness_session_set` | both |
| `get_active_injury_flags` | `(user_id)` | derived† | 0 | `observation_injury_flag` (`active=true`) | `training_safety` only (system arch §2.7, literal) |
| `cancel_scheduled_workout` | `(session_id)` | write | 2 | `actions` (`action_type='workout_cancellation'`) + `events.status='cancelled'` | `fitness_performance`, after explicit confirmation (system arch §2.7, literal) |

† `flagged_by` on `observation_injury_flag` is constrained to
`('user','clinician')` — [04-database-schema.md](04-database-schema.md)
§3.3 — with no `'agent'` value. This is a schema-level guarantee, not just
a tool-registration choice: **no Scoped Tool exists, or could be added
without a schema migration, that lets any agent write an injury flag.**
`training_safety` can only ever read this table.

### 3.5 Learning — `knowledge_agent` / `learning_strategy`

**Responsibilities**: `knowledge_agent` reads progress/scores/knowledge-gap
tags. `learning_strategy` reframes toward study-approach recommendations
(spacing, sequencing) — again the planning-variant second agent, not a
safety check.

**Permissions**: `learning.read`, `learning.read_raw`.

**Tools**:

| Tool | Signature | Data class | Risk tier | Backing table(s) | Callable by |
|---|---|---|---|---|---|
| `get_learning_progress_summary` | `(user_id, subject?)` | derived | 0 | `event_learning_session` ⋈ `events`, aggregated (`score`, `knowledge_gap_tags`) | both |
| `get_knowledge_gap_tags` | `(user_id, subject?)` | derived | 0 | `event_learning_session.knowledge_gap_tags` | both |
| `get_recent_learning_sessions_raw` | `(user_id, sessions ≤ N)` | raw | 0 (read, logged) | `event_learning_session` ⋈ `events` | `knowledge_agent` only |

No write tool — scheduling a study block is a Productivity-domain write
(`move_calendar_event`/task creation, §3.6); `learning_strategy` proposes,
it does not itself hold a calendar-write tool, keeping one write path per
resource instead of two domains both able to write `event_calendar_item`.

### 3.6 Productivity — `productivity_planning` / `focus_scheduling`

**Responsibilities**: `productivity_planning` reads workload (tasks, goal
linkage) and produces planning-level findings. `focus_scheduling` is the
one with calendar-write access and the raw-calendar-detail tool, matching
[03-system-architecture.md](03-system-architecture.md) §4.6's worked
example exactly (`get_calendar_density_tomorrow` for both, but only
Focus/Scheduling dispatched alone for a pure scheduling question).

**Backing-table decision** ([04-database-schema.md](04-database-schema.md)
§14 left this open): `get_calendar_density_tomorrow` reads a **`baselines`
row** (`domain='productivity', metric='calendar_density_next_day'`,
`mean`/`stddev` NULL per that doc's own note on non-statistical derived
flags), recomputed daily by the `worker` task — not a live query against
`event_calendar_item`. This keeps the tool on the same precomputed-context
path as every other Tier 0 derived read (matching the latency principle in
[00-strategy-moat-and-hazards.md](00-strategy-moat-and-hazards.md)) and
means neither `focus_scheduling` nor the Life Master Agent's context
snapshot ever needs raw calendar access just to answer "is tomorrow busy."

**Permissions**: `productivity.read`, `productivity.read_raw`,
`productivity.write`.

**Tools**:

| Tool | Signature | Data class | Risk tier | Backing table(s) | Callable by |
|---|---|---|---|---|---|
| `get_calendar_density_tomorrow` | `(user_id)` | derived | 0 | `baselines` (`domain='productivity', metric='calendar_density_next_day'`) | both, and the Life Master Agent's context snapshot (system arch §2.4, §4.5) |
| `get_task_workload_summary` | `(user_id)` | derived | 0 | `event_task` ⋈ `events`, aggregated (open/overdue counts, priority mix) | both |
| `get_recent_tasks_raw` | `(user_id, tasks ≤ N)` | raw | 0 (read, logged) | `event_task` ⋈ `events` | `productivity_planning` only |
| `get_calendar_raw` | `(user_id, days ≤ N)` | raw | 0 (read, logged) | `event_calendar_item` ⋈ `events` ⋈ `event_participants` | `focus_scheduling` only — event titles/attendee detail; per system arch §4.5, this is deliberately the *last resort*, not the default path to "is tomorrow busy" |
| `move_calendar_event` | `(event_id, new_time)` | write | 1 | `actions` (`action_type='calendar_change'`) + `event_calendar_item`/`events` | `focus_scheduling`, confirmation optional depending on surface (system arch §2.7, literal) |

### 3.7 Finance — `financial_analysis` / `financial_risk`

**Responsibilities**: `financial_analysis` reads spend/net-worth trends
against baseline. `financial_risk` verifies against account-level risk
tolerance and flags anomalous transactions — the pair most directly
governed by the Tier 4 "no tool exists" rule.

**Permissions**: `finance.read`, `finance.read_raw`. (`finance.execute` —
the scope name vision §15 gives as its own example — exists in the
`permission_scopes` catalog per [04-database-schema.md](04-database-schema.md)
§8.1 but **no Scoped Tool anywhere in this roster requires it**; it is
reserved for a future, explicitly out-of-scope capability, never assigned
to `financial_analysis` or `financial_risk`.)

**Tools**:

| Tool | Signature | Data class | Risk tier | Backing table(s) | Callable by |
|---|---|---|---|---|---|
| `get_spend_baseline_deviation` | `(user_id, window_days)` | derived | 0 | `baselines` (`domain='finance', metric='spend_rate'`) | both |
| `get_financial_snapshot_summary` | `(user_id)` | derived | 0 | `observation_financial_snapshot`, trend over time | both |
| `get_financial_accounts_summary` | `(user_id)` | derived | 0 | `financial_accounts` (balances, `risk_tolerance`, not transaction detail) | both |
| `get_recent_transactions_raw` | `(user_id, days ≤ N, category?)` | raw | 0 (read, logged) | `action_financial_transaction` ⋈ `actions` | both |

**No write tool exists for this pair, at any tier** — matching
[03-system-architecture.md](03-system-architecture.md) §2.7's explicit
Finance row (`*(no tool exists)* | Finance | — | 4 | nobody`). This is the
literal enforcement of vision non-negotiable #12 ("AI never autonomously
executes Tier 3/4 actions — finance...") and the strategy doc's Tier 4
definition: money movement is never reachable through any agent, regardless
of confidence, confirmation, or user request phrasing.

**Known gap, not resolved here**: neither this document's tools nor
[04-database-schema.md](04-database-schema.md) model investment holdings or
asset allocation — only point-in-time balance snapshots
(`observation_financial_snapshot`) and account-level `risk_tolerance`
metadata. `financial_risk`'s ability to check allocation-vs-risk-tolerance
is therefore bounded by what the schema actually stores; a real
holdings/positions table would be a schema addendum, not something this
document can retrofit a tool onto. Flagged again in §12.

### 3.8 Social — `social_context` / `social_planning`

**Responsibilities**: `social_context` reads the relationship graph and
recent social activity. `social_planning` is the planning-variant second
agent (suggests when/how to reconnect, weighs a social opportunity against
routine — the exact "value a rare family trip over training-schedule
adherence" example from vision §34–41 is a Social-vs-Fitness cross-domain
case, handled at the Life Master Agent level, §9).

**Permissions**: `social.read`, `social.read_raw`.

**Tools**:

| Tool | Signature | Data class | Risk tier | Backing table(s) | Callable by |
|---|---|---|---|---|---|
| `get_relationship_summary` | `(user_id, entity_id?)` | derived | 0 | `relationships` (`relationship_class='social'`) ⋈ `entity_person_detail` | both |
| `get_recent_social_activity_summary` | `(user_id, days)` | derived | 0 | `event_social_activity` ⋈ `events` ⋈ `event_participants`, aggregated | both |
| `get_recent_social_activity_raw` | `(user_id, events ≤ N)` | raw | 0 (read, logged) | `event_social_activity` ⋈ `events` ⋈ `event_participants` | `social_context` only |
| `get_important_dates` | `(user_id)` | derived | 0 | `entity_person_detail.birthday` (not `is_emergency_contact`/`contact_channel_ref` — those are account-safety fields this tool never surfaces) | both |

No write tool — a social plan is a recommendation the user acts on
themselves (potentially via `move_calendar_event`, which lives with
Productivity, §3.6), not a direct write this pair holds.

### 3.9 Travel — `travel_research` / `travel_planning`

**Responsibilities**: `travel_research` reads trip history and, critically,
the **relational preference memory** the strategy doc's Identity Graph
section specifically illustrates with a travel example
([00-strategy-moat-and-hazards.md](00-strategy-moat-and-hazards.md), "Memory
must be relational, not just factual"). `travel_planning` turns that into
forward-looking suggestions.

**Permissions**: `travel.read`, `travel.read_raw`.

**Tools**:

| Tool | Signature | Data class | Risk tier | Backing table(s) | Callable by |
|---|---|---|---|---|---|
| `get_travel_history_summary` | `(user_id)` | derived | 0 | `event_travel_trip` ⋈ `events`, aggregated | both |
| `get_travel_preferences` | `(user_id, destination_entity_id?)` | derived | 0 | `memories` (`memory_class='preference'`, `subject_core_object_id`= a `place` entity) ⋈ `memory_reasons` — the exact worked example from [04-database-schema.md](04-database-schema.md) §4.1 | both |
| `get_recent_trip_raw` | `(user_id, trip_id)` | raw | 0 (read, logged) | `event_travel_trip` ⋈ `events` | `travel_research` only |

No write/booking tool exists. Booking would be a Tier 3 action at minimum
(financial cost, third-party commitment) and, per vision §17–20, would
require a legitimate provider adapter that doesn't exist in this
architecture yet — not modeled as a Scoped Tool until one does, same "no
tool exists" discipline as Finance.

### 3.10 Career — `career_analysis` / `career_planning`

**Responsibilities**: `career_analysis` reads milestone history and skill
inventory. `career_planning` is the planning-variant second agent
(development suggestions against stated career goals).

**Permissions**: `career.read`, `career.read_raw`.

**Tools**:

| Tool | Signature | Data class | Risk tier | Backing table(s) | Callable by |
|---|---|---|---|---|---|
| `get_career_milestone_summary` | `(user_id)` | derived | 0 | `event_career_milestone` ⋈ `events` | both |
| `get_skill_inventory` | `(user_id)` | derived | 0 | `entities` (`entity_type='skill'`) | both |
| `get_recent_career_events_raw` | `(user_id, events ≤ N)` | raw | 0 (read, logged) | `event_career_milestone` ⋈ `events` | `career_analysis` only |

No write tool — a promotion, project, or certification is recorded by the
user (or an integration), never by an agent.

## 4. Common tools (shared across the roster, defined once)

Several tools are identical in shape across every domain and are defined
once here rather than repeated ten times in §3. Each specialist's
per-request allow-list includes the instance scoped to *its own* domain
only — a specialist cannot request another domain's goals or memories
through these; the `domain` argument is validated server-side against the
calling agent's registered `domain_key` (§6), not trusted from the
argument alone.

| Tool | Signature | Data class | Risk tier | Backing table(s) | Callable by |
|---|---|---|---|---|---|
| `get_domain_goals` | `(user_id, domain)` | derived | 0 | `goals` (+ `goal_habit_detail` for habit-type goals) filtered to the caller's own `domain_key` | every specialist, own domain only |
| `get_domain_memory_digest` | `(user_id, domain)` | derived | 0 | `memories` ⋈ `memory_reasons`, filtered by joining `subject_core_object_id` to a core object whose `domain` matches the caller's own | every specialist, own domain only |
| `get_domain_recent_outcomes` | `(user_id, domain)` | derived | 0 | `outcomes` ⋈ `actions`/`decisions`, filtered to the caller's own `domain_key` | every specialist, own domain only |

`get_domain_memory_digest` is how the strategy doc's Identity Graph
requirement (structured reasons, not a bare "likes X") reaches every
domain, not just Travel — Nutrition can pull "prefers high-protein
breakfasts because of afternoon energy crashes," Career can pull "declined
the last relocation offer because of family constraints," using the exact
same `memories`/`memory_reasons` shape.

## 5. The Life Master Agent's own tools

The orchestrator never calls a domain Scoped Tool directly (§2.4 of
[03-system-architecture.md](03-system-architecture.md), reaffirmed here) —
its only tool is the context-snapshot read.

| Tool | Signature | Data class | Risk tier | Backing table(s) | Notes |
|---|---|---|---|---|---|
| `get_context_snapshot` | `(user_id, domains: domain_key[])` | derived | 0 | `baselines`, `timeline_entries`, plus a cross-domain `memories` digest, all filtered to the requested `domains` | Callable only by `life_master_agent` |

`get_context_snapshot` fans out, per requested domain, to that domain's own
`<domain_key>.read` scope check (§6) — it is not a scope-bypass. A domain
the current `permission_grants` set doesn't authorize is simply omitted
from the returned snapshot and logged as an omission; this is ordinary
least-privilege filtering, not the "never silently resolve" rule (§8) — that
rule is about disagreement between findings, not about which domains a
user has granted access to.

## 6. The risk-tier gate: tool contract shape and the enforced chain

Every tool above, without exception, declares the same contract shape,
matching [03-system-architecture.md](03-system-architecture.md) §2.7 and
[00-strategy-moat-and-hazards.md](00-strategy-moat-and-hazards.md)'s
risk-tier model, made concrete as TypeScript (ADR D2: NestJS/TypeScript):

```typescript
interface ScopedToolContract<Args, Result> {
  name: string;
  domain: DomainKey;
  dataClass: 'derived' | 'raw' | 'write';
  riskTier: 0 | 1 | 2 | 3 | 4;
  requiredScope: string;            // a permission_scopes.scope value
  callableBy: AgentName[];          // static ceiling, §1/§3-5
  validate(args: unknown): Args;    // schema-checked, independent of any LLM output trust
  requiresConfirmation(args: Args): boolean;  // false for riskTier 0; true for riskTier ≥ 2; surface-dependent for riskTier 1
  execute(ctx: RequestContext, args: Args): Promise<Result>;
}
```

**The chain every call runs, in order** (verbatim mechanism, per
[00-strategy-moat-and-hazards.md](00-strategy-moat-and-hazards.md)'s
"Agent → Scoped tool → Authorization check → Validation → Risk-tier check →
Confirmation if required → Execution → Audit"):

1. **Agent** emits a tool call. This is a request, not a capability — the
   subagent's SDK-level allow-list (§1) is the first filter, but is
   advisory from the server's point of view (a prompt-injected or
   misbehaving subagent could still *attempt* an out-of-allow-list call).
2. **Scoped tool** receives the call as a NestJS provider method — never
   raw SQL reachable from agent code (system arch §2.7).
3. **Authorization**: `ctx.scopes` (from `RequestContext`, resolved
   server-side from the verified session — never client-supplied, system
   arch §2.3) must include the tool's `requiredScope`; `ctx.professional_id`
   is checked instead of/alongside `ctx.user_id` when the caller is a
   `PROFESSIONAL`-role request against `clinical_memories` (§6.1 below
   resolves this). Failure → `403`, audited as `result='denied'`, nothing
   further runs.
4. **Validation**: `args` schema-checked (independent of the SDK's own
   type system, per ADR D3) before touching any repository — malformed or
   out-of-range arguments (e.g., a negative `window_days`) never reach a
   query.
5. **Risk-tier check**: the tool's declared `riskTier` is compared against
   the **scope's own ceiling** — `permission_scopes.risk_tier`
   ([04-database-schema.md](04-database-schema.md) §8.1). **New rule this
   document adds**: a tool's `riskTier` must be ≤ its `requiredScope`'s
   catalog `risk_tier`, asserted once at tool-registry startup, not
   per-call (both are static configuration, so a per-call check would be
   redundant) — this is what stops a future tool from being wired to an
   under-scoped permission by mistake; it is a build-time guarantee, not a
   runtime one. For Tier 4: **no tool is ever registered at that tier**
   (§3.4, §3.7) — the check exists for tiers 0–3 only, because a Tier 4
   row would fail registration outright.
6. **Confirmation if required**: `requiresConfirmation(args)` — always
   `false` at Tier 0; surface-dependent at Tier 1 (`move_calendar_event`);
   always `true` at Tier 2+ (`cancel_scheduled_workout`,
   `share_professional_report`). The server re-validates a returned
   confirmation token server-side; a client UI having *shown* a confirm
   dialog is never itself sufficient (system arch §2.7, reaffirmed). Tier 3
   additionally requires the reauthentication step vision §12 mandates for
   sensitive operations — a fresh credential/passkey assertion, not merely
   the existing session's access token.
7. **Execution**: a parameterized, `user_id`-scoped query/write against RDS
   Postgres, under the RLS session variable already set for this request
   ([04-database-schema.md](04-database-schema.md) §10.1).
8. **Audit**: one `audit_log` row — tool name, `args_hash` (never raw args),
   `user_id`, calling `agent_name`, `risk_tier`, `result` — regardless of
   outcome, including denials (system arch §7, schema §11).

### 6.1 Resolving the `RequestContext` professional-identity gap

[04-database-schema.md](04-database-schema.md) §14 flagged that its
`clinical_memories` shared-access RLS policy needs
`app.current_professional_id`, but
[03-system-architecture.md](03-system-architecture.md) §2.3's
`RequestContext {user_id, scopes, session_id, entitlement_tier}` has no such
field. **Decision (Phase 0-D closes this)**: a professional authenticates
as an ordinary `users` row holding the `PROFESSIONAL` role
([04-database-schema.md](04-database-schema.md) §7.1), acting on a
*different* user's data — not a structurally separate principal type.
`RequestContext` is extended to:

```typescript
interface RequestContext {
  user_id: string;
  scopes: string[];
  session_id: string;
  entitlement_tier: string;
  professional_id?: string;   // set only when the authenticated account holds
                               // PROFESSIONAL role and is viewing another
                               // user's shared clinical content; resolved
                               // server-side from professionals.user_id,
                               // never client-supplied
}
```

`professional_id` present ⇒ AuthGuard additionally sets
`SET LOCAL app.current_professional_id` for that transaction, activating
the `clinical_memories_shared_professional` policy
([04-database-schema.md](04-database-schema.md) §10.3). `user_id` in this
case is the *patient's* id (whose data is being read), resolved from the
request path/grant, not from the professional's own account row — the
same "never trust a client-supplied `user_id`" rule applies to which
patient a professional is requesting, re-verified against an active
`permission_grants` row every time, not cached.

## 7. Compartmentalization: derived-vs-raw defaults, per agent

[03-system-architecture.md](03-system-architecture.md) §3 states this at
the component level (Life Master Agent: derived by default; Specialist
Agents: raw only within their own domain when genuinely necessary). This
section makes it a concrete per-agent grant list, extending that table:

| Agent | Raw-tool access | One-line rationale |
|---|---|---|
| `life_master_agent` | **None, ever** | Only tool is `get_context_snapshot` (§5); structurally cannot call a raw domain tool — this is what bounds blast radius for a compromised orchestrator context (strategy doc hazard register) |
| `health_analysis`, `health_safety` | `get_recent_sleep_raw`, `get_recent_vitals_raw` (both); `get_recent_lab_results_raw` (`health_safety` only) | Both need raw vitals/sleep for their own analysis/verification job; lab raw is restricted to the verification agent since it's the more clinically sensitive read |
| `mental_context`, `clinical_safety_handoff` | `get_recent_journal_raw` (both); `get_clinical_memory_flags`, `check_crisis_risk_signals` (`clinical_safety_handoff` only) | Both need raw journal text to do their job at all — this is the pair the strategy doc's "400 raw journal entries" example is about, and it is about keeping that raw text **away from the Life Master Agent**, not away from `mental_context` itself |
| `nutrition_analysis` only | `get_recent_nutrition_log_raw` | Planning doesn't need per-item raw; analysis does |
| `fitness_performance`, `training_safety` | `get_recent_training_raw` (both); `get_active_injury_flags` (`training_safety` only) | Both need set-level detail; injury-flag read is restricted to the safety agent per system arch §2.7 literally |
| `knowledge_agent` only | `get_recent_learning_sessions_raw` | Strategy agent works from the progress summary |
| `focus_scheduling` only | `get_calendar_raw` | Productivity Planning needs workload counts, not attendee-level detail — matches the worked example's explicit "attendee detail isn't needed" (system arch §4.5) |
| `productivity_planning` only | `get_recent_tasks_raw` | Needs actual task titles/due dates to plan around; Focus/Scheduling doesn't |
| `financial_analysis`, `financial_risk` | `get_recent_transactions_raw` (both) | Risk verification specifically needs to see the anomalous transaction, not just its aggregate signature |
| `social_context` only | `get_recent_social_activity_raw` | Planning works from the relationship graph + summary |
| `travel_research` only | `get_recent_trip_raw` | Planning works from history summary + preference memory |
| `career_analysis` only | `get_recent_career_events_raw` | Planning works from milestone summary + goals |

**Cross-domain rule, reaffirmed**: none of the above ever hands its raw
data to a *different* domain's pair through the Life Master Agent — if
Nutrition needs to know sleep was poor, it receives the derived baseline
deviation `health_analysis`/the Context Engine already computed, exactly
as [03-system-architecture.md](03-system-architecture.md) §3 states for the
Fitness/Health case. The device-level raw compartment
([03-system-architecture.md](03-system-architecture.md) §2.1: HealthKit
data is rawest on-device, pre-upload) is unaffected by anything in this
document — it's a client-side surface Phase 0-F owns.

## 8. Disagreement detection

Per-domain pair disagreement (§3's sequential dispatch, §1) is checked two
ways, not one — a single mechanism risks either false negatives (a
specialist that doesn't self-report) or false positives (a naive text diff):

1. **Self-declared**: the second agent in a pair is explicitly instructed,
   as part of its prompt, to compare its own conclusion to the primary
   agent's `AgentOutput` it received as input (§1), and to set
   `disagrees_with_output_id` to the primary's output id whenever its
   `finding` or `recommendation` differs materially, with the disagreement
   itself explained in its own `evidence[]`. This is the mechanism the
   `agent_outputs.disagrees_with_output_id` column
   ([04-database-schema.md](04-database-schema.md) §5) exists to store.
2. **Orchestrator backstop**: independent of self-declaration, the Life
   Master Agent runs one additional fast model call (same cheap-model
   routing principle as intent classification, system arch §4.4 / §7)
   after collecting a pair's two outputs, comparing structural signals a
   specialist might fail to self-report: a mismatch in `requires_human_review`,
   a `risk_tier` delta between the two outputs, or a primary
   `recommendation` the second agent's own `finding` contradicts without
   having set the pointer. If this backstop finds a mismatch the primary
   output's own self-declaration missed, the orchestrator sets
   `disagrees_with_output_id` itself (backdated to the pair, with a note
   that it was orchestrator-detected, not self-declared) rather than
   silently trusting the specialist's own report.
3. **Cross-pair (cross-domain) disagreement** — e.g., Fitness Performance's
   raw training-load reading says "train as planned" while a different
   domain's recommendation implicitly conflicts (a Social Planning
   suggestion for the same evening) — is not caught by either mechanism
   above, since it isn't within one pair. The same backstop model call is
   extended to compare `recommendation` fields **across all dispatched
   outputs for this request**, not just within pairs, when more than one
   domain was dispatched (system arch §4.4's multi-domain classification
   makes this the common case for anything beyond a pure lookup).

**Surfacing rule, absolute**: whenever any disagreement is detected by
either mechanism, the Life Master Agent's composed answer **must present
both readings with their respective evidence** — it never picks the
primary agent's reading by default ordering, and it never silently drops
the dissenting output from `sources[]` (§2.2). This is the literal
mechanism behind the CLAUDE.md non-negotiable "agent disagreement is
surfaced, never silently resolved" and vision §57's identical rule.

## 9. Conflict resolution and response composition

Detecting disagreement (§8) is not the same as deciding what to say —
composition follows a fixed priority, never an implicit "first agent
wins":

1. **Within a pair**: the safety/verification agent's signal is weighted
   into the composed framing (matching
   [03-system-architecture.md](03-system-architecture.md) §4.9's worked
   example — Training Safety's fatigue-risk read shapes the final
   recommendation even though Fitness Performance's raw reading alone
   would say "train as planned") — but the primary agent's reading is
   still stated, with its evidence, not erased. "Weighted into the
   framing" means the recommendation reflects the safety read; it does not
   mean the primary agent's output is omitted from `sources[]`.
2. **Across domains, no resource conflict** (e.g., Health flags poor sleep,
   Productivity flags a busy tomorrow — both bear on the same
   recommendation, not opposed to each other): compose one answer citing
   both, as in the worked example.
3. **Across domains, genuine resource/goal conflict** (e.g., Fitness says
   train tonight, Social flags a family event the same evening): this is
   not resolved by picking a "more important" domain by fixed rule — vision
   §34–41 explicitly requires weighing routine vs. flexibility per the
   user's own goals, and the strategy doc's Personal Constitution concept
   (a user-authored priority/constraint record) is the intended tiebreak
   input. **The Personal Constitution is not yet built** — it's named in
   the strategy doc as a supporting subsystem, not committed to by the ADR
   or system architecture. Until it exists, this document's rule is:
   **the Life Master Agent never silently picks a side of a genuine
   cross-domain resource conflict** — it presents the trade-off explicitly
   ("training tonight conflicts with [event]; here's what's true about
   each") and lets the user decide, which is also just vision §54's
   `CONFIRM` step in the core loop applied to a decision rather than an
   action.
4. **Risk-tier of the composed answer itself**: displaying any
   recommendation, however composed, is Tier 0 (informational) — no
   autonomous action occurs by producing an answer. The response's `risk_tier`
   field (§2) reflects the *highest-tier tool a follow-up action would
   invoke* if the user acts on it (e.g., a recommendation whose acceptance
   would call `cancel_scheduled_workout` carries `risk_tier=2` on the
   `agent_outputs` row even though producing the recommendation itself
   executed nothing) — this lets the client render the right level of
   "are you sure" affordance before the user even taps to confirm.

## 10. Escalation paths

Three distinct escalation mechanisms exist in this architecture; conflating
them is a real risk worth naming explicitly:

| Mechanism | Trigger | What happens | Who can clear it |
|---|---|---|---|
| **`requires_human_review`** (contract field, §2) | Any specialist judges the finding needs review beyond what plos itself should conclude (abnormal lab value, crisis signal, high-uncertainty finding) | Surfaced to the user as-is; never silently cleared or downgraded by the Life Master Agent's composition step (§9) | Only ever "cleared" by the fact resolving itself in later data (e.g., a follow-up lab result), never by agent override |
| **`requires_user_confirmation`** (contract field, §2) + tool-level **confirmation gate** (§6, step 6) | Any Tier 1+ tool call the recommendation implies | Client renders a confirm affordance; server re-validates a confirmation token before executing | The user, by confirming or declining |
| **Professional handoff** (§3.2 only) | `check_crisis_risk_signals` or a clinician-relevant finding, via `draft_professional_report` → `share_professional_report` | A draft is composed (Tier 1); sharing requires separate explicit confirmation + reauthentication (Tier 3) | The user; a professional can never pull a report without an active `permission_grants` row the user granted |

No mechanism above ever escalates to an autonomous action — escalation in
this architecture always means "surface more clearly to a human," never
"the system acts with less oversight." This matches vision non-negotiable
"AI never replaces a licensed professional" and "no silent autonomous
sensitive actions" directly.

## 11. MVP dispatch scope — a flag for Phase 0-G, not a decision made here

[00-product-vision-master-prompt.md](00-product-vision-master-prompt.md)
§52 names the MVP agent set as "Life Master Agent + Health specialist +
Fitness specialist + Journal/context specialist + safety/verification
layer" — three specialists plus their safety layer, not all ten pairs.
Mapping that onto this document's roster: Health (`health_analysis` /
`health_safety`, §3.1) and Fitness (`fitness_performance` /
`training_safety`, §3.4) map directly. "Journal/context specialist" maps
most closely to `mental_context` (§3.2) operating without its pair-mate's
full clinical-handoff machinery — but the vision doc doesn't say whether
MVP ships `mental_context` alone (no `clinical_safety_handoff` dispatch at
all) or the full pair with `share_professional_report` simply unused in
practice. **This document does not resolve that** — it's a scope decision
for Phase 0-G (MVP definition), not an architecture decision; the other
seven pairs (§3.3, §3.5–§3.10) are fully specified here so that whichever
MVP boundary Phase 0-G draws, the agent contracts and tool grounding
already exist rather than being designed under deadline pressure later.

## 12. Open questions / inconsistencies vs. the ADR and database schema

- **`sources[]` has no dedicated column** (§2.2) — resolved here as a
  computed field (`evidence[].core_object_id` ∪ `agent_output_sources`),
  not a schema gap requiring a migration, but worth a human confirming
  this reading matches intent before the API layer is built against it.
- **Sequential (not parallel) pair dispatch** (§1) is a new decision this
  document makes that neither the ADR nor the system architecture
  specified — flagged for a human to confirm, since it's a real latency
  trade-off (two sequential model calls per dispatched pair instead of
  two concurrent ones).
- **`RequestContext.professional_id`** (§6.1) closes the gap
  [04-database-schema.md](04-database-schema.md) §14 flagged, by deciding
  professionals authenticate as `users` rows with `PROFESSIONAL` role
  acting on another user's data. This is a decision, not just a flag, but
  it changes [03-system-architecture.md](03-system-architecture.md) §2.3's
  `RequestContext` shape and should be folded back into that document if a
  human agrees.
- **`get_calendar_density_tomorrow`'s backing store** (§3.6) is resolved
  here as a `baselines` row, closing
  [04-database-schema.md](04-database-schema.md) §14's open item — same
  caveat: worth folding back into that document once confirmed.
- **Finance holdings/allocation gap** (§3.7): `financial_risk`'s natural
  job (checking allocation against `risk_tolerance`) is only partially
  answerable with the schema as written — no positions/holdings table
  exists, only balance snapshots. Not fixed here; either a real gap to
  accept for MVP-and-beyond (finance is unlikely to be an early domain
  regardless, per §11's MVP list) or a future schema addendum.
- **Tier-consistency assertion (§6, step 5)** — "a tool's `riskTier` must
  be ≤ its scope's catalog `risk_tier`, checked at registry startup" is a
  new rule this document adds on top of the strategy doc's model; it isn't
  contradicted by anything already written, but it's a real new constraint
  implementers must satisfy when `permission_scopes` rows are seeded — the
  catalog's `risk_tier` values need to be chosen with this constraint in
  mind, which [04-database-schema.md](04-database-schema.md) doesn't
  populate with actual rows (it only defines the table shape).
- **AI governance/eval tooling** remains deliberately deferred per ADR D10
  — this document defines what every agent output and tool call must
  record (§2, §6 step 8), which is what an eval/tracing vendor would
  consume, but does not pick that vendor, consistent with ADR D10's own
  deferral.
- **Stale numbering cross-reference — resolved.** `00-strategy-moat-and-hazards.md`'s
  link now correctly points to `04-database-schema.md`; flagged (a third
  time, inherited from [03-system-architecture.md](03-system-architecture.md)
  §8 and [04-database-schema.md](04-database-schema.md) §14) when this
  document was drafted, fixed since.
