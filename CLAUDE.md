# plos — Development Operating System

**Status (update this line as phases complete):** Capability audit done
(2026-09-20). Phase 0 A–G drafted and reconciled (2026-09-20/21) — ADR,
system architecture, database schema, agent architecture, threat model,
privacy model, MVP — see the doc index below. A full cross-document
reconciliation pass ran and found 4 definite inconsistencies (all fixed)
plus 3 lower-priority items (see "Known open items" — two are real,
undesigned infra/upload work, deliberately left as such rather than
patched superficially; one is a cosmetic style note, deliberately not
mass-edited). Treat Phase 0 as reviewed, not merely drafted — but "reviewed"
is not "final": read the open items below before building against any of
this. Design phase started (2026-09-21): a brand/foundations + Home + Ask
plos design artifact exists (see "Design system" below). An iOS app build
started the same day, with a screen set wider than `docs/08-mvp-definition.md`
per direct instruction — see "iOS app" below for exactly what exists,
what's verified, and what isn't (the Xcode project itself now builds with
real Xcode as of 2026-09-21 — see the iOS app section's current state,
not this original note). `git init` has run for the
project (no commits yet — nothing is committed until asked). **Phase 1
Milestone 1 (backend bootstrap) is done and genuinely verified** — see
`docs/09-phase1-implementation-plan.md` and `docs/10-progress-checklist.md`
for exactly what's built and how it was proven (a real Postgres via
`embedded-postgres`, not a mock; 6/6 RLS tests passing). `apps/api` exists
(NestJS, 22 migrations, `TenantDatabaseService`). **Phase 1 Milestone 2
(auth + CRUD) is done end-to-end, backend and iOS; Milestone 3
(HealthKit + Calendar sync) is done end-to-end too; Milestone 4
(Personal Baseline Engine / worker) is done; Milestone 5 (Agent
orchestration + the 3 MVP specialist pairs) is done; Milestone 6
(Privacy & data-control) is done; Milestone 7 (Security & ops
hardening) is done** (all 2026-09-21). **Milestone 8 (AWS staging
deploy)'s Terraform is written** (2026-09-22, `infra/`) but unapplied —
still no running deployment; no AWS account exists in this environment
(confirmed: no AWS CLI, no credentials) — see "Backend" below and
`infra/README.md`. **Xcode is now installed** (2026-09-21) —
`apps/ios/plos.xcodeproj` builds successfully with real `xcodebuild` (one
real bug found/fixed: a wrong Swift package relative path), **and the app
was actually installed and launched on a real iPhone 17 simulator for the
first time ever** (2026-09-22, during the pre-Milestone-8 audit pass) —
found and fixed a second real bug in the process (`apps/ios/plos/Info.plist`
was missing `CFBundleIdentifier` and every other standard bundle key, so
the app built but could never have been installed anywhere). LoginView
renders correctly; screens past it (Sign in with Apple / passkey) can't
be reached in this environment — no real Apple Developer team configured,
an existing known blocker, not new. **Client-platform
scope changed 2026-09-21** (direct
instruction, mid-Milestone-2): plos now targets iPhone/iPad/Watch (native
SwiftUI, unchanged), PC/Linux/Windows (new: a web app, `apps/web`, not yet
started), and Android (new: native Kotlin/Compose, `apps/android`, not
yet started) — see ADR D1's "Superseded in part" note and D9's extension
in `docs/02-architecture-decision-record.md` for the reasoning and what
does/doesn't change. The backend (`apps/api`) is unaffected by this — it
was always a plain HTTP/JSON API, never iOS-specific. Sequencing for
`apps/web`/`apps/android` has not been decided yet; ask before assuming
which comes next. **A fresh gap audit across Phases 0-1/M1/M2 ran
2026-09-21** (see `docs/10-progress-checklist.md`'s "Gap audit" section)
— found and fixed two real, concrete gaps (no way to run `apps/api` as a
live server at all until now, and iOS's missing ATS exception would have
blocked every network call), plus three flagged items needing a
decision, not a code fix (passkey registration has no UI entry point, no
rate limiting on auth endpoints, a bundle-ID/audience consistency note).
`apps/api`'s dev database (`npm run dev:db`) and server (`npm run start`)
are running in the background as of this note, against a real persistent
(not ephemeral-per-test) Postgres for the first time.

## Client-platform scope (read before touching apps/web or apps/android)

Three client apps are now planned against one `apps/api` backend:
`apps/ios` (SwiftUI — iPhone, iPad, and a planned Watch companion target),
`apps/web` (PC/Linux/Windows, framework not yet chosen — default toward
a mainstream React-based stack unless told otherwise), `apps/android`
(Kotlin/Jetpack Compose). None of them share UI code; all of them
implement the same brand/design system independently (see "Design
system" below) and talk to the same REST endpoints. `apps/web` and
`apps/android` do not exist yet as of this note — don't assume screens,
build tooling, or even a chosen web framework are decided until this
paragraph is updated to say otherwise.

## What this project is

plos (Personal Life Operating System) — a personal AI system that connects
fragmented life data (health, fitness, nutrition, mental/emotional,
productivity, learning, finance, career, relationships, travel, goals)
into one coherent, longitudinal context, orchestrated by a single "Life
Master Agent" in front of scoped specialist agents. Full specs:

- [`docs/00-product-vision-master-prompt.md`](docs/00-product-vision-master-prompt.md) — product, architecture mandate, non-negotiable rules
- [`docs/00-brand-design-master-prompt.md`](docs/00-brand-design-master-prompt.md) — visual/brand system (design-phase input)
- [`docs/00-strategy-moat-and-hazards.md`](docs/00-strategy-moat-and-hazards.md) — moat thesis, hazard register, risk tiers (feeds architecture)
- [`docs/01-capability-audit.md`](docs/01-capability-audit.md) — what's actually installed vs. recommended, with evidence
- [`docs/02-architecture-decision-record.md`](docs/02-architecture-decision-record.md) — Phase 0-A: stack, hosting, and orchestration decisions with alternatives/trade-offs
- [`docs/03-system-architecture.md`](docs/03-system-architecture.md) — Phase 0-B: request pipeline, component responsibilities, compartmentalization, worked example
- [`docs/04-database-schema.md`](docs/04-database-schema.md) — Phase 0-C: tables, provenance/epistemic-status spine, RLS, versioning
- [`docs/05-agent-architecture.md`](docs/05-agent-architecture.md) — Phase 0-D: specialist roster, output contract, risk-tier gate, compartmentalization, disagreement handling
- [`docs/06-threat-model.md`](docs/06-threat-model.md) — Phase 0-E: threats against the actual system architecture/schema/agents, not generic OWASP boilerplate
- [`docs/07-privacy-model.md`](docs/07-privacy-model.md) — Phase 0-F: sensitivity tiers, permission-scope mapping, deletion/export workflows, professional sharing
- [`docs/08-mvp-definition.md`](docs/08-mvp-definition.md) — Phase 0-G: in/out scope for the smallest version that proves the core loop
- [`docs/09-phase1-implementation-plan.md`](docs/09-phase1-implementation-plan.md) — Phase 1: sequenced milestones (backend bootstrap → auth/CRUD → HealthKit/Calendar sync → baseline engine → agent orchestration → privacy endpoints → hardening → deploy), with the CRUD-vs-agent-tool scope reconciliation for the iOS app's wider screen set.
- [`docs/10-progress-checklist.md`](docs/10-progress-checklist.md) — granular, living checklist across every phase; update it as work completes, don't batch at session end
- [`docs/11-ops-security-runbook.md`](docs/11-ops-security-runbook.md) — Milestone 7: break-glass IAM policy/procedure, CloudTrail/GuardDuty checklist (Milestone 8), least-privilege DB role rationale, backup/restore verification cadence
- [`infra/README.md`](infra/README.md) — Milestone 8: the actual Terraform (RDS/ALB/Fargate/S3/KMS/Secrets Manager), written 2026-09-22, unapplied — no AWS account exists yet

### Design system (started 2026-09-21)

- Design artifact: https://claude.ai/artifact/ChhVF6Jd4wp5TV2At4b3Pv — 3 artboards (Brand & foundations, Home, Ask plos). Private; share from its own Share menu if someone else needs the link.
- Deliberately deferred, in both the artifact and the Swift code (same line drawn in both places, not silently widened at the code layer): dark mode, RTL/Hebrew, icon set beyond the plus mark and SF Symbols already in use.

### iOS app (started 2026-09-21, screen set expanded beyond `docs/08-mvp-definition.md` on direct request)

**Scope note, not silently absorbed into the MVP doc**: this build has more screens (login, signup, settings, profile, history, calendar, workouts, meds) than `docs/08-mvp-definition.md` scoped — that doc still reflects the deliberate 3-domain MVP; this expansion was an explicit user instruction ("keep it simple" on execution, not on scope) given in a later session, not a revision of the MVP decision. If the MVP doc's scope should actually change, that's a separate decision to make on its own, not something this note resolves.

- [`apps/ios/PlosDesignSystem`](apps/ios/PlosDesignSystem) — the Swift Package. Two products: the `PlosDesignSystem` library (everything below) and `PlosPreviewApp`, a real runnable macOS executable target that exists purely as a verification harness (`swift run PlosPreviewApp`). Design-system primitives: `PlosTheme`, `PlusMark`, `TodayStateGrid`, `InsightCard`, `GlassAskBar` (the one Liquid Glass surface, real `.glassEffect()` gated `#available(iOS 26, macOS 26, *)` with an `.ultraThinMaterial` fallback). `Networking/` (Milestone 2): `PlosAPI` (URLSession client for every backend endpoint), `KeychainStore`, `PasskeyCeremony`/`WebAuthnEncoding` (real `ASAuthorizationController` bridging). `DeviceSync/` (Milestone 3): `HealthKitService` (`#if os(iOS)`-gated, real `HKHealthStore` queries, macOS stub alongside since this package also builds for `PlosPreviewApp`), `EventKitService` (real on both platforms). Screens: `LoginView`/`SignUpView` (Auth/, real backend calls), `MainTabView` (Main/) with five tabs — `HomeView`/`AskView`/`JournalView` (Today), `CalendarView` (Calendar/), `WorkoutsView` (Workouts/, real Save), `HistoryView` (History/, still mock — no read endpoint yet), `MeView` (Me/, with `SettingsView`/`MedsView`/`ConnectedAppsView`/`PrivacyDataView` beneath it — `SettingsView` now has a real passkey-registration entry point, `ConnectedAppsView`'s rows are real permission checks + sync triggers, not hardcoded). `RootView` is the one public entry point. Milestone 5: `AskView` has a real text-entry bar (`GlassAskBar` elsewhere is a tap-to-open button, not a text field — a genuine `TextField` was added here) calling the real `POST /v1/agent/ask` and rendering the real evidence/confirm shape; `HomeView`'s Insight card runs the same real ask flow with a fixed canonical question (no separate "today's insight" endpoint exists yet — flagged, not hidden) and both cards' actions run the real Tier 2 confirm/decline round trip via new `PlosAPI` methods (`askAgent`, `requestCancelWorkout`, `confirmCancelWorkout`).
- **Verification boundary — read before trusting either half:**
  - The Swift package (everything above): fully verified, now with **real Xcode** (installed 2026-09-21, previously only Command Line Tools). `swift build` compiles every target (`PlosDesignSystem`, `PlosPreviewApp`) with zero errors; `swift run PlosPreviewApp` runs the full flow as a real macOS window with no crash, including the new session-restoration path on launch (no stored token → cleanly falls through to `.loggedOut`, no network-failure crash).
  - [`apps/ios/plos.xcodeproj`](apps/ios/plos.xcodeproj) (the actual iOS app target): **builds successfully with real Xcode 27** (`xcodebuild -scheme plos -destination 'generic/platform=iOS Simulator' build` → BUILD SUCCEEDED). One real bug found and fixed the moment real Xcode existed: the hand-authored `project.pbxproj`'s local Swift package reference pointed at `../PlosDesignSystem` (one directory too high) instead of the correct sibling path `PlosDesignSystem` — exactly the class of error this verification step existed to catch. **Not yet verified**: actually launching in a simulator and looking at it — no iOS Simulator runtime is installed (device profiles only), a download was in progress as of this note.
  - Sign in with Apple: `LoginView` now extracts the real Apple identity token and calls the real backend (`apps/api`'s `/v1/auth/apple`) — see "Backend" below. A genuine on-device/simulator round trip still needs the "Sign in with Apple" capability enabled in Xcode's Signing & Capabilities with a real Apple Developer team — not configured here. Passkeys are similarly real-but-unexercisable: they need an Associated Domains entitlement backed by a real hosted domain, which doesn't exist yet.
  - HealthKit (Milestone 3): **confirmed, not assumed, to need the same real-Developer-Team blocker as Sign in with Apple** — the `com.apple.developer.healthkit` entitlement (`plos/plos.entitlements`) is correctly declared but verified to NOT survive into the actual signed binary under this project's no-team automatic signing (inspected the `.xcent` file `codesign` actually uses: empty). EventKit (calendar) needs no entitlement and should work once a simulator is available. `HKHealthStore.authorizationStatus` also never reveals true grant/deny status for read types by Apple's own design — `ConnectedAppsView`'s copy says so rather than presenting a guess as fact.
- Not done: no StoreKit wiring; no dark mode/RTL (same deferral as the design artifact); Workouts/Meds/History screens still *display* mock lists even though Save and sync now write real rows (no read/list endpoint yet).

### Backend (`apps/api`) — Milestones 1-7 done 2026-09-21

- [`apps/api`](apps/api) — NestJS (ADR D2), one service. `src/database/tenant-database.service.ts` implements the RLS `SET LOCAL`/`set_config` mechanism (docs/04 §10.1) — the sanctioned way application code touches a tenant-scoped table, plus one explicitly-documented exception (`runPreAuth`) for identity-resolution, the worker's user-enumeration step, and (Milestone 5) the tool registry's build-time tier-consistency check, all of which necessarily run before any single user_id is in scope. `migrations/001`-`028` plus `999_embeddings.js` (node-pg-migrate; the embeddings migration was renamed to a fixed, far-future number in Milestone 7 after being mis-numbered relative to a new migration three separate times — see its own header) apply the full schema plus every milestone's additions, in FK-dependency/failure-ordering order. Real doc/implementation gaps found and fixed while writing, not silently: extension tables have no `user_id` column despite §10.2 claiming otherwise (`020`); no baseline table grants beyond `audit_log` (`021`); `audit_log` had no RLS `INSERT` policy (`022`); no `mental_health.write` scope (`024`); no `productivity.write` scope (`025`); no `agent.ask` scope and no confirmation-token table (`026`); no `users.deletion_requested_at` column for the account-deletion grace period (`027`); `plos_worker` had unnecessarily broad grants and had never actually been connected-to by any real code path (`028`, Milestone 7).
- **Milestone 2 (auth + CRUD)**: Sign in with Apple, Passkeys (`@simplewebauthn/server`, full register+login), the `AuthGuard`/`ScopeGuard`/`EntitlementGuard` pipeline (docs/03 §2.3), and a plain CRUD surface (`POST /v1/journal`, `/v1/workouts`, `/v1/medications`) distinct from the agent Scoped Tool layer. First-time sign-in self-grants every MVP scope except `professional.share`.
- **Milestone 3 (HealthKit + Calendar sync)**: `src/sync/` — `POST /v1/sync/health`/`/v1/sync/calendar`, client-driven (no server OAuth). `ImportService.insertSpineIfNew` makes every sync idempotent via `core_objects`'s `(provider, source, source_id)` unique index. Calendar sync never stores event titles (density signal, not content).
- **Milestone 4 (Personal Baseline Engine / worker)**: `src/worker/` + `src/worker-main.ts` — a headless `NestFactory.createApplicationContext` entry point (`npm run worker`/`worker:dev`), not an HTTP service, matching "a scheduled job, nightly is enough" (no separate Fargate task exists until Milestone 8). `BaselineService.computeForUser` opens one `runAsUser` transaction per user — the worker's own loop calls it once per user, sequentially, which is the entire T9 (cross-tenant leakage) mitigation. Real, from-scratch classification algorithm for `docs/04`'s 6-value enum (never given one): z-score buckets (±1.0/±2.5) with a per-metric direction, `new_pattern` for a metric's first-ever computation, `repeated_pattern` for a signal persisting across runs — genuinely uses all 6 values, while being explicit that it doesn't attempt real temporal pattern-mining.
- **Milestone 5 (Agent orchestration + 3 MVP specialist pairs)**: `src/agent/` — full detail in `docs/10-progress-checklist.md`. Headline points: a documented, reasoned deviation from ADR D3's literal `@anthropic-ai/claude-agent-sdk` package name (that package is the Claude Code CLI harness, not a fit for a stateless backend — the plain `@anthropic-ai/sdk` Messages API with a hand-rolled tool loop satisfies what ADR D3 actually asks for, behind the same one-file-imports-the-SDK `ModelProvider` abstraction); sequential (never parallel) pair dispatch; the full 8-step Scoped Tool chain with real, tested T4/T5/T7/T9/T12 threat-model must-fixes (build-time tier-consistency assertion, untrusted-journal-text spans, single-use HMAC confirmation tokens, per-user rate limiting, epistemic-hedged system prompts); disagreement surfaced via self-declaration + an independent model backstop, never silently resolved; a real gap found and fixed while building the consumer (Milestone 4's worker never computed the `productivity`/calendar-density baseline the worked example needs).
- **Verified for real**: `npm run test:rls` runs five e2e suites against a real `embedded-postgres` instance — **35/35 tests passing** (was 31/31 before Milestone 5), including Milestone 4's two stated bars and Milestone 5's own: real sequential Health+Fitness dispatch, a real persisted disagreement pointer between `fitness_performance`/`training_safety`, a full Tier 2 confirm→execute→audit round trip (with a rejected token-replay attempt), and the per-user rate limit actually 429ing. Found and fixed a genuine Jest/V8 cross-file interaction bug once a third suite was added (`--runInBand` caused one spec file's import shim to bind to a *different* file's torn-down environment — fixed by dropping `--runInBand`, documented in `rls.e2e-spec.ts`). `nest build` succeeds; `npm audit` unchanged. The real worker and the real API server (all agent routes registered, tier-consistency assertion passing) were both run against the live persistent dev database.
- **Milestone 6 (Privacy & data-control)**: `src/privacy/` — full detail in `docs/10-progress-checklist.md`. Headline points: a real object-storage substitution for the same reason Milestone 5 substituted its model SDK (no live AWS account in this environment) — `ExportBundleStorageService` implements ADR D6's exact contract (versioned put, signed short-lived download reference, delete-one/delete-all-versions) against the local filesystem, with the `documents` table already shaped for a real S3 client to slot in later; a genuinely valid downloadable ZIP export bundle matching docs/08 §7's reduced MVP folder set, with `mental_health/` gated behind a real two-step confirmation (reusing Milestone 5's confirmation-token service); the real 8-step account-deletion workflow (docs/07 §7) including a 14-day cancellable grace period or immediate deletion, with several non-cascading foreign keys found (not assumed) to need explicit deletion ordering by actually running it against Postgres; consent grant/revoke with real cascading scope revocation, and TOS-revocation correctly treated as an account-deletion trigger; permission-grant listing + revoke.
- **Verified for real**: `npm run test:rls` runs six e2e suites against a real `embedded-postgres` instance — **43/43 tests passing** (was 35/35 before Milestone 6), including both of this milestone's own stated bars: a real downloadable, structurally-valid ZIP, and account deletion actually removing/anonymizing rows end-to-end with a second user's data proven completely untouched — the same cross-tenant proof Milestone 1's own RLS test established, now applied to a destructive operation. `nest build` succeeds; the real API server (all privacy routes registered) and the new migrations were both run against the live persistent dev database.
- **Milestone 7 (Security & ops hardening)**: `docs/10-progress-checklist.md`'s Milestone 7 section has full detail. Headline points: least-privilege `plos_worker` DB role (was broad CRUD, tightened to exactly what the worker reads/writes, `028_least_privilege_worker_role.js`) — with a real gap found and closed along the way, since nothing had ever actually connected as that role before this milestone; a real 8-angle multi-agent security review of the auth/RLS/tool-authorization/injection surface producing 16 verified findings, 12 fixed; the single most severe fix was a systemic bug where `ToolExecutorService` denial/error audit rows were being silently erased by the caller's own transaction rollback, violating docs/05 §6's "audit always, including denials" rule — fixed by returning a typed result instead of throwing for denials, and auditing genuine faults on an independent transaction before rethrowing; a pre-existing (Milestone 2) passkey signature-counter clone-detection bypass, fixed; a real IDOR test suite (6 tests) targeting `cancel_scheduled_workout`, the one Tier 2+ target that exists at MVP; a genuinely executed backup/restore drill (`npm run restore-drill`) using Postgres's own physical stop-copy-restart method (no `pg_dump`/RDS available in this environment) — actually run once, logged `RESTORE VERIFIED`; `docs/11-ops-security-runbook.md` (new) covering the break-glass IAM procedure, a CloudTrail/GuardDuty checklist for Milestone 8, and the backup/restore cadence; a real `npm audit` fix (a genuinely-outdated `qs` pin two patches behind a fix, reachable via Express's own request parsing, not just build tooling) via a non-breaking `package.json` override rather than a NestJS major-version bump. Several lower-priority findings (the pre-`ToolExecutor` auth/guard denial-audit gap, a few reuse/duplication cleanups) were deliberately deferred, not silently dropped — see docs/10's Milestone 7 section for the full list with reasons.
- **Verified for real**: `npm run test:rls` — **51/51 tests passing** across 7 e2e suites (was 43/43 before Milestone 7), run three times consecutively with no flakes after the last fix. `nest build` succeeds after the dependency override. The new migrations were applied to the live persistent dev database, the real API server booted cleanly against it with every route registered, and the real worker ran against that same live DB connected as the tightened `plos_worker` role.
- **A real, persistent local dev server exists** (`npm run dev:db` + `npm run start`) — verified with genuine live HTTP calls, including hitting the real `appleid.apple.com` JWKS endpoint.
- Not done: no read/list endpoints for journal/workouts/medications/sync data (History/Workouts/Meds screens still show mock lists); no real Apple Developer team configured (blocks a genuine on-device Sign-in-with-Apple/passkey/HealthKit round trip); the real Anthropic model call has never been exercised in this environment (no API key); no real S3 (local-filesystem substitute, see above); no scheduled job finalizes a grace-period deletion automatically (no scheduler infra exists yet); CloudTrail/GuardDuty are a checklist, not live resources — no AWS account exists yet (Milestone 8's job); the systemic pre-authentication denial-audit gap is flagged, not fixed — everything else across the agent, privacy, and auth pipelines is verified for real.
- **Pre-Milestone-8 audit pass — DONE 2026-09-21** (full detail: `docs/10-progress-checklist.md`). Code leanness (`ponytail-audit`, whole-repo): 7 backend + 8 iOS findings applied (shared helpers replacing duplicated permission-grant/spine-insert/tool-arg-validation queries, dead-code deletions, a deduped glass-fallback modifier); `ModelProvider.embedding()` deliberately kept despite looking dead — ADR D3 commits the interface to it. Safety: three real gaps in the agent-output/tool-authorization layer, all fixed — epistemic-status tags (`fact`/`derived_fact`/`ai_inference`/`recommendation`) now actually reach the wire instead of stopping at the DB; a build-time assertion now rejects any tier-2+ tool whose `requiresConfirmation` doesn't return true; cross-domain disagreement (mechanism 3) is now audited and returned as a structured field instead of only trusted to the composition model's prose. Also fixed: `privacy.controller.ts`'s mental-health export denial/confirmation branches were missing audit-log rows. Accessibility: first-ever pass on `apps/ios`, 9 High findings (missing VoiceOver labels, ungrouped composite cards, a screen with no empty state) all fixed; zero hardcoded colors/fixed font sizes found across all 21 screens. Rate-limiting: the "auth endpoints uncovered" gap named above was **stale** — `AuthController` already has per-route `ThrottlerGuard` from Milestone 7 itself; corrected here and in the gap-audit note below. UI/UX folded into the same accessibility pass (same 21 files). **Correction made along the way**: this bullet and `docs/01-capability-audit.md` §3 previously named `yuval-skills:security-review` as an installed skill — it doesn't exist (`ListSkills` confirms); the actual tool used, both here and for Milestone 7's own security pass, is the bundled `code-review` skill.
- **Milestone 8 (AWS staging deploy) — IaC written 2026-09-22, unapplied** (full detail: `infra/README.md`, `docs/10-progress-checklist.md`). RDS Postgres 16 Multi-AZ, ALB, `api` Fargate service, nightly-scheduled `worker` Fargate task (EventBridge Scheduler, not a standing service), S3 (versioned, SSE-KMS), Secrets Manager, one KMS CMK, ECR — sized per ADR D4. Writing this against the real code (not just infra in isolation) surfaced and fixed two real, previously-undiscovered bugs: `migrations/001_roles_and_extensions.js` hardcoded the `plos_app`/`plos_worker` role passwords as plaintext literals (would have shipped these exact public passwords to a real production database — now reads them from the environment, with the original dev-only literals kept as the fallback so local/test behavior is unchanged); `export-bundle-storage.service.ts` only ever wrote to the local container filesystem (a real S3 bucket would have gone completely unused — now has a real `@aws-sdk/client-s3` path behind the same interface, toggled by `PLOS_OBJECT_STORE_DRIVER=s3`, unverified against a real bucket since none exists). Added `GET /health` (real DB round trip, tested) since the ALB's target group needs an unauthenticated endpoint and none existed. **Verified for real**: build clean, 53/53 `test:rls` (was 51/51) after all of the above. **Not verified, honestly**: nothing in `infra/` has been applied — no AWS account exists in this environment (no CLI, no credentials, checked not assumed) — so RLS-enforced-remotely, the restore-drill-against-real-RDS, and the S3 client's actual behavior all remain unconfirmed until one does.

### Known open items (from the completed reconciliation pass, 2026-09-21)

Fixed during reconciliation (recorded so nobody re-discovers these):
stale `02-database-schema.md` links across four documents; a second,
independently-found dead link in the brand doc; the `mental_emotional` vs
`mental_health` domain-identifier split between the database schema and
agent architecture (unified on `mental_health`, matching product vision
§15's own example scope); a genuine coverage gap — the vision's tiered
notification requirement (§28–41) had zero representation anywhere in
Phase 0, now placed in `docs/03-system-architecture.md` §7 and scoped
out of MVP in `docs/08-mvp-definition.md` §8; and the threat-model/
privacy-model parallel-drafting gap around the §6.2 break-glass procedure
(now explicitly scoped against `docs/06-threat-model.md` T10 in
`docs/07-privacy-model.md` §6.2 and §10).

Still genuinely open (not superficially patched — real, undesigned work):

- **Infrastructure-level break-glass access** (`docs/06-threat-model.md`
  T10, `docs/07-privacy-model.md` §6.2/§10): who holds RDS Postgres
  superuser, AWS IAM admin, or KMS key-usage permission, and whether their
  use is audited anywhere outside the application's own (superuser-
  bypassable) `audit_log`. This is IAM/infra policy work, not a schema or
  document fix — resolve before any of those credentials are provisioned
  for real. **A concrete procedure is now written** (Milestone 7,
  2026-09-21): `docs/11-ops-security-runbook.md` covers the break-glass
  policy, role-assumption procedure, and cross-account CloudTrail
  logging — but it's a document waiting on Milestone 8's real AWS
  account, not yet an enforced policy against live credentials.
- **Malicious-document handling** (`docs/06-threat-model.md` T6): malware
  scanning, file-type allowlisting, upload/decompression-bomb limits.
  Moot at MVP (no user-uploaded document exists yet, per
  `docs/08-mvp-definition.md` §6) but undesigned — must be built into
  whichever code actually implements document upload, before the
  lab-result/professional-report upload feature ships.
- **Stylistic pattern, deliberately not mass-edited**: the reconciliation
  pass counted heavy em-dash use (~900 instances) and "X, not Y"
  contrastive framing (~250 instances) across the doc set — a genuine
  AI-writing tell, but a cosmetic one that doesn't affect any technical
  claim. Not worth a rewrite pass; mentioned so it's a known, considered
  trade-off rather than an unnoticed tic if it comes up later.

**If any instruction below conflicts with something a user message says in
the moment, the live instruction wins for that turn** — but don't silently
change these documents based on a one-off remark; if a request seems to
contradict the specs, say so and ask before treating it as a standing
change.

## Non-negotiables (full list: product vision §57)

Security is architecture, not a later pass. Privacy is product design, not
a legal page. The user controls their data. The LLM never gets
unrestricted DB access — only scoped, authorized, logged tools. AI
inference must never be presented as fact (FACT / DERIVED FACT / AI
INFERENCE / RECOMMENDATION are distinct). Every important AI output has
provenance (model/agent/prompt version, sources, timestamp). Agent
disagreement is surfaced, never silently resolved. AI never replaces a
licensed professional and never autonomously executes Tier 3/4 actions
(finance, medication, emergency clinical decisions — see risk tiers in the
strategy doc). No unnecessary AI notifications or filler ("no AI slack").
No permission requested without a feature that needs it right now.
PostgreSQL is the source of truth; a vector store is never authoritative.
Backups are only "verified" once restore has actually been tested. Account
deletion is a real, complete workflow. Architecture is model-agnostic,
provider-adapter-based, and auditable. Build the smallest useful thing
before expanding (product vision §52 MVP). **plos must become better at
understanding a person without becoming more invasive** (strategy doc's
closing principle) — breadth is only a moat under that constraint.

## The gate sequence — apply to every non-trivial request

1. **Capability check.** Is there an installed skill/plugin/tool for this
   already? Check `docs/01-capability-audit.md` first; if the need is new,
   check with `ListSkills`/`SearchPlugins`/`ToolSearch` before assuming a
   gap. If a real capability is genuinely missing and material to doing
   the task well, **say so explicitly and stop** rather than
   improvising a worse approximation — "I don't have X, here's what I'd
   need" is a valid, expected response, not a failure. Do not silently
   approximate a capability that was flagged missing (e.g. don't
   freehand Apple HIG compliance from general knowledge once the gap is
   known — say the skill isn't installed yet).
2. **Goal definition.** Translate the request into: objective → user →
   desired outcome → constraints → non-goals → measurable success
   criteria → dependencies → risks. For anything creative or
   architecturally consequential, this is what `yuval-skills:brainstorming`
   and `writing-plans` are for — use them rather than jumping straight to
   output.
3. **Research** when current external facts matter (library APIs, provider
   capabilities, regulatory specifics, or — as in this audit — verifying a
   third-party source before trusting it). Use `documentation-lookup`,
   `WebFetch`/`WebSearch`, or a research skill; don't answer from stale
   training knowledge when a five-minute check would confirm or refute it.
4. **Inspect current state** — the actual repo, actual installed
   capabilities, actual prior decisions in `docs/` — before proposing
   anything, rather than assuming.
5. **Design direction** (for anything user-facing): apply the brand/design
   master prompt's principles and process order (§44 of that doc) — brand
   concept and component system come before individual screens.
6. **Plan** non-trivial or multi-file work before touching code
   (`writing-plans`), including security/performance/accessibility/
   maintainability risk and whether an MCP/connector is required.
7. **Surface the plan and open decisions before implementing** anything
   that's expensive to reverse — a new architectural pattern, a schema
   choice, a third-party dependency, anything touching auth/data model/
   agent contracts. Cheap, clearly-scoped, reversible steps (e.g. writing
   another doc like this one) don't need a stop-and-ask.
8. **Implement** using TDD for anything with real logic
   (`test-driven-development`), subagent delegation for genuinely
   parallel/independent work (`dispatching-parallel-agents`,
   `subagent-driven-development`, or the `Workflow` tool for deterministic
   multi-agent pipelines — see `workflow-authoring`), and git worktrees
   (`using-git-worktrees`) when isolation from other in-flight work matters.
9. **Verify, don't assert** (`verification-before-completion`) — run
   tests/build/lint and read the actual output before claiming something
   works; for UI, actually drive it in a browser/simulator.
10. **Security gate** (bundled `code-review` skill, scoped at the changed
    security-sensitive paths — `yuval-skills:security-review` does not
    exist, corrected 2026-09-21; `claude-security`/`semgrep` remain
    marketplace-available-not-installed) before anything touching auth,
    user input, secrets, or a new API endpoint reaches "done."
11. **Anti-slop gate** (`stop-slop` for prose, `ponytail-review` for
    over-engineered/bloated code, `code-simplifier` if installed) before
    shipping UI copy, marketing text, or a finished feature.
12. **Report** what was done, what was verified (with evidence), and what
    remains open or unresolved — don't round up to "done" if a step above
    was skipped or partial.

Memory/instruction precedence when sources conflict: **explicit current
user instruction → these project docs → actual code/tests → other project
docs → this session's persistent memory.** Memory informs judgment calls;
it never overrides an explicit instruction or an authoritative doc.

## Phase gate (do not skip ahead)

No product code, no visual design assets, and no new "master" documents
get created until Phase 0 is done and reviewed: **A.** Architecture
Decision Record, **B.** System architecture, **C.** Database schema, **D.**
Agent architecture, **E.** Threat model, **F.** Privacy model, **G.** MVP
definition (product vision §60). Visual/brand work (logo geometry, tokens,
component library) additionally waits until Phase 0 has produced real
screens/flows for the design system to be designed against — a brand
system with nothing to apply it to is premature (see the sequencing note
at the end of the brand doc).

## Plugin/skill installation policy

I cannot install plugins or add marketplaces from a non-interactive
session — `/plugin` is an interactive terminal dialog. When a real gap is
identified (see `docs/01-capability-audit.md` for the audit method), I'll
name the specific, verified package and the exact command; you run it. I
will not recommend adding an unverified third-party marketplace when an
already-trusted one (official `claude-plugins-official`, or your existing
enabled account skills) covers the same need — this project will
eventually hold health, financial, and mental-health data, and every
installed plugin is code that can register hooks against this repo.
