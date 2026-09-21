# plos — MVP Definition (Phase 0-G)

> This is Phase 0-G, the last document in the sequence fixed in
> [00-product-vision-master-prompt.md](00-product-vision-master-prompt.md) §60
> (A. ADR — B. System architecture — C. Database schema — D. Agent
> architecture — E. Threat model — F. Privacy model — G. **MVP definition**).
> It takes [02-architecture-decision-record.md](02-architecture-decision-record.md),
> [03-system-architecture.md](03-system-architecture.md),
> [04-database-schema.md](04-database-schema.md),
> [05-agent-architecture.md](05-agent-architecture.md),
> [06-threat-model.md](06-threat-model.md), and
> [07-privacy-model.md](07-privacy-model.md) as given and closes every
> MVP-scope flag those documents deliberately left open for this one:
> [05-agent-architecture.md](05-agent-architecture.md) §11 (which of the 10
> pairs ship), [03-system-architecture.md](03-system-architecture.md) §8
> (whether "ask agent" is ever entitlement-gated),
> [00-strategy-moat-and-hazards.md](00-strategy-moat-and-hazards.md)'s "Where
> this document plugs into Phase 0" (Baseline Engine + minimal Outcome
> Learning in; Context Engine/Personal Constitution/Why-What-If/Life Timeline
> out), and [06-threat-model.md](06-threat-model.md) §17 /
> [07-privacy-model.md](07-privacy-model.md) §10's consolidated gap lists
> (which gaps must close before real user data is at risk vs. which are
> acceptable residual risk at MVP's actual scope and scale).
>
> **Method**: every scope call below is derived from, not invented on top of,
> the six documents above — where [00-product-vision-master-prompt.md](00-product-vision-master-prompt.md)
> §52's own MVP sketch under- or over-specifies relative to what the
> architecture actually built (e.g. Apple Calendar is an MVP integration but
> no Productivity specialist ships), this document says so explicitly and
> resolves it, per CLAUDE.md's "flag rather than silently resolve" rule
> applied to *this* document's own resolution power, since Phase 0-G is
> exactly the phase vision §60 assigns that resolution to.
>
> **Out of scope here**: re-litigating any ADR/architecture/schema decision
> (those are taken as fixed); UI copy and screen-by-screen design (waits on
> Phase 0 completing per the brand doc's sequencing note, CLAUDE.md's phase
> gate); a ship date or team-capacity estimate (a scope document, not a
> project plan).

## 1. What "prove the core loop" means, concretely

Vision §54's loop — `OBSERVE → UNDERSTAND → ANALYZE → INFORM → ASSIST →
CONFIRM → ACT → LEARN` — is the literal acceptance test for this MVP: every
stage must be real and observable in the shipped product, even if each
stage's *breadth* (domains, data volume, sophistication) is minimal. A
build that nails Health data visualization but never reaches ACT/LEARN is
not this MVP; a build that reaches ACT/LEARN only for a toy domain nobody
would use is not it either. Concretely, each stage maps to a specific
mechanism already fixed by prior Phase 0 documents — this table is the
traceability check that nothing in §3–§9 below accidentally drops a stage:

| Loop stage | MVP mechanism | Fixed by |
|---|---|---|
| OBSERVE | HealthKit sync (vitals, sleep), Apple Calendar sync (density only), Journal entries (free text + structured check-in) become `observations`/`events` rows with full provenance | [03-system-architecture.md](03-system-architecture.md) §2.1, §2.8; [04-database-schema.md](04-database-schema.md) §2–§3 |
| UNDERSTAND | Personal Baseline Engine (`worker` task) computes per-domain baselines (sleep, training load, calendar density, mood/stress) classified normal/improving/deteriorating/anomalous | [03-system-architecture.md](03-system-architecture.md) §2.5; [04-database-schema.md](04-database-schema.md) §6 |
| ANALYZE | `health_analysis`/`fitness_performance`/`mental_context` read baselines + domain tools, produce a structured `AgentOutput` finding | [05-agent-architecture.md](05-agent-architecture.md) §2–§3 |
| INFORM | The paired safety/verification agent (`health_safety`/`training_safety`/`clinical_safety_handoff`) verifies, and the Life Master Agent composes one answer with evidence, confidence, and FACT/DERIVED-FACT/AI-INFERENCE/RECOMMENDATION labeling | [05-agent-architecture.md](05-agent-architecture.md) §8–§9; vision §3, §8 |
| ASSIST | A `recommendation` field is populated when applicable (e.g. "consider a lighter session") | [05-agent-architecture.md](05-agent-architecture.md) §2 |
| CONFIRM | Tier 1–2 write tools (`cancel_scheduled_workout`) require an explicit, server-validated confirmation before executing | [05-agent-architecture.md](05-agent-architecture.md) §6 steps 5–6 |
| ACT | The confirmed write executes through the full AuthZ→Validate→RiskTier→Confirm→Execute→Audit chain, producing an `actions` row | [05-agent-architecture.md](05-agent-architecture.md) §6; [04-database-schema.md](04-database-schema.md) §3.5 |
| LEARN | A `decisions` row records the user's response to the recommendation; a minimal `outcomes` row is written by a follow-up baseline check — the strategy doc's "minimal Outcome Learning loop," not the full personal-intervention-history flywheel | [00-strategy-moat-and-hazards.md](00-strategy-moat-and-hazards.md) "Where this document plugs into Phase 0"; §3.4 below |

Measurable success criteria for this MVP (vision §59's gate-sequence
requirement, applied to this document itself): (1) a real user can connect
HealthKit + Apple Calendar and write a journal entry inside one session;
(2) within 7 days of connected data, the Home screen surfaces at least one
insight that passes vision §28-41's five-question usefulness test
(relevant, evidenced, novel, actionable, worth interrupting); (3) at least
one Tier 2 recommendation (a workout-adjustment suggestion) reaches CONFIRM
and, if accepted, ACT, and a corresponding `decisions`/`outcomes` pair is
recorded; (4) a user can export their data and delete their account
end-to-end without support intervention; (5) zero cross-tenant data
exposure in the specific IDOR/RLS test targets named in §7 below, verified
before launch, not assumed.

## 2. In/out scope — domains and specialist pairs

### 2.1 Resolving vision §52 against the actual agent architecture

Vision §52 names "Health specialist + Fitness specialist + Journal/context
specialist + safety/verification layer" — four items, but
[05-agent-architecture.md](05-agent-architecture.md)'s actual design has no
free-standing "safety/verification layer"; safety/verification is *built
into* each domain pair as its second agent (§1 of that document). Read
literally against the roster that now exists, "safety/verification layer"
is not a fourth agent — it is the second agent of each of the three named
pairs. This document confirms that reading: **the safety/verification
layer is `health_safety` + `training_safety` + `clinical_safety_handoff`,
one per dispatched domain, not a separate cross-cutting agent.** This
also resolves [05-agent-architecture.md](05-agent-architecture.md) §11's
open flag about whether "Journal/context" means `mental_context` alone or
the full pair: **it means the full pair** (`mental_context` +
`clinical_safety_handoff`), because shipping a mental/emotional specialist
with no crisis-detection counterpart would violate vision §16's
professional-handoff non-negotiable outright, not merely under-scope it —
see §2.3 below for exactly which of that pair's tools ship.

### 2.2 In scope: three domains, three full pairs

| # | Domain | Pair (agent-arch §3 ref) | MVP status |
|---|---|---|---|
| 1 | Health | `health_analysis` / `health_safety` (§3.1) | **Full pair, in scope** |
| 2 | Fitness | `fitness_performance` / `training_safety` (§3.4) | **Full pair, in scope** |
| 3 | Mental/Emotional ("Journal/context") | `mental_context` / `clinical_safety_handoff` (§3.2) | **Full pair, in scope — detection/escalation tools only, see §2.3** |
| — | (orchestrator) | `life_master_agent` | **In scope**, dispatching only the above three plus the passive calendar signal below |

### 2.3 The one deliberate reduction: professional-sharing tools deferred, not the pair

`clinical_safety_handoff`'s crisis-detection tools (`get_clinical_memory_flags`,
`check_crisis_risk_signals`) and its `requires_human_review` escalation
**ship at MVP** — this is the actual safety-net vision §16 requires, and it
is cheap: it is a read-only tool chain plus a UI state that recommends the
user seek professional/emergency help, with no dependency on a verified
professional network. Its Tier 1/3 write tools —
`draft_professional_report` and `share_professional_report`
([05-agent-architecture.md](05-agent-architecture.md) §3.2, §9 of
[07-privacy-model.md](07-privacy-model.md)) — **do not ship at MVP**. This
is a deliberate scope cut, not an oversight: those two tools depend on a
verified `professionals` table, an invite/verification flow, and the
`documents.shared_via_grant_id` schema addendum
[07-privacy-model.md](07-privacy-model.md) §10 already flags as
undesigned — building a professional-verification pipeline is not "the
smallest useful thing" that proves the core loop, and the non-negotiable
it exists to satisfy ("high-risk situations need a safety escalation
design," vision §16) is fully satisfied by the crisis-detection half alone.
**Escalation at MVP always terminates at the user** ("this pattern suggests
talking to a professional; here are resources"), never at an in-product
share to a named clinician.

### 2.4 Calendar is a data source, not a specialist domain, at MVP

Vision §52 lists Apple Calendar as an MVP data source but does not list a
Productivity specialist in the same sentence — the vision doc's own
worked-example equivalent
([03-system-architecture.md](03-system-architecture.md) §4) dispatches
`focus_scheduling` for calendar density, which would be a fourth pair not
named in §52. This document resolves the apparent gap in vision §52's own
list by **not dispatching any Productivity specialist at MVP**: Apple
Calendar data is synced and feeds exactly one passive derived signal —
`get_calendar_density_tomorrow`
([05-agent-architecture.md](05-agent-architecture.md) §3.6, backed by a
`baselines` row) — which the Life Master Agent's `get_context_snapshot`
reads directly, the same way it reads Health/Fitness baselines, without
ever dispatching `productivity_planning` or `focus_scheduling` as their own
specialist calls. This keeps the "should I train tonight" worked example
fully functional at MVP (its exact three inputs — sleep baseline, training
load, calendar density — are all present) without building a fourth pair,
its write tool (`move_calendar_event`), or its raw-calendar tool
(`get_calendar_raw`) — none of which vision §52 asked for.

### 2.5 Out of scope: seven domains, entirely

Nutrition, Learning, Productivity (as a *dispatched specialist*, per §2.4),
Finance, Social, Travel, Career: **zero data ingestion, zero specialist
dispatch, zero scopes exercised, zero UI surface.** Their tool contracts,
scopes, and table shapes already exist in
[05-agent-architecture.md](05-agent-architecture.md) §3.3/§3.5/§3.7–§3.10
and [04-database-schema.md](04-database-schema.md) so that shipping them
later is a dispatch-and-scope-registration change, not a redesign — but
none of that code path is reachable at MVP. This is a direct application of
the strategy doc's own instruction not to let its five-layer-moat ambition
scope-creep the MVP vision §52 already drew narrower.

## 3. Integrations in scope

| Provider | Tier (vision §17-20) | MVP status | Notes |
|---|---|---|---|
| Apple Health (HealthKit) | 1 | **In** | Client-driven sync ([03-system-architecture.md](03-system-architecture.md) §2.1) — no server-side OAuth token; device-permission-based |
| Apple Calendar (EventKit) | 1 | **In, density-only** (§2.4) | Same client-driven, on-device pattern as HealthKit — no server-held credential, `integrations.credentials_secret_ref` is NULL for both |
| Strava, Garmin, MyFitnessPal, Fitbit, Oura, WHOOP, Health Connect, Adidas | 2 | **Out** | No adapter built; Tier 2 roadmap unchanged |
| Google Calendar, banking, brokerage, medical providers, education, travel, other AI systems | 1(partial)/3 | **Out** | Google Calendar specifically deferred even though it's nominally Tier 1, since vision §52's MVP line item says "Apple Calendar," not "Calendar" generically |

Because both MVP integrations are on-device/client-driven, **account-
deletion step 1** ([07-privacy-model.md](07-privacy-model.md) §7 step 1,
"revoke integrations... delete the pointed-to secret from Secrets
Manager") simplifies at MVP scale: there is no OAuth secret to delete for
either provider yet — the step reduces to marking `integrations.status =
'revoked'` and the app ceasing to read the device permission. The full
Secrets-Manager-revocation path becomes live the day the first Tier 2/3
adapter ships, not before.

## 4. Database: populated vs. stubbed at MVP

Every table below exists in [04-database-schema.md](04-database-schema.md)
regardless of MVP status — nothing here proposes a schema change; this is
a usage classification. "Populated" = real rows written by real product
flows at MVP. "Stubbed" = table/type exists, no MVP code path writes to it.

### 4.1 Populated at MVP

| Table(s) | Scope note |
|---|---|
| `core_objects` | Only `object_type IN ('event','observation','goal','action','decision','outcome','agent_output','memory')` actually appear; `'entity'`, `'relationship'`, `'clinical_memory'`, `'document'` types are structurally possible but see §4.2 |
| `events`, `event_fitness_session`, `fitness_session_set` | Fitness only |
| `event_calendar_item` | Read-only ingestion for the calendar-density baseline (§2.4) — no `event_participants`/attendee detail is ever fetched, matching [03-system-architecture.md](03-system-architecture.md) §4.5's "attendee detail isn't needed" |
| `observations`, `observation_vital`, `observation_sleep` | HealthKit-sourced |
| `observation_journal_entry` | Both `entry_kind` values (vision §52's "text + structured check-in") |
| `observation_injury_flag` | **User-entered only** (`flagged_by='user'`) — no clinician-flag UI at MVP |
| `health_profile`, `health_profile_history` | Minimal onboarding fields (allergies, chronic conditions, current medications) — "profile" per vision §52 |
| `goals`, `goal_habit_detail`, `goal_history` | Vision §52's "profile + goals" |
| `actions` | Only `action_type='workout_cancellation'`, `executed_by IN ('user','agent_on_behalf_of_user')` |
| `decisions`, `outcomes` | The minimal Outcome Learning loop (§3.4 of this document, strategy doc's MVP-candidate call) |
| `memories`, `memory_reasons`, `memory_history` | **Manual/user-edited only** — no automated behavioral-pattern extraction pipeline runs at MVP; exists because "user can edit memories" is a vision §54 non-negotiable, not because the moat's Identity Graph is being built yet |
| `agent_outputs`, `agent_output_sources` | Every specialist call and composed answer, full provenance |
| `agent_conversations`, `agent_turns` | Full, 90-day retention per [07-privacy-model.md](07-privacy-model.md) §5 |
| `baselines` | `domain IN ('health','fitness','productivity')`, the metrics named in [05-agent-architecture.md](05-agent-architecture.md) §3.1/§3.4/§3.6 |
| `users`, `user_roles` (USER only), `webauthn_credentials`, `sessions` | Full auth baseline, vision §52's explicit line item |
| `integrations` | Apple Health + Apple Calendar rows only |
| `permission_scopes` (catalog), `permission_grants` | Catalog seeded in full per [07-privacy-model.md](07-privacy-model.md) §3.2; only `health.*`, `fitness.*`, `mental_health.*`, `productivity.read` (calendar-density), `account.export`, `account.delete`, `consent.manage` scopes are ever actually granted |
| `consent_records` | `consent_type IN ('tos','health_data_processing','mental_health_data_processing')` |
| `documents`, `document_links` | **`document_type='export_bundle'` only** |
| `audit_log` | Full — every tool call and guard rejection, regardless of domain, from day one |

### 4.2 Stubbed at MVP (schema exists, zero MVP write path)

| Table(s) | Why deferred |
|---|---|
| `entities`, `entity_person_detail` | No Social domain, no person-entity extraction at MVP |
| `event_travel_trip`, `event_learning_session`, `event_task`, `event_social_activity`, `event_career_milestone` | Their domains are out of scope (§2.5) |
| `observation_symptom`, `observation_lab_result` | No symptom-logging UI or document-upload feature at MVP; `get_active_symptom_flags`/lab tools degrade to empty reads |
| `observation_nutrition_log`, `nutrition_log_item`, `financial_accounts`, `observation_financial_snapshot`, `financial_account_history` | Nutrition and Finance domains out of scope |
| `relationships` | No Social pair, and no cross-domain `causal_association` rows are populated at MVP — the "sleep↓ associated with stress↑" pattern-language capability exists in the schema but the MVP's answers stay at the single-baseline-deviation level the worked example actually needs; a real gap between vision §42's ambition and MVP's proof-of-loop, resolved toward MVP scope |
| `clinical_memories`, `clinical_memory_history` | No professional-authored clinical content exists without the professional-sharing workflow (§2.3) |
| `embeddings` | **Deferred entirely** — no `ModelProvider.embedding()` call is ever made at MVP; see §9.1 |
| `timeline_entries` | Explicitly named post-MVP by [00-strategy-moat-and-hazards.md](00-strategy-moat-and-hazards.md) ("Life Timeline... later-phase, not MVP") and by [04-database-schema.md](04-database-schema.md) §6's own comment ("table exists now because the worker can populate it cheaply") |
| `professionals` | No verified-professional workflow at MVP |
| `subscriptions` | See §9.2 — monetization deferred |
| `document_history`, `financial_account_history` (beyond what's listed above) | Their governing live tables (`professional_report` documents, financial accounts) don't exist yet |

## 5. Tool ceiling at MVP

Every tool a dispatched pair could call, restricted to the tools whose
domain and tier this document actually populates (§4). Tools not listed
here are **not wired at MVP even though [05-agent-architecture.md](05-agent-architecture.md) already fully specifies them** — they remain available, unmodified, for the domain's future activation.

| Agent | Tools that ship at MVP | Tools deferred |
|---|---|---|
| `life_master_agent` | `get_context_snapshot(domains=[health,fitness,mental_health])`, reading `baselines` for productivity calendar-density too | — |
| `health_analysis`, `health_safety` | `get_sleep_baseline_deviation`, `get_vital_baseline_deviation`, `get_recent_sleep_raw`, `get_recent_vitals_raw`, `get_health_profile_summary`, `get_domain_goals`, `get_domain_memory_digest`, `get_domain_recent_outcomes` | `get_active_symptom_flags`, `get_lab_result_summary`, `get_recent_lab_results_raw` (degrade to empty/unused, no data exists) |
| `fitness_performance`, `training_safety` | `get_training_load_baseline`, `get_recent_training_summary`, `get_recent_training_raw`, `get_active_injury_flags` (user-flagged only), `cancel_scheduled_workout`, `get_domain_goals`, `get_domain_memory_digest`, `get_domain_recent_outcomes` | none — full pair ships |
| `mental_context`, `clinical_safety_handoff` | `get_mood_stress_baseline_deviation`, `get_recent_journal_summary`, `get_recent_journal_raw`, `check_crisis_risk_signals`, `get_domain_goals`, `get_domain_memory_digest`, `get_domain_recent_outcomes` | `get_clinical_memory_flags` (unused, no `clinical_memories` rows exist yet, returns empty by construction), `draft_professional_report`, `share_professional_report` (§2.3) |
| (no agent) | `get_calendar_density_tomorrow` read only by the Life Master Agent's context snapshot | `get_task_workload_summary`, `get_recent_tasks_raw`, `get_calendar_raw`, `move_calendar_event` (no Productivity pair dispatched, §2.4) |

The one Tier 2+ write tool at MVP is `cancel_scheduled_workout` — this
concentrates the entire confirmation/reauthentication/audit chain's
real-world proof burden onto a single tool, which is deliberate: it is
enough to prove CONFIRM→ACT works end-to-end without needing every domain's
write path built.

## 6. Threat model: must-fix-before-MVP-ships vs. acceptable residual risk

Every T1–T12 finding from [06-threat-model.md](06-threat-model.md), scoped
against the MVP surface actually defined in §2–§5 above. Several gaps that
document calls severe become **moot at MVP scale** because the feature they
attack doesn't exist yet — that narrowing is itself a legitimate MVP
benefit, not a way of ignoring the finding, and each moot item is flagged
to re-open the day its feature ships.

| # | Threat model finding | MVP disposition | Rationale |
|---|---|---|---|
| T1 | Session revocation/device management | **Must-fix** | Table-stakes for vision §52's "full auth baseline" line item; the schema/mechanism already exists, this is an implementation gate not new scope |
| T1 | Suspicious-login anomaly detection, concurrent-session cap, Apple-ID-revocation propagation | **Acceptable residual** | Real hardening, not blocking; `sessions` table already carries what a later pass needs |
| T1 | Independent 2nd factor beyond the Apple ID root of trust | **Accepted architectural residual, not an MVP bug** | Inherent to ADR D7's Apple+Passkeys choice, which vision §14 mandates over inventing a custom scheme — not something an MVP scope decision can "fix" without contradicting D7 |
| T2 | RLS `FORCE`d + tested on every MVP-populated table | **Must-fix** | Existential-tier hazard; the mechanism is already designed, MVP's obligation is verifying it works on the actual reduced table set before real health/journal data lands |
| T2 | `embeddings` join-discipline, cross-domain memory-digest join leak, `document_links` scoping | **Moot at MVP** | No embeddings are written (§4.2, §9.1); no `relationships` rows span domains (§4.2); no non-export document is shared with anyone (§2.3) — re-open when any of those three ship |
| T2 | Per-tenant envelope encryption beneath RLS | **Acceptable residual** | Real defense-in-depth, not required to prove the core loop; single-CMK KMS (already ADR D4) is the MVP baseline |
| T3 | `user_id` taken only from `RequestContext`, never a tool argument; ownership re-check on `cancel_scheduled_workout` | **Must-fix** | Cheap, concrete, and it's the *only* Tier 2+ write tool shipping (§5) — no excuse to defer the one IDOR test target that actually exists at MVP |
| T3 | `move_calendar_event`/`share_professional_report` ownership tests | **Moot at MVP** | Neither tool is wired (§2.3, §2.4) |
| T4 | Build-time tool/scope tier-consistency assertion | **Must-fix** | Cheap (a startup check), already specified, no reason to defer even at 3-domain scale |
| T4 | `user_roles` write path, professional-invite consent proof | **Moot at MVP** | No role beyond USER, no professional invite flow exists (§2.3) |
| T4 | Intent-classifier over-scoping | **Acceptable residual** | Worst case at MVP is over-dispatching 3 domains instead of 1 — bounded and low-impact at this domain count; revisit when the roster grows past MVP |
| T5 | Untrusted-span isolation for raw journal text before it reaches `mental_context`/`clinical_safety_handoff` | **Must-fix** | The one raw-text injection surface that exists at MVP (calendar titles are never given to any specialist, §2.4) sits directly in front of the crisis-detection pair — cheap prompt-engineering discipline, high consequence if skipped |
| T5 | Full injection-detection/eval tooling, provider-webhook free-text ingestion | **Moot / acceptable residual** | No Tier 2/3 webhook-based provider exists at MVP (§3); eval-tooling vendor selection is already deferred by ADR D10 |
| T5 | Sharpest instance (injected journal text reaching `share_professional_report`) | **Eliminated by scope, not mitigated** | That tool doesn't exist at MVP (§2.3) — the worst-case blast radius this finding named is structurally absent, not merely defended against |
| T6 | Malicious documents (malware scanning, upload limits) | **Moot at MVP** | No user-uploaded document exists — `documents` holds only system-generated export bundles (§4.1). Must close before any lab-result/professional-report upload feature ships |
| T7 | Confirmation-token binding (scoped, single-use, time-boxed HMAC) | **Must-fix** | The one Tier 2 tool at MVP needs real confirmation semantics, not a placeholder, before it executes anything |
| T7 | Per-conversation tool-call rate limit, cross-tool aggregation-exfiltration bound | **Acceptable residual** | Three-domain MVP bounds both risks structurally; revisit at 10-domain scale |
| T8 | Subscription bypass (all of it) | **Moot at MVP** | No entitlement gating exists (§9.2) |
| T9 | Per-user/session application-level rate limit on `/v1/agent/ask` | **Must-fix** | Direct dollar-cost exposure per call from day one, not just a security nicety — cheap NestJS throttler |
| T9 | Per-request specialist fan-out cap | **Acceptable residual** | MVP's own domain ceiling already bounds fan-out to at most 3 pairs (6 calls) + 1 backstop; add a hard cap as cheap insurance, not a blocker |
| T9 | Worker connection-pool `SET LOCAL app.current_user_id` discipline | **Must-fix** | The `worker` task ships at MVP to compute baselines from real HealthKit/Calendar syncs from day one; a pool-reuse bug here is a direct path to T2's cross-tenant leakage, not a hypothetical |
| T10 | Least-privilege DB roles (no interactive superuser prod shell for routine ops), baseline CloudTrail/GuardDuty | **Must-fix** | Cheap relative to the AWS-from-MVP buildout already committed (ADR D4); foundational ops hygiene for a product holding real health/journal data from launch |
| T10 | SUPPORT-role visibility scope, professional-query anomaly detection, RDS-level query auditing (`pgaudit`) | **Moot / acceptable residual** | No support tooling and no professional access exist at MVP (§2.3); revisit when either ships |
| T11 | At least one verified restore test before real user data goes live; restores only into the same private-VPC-locked environment | **Must-fix** | Direct application of CLAUDE.md's "a backup that has never been restored is not verified" — cannot be deferred once real health data exists, must happen before launch, not after |
| T11 | Formal RPO/RTO SLA documentation, key-rotation cadence | **Acceptable residual (adopt placeholders)** | [07-privacy-model.md](07-privacy-model.md) §5's placeholder numbers (35-day backup window, RTO ≤4h, quarterly restore test) are adopted as MVP's working target; formalize post-MVP |
| T12 | Hedged/epistemic-status-consistent language in all three MVP specialists' system prompts (no causal claims, no fact-shaped phrasing for `ai_inference`/`recommendation`) | **Must-fix** | Central to the FACT/DERIVED-FACT/AI-INFERENCE/RECOMMENDATION non-negotiable the Home screen literally must render; manually reviewable at 3-pair scale, no excuse to defer |
| T12 | Automated epistemic-language linting/eval, memory decay/re-confirmation policy | **Acceptable residual** | Eval tooling already deferred by ADR D10; memory decay is moot while memories are manual-only (§4.1) |

**Deliberately not dispositioned above**: vision §49's "professional
penetration test before serious commercial deployment." Every other item
in that same vision sentence (SAST/dependency/secret scanning, IDOR,
privilege escalation, rate-limiting, prompt injection, subscription
bypass, backup restoration) is a Phase-0 architecture concern and gets a
row above. A professional pen-test is a paid third-party engagement gated
on *commercial* launch, not on MVP passing internally — there's nothing
for this document to disposition yet. Recorded here explicitly so the
asymmetry with its sibling requirements doesn't read as an oversight.

## 7. Privacy model: non-negotiable at MVP vs. reduced scope

Vision §54 and CLAUDE.md's non-negotiables list export, deletion, and user
control with no MVP carve-out — "build the smallest useful thing" governs
*domain breadth*, not *whether these ship*, matching the same resolution
already used for [02-architecture-decision-record.md](02-architecture-decision-record.md)
D4's own smallest-useful-thing note (infrastructure minimalism, not a
security-non-negotiable exemption).

| Privacy-model piece | MVP status | Scope note |
|---|---|---|
| Account deletion, full 8-step workflow ([07-privacy-model.md](07-privacy-model.md) §7) | **Non-negotiable, ships in full** | Actually *simpler* at MVP scale: step 4 (delete derived data) has no `clinical_memories` to purge; step 5 (S3 purge) only ever touches export-bundle objects; step 6 (embeddings) is trivially satisfied since none exist |
| Data export bundle ([07-privacy-model.md](07-privacy-model.md) §8) | **Non-negotiable, ships with a reduced folder set** | Only `profile/`, `goals/`, `health/`, `fitness/`, `mental_health/` (behind reauthentication, unchanged from §8's rule), `memories/`, `ai/`, `audit/` are ever non-empty; `finance/`, `nutrition/`, `productivity/`, `learning/`, `social/`, `travel/`, `career/`, `professional_sharing/` directories are simply absent, not empty stubs, since no data was ever collected there |
| Privacy & Data Control Center | **Non-negotiable, scoped to MVP's actual surface** | Must show: connected integrations (Apple Health, Apple Calendar) with disconnect; active permission grants with revoke; editable memories; export request; account deletion request; consent toggles (`tos`, `health_data_processing`, `mental_health_data_processing`). Must **not** show: professional-sharing management (§2.3), subscription management (§9.2), or scopes/domains never granted |
| Consent model ([07-privacy-model.md](07-privacy-model.md) §4) | **Non-negotiable for the three consent types actually exercised** | `tos`, `health_data_processing`, `mental_health_data_processing` — `financial_data_processing` and `marketing` rows exist in the catalog but are never presented to an MVP user |
| Support/admin break-glass rule ([07-privacy-model.md](07-privacy-model.md) §6.2) | **Non-negotiable as a standing rule, moot as a built feature** | No support tooling ships at MVP, so the rule ("no implicit superuser path") holds trivially by absence — must be honored the day any support tooling is built, not before |
| Professional sharing workflow ([07-privacy-model.md](07-privacy-model.md) §9) | **Deferred, per §2.3** | Not a non-negotiable at MVP scope since the mental-health non-negotiable it exists to satisfy is met by crisis-detection alone (§2.3) |

## 8. Explicitly out of scope (consolidated)

- **Domains**: Nutrition, Learning, Productivity (as a dispatched
  specialist), Finance, Social, Travel, Career — zero ingestion, zero
  dispatch (§2.5).
- **Integrations**: everything beyond Apple Health + Apple Calendar,
  including all Tier 2/3 providers (§3).
- **Agents/tools**: `nutrition_analysis`/`nutrition_planning`,
  `knowledge_agent`/`learning_strategy`,
  `productivity_planning`/`focus_scheduling`,
  `financial_analysis`/`financial_risk`, `social_context`/`social_planning`,
  `travel_research`/`travel_planning`, `career_analysis`/`career_planning`;
  `draft_professional_report`/`share_professional_report`;
  `move_calendar_event`, `get_calendar_raw` (§2.3, §2.4, §5).
- **Subsystems named explicitly post-MVP by the strategy doc**: the full
  Context Engine (beyond the Personal Baseline Engine piece already
  required by every Tier-0 tool), Personal Constitution, "Why?" engine
  (beyond the evidence list already in every `AgentOutput`), "What if?"
  engine, Life Timeline.
- **Database**: everything in §4.2.
- **Monetization**: StoreKit 2, RevenueCat integration, entitlement gating
  of any capability (§9.2).
- **Semantic retrieval**: `pgvector` embeddings, `ModelProvider.embedding()`
  (§9.1).
- **Professional accounts and sharing**: verification flow, invite flow,
  read/write toggle, expiry (§2.3; [07-privacy-model.md](07-privacy-model.md)
  §9's open items are all therefore moot at MVP).
- **Support/admin tooling** of any kind.
- **Cross-domain association rows** (`relationships.relationship_class IN
  ('causal_association','temporal_sequence')`) — vision §42's "appears
  associated with" pattern language is a real capability the schema
  supports, not one MVP's three domains need to prove the loop.
- **Push notifications, entirely** (product vision §28–41; tiering design
  in [03-system-architecture.md](03-system-architecture.md) §7). MVP's
  Home screen already surfaces "one meaningful insight" on open — the
  pull model the vision itself treats as the default (§30) — so a push
  pipeline adds delivery infrastructure (APNs registration, token
  storage, a send path) MVP's core loop doesn't need to prove. No tier
  ships: not Critical, not Silent-logged-only, none. The five-tier model
  and the "which component may enqueue one" rule are real design, ready
  to implement post-MVP; nothing here is a stub or a partial version of
  it.

## 9. Two decisions this document makes that prior documents left open

### 9.1 Embeddings deferred entirely — closes an ADR D3/schema gap by not building it yet

[04-database-schema.md](04-database-schema.md) §14 flagged that neither
ADR D3 nor [03-system-architecture.md](03-system-architecture.md) fixes an
embedding model or dimension, and `embeddings.embedding VECTOR(1536)` is an
assumption that would be disruptive to change after real rows exist. This
document closes that gap the cheapest possible way: **no embedding is
generated or stored at MVP.** `ModelProvider.embedding()` is never called;
the `pgvector` extension can be enabled in the database (zero cost, per
ADR D5) but nothing writes to it. This is possible only because MVP's
three domains never need semantic retrieval to prove the loop — structured
domain tools and baselines are sufficient. The embedding-model decision is
pushed to whichever later phase first needs semantic memory search (a real
Context Engine, richer `memory_reasons` retrieval across many domains),
which is exactly where the strategy doc already placed the "full Context
Engine."

### 9.2 Entitlement gating off at MVP — closes a system-architecture §8 open question

[03-system-architecture.md](03-system-architecture.md) §8 explicitly left
"whether the core 'ask agent' capability is ever entitlement-gated, or only
certain domains/specialists are... a product-scope decision this document
doesn't make." Vision §52's own MVP list never mentions subscriptions,
StoreKit, or a paywall. **This document decides: nothing is entitlement-
gated at MVP.** `EntitlementGuard`
([03-system-architecture.md](03-system-architecture.md) §2.3) remains in
the pipeline as a pass-through stage (architecturally present, gating
nothing) rather than being removed, so wiring real entitlement checks later
is a configuration change, not a new pipeline stage. This does **not**
reverse [02-architecture-decision-record.md](02-architecture-decision-record.md)
D8's StoreKit 2 + RevenueCat decision — unlike ADR D4, which explicitly
pins private-VPC hosting to "starting at MVP," D8 names no MVP start date,
so deferring its *rollout* (not its *design*) is exercising a scope
decision the architecture left open, not silently changing one it already
closed.

## 10. Cross-references worth folding back (flagged, not silently applied)

Per CLAUDE.md's "don't silently change these documents based on a one-off
remark" — the following MVP-scope decisions have a natural home in an
earlier document and should be folded back there if a human agrees, rather
than treated as already incorporated:

- §2.4's resolution (Calendar as a passive signal, no Productivity
  dispatch at MVP) is a concrete instance of
  [05-agent-architecture.md](05-agent-architecture.md) §11's flag — worth
  a one-line addition there once confirmed.
- §9.2's entitlement decision resolves
  [03-system-architecture.md](03-system-architecture.md) §8's open
  question — worth closing that bullet explicitly in that document.
- §9.1's embeddings deferral resolves
  [04-database-schema.md](04-database-schema.md) §14's embedding-model gap
  for the MVP timeframe specifically (the gap still needs a real answer
  before any post-MVP phase turns semantic retrieval on).
- §6's must-fix list (confirmation-token binding, worker RLS-pool
  discipline, one verified restore test, untrusted-span isolation for
  journal text) are implementation obligations, not document edits — they
  belong in whatever engineering task list executes Phase 1, not folded
  into a Phase 0 doc.
