# plos — Architecture Decision Record (Phase 0-A)

> Decisions below are the foundation every other Phase 0 document builds
> on. Each one states the decision, why, the alternatives considered, and
> the trade-off accepted — per the FIRST TASK format in the product vision
> doc. These are real decisions, not placeholders — but every one is
> revisable with a documented reason, not a silent change (per `CLAUDE.md`).

## D1. Mobile client: native SwiftUI (iOS-first)

**Decision**: Native iOS app in SwiftUI. No cross-platform framework.

**Why**: Product vision §50 mandates this directly. It's also the right
call independent of that mandate: plos's MVP depends on deep, fast-moving
platform integration (HealthKit, EventKit, StoreKit 2, Sign in with Apple,
Passkeys, Liquid-Glass-era HIG) where native access is more complete and
lower-latency-to-ship than a cross-platform bridge, and the brand doc's
Apple-quality interaction bar (§05–06) is easier to hit natively.

**Alternatives considered**: React Native/Expo (mature, and the official
`expo` plugin found in the capability audit even bundles SwiftUI
components) — rejected because it still shells out to native modules for
HealthKit/StoreKit depth, adding a translation layer for no benefit when
there's no Android requirement in the MVP (product vision never mentions
Android). Flutter — same objection, worse HealthKit ecosystem maturity.

**Trade-off accepted**: no Android reach. Acceptable — product vision's
MVP and even its roadmap never mention Android; revisit only if market
strategy changes.

**Superseded in part, 2026-09-21 (direct instruction, mid-Milestone-2):**
market/reach requirement changed — plos now needs to reach PC, iPad,
Apple Watch, Linux, Windows, and Android, not iOS-only. This does **not**
reverse D1's core reasoning for the *Apple* client: SwiftUI stays for
iPhone/iPad/Watch, specifically because the HealthKit/StoreKit2/Liquid-
Glass argument above is still true and there is no cross-platform
framework that reaches those APIs as well. What changes is the closed
"no Android reach" trade-off and the assumption of a single client:

- **Apple platforms** (iPhone, iPad, Apple Watch): stays native SwiftUI —
  `apps/ios`, extended with a watchOS companion target. Mac reach comes
  free via the existing SwiftUI code (Catalyst or a native macOS target,
  not yet decided — a Milestone-2-adjacent detail, not a new ADR).
- **PC, Linux, Windows**: no native SwiftUI path exists on these OSes at
  all — a new client is required. Decision: a responsive web app
  (`apps/web`), not a per-OS native rewrite, since a single web codebase
  reaches all three desktop OSes through the browser with no separate
  build/distribution pipeline per platform.
- **Android**: a genuinely new requirement D1 explicitly didn't have.
  Decision: native Android (Kotlin/Jetpack Compose), not a cross-platform
  rewrite of the whole app — same reasoning as D1's original iOS
  argument, applied to the platform that now needs its own native reach,
  and it keeps the *existing, already-verified* SwiftUI/PlosDesignSystem
  work untouched rather than discarding it for a shared framework.

**New trade-off accepted**: three client codebases (`apps/ios`,
`apps/web`, `apps/android`) instead of one, each independently
implementing the brand/design system rather than sharing UI code across
platforms. All three are thin clients over the same `apps/api` NestJS
backend (D2) — no backend logic duplicates, and Sign in with Apple's
REST-based identity-token flow (D7) works identically regardless of which
client obtained the token, so Milestone 2's auth backend needed no
redesign for this change, only the recognition that it was never iOS-
specific to begin with. Alternatives considered: a full rewrite onto one
cross-platform framework (React Native, Flutter, Kotlin Multiplatform) —
rejected for the same reason D1 originally rejected them (HealthKit/
StoreKit2/Liquid-Glass depth), now doubled by the cost of discarding
already-verified, working SwiftUI code for no functional gain on the
platforms it already covers well. Sequencing (which client gets built
first/next) is a Phase 1 planning question, not an architecture one —
see `docs/09-phase1-implementation-plan.md`.

## D2. Backend language: TypeScript (Node.js) with NestJS

**Decision**: The API layer and the Life Master Agent orchestration layer
are one TypeScript/Node.js service (NestJS framework), not two languages.

