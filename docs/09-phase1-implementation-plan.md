# plos — Phase 1 Implementation Plan

> Phase 0 (docs 02–08) specifies **what** to build. This document plans
> **when and in what order** to actually build it, and calls out the small
> number of things Phase 0 didn't fully specify. It does not re-derive
> architecture — every milestone below cites the Phase 0 section it
> implements rather than restating it.

## Context

Phase 0 is drafted and reconciled. A design artifact and a real,
compiling, running SwiftUI client exist (`apps/ios/`), but **every screen
runs on static mock data** (`MockData.swift`) — there is no backend, no
database, no auth, no agent orchestration, no deployed infrastructure
anywhere. This plan sequences the work that turns the already-designed
system into something real, ending where `docs/08-mvp-definition.md`'s
own success criteria (§1) can actually be tested against a live system
rather than read as a specification.

Two things this plan resolves that Phase 0 left as gaps (not architecture
changes — reconciling what's already decided):

1. **The iOS app's screen set is wider than the MVP's 3 domains** (login,
   signup, settings, history, calendar, workouts, meds, connected apps —
   see `CLAUDE.md`'s "iOS app" section). Rather than expanding the MVP's
   agent/domain scope to match, this plan keeps the **agent scope exactly
   as spec'd** (Health, Fitness, Mental/Emotional only) and backs the
   extra screens with **plain authenticated CRUD**, not agent tools,
   wherever that's a legitimate fit:
   - Workouts screen → `event_fitness_session` (Fitness domain, already
     in scope) — a user logging their own workout is a direct write, not
     an agent action.
   - Meds screen → `action_medication_log` (Health-adjacent, already in
     the schema) — same reasoning, and it's already architecturally
     required to be write-once/user-initiated only (04 §14's flagged
     cross-check).
   - History screen → reads `agent_outputs` (already in scope).
   - Calendar screen → EventKit density data (already in scope as "a data
     source, not a specialist domain," 08 §2.4).
   - Connected Apps / Settings → mostly client-local or simple status
     endpoints, minimal backend.

   This is a genuine architectural addition Phase 0 didn't name: **a plain
   CRUD API surface for user-entered facts, separate from the Agent Scoped
   Tools layer**, which exists only for agent-initiated reads/actions.
   Both surfaces write through the same RLS-scoped connection and the same
   audit log — they differ in who's calling, not in data-safety mechanism.
   If this reconciliation is wrong, say so before Milestone 1 starts —
   everything downstream assumes it.

2. **No journal-entry screen exists client-side** despite journal entries
   being an explicit MVP loop requirement (08 §1). Added in Milestone 2.

## Milestone 0 — Xcode project verification (blocking, not sequenced with the rest)

Not backend work — a prerequisite only you can clear, since this
environment has no full Xcode. Open `apps/ios/plos.xcodeproj` in real
Xcode and confirm it opens, resolves the local `PlosDesignSystem` package
dependency, and builds to the simulator. Every later milestone's iOS-side
verification step assumes this works. Backend milestones (1–4, 6–8) don't
depend on it and can proceed in parallel regardless of when you get to
this.

## Milestone 1 — Backend bootstrap

**Builds**: `apps/api`, a NestJS project (ADR D2, D9). Local Postgres via
Docker Compose for iteration (prod is RDS per D4/D5, not touched yet).
Migrations for the MVP-populated tables only (08 §4.1): the `core_objects`
spine + epistemic-status constraints (04 §2), `events`/`event_fitness_session`/
`fitness_session_set`, `event_calendar_item`, `observations`/`observation_vital`/
`observation_sleep`/`observation_journal_entry`/`observation_injury_flag`,
`health_profile`(`_history`), `goals`/`goal_habit_detail`(`_history`),
`actions`, `decisions`/`outcomes`, `memories`/`memory_reasons`(`_history`),
`agent_outputs`/`agent_output_sources`, `agent_conversations`/`agent_turns`,
`baselines`, `users`/`user_roles`/`webauthn_credentials`/`sessions`,
`integrations`, `permission_scopes`/`permission_grants`, `consent_records`,
`documents`/`document_links` (export-bundle rows only), `audit_log`.
Apply the noted schema fixes while writing these migrations, not after:
`ON DELETE CASCADE`/`SET NULL` on the FK cascade gap (07 §10), the
`mental_health` naming (already consistent across docs, just confirm the
migration uses it). RLS per 04 §10 on every table above: `ENABLE` +
`FORCE ROW LEVEL SECURITY`, `SET LOCAL app.current_user_id` per request
transaction, never `SET`.

**Verification**: `docker compose up`, run migrations, connect as the app
role, confirm a query for another `user_id` returns zero rows (not an
error) with RLS forced. This single test is the concrete proof for T2's
"must-fix" disposition.

## Milestone 2 — User-entered data: auth, journal, and the CRUD surface

**Builds**:
- Sign in with Apple backend (D7): verify Apple identity token (JWKS),
  upsert `users` on `apple_sub`, issue 15-min access JWT + refresh token,
  write `sessions` row (device info, timestamps, revocation flag) — this
  is T1's must-fix.
- `AuthGuard` + `ScopeGuard` (03 §2.3); `EntitlementGuard` as a
  pass-through stage per 08 §9.2 (present, gating nothing).
- The plain CRUD surface from the Context section above: journal entries
  (`observation_journal_entry`, both free-text and structured check-in —
  the MVP loop requirement 08 §1 names), workout logging
  (`event_fitness_session`, `executed_by='user'`), medication dose logging
  (`action_medication_log` — confirm at implementation time that no
  agent-callable tool ever writes this table, closing 04 §14's flagged
  cross-check for real). Every write goes through the same RLS session
  variable and audit-log path as agent tools, just without the Scoped
  Tool authorization/risk-tier chain (there's no agent in the loop).
- iOS: add a Journal entry screen (new — see Context). Wire `LoginView`'s
  `SignInWithAppleButton.onCompletion` and "Use a Passkey instead" to real
  token exchange (currently both just call `session.completeSignIn()`
  with the `Result` discarded). Add `loading`/`error` states to
  `AuthStage` (currently only `loggedOut`/`signingUp`/`loggedIn` — no way
  to represent a request in flight or a failed sign-in). Add Keychain
  token storage and an app-launch session-restoration check (`RootView`
  currently always cold-starts at `.loggedOut`). Wire `SignUpView`'s
  `selectedGoal` (currently collected into `@State` and silently
  discarded on submit) into the real sign-up call. Wire `LogWorkoutSheet`
  and `LogDoseSheet`'s "Save" buttons (currently just `dismiss()`, per the
  iOS audit) to the real writes.

**Verification**: real device/simulator Sign in with Apple round-trip
(needs the capability enabled in Xcode Signing & Capabilities with a real
Apple Developer team — not yet configured, a dependency to resolve before
this milestone's iOS half can be tested, independent of Milestone 0).
Journal entry, workout log, and medication log each produce a real,
RLS-isolated row, confirmed by direct DB query.

## Milestone 3 — HealthKit + Calendar sync (client-driven, Tier 1 only)

**Builds**: iOS requests HealthKit read (sleep, heart rate, workouts) and
EventKit calendar read permissions. Per D4/03 §2.8, Apple Health is
**client-driven, no server OAuth** — the app itself reads HealthKit and
posts normalized observations to a backend sync endpoint. Backend:
ingestion endpoints writing `observations`/`observation_sleep`/
`observation_vital` and `events`/`event_calendar_item`, with provenance
fields set correctly (`is_imported=true`, `provider='healthkit'` /
`'apple_calendar'`). `ConnectedAppsView`'s currently-hardcoded "Connected"
rows (Apple Health, Apple Calendar) become real permission-status checks.

**Verification**: a real sync (simulator can partially fake HealthKit
data) produces real rows with correct provenance.

## Milestone 4 — Personal Baseline Engine (the `worker` task, minimal)

**Builds**: the `worker` Fargate task/module (03 §2.5) — for MVP, a
scheduled job (nightly is enough; no need for real-time recompute)
computing rolling mean/stddev/z-score into `baselines` for sleep,
training-load, and mood/stress (the three MVP domains). Enforces the
worker RLS discipline `SET LOCAL` pattern per-user, never a pooled
connection reused across users (T9's must-fix, and the specific hazard
04 §10 calls out for this task).

**Verification**: seed a week of observations for a test user, run the
job, confirm a `baselines` row with a sane classification
(normal/improving/deteriorating/anomalous/repeated_pattern/new_pattern).
Then a second test user in the same job run, confirming no cross-user
leakage through the connection pool — this is the concrete proof for
that specific T9 sub-item.

## Milestone 5 — Agent orchestration and the three MVP specialist pairs

The largest milestone; the one everything else exists to feed.

**Builds**:
- `ModelProvider` abstraction (D3) wrapping the Claude Agent SDK — the
  only file allowed to import it.
- Life Master Agent orchestrator (03 §2.4): parse intent → classify
  domains (cheap/fast model) → `get_context_snapshot` → dispatch the
  relevant specialist pair(s) **sequentially, not in parallel** (05 §1's
  explicit decision — primary agent's complete output feeds the second
  agent) → collect `AgentOutput` contracts → disagreement detection (self-
  declared + orchestrator backstop, 05 §8) → compose one response,
  surfacing disagreement rather than silently picking a side.
- The exact MVP Scoped Tool registry (05 §3, full tool list already
  extracted — not repeated here), each implementing the 8-step chain (05
  §6): authorization from `RequestContext` only → validation → risk-tier
  check → confirmation if required → execution (RLS-scoped) → audit,
  always, including denials. Build-time tier-consistency assertion at
  startup (T4's must-fix). `cancel_scheduled_workout` — the one Tier 2+
  write tool at MVP — gets real confirmation-token binding (scoped,
  single-use, time-boxed HMAC — T7's must-fix).
- Untrusted-span isolation for raw journal text before it reaches
  `mental_context`/`clinical_safety_handoff` (T5's must-fix — the one raw-
  text injection surface at MVP, directly in front of the crisis-detection
  pair).
- Epistemic-status-consistent hedging in all three specialists' system
  prompts — no causal claims, no fact-shaped phrasing for
  `ai_inference`/`recommendation` outputs (T12's must-fix).
- Per-session/user rate limit on the ask endpoint (T9's must-fix — direct
  cost exposure per call).
- iOS: wire `AskView`'s question submission (currently a hardcoded
  question/answer pair) to a real `POST /v1/agent/ask`, rendering the real
  `AgentOutput` shape. Wire `HomeView`'s `InsightCard` actions ("Move
  today's workout" / "Not today" — currently empty closures) to the real
  Tier 2 confirm flow for `cancel_scheduled_workout`.

**Verification**: ask "should I train tonight?" against seeded data (the
exact worked example in 03 §4) — confirm real sequential dispatch of the
Fitness and Health pairs, confirm disagreement between them surfaces
rather than getting silently resolved, and confirm a full Tier 2
confirm→execute→audit round trip for cancelling a workout.

## Milestone 6 — Privacy & data-control (non-negotiable per 08 §7)

**Builds**: account deletion, the full workflow (07 §7), simplified at MVP
scale (no `clinical_memories` to purge, export-bundle-only S3 objects).
Data export bundle with the reduced MVP folder set (`profile/`, `goals/`,
`health/`, `fitness/`, `mental_health/` behind reauthentication,
`memories/`, `ai/`, `audit/`). Consent records for the three types actually
exercised (`tos`, `health_data_processing`, `mental_health_data_processing`).
Permission-grant listing + revoke. iOS: wire `PrivacyDataView`'s two
placeholder screens (currently literally say "not wired to a backend
yet") to these real endpoints.

**Verification**: export produces a real, downloadable bundle matching
the reduced folder set; account deletion actually removes/anonymizes rows
end-to-end, re-verified against the same RLS test from Milestone 1.

## Milestone 7 — Security & ops hardening pass

Sweeps the remaining T1–T12 must-fix items not already covered by
finishing a feature milestone above: least-privilege DB roles (no
interactive superuser shell for routine prod ops), baseline
CloudTrail/GuardDuty, one verified restore test (backups only "count" once
restored, per `CLAUDE.md`), and an IDOR test suite specifically targeting
`cancel_scheduled_workout` (the one Tier 2+ target that exists at MVP).

**The infrastructure-level break-glass gap** (T10's largest named gap,
still open per `CLAUDE.md`'s "Known open items": who holds RDS superuser /
AWS IAM admin / KMS key-usage permission, and whether their use is
audited outside the application's own audit log) gets resolved **here**,
as IAM/infra policy — this is the one item in this whole plan that isn't
a coding task.

**Verification**: run the `security-review` skill against the auth/RLS/
tool-authorization/injection surface; execute an actual restore drill into
the same private-VPC-locked environment and log it.

## Milestone 8 — Deploy the AWS skeleton (staging first)

**Builds**: RDS Postgres Multi-AZ (private subnet), ALB, one `api` and one
`worker` Fargate task, S3 (SSE-KMS), Secrets Manager, KMS — the MVP-sized
buildout ADR D4 commits to ("a single small RDS instance and a couple of
Fargate tasks, not a large multi-service buildout"). Staging environment
only; production is a separate, later decision.

**Verification**: staging is reachable, RLS still enforced remotely,
Milestone 7's restore drill repeated against staging specifically.

## What this plan deliberately does not include

Everything `docs/08-mvp-definition.md` §8 already puts out of scope
(Nutrition/Learning/Productivity-as-specialist/Finance/Social/Travel/Career,
all Tier 2/3 integrations, professional sharing, subscriptions/RevenueCat,
embeddings/semantic retrieval, push notifications, support tooling) stays
out of scope here too — this plan implements Phase 0's MVP, it doesn't
re-litigate it. A professional penetration test stays gated on commercial
launch, not this plan, per 08's own explicit deferral.

## Suggested sequencing

Milestones 1→2→3→4→5→6 are a genuine dependency chain (each needs the
previous one's data or auth). Milestone 7 (hardening) and Milestone 8
(deploy) can start once Milestone 1 exists and run partly in parallel with
2–6, since infra/ops work doesn't block feature work and vice versa.
Milestone 0 (Xcode verification) is independent and should happen as soon
as convenient — it blocks nothing on the backend side, but it blocks every
iOS-side verification step above.
