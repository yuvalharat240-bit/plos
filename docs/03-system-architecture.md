# plos — System Architecture (Phase 0-B)

> This is Phase 0-B of the sequence fixed in
> [00-product-vision-master-prompt.md](00-product-vision-master-prompt.md) §60
> (A. ADR — B. **System architecture** — C. Database schema — D. Agent
> architecture — E. Threat model — F. Privacy model — G. MVP). It takes the
> stack fixed in [02-architecture-decision-record.md](02-architecture-decision-record.md)
> as given and answers the question that ADR deliberately left open: how the
> product vision's request pipeline (§60-B: `iOS App → API Gateway →
> Identity/Authorization → Life Master Agent → Specialist Agents → Scoped
> Tools → Data/Integrations`) actually runs on top of "one NestJS service"
> (ADR D2) rather than five separate network services, and where the
> [00-strategy-moat-and-hazards.md](00-strategy-moat-and-hazards.md) Context
> Engine, Personal Baseline Engine, risk-tier model, and compartmentalization
> rule attach to that pipeline. Database tables (Phase 0-C) and the exact
> tool-contract/subagent schema (Phase 0-D) are intentionally out of scope
> here and referenced only by shape, not by field list.

## 1. The one fact everything else in this document follows from

The product vision's §60-B pipeline reads like seven services in series.
ADR D2 puts the API layer and the orchestration layer in **one** NestJS
process, and ADR D4 puts that process behind **AWS API Gateway/ALB** with
"a couple of Fargate tasks" — not seven. Both are correct; they describe two
different planes:

- **Physical/network plane** (things with their own IP address and their
  own failure mode): iOS App, AWS edge (API Gateway/ALB), the `apps/api`
  NestJS process(es), RDS Postgres, S3, RevenueCat, external provider APIs,
  and the Anthropic API.
- **Logical/pipeline plane** (things the product vision names as request
  stages): Identity/Authorization, Life Master Agent, Specialist Agents,
  Scoped Tools. These are **modules inside the same NestJS process**, not
  network hops — a request never leaves the process between "Identity/
  Authorization" and "Scoped Tools." There is exactly one network hop on
  the way in (iOS → edge → NestJS) and one on the way out; everything in
  between is an in-process function-call chain (guards → orchestrator
  module → SDK subagent dispatch → tool provider).

This matters architecturally, not just semantically: it means the
authorization boundary that matters is a NestJS guard/DI boundary, not a
network boundary, so it has to be enforced in code on every tool call (§3.7,
§4) rather than assumed from "this call already crossed a network edge, so
it must have been checked." It also means the two Fargate tasks ADR D4
mentions are best read as **one codebase, two entry points**: an
`api` task (HTTP-facing, runs Identity/Authorization → Life Master Agent →
Specialists → Scoped Tools per request) and a `worker` task (no inbound
HTTP; runs the Context Engine's async ingestion/recompute jobs, §3.5). This
worker/api split is *this document's* decision, not stated in the ADR —
flagged in §9 for confirmation.

## 2. Component responsibilities

### 2.1 iOS App (SwiftUI, ADR D1)

Owns everything on-device: HealthKit/EventKit reads, the sync client that
pushes normalized deltas to the backend, session/token storage (Sign in
with Apple + Passkey credential, short-lived access JWT, refresh token —
ADR D7), and all rendering — including the FACT / DERIVED FACT / AI
INFERENCE / RECOMMENDATION distinction and the "why" evidence panel the
brand doc specifies ([00-brand-design-master-prompt.md](00-brand-design-master-prompt.md),
"Confidence & uncertainty" and "Insight component" sections), the
Home screen's "Today + one insight + Ask Agent" surface (product vision
§28–41), and the confirmation UI for Tier 1+ actions (§4, §5). It never
computes or stores baselines, embeddings, or cross-domain context — that
is server-side only (§3.5). The one privacy nuance worth flagging now for
Phase 0-F: HealthKit data is at its rawest on-device, before the sync
client ever uploads it — the device itself is a raw-data compartment this
document's server-side compartmentalization model (§4) doesn't cover.

### 2.2 Edge: AWS API Gateway / ALB (ADR D4)

Pure network edge: TLS termination, WAF rules, and coarse (IP/connection-
level) rate limiting per product vision §12. It holds no session state, no
domain logic, and makes no authorization decision — it routes every
`/v1/*` request to the `api` Fargate task and nothing else. The ADR's own
wording ("API Gateway/ALB") left open whether this is AWS's managed API
Gateway service or a plain ALB; this document resolves it as **ALB is
sufficient at MVP scale** — a single backend service with no per-route
API-key/usage-plan requirements doesn't need API Gateway's extra features,
and ALB is simpler to operate inside the private-VPC posture ADR D4 already
committed to. Flagged in §9 as a small addendum to D4 for the human to
confirm or override.

### 2.3 Identity & Authorization (NestJS guards/interceptors, in-process)

The first thing the request touches inside `apps/api`. Three checks run in
order, each able to reject before any domain logic runs: **AuthGuard**
verifies the access JWT (15-minute lifetime, ADR D7) and confirms the
backing `sessions` row hasn't been revoked; **ScopeGuard** checks the
request against the granular `resource.action` permission scopes from
product vision §15 (only the entry scope, e.g. `agent.ask` — per-domain
scopes like `health.read` are re-checked later, at the tool boundary, §3.7,
because only the Life Master Agent knows yet which domains a given question
touches); **EntitlementGuard** reads the cached RevenueCat entitlement row
(ADR D8) if the requested capability is gated by subscription tier. On
success it produces one object, `RequestContext {user_id, scopes,
session_id, entitlement_tier}`, resolved entirely server-side from the
verified token — **never from a client-supplied field** (product vision
§12's "never trust the client... or a client-supplied `user_id`"). Nothing
past this point trusts any other identity claim. This layer never reads or
returns domain content (health, journal, finance) — its only job is
deciding whether the request may proceed, not what it may see once it does.

### 2.4 Life Master Agent (orchestrator module, in-process, `ModelProvider.generate()`)

The single entry point into agent reasoning (product vision §2), running as
a module in the same NestJS process, driven by the Claude Agent SDK behind
the `ModelProvider` abstraction (ADR D3). Its job, per product vision §7's
orchestration steps: parse the request → classify which domains it touches
(a cheap/fast model call, per the strategy doc's model-routing principle —
routine classification doesn't need the expensive reasoning pass) → pull a
**context snapshot** from the Context Engine (§3.5) — derived, not raw —
→ dispatch the minimum necessary specialist subagents with the minimum
necessary data (§2.6) → collect each specialist's structured contract
(product vision §7: `finding, evidence[], confidence, uncertainty[],
recommendation, requires_human_review, requires_user_confirmation` +
provenance metadata) → detect disagreement between specialists → resolve
with evidence, never silently (CLAUDE.md non-negotiables; product vision
§57) → decide whether the *response itself* needs human/professional
review (§16) → assign the response a risk tier (strategy doc's tier model,
§4 below) → produce exactly one coherent answer. It never calls a Scoped
Tool directly for domain data — only specialists and the Context Engine's
own retrieval tool do that — which is what keeps it structurally on the
"derived context" side of the compartmentalization line (§4).

### 2.5 Context Engine & Personal Baseline Engine

These are not a pipeline stage a request passes through at call time —
they are a **standing, continuously-updated layer inside Data/Integrations
(§2.8)** that the Life Master Agent's and specialists' Scoped Tools read
from. Concretely: the `worker` Fargate task (§1) consumes normalized
provider data as it lands (webhook-driven for server-side adapters like
Strava/Garmin; poll- or app-sync-triggered for HealthKit, since Apple Health
has no server push) and, per the strategy doc's Context Engine definition,
writes derived rows back into Postgres — baselines, timelines, memory/
preference records, and (via `ModelProvider.embedding()`, the other half
of ADR D3's interface) the `pgvector` embeddings those records need for
semantic retrieval. The Personal Baseline Engine is the specific piece of
this that maintains, per domain per user, a rolling statistical baseline
(mean/stddev or z-score-style deviation — ADR D2's own trade-off note says
this doesn't need a scientific-computing stack) classified as *normal /
improving / deteriorating / anomalous / repeated pattern / new pattern*.
At request time, nobody recomputes a baseline live — the Life Master
Agent's context-snapshot tool and each specialist's domain tools **read**
these precomputed rows. This is what makes the strategy doc's latency
principle ("architect for cached/precomputed context") true by
construction rather than by discipline, and it's the mechanism that makes
compartmentalization (§4) enforceable: a specialist reading `baselines` and
`timelines` tables structurally cannot see the raw rows those tables were
derived from unless it calls a *separate, explicitly-authorized* raw-data
tool.

### 2.6 Specialist Agent pairs

Each domain's primary/verification pair (product vision §5–8's table) is
implemented as a **named Claude Agent SDK subagent**, not a separate
service and not a separate model call the orchestrator hand-rolls: the SDK
subagent mechanism gives each specialist its own system prompt, its own
model choice, and — the part that matters for compartmentalization — its
own **tool allow-list**, configured by the Life Master Agent at dispatch
time from the domain(s) it decided the request needs. A specialist never
sees the user's raw question in isolation with unrestricted tool access; it
sees the sub-task the orchestrator hands it plus exactly the tools that
domain is scoped to. The second agent in each pair (e.g. Training Safety,
Health Safety/Verification) is not a duplicate call — per product vision
§5-8 it verifies the first agent's finding, checks constraints, or offers
an alternative reading, and its output feeds the same structured contract
back to the orchestrator. Framing specialists as SDK subagents (rather than
independent orchestrator-level API calls) is this document's proposed
mapping of ADR D3's "specialist dispatch" — flagged in §9 as an assumption
for Phase 0-D to confirm or revise once the actual tool-contract schema is
designed.

### 2.7 Scoped Tools

The **only** path from any agent to data or to an action, per product
vision §44 and CLAUDE.md's non-negotiable that the LLM never gets
unrestricted DB access. Every tool is a NestJS provider — never raw SQL
reachable from agent code — and every call passes through the same chain
the strategy doc specifies: **Authorization check → Validation → Risk-tier
check → Confirmation if required → Execution → Audit**. Two enforcement
layers exist deliberately, not redundantly: the SDK subagent's tool
allow-list (§2.6) bounds what a specialist can even *attempt* to call —
this is the prompt-injection blast-radius control from the strategy doc's
hazard register — but the authorization check inside the tool provider
itself is what actually decides whether the call is permitted, re-verified
server-side against `RequestContext.scopes` and the tool's declared domain
+ risk tier, regardless of which agent invoked it. A compromised or
injected subagent that somehow emits a call outside its allow-list still
hits this second, server-side gate. Concretely, a tool's registration
declares: `domain`, `dataClass` (`derived` | `raw` | `write`), `riskTier`
(0–4, strategy doc), and the scope(s) required. Illustrative examples:

| Tool | Domain | Data class | Risk tier | Callable by |
|---|---|---|---|---|
| `get_sleep_baseline_deviation(user_id, window)` | Health | derived | 0 | Life Master Agent (context snapshot), Health Analysis |
| `get_recent_sleep_raw(user_id, nights≤N)` | Health | raw | 0 (read, logged) | Health Analysis, Health Safety only |
| `get_training_load_baseline(user_id)` | Fitness | derived | 0 | Fitness Performance, Training Safety |
| `get_active_injury_flags(user_id)` | Fitness | derived† | 0 | Training Safety only |
| `get_calendar_density_tomorrow(user_id)` | Productivity | derived | 0 | Life Master Agent, Focus/Scheduling |
| `move_calendar_event(event_id, new_time)` | Productivity | write | 1 | Focus/Scheduling, after user confirmation |
| `cancel_scheduled_workout(session_id)` | Fitness | write | 2 | Fitness Performance, after explicit confirmation |
| *(no tool exists)* | Finance | — | 4 | nobody — Tier 4 actions have no Scoped Tool at all |

† user-declared or clinician-flagged, not raw clinical text.

That last row is the point: Tier 4 (money movement, medication changes —
already prohibited outright by product vision non-negotiables #12/#16) is
enforced by **absence from the tool registry**, not by a prompt
instruction an injected context could argue around. A write tool's
`Confirmation if required` step is re-checked server-side against a
confirmation token the client returns — the app surfacing a "confirm" UI
is not itself sufficient; the server never executes a Tier 2+ write on the
strength of a client claim alone, for the same "never trust the client"
reason as §2.3.

### 2.8 Data & Integrations

The only component that ever holds the full raw picture, protected by
`user_id`-scoped, parameterized queries (never client-supplied `user_id`,
§2.3) and by Scoped Tools being the only way in (§2.7). Concretely: RDS
PostgreSQL Multi-AZ with `pgvector` in the same instance (ADR D5) holding
both raw normalized provider tables and the Context Engine's derived
tables (§2.5) — deliberately one database, so there is no second store
that can drift out of sync or dodge backup/restore testing; S3 for
binaries — lab PDFs, professional reports, imported documents — private,
SSE-KMS, versioned, accessed only via short-lived presigned URLs (ADR D6);
provider adapters implementing the uniform `connect, authorize, sync,
normalize, disconnect, revoke, healthCheck` contract (product vision
§17–20) for Tier 1 sources (Apple Health — client-driven sync, see §2.1;
Apple/Google Calendar; Strava) with Tier 2/3 providers added later behind
the same adapter shape, never with provider-specific logic leaking into
the Context Engine or agents; and RevenueCat as the entitlement source of
truth (ADR D8), queried by §2.3's EntitlementGuard and mirrored into a
local table so a RevenueCat outage degrades to cached entitlement rather
than locking out paying users.

## 3. Compartmentalization: who is allowed to see what

The strategy doc's compartmentalization rule ("the Life Master Agent
should, by default, receive derived context rather than raw sensitive
material") is a scoping rule per component, not a blanket policy — here is
what it means concretely for each one:

| Component | Sees raw domain data? | Sees derived context? | Basis |
|---|---|---|---|
| iOS App | Yes — its own device (HealthKit), transiently, pre-upload | Yes — rendered results only | §2.1 |
| AWS edge | No — TLS payload only, never decrypted for content | No | §2.2 |
| Identity/Authorization | No — identity/scope claims only | No | §2.3 |
| Life Master Agent | **No, by default** | Yes — baselines, timelines, specialist contracts | §2.4, strategy doc compartmentalization |
| Specialist Agents | **Only within their own domain, only when a specific tool call is genuinely necessary and authorized**, e.g. Training Safety reading recent raw session detail | Yes | §2.6, §2.7 |
| Scoped Tools | N/A — they are the boundary, not a viewer | N/A | §2.7 |
| Data/Integrations | Yes — the only component with the complete picture | Yes — it's where derived data is written | §2.5, §2.8 |

The consequence that matters most in practice: a specialist in one domain
never receives another domain's raw data through the orchestrator. If the
Fitness pair needs to know sleep was poor, it receives the **derived**
fact ("sleep 1h18m below 30-day baseline") that the Health domain's own
Context Engine tables already computed — never the raw sleep series, and
never routed *through* the Health specialist as a side channel. This is
also what bounds blast radius for the strategy doc's two existential
hazards (breach concentration, prompt injection): compromising the
Life Master Agent's context does not, by construction, hand an attacker
raw journal text or raw clinical data — only the derived summaries it was
scoped to receive.

## 4. Worked example: "Should I train tonight?"

1. **iOS App.** User taps "Ask your Life Master Agent" and types the
   question. The app sends `POST /v1/agent/ask {text}` over TLS with the
   access JWT in the `Authorization` header. It does not attach any health
   or calendar payload — the backend already has whatever was previously
   synced; the request carries only the question and client metadata
   (timestamp, locale).
2. **AWS API Gateway/ALB.** Terminates TLS, applies WAF/rate-limit checks,
   routes to the `api` Fargate task. No decision is made about the
   request's content.
3. **Identity & Authorization.** AuthGuard validates the JWT and the
   `sessions` row; ScopeGuard confirms the `agent.ask` scope; Entitlement
   Guard checks the cached RevenueCat row if "ask agent" is entitlement-
   gated. `RequestContext {user_id, scopes: [...], session_id}` is
   constructed server-side and attached to the request. Failure at any
   check returns 401/403 and nothing downstream ever runs.
4. **Life Master Agent — intent parse.** A fast model call classifies the
   question as touching **Fitness** (primary intent) and, because the
   product vision's own worked example (§3) is exactly this shape,
   **Health** (recovery/sleep is relevant to a training-tonight decision)
   and **Productivity** (tomorrow's calendar matters to *when* to train).
   It does **not** classify this as touching Nutrition, Finance, Learning,
   Social, Travel, or Career — those domains' specialists are never
   dispatched, satisfying "activate specialists with minimum necessary
   data" (product vision §7).
5. **Life Master Agent — context snapshot.** Calls the Context Engine's
   retrieval tool (`get_context_snapshot(user_id, domains=[health,
   fitness, productivity])`), which returns only precomputed, derived
   rows: a training-load baseline classification, a sleep-baseline
   deviation, and a boolean/level "calendar density tomorrow" flag — no
   raw sleep series, no raw calendar event titles or attendees (attendee
   detail isn't needed to answer a training-timing question, so it's
   never fetched — another concrete instance of minimum-necessary data).
6. **Specialist dispatch.** The orchestrator spawns, as SDK subagents with
   per-domain tool allow-lists (§2.6): **Fitness Performance Agent** +
   **Training Safety Agent** (tools: `get_training_load_baseline`,
   `get_recent_training_summary`, `get_active_injury_flags`), and
   **Health Analysis Agent** + **Health Safety/Verification Agent**
   (tools: `get_sleep_baseline_deviation`, and — only if a specialist
   decides it's genuinely needed — the raw-scoped `get_recent_sleep_raw`,
   which is logged whether or not it's called). Because a recommendation
   is what's being produced here (not a pure lookup), both agents in each
   of these two pairs run, per §2.6's "second agent verifies/risk-checks"
   role. For Productivity, only **Focus/Scheduling Agent** runs (tool:
   `get_calendar_density_tomorrow`) — its pair-mate, Productivity Planning
   Agent, is not dispatched, because this question needs one derived
   signal, not workload/task planning.
7. **Scoped Tool calls.** Every call above runs the chain from §2.7:
   AuthZ (does this session + this subagent's scope + this tool's declared
   domain line up) → Validate (schema-checked args) → RiskTier (all five
   calls here are Tier 0, read-only, informational — no confirmation gate)
   → Execute (a parameterized, `user_id`-scoped read against RDS, in most
   cases a `baselines`/`timelines` row the Context Engine already wrote,
   §2.5) → Audit (tool name, args hash, `user_id`, agent, risk tier,
   timestamp logged).
8. **Specialist outputs.** Each specialist returns the product-vision §7
   contract. In this run: Health Safety flags sleep 1h18m below the
   30-day baseline (`confidence: high`, `uncertainty: []`); Training
   Safety notes no active injury flag but elevated fatigue risk given the
   sleep deviation; Focus/Scheduling flags an early meeting tomorrow.
9. **Aggregation and disagreement handling.** Fitness Performance's raw
   training-load reading alone might say "on schedule, train as planned" —
   this is the disagreement the CLAUDE.md non-negotiable requires be
   surfaced, not silently resolved. The Life Master Agent weighs the
   safety-agent signal (per the pairing model's purpose) and composes one
   answer along the lines of the product vision §3 target-quality example:
   "Your sleep was significantly below your baseline last night, and you
   have an early meeting tomorrow. Consider a lighter session or moving
   tonight's high-intensity work to tomorrow evening." This is
   labeled a **RECOMMENDATION**, not a fact, with a "why" panel citing the
   specific evidence (sleep deviation %, training-load state, calendar
   flag) per the brand doc.
10. **Risk tier of the response.** Displaying this recommendation is Tier
    0 — no autonomous action was taken. If the user then taps "move
    tonight's session," *that* triggers `cancel_scheduled_workout` /
    `move_calendar_event`, both Tier 1–2 write tools (§2.7), which go
    through their own confirmation-and-audit gate independently of the
    read path above.
11. **Response and rendering.** The composed answer, its evidence list,
    confidence, and provenance metadata (`agent_version, model_version,
    prompt_version, data_timestamp, sources[], tools_used[]` — product
    vision §7–8) return through the NestJS process → AWS edge → iOS App,
    which renders it as a RECOMMENDATION with its FACT/DERIVED-FACT
    evidence, never as a flat assertion.

## 5. Diagram (supplement to §2–4, not a replacement)

```
 iOS App (SwiftUI)
   |  HTTPS + access JWT   (no domain payload in the request)
   v
 AWS edge: API Gateway/ALB  --  TLS term, WAF, coarse rate limit only
   |
   v
+-----------------------------------------------------------------------+
|  apps/api  --  ONE NestJS codebase (ADR D2), two Fargate entry points |
|                                                                         |
|  [api task, per-request]                                               |
|   Identity & Authorization                                             |
|     AuthGuard . ScopeGuard . EntitlementGuard  -->  RequestContext     |
|     |                                                                  |
|     v                                                                  |
|   Life Master Agent  (orchestrator; ModelProvider.generate())          |
|     | parse intent -> pick domains -> read context snapshot           |
|     |------------------------------------.                            |
|     v                                     v                            |
|   Specialist Agent pairs            (reads from)                       |
|   (SDK subagents, one tool          Context Engine tables              |
|    allow-list per domain)           (baselines, timelines,             |
|     |                                embeddings)                       |
|     v                                     ^                            |
|   Scoped Tools                            |                            |
|     AuthZ -> Validate -> RiskTier ->      |                            |
|     Confirm? -> Execute -> Audit          |                            |
|     |                                     |                            |
|  [worker task, async, no inbound HTTP]    |                            |
|   Context Engine / Personal Baseline Engine  -- writes -->  (above)    |
|     ingests provider syncs/webhooks; ModelProvider.embedding()         |
+-----|----------------------------------------------------------|-------+
      |                                                          |
      v                                                          v
 RDS Postgres + pgvector (ADR D5)                    S3 (docs, binaries, ADR D6)
 raw + derived tables, sole source of truth           private, SSE-KMS, versioned
      ^
      |
 Provider adapters (connect/authorize/sync/normalize/disconnect/revoke/healthCheck,
 product vision par.17-20): Apple Health (client-driven), Calendar, Strava, ...
 RevenueCat (entitlement, ADR D8) -- read by EntitlementGuard above
```

Note on the Anthropic API: it is not drawn as its own box because it has no
fixed position in the pipeline — both the Life Master Agent/Specialist
Agents (`ModelProvider.generate()`) and the Context Engine
(`ModelProvider.embedding()`) reach it, but only through the single
`ModelProvider` implementation (ADR D3); no other file in the codebase
imports the Anthropic SDK directly.

## 6. Mapping to the ADR's concrete stack

| Product vision §60-B stage | Concrete implementation | ADR ref |
|---|---|---|
| iOS App | SwiftUI, native | D1 |
| API Gateway | AWS ALB (this doc resolves D4's "API Gateway/ALB" to ALB, §2.2) | D4 |
| Identity/Authorization | NestJS guards/interceptors, `sessions` table | D7 |
| Life Master Agent | NestJS orchestrator module, Claude Agent SDK via `ModelProvider.generate()` | D2, D3 |
| Specialist Agents | Claude Agent SDK subagents, one per named agent in product vision §5–8's table | D3 |
| Scoped Tools | NestJS providers, DI-injected repositories only (no raw SQL from agent code) | D2 |
| Data/Integrations | RDS Postgres + `pgvector` (raw + derived), S3, provider adapters, RevenueCat | D5, D6, D8 |
| (not a §60-B box) Context Engine / Baseline Engine | `worker` Fargate task, same codebase, writes derived tables read by Scoped Tools | D2, D4, D5 (this doc's addition, §1) |

## 7. Cross-cutting concerns (thread through every component above, not a box of their own)

- **Observability/audit**: every Scoped Tool call and every guard
  rejection is logged (product vision §43–49) without logging raw
  sensitive payloads — the audit row records *that* `get_recent_sleep_raw`
  was called, by which agent, for which user, not the sleep data itself.
- **Latency/model routing**: the strategy doc's "cheap model for routine
  classification, expensive reasoning only when warranted" principle
  applies at the intent-parse step (§4.4) and nowhere else in this
  pipeline forces a specific model tier — that choice belongs to the
  `ModelProvider` implementation (ADR D3), not to this document.
- **Provenance**: every specialist contract and every Context Engine write
  carries the product vision §7–8 metadata fields; this document doesn't
  restate the schema, only confirms every component in §2 is a place
  provenance must be attached, not dropped, as data moves through it.
- **Notification tiering** (product vision §28–41; previously unaddressed
  anywhere in Phase 0 — found by the reconciliation pass): a notification
  is never sent directly by a specialist or the Life Master Agent. The
  Context Engine worker (§2, §5) is the only component allowed to enqueue
  one, and only after an Insight it produced already passed the "no AI
  slack" 5-question gate (relevant / evidenced / novel / actionable /
  worth interrupting — vision §32). Each enqueued notification carries one
  of the five vision-§31 tiers (Critical/Important/Useful/Optional/
  Silent), which maps to iOS delivery behavior at the client, not to
  anything server-architectural: Critical → time-sensitive interruption;
  Important → standard push; Useful/Optional → badge or in-app surface
  only, no push; Silent → logged to `audit_log`, never rendered. No new
  server component is implied beyond a `tier` column on whatever the
  Context Engine already writes when it produces an Insight — this is a
  policy applied at existing write/read points, not a new pipeline stage.
  Left for [08-mvp-definition.md](08-mvp-definition.md) to decide whether
  any tier ships at MVP.

## 8. Open questions / flags for a human to resolve

- **Numbering collision — resolved.** This was flagged when this document
  was drafted (the strategy doc linked to a `02-database-schema.md` that
  didn't exist yet, since `02-` had become the ADR). The sequence landed
  exactly as predicted (04 = database schema, 05 = agent architecture,
  06 = threat model, 07 = privacy model, 08 = MVP), and
  [00-strategy-moat-and-hazards.md](00-strategy-moat-and-hazards.md)'s
  link now correctly points to `04-database-schema.md`. Recorded here only
  so this bullet doesn't look like an open item to a later reader — this
  same stale claim was independently found stuck in `04-database-schema.md`
  §14 and `05-agent-architecture.md` §12 by the reconciliation pass and
  should be corrected there too.
- **AWS API Gateway vs. plain ALB** (§2.2): this document resolves ADR D4's
  "API Gateway/ALB" ambiguity in favor of ALB for MVP simplicity. That's an
  addition to, not a reversal of, D4 — worth folding back into the ADR
  explicitly if a human agrees, since D4 as written leaves it open.
- **Two Fargate tasks = api + worker** (§1, §5): ADR D4 says "a couple of
  Fargate tasks" without saying what they're for. This document assigns
  them (request-serving api task, async Context Engine worker task) as the
  simplest reading consistent with "smallest useful thing" — flagged for
  confirmation since the ADR itself never specified this split.
- **Specialists as Claude Agent SDK subagents** (§2.6): this document
  proposes the SDK's native subagent/tool-allow-list feature as the
  concrete mechanism for "specialist dispatch" under ADR D3. ADR D3 commits
  to the SDK generally but not to this specific mechanism — Phase 0-D
  (agent architecture) should confirm this is how the SDK is actually used,
  or document why a hand-rolled per-specialist dispatch was chosen instead.
- **Entitlement gating of "ask agent" itself** (§2.3, §4.3): whether the
  core "ask your Life Master Agent" capability is ever entitlement-gated,
  or only certain domains/specialists are, is a product-scope decision
  this document doesn't make — the EntitlementGuard is architected to
  support either, but which applies is unresolved here.