**Why**: (a) NestJS's dependency injection and guard/interceptor model is
a natural fit for the non-negotiable "every sensitive query enforces
authorization server-side" (product vision §12) — permission scopes
(§15) become guards, not scattered `if` checks; (b) the agent
output-contract schemas (§7) and the DB row types can share one type
system end-to-end (API request → agent tool call → DB row), cutting a
whole class of the "agent hallucinates a field that doesn't exist"
failure mode down at compile time; (c) Anthropic's Agent SDK (found
installed as `agent-sdk-dev` in the capability audit) has first-class
TypeScript support; (d) if a companion web surface is ever built (the "My
Data & Privacy" control center, product vision §23, could plausibly be
web rather than only in-app), it shares the same language and some of the
same validation code.

**Alternatives considered**: Python/FastAPI — the strongest real
alternative; better if the team's own engineering strength is Python, and
Pydantic's schema validation is arguably even more natural for the agent
output contracts than TypeScript's. Rejected as the *default* here only
for lack of a stated team preference and because (c) and (d) above tip
narrowly toward TypeScript — **this is the single most reversible-if-wrong
decision in this document; if the actual engineering team is Python-first,
swap this line item, not the rest of the ADR.** Go — rejected: weaker
LLM/agent ecosystem, more boilerplate for the iteration speed an MVP needs.

**Trade-off accepted**: Node's ecosystem for numeric/scientific work
(baseline statistics, the Personal Baseline Engine's "improving /
deteriorating / anomalous" classification from the strategy doc) is
thinner than Python's. Mitigation: that logic is simple enough
(rolling means/stddev, z-score-style deviation) not to need a
scientific-computing stack; revisit only if the Baseline Engine grows
into real statistical modeling.

## D3. Agent orchestration: Claude Agent SDK behind a `ModelProvider` abstraction

**Decision**: Build the Life Master Agent's tool-calling loop, context
management, and specialist dispatch on Anthropic's **Claude Agent SDK**,
but never let application code call the SDK or any model API directly.
Every specialist and the orchestrator itself talks to a `ModelProvider`
interface (`generate()`, `embedding()`) that the SDK integration
implements. Structured agent I/O uses the exact contract in product vision
§7–8, validated against a JSON Schema independent of the SDK's own types.

**Why**: satisfies the model-agnostic non-negotiable (product vision
rule #23, strategy doc's "context engine must be model-independent")
without hand-rolling the tool-calling loop, context window management, and
retry/error handling the Agent SDK already provides. The abstraction layer
is the actual deliverable that makes swapping models possible later — the
SDK choice only affects the current implementation of that layer.

**Alternatives considered**: fully hand-rolled orchestration (rejected:
reinvents solved problems — tool-call parsing, streaming, context
trimming — for no strategic benefit); a multi-provider framework like
LangGraph or Atomic Agents (found in the capability audit) — rejected for
MVP: adds a heavy dependency and a second abstraction layer *on top of*
the one we're already building for model-agnosticism, and the product
launches Claude-first regardless: the marginal value of framework-level
multi-provider routing before there's a second provider in production is
low. Revisit if true simultaneous multi-provider routing (not just
future swappability) becomes a real requirement.

**Trade-off accepted**: some coupling to Anthropic SDK idioms in the
`ModelProvider` implementation itself. Contained by design — only that one
implementation file should ever import the SDK.

## D4. Cloud & hosting: AWS, private VPC, from day one — including MVP

**Decision**: AWS. RDS for PostgreSQL (Multi-AZ) in a private subnet, no
public database endpoint; application tier in private subnets behind an
API Gateway/ALB; S3 for object storage; KMS for encryption keys; Secrets
Manager for credentials; CloudTrail/GuardDuty for baseline audit and
threat detection. This applies **starting at MVP**, not after.

**Why**: product vision §12 requires private DB networking and no public
DB endpoint as an architectural property, not a post-launch hardening
step, and the vision explicitly warns against exactly the trap of
"designing around privacy later" causing "future architectural rewrites."
A health/financial/mental-health data product retrofitting private
networking after a public-beta MVP is the failure mode to avoid, even
though it costs more ops overhead on day one than a PaaS would.

**Alternatives considered**: a lighter PaaS (Render, Fly.io, Railway — all
present in the capability audit's marketplace scan) for MVP velocity, with
a planned migration to AWS later. Rejected as the default: several of
these *can* do private networking, but "migrate to compliant
infrastructure once we have real users and their real health data on the
old infrastructure" is precisely the sequencing the vision's own
compliance section warns against. Acceptable **only** as a throwaway
prototype/spike environment that never touches real user data — not
acceptable for anything that will hold a real user's health data, even in
early beta. GCP/Azure — comparable technically; AWS chosen for the
maturity of its compliance tooling ecosystem (HIPAA-eligible service
list, Secrets Manager, KMS, well-documented private-networking patterns)
and no other differentiating factor either way.

**Trade-off accepted**: higher ops complexity and cost than a PaaS at MVP
scale (product vision rule #25, "build the smallest useful thing," is in
tension with this — resolved by keeping the *infrastructure* minimal
inside AWS: a single small RDS instance and a couple of Fargate tasks, not
a large multi-service buildout — smallest-useful applies to scope and
feature count, not to skipping the security non-negotiables).

## D5. Database: PostgreSQL on RDS is the sole source of truth; pgvector for retrieval

**Decision**: One RDS PostgreSQL instance is canonical for all structured
data. Vector/semantic search uses the `pgvector` extension **inside that
same database** — no separate vector database.

**Why**: product vision rule #18 requires Postgres as the source of truth
and rule #18/§9 requires the vector store never be authoritative. Using
`pgvector` in the same instance makes that non-negotiable true *by
construction* — there is no second store that could drift out of sync,
need separate backup/restore testing, or need separate tenant-isolation
enforcement. It also directly serves the strategy doc's Context Engine
requirement (baselines, relationships, timelines, and embeddings living
in one auditable place).

**Alternatives considered**: managed Postgres platforms with more
built-in DX (Supabase, Neon — both found in the capability audit) —
rejected as the primary store for the same reason as D4: they interpose a
vendor-managed layer between us and the database, complicating direct
control over backup/restore testing (rule #19) and private networking in
the way the vision requires; reasonable for a prototype, not for the path
that touches real user data. A dedicated vector database (Pinecone,
Weaviate) — explicitly deferred, not rejected: revisit only if embedding
volume/query patterns genuinely outgrow what `pgvector` handles well, at
which point it becomes a read-path optimization behind the same
Context-Engine interface, not a source-of-truth change.

**Trade-off accepted**: `pgvector` at large scale has different
performance characteristics than a purpose-built vector engine. Acceptable
at MVP-and-beyond scale (a single user's personal context, not
web-scale search); revisit only with real evidence of a bottleneck.

## D6. Object storage & documents

**Decision**: S3, private buckets, SSE-KMS server-side encryption,
versioning enabled, access only via short-lived presigned URLs — never a
public bucket or public object ACL.

**Why**: direct requirement (product vision §9, §12). Versioning
supports the "important objects keep version history" rule (§27) for
uploaded documents (lab results, professional reports).

## D7. Auth: Sign in with Apple + Passkeys, first-party session model

**Decision**: Sign in with Apple as primary identity; WebAuthn Passkeys
for additional devices/recovery. Backend issues a short-lived access JWT
(~15 min) plus a rotating refresh token; refresh tokens are tracked
server-side in a `sessions` table (device info, issued/last-used
timestamps, revocation flag) so revocation, device management, and
suspicious-login detection (§14) are real, queryable operations — not
just "the client discards the token."

**Why**: direct requirement (§14). No custom-invented auth scheme (§14
explicitly warns against this).

**Alternatives considered**: a third-party identity vendor (Auth0,
WorkOS — both present in the capability audit) — rejected: these solve
enterprise SSO/multi-tenant-org problems plos doesn't have, and would add
a vendor in the critical path of every authentication event for a
consumer app that the vision already specifies a standard, well-supported
path for (Apple + Passkeys directly).

## D8. Subscriptions: StoreKit 2 + RevenueCat for server-side entitlement

**Decision**: StoreKit 2 on-device for the purchase flow; **RevenueCat**
(found as a real, well-integrated option in the capability audit) for
server-side entitlement sync, receipt validation, and App Store Server
Notifications v2 handling. Our backend queries RevenueCat's entitlement
API/webhooks as the source of truth for "is this user's subscription
active," rather than trusting the device.

**Why**: product vision §21 requires exactly this shape ("server-side
entitlement model... never trust only the device"), and correctly
implementing App Store Server Notifications v2 + receipt validation
in-house is a well-known source of subtle production bugs for very little
strategic benefit — it isn't part of plos's differentiation.

**Alternatives considered**: fully custom entitlement service against
Apple's App Store Server API directly — rejected for MVP as meaningfully
more engineering effort with no product benefit; revisit only if
RevenueCat's pricing or limits become a real constraint at scale.

**Trade-off accepted**: a billing-critical dependency on a third-party
vendor. Mitigated by RevenueCat being purpose-built for exactly this and
widely used in production iOS apps; our own entitlement table still stores
the last-known-good state so a RevenueCat outage degrades gracefully
(cached entitlement) rather than locking out paying users.

## D9. Repository structure: monorepo

**Decision**: one repository — `apps/ios` (SwiftUI/Xcode project),
`apps/api` (NestJS), `packages/shared-contracts` (agent output schemas,
DB row types shared where language boundaries allow, i.e. informing both
the TS backend and generated Swift models), `docs/` (this Phase 0 set and
everything after it).

**Why**: the team is small (per product vision §51's phased, incremental
build-up); a monorepo keeps the agent contract schema, the DB schema, and
the API in lockstep without cross-repo version-pinning overhead. Swift
doesn't participate in the JS package graph regardless, so this costs
nothing on the iOS side beyond living in the same folder tree.

**Alternatives considered**: separate `plos-ios` / `plos-api` repos —
rejected for MVP as coordination overhead disproportionate to team size;
revisit if/when the iOS and backend work is owned by genuinely separate
teams with separate release cadences.

**Extended 2026-09-21, following D1's supersession above**: two more app
directories join the same monorepo — `apps/web` (the PC/Linux/Windows
client) and `apps/android` (the native Android client). Same reasoning as
the original decision, now with three frontends instead of one: they all
depend on the same `apps/api` contract and the same `docs/` schema, and
none of them participate in each other's package graph (npm-based web
app, Gradle-based Android app, SwiftPM-based iOS app all coexist under
one `apps/` tree with zero build-tool cross-talk). `packages/shared-
contracts` becomes more valuable, not less, with three clients to keep in
sync against the API's actual response shapes — still TypeScript/JSON-
schema-based, informing generated types for the web app directly and
hand-mirrored into Swift/Kotlin models for the other two, since neither
platform has a mature shared-codegen story worth adopting for three
clients at MVP scale.

## D10. AI governance & evaluation tooling — deliberately deferred

**Decision**: this ADR commits to the *requirement* (every agent output
traceable to model/prompt/agent version and sources, per §45–46; automated
eval suites per §48) but does **not** commit to a specific tracing/eval
vendor (Langfuse, DeepEval, and others were noted as candidates in the
capability audit's forward-looking watchlist). That choice is deferred to
when the agent architecture (Phase 0-D) is actually implemented, so it's
made against real agent contracts instead of speculatively.

## Summary table

| Layer | Decision |
|---|---|
| Mobile | SwiftUI, native iOS |
| Backend/orchestration | TypeScript, NestJS, one service |
| Agent orchestration | Claude Agent SDK behind a `ModelProvider` abstraction |
| Hosting | AWS, private VPC, from MVP onward |
| Database | PostgreSQL on RDS (Multi-AZ), sole source of truth |
| Vector/semantic search | `pgvector` in the same Postgres instance |
| Object storage | S3, private, SSE-KMS, versioned |
| Auth | Sign in with Apple + Passkeys, first-party session table |
| Subscriptions | StoreKit 2 + RevenueCat |
| Repo | Monorepo |
| AI eval/tracing | Requirement fixed now; vendor deferred to Phase 0-D implementation |
