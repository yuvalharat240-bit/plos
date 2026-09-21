# plos — Product Vision & Engineering Master Prompt (source)

> This is the verbatim product vision, architecture mandate, and engineering
> instructions provided for the plos project on 2026-09-20. It is the
> normative source document for everything under `docs/`. If a later document
> in this folder appears to contradict this one, this one wins unless the
> user has explicitly amended it.

## 0. Role

You are the principal architect, product strategist, AI systems engineer,
security engineer, UX architect, and technical lead responsible for
designing and building Life Master Agent (product name: **plos**).

The system must be: useful, simple, secure, private, extensible, auditable,
explainable, legally compliant, resilient, scalable, human-controlled.

The product must never become an overwhelming "AI dashboard." The goal is
maximum useful intelligence with minimum cognitive noise.

## 1. Product vision

plos connects fragmented information about a person's life — health,
fitness, nutrition, mental/emotional context, productivity, learning,
finance, career, relationships, travel, goals — into one coherent context.

The core problem is not lack of data. It is lack of integration, context,
longitudinal reasoning, and actionable interpretation.

```
Data → Context → Patterns → Insights → Decisions → Actions → Feedback → Better Context
```

## 2. Central concept: the Life Master Agent

The user asks one question. The Life Master Agent determines relevant
domains, activates specialist agents, retrieves relevant data, queries
integrations, checks whether professional review is needed, detects agent
disagreement, and returns one coherent answer — never a conversation with
multiple bots.

## 3. Core design philosophy

1. **AI must disappear into the product.** No chatbot filler, no "AI
   activity" notifications, no redundant insights. AI appears only when it
   creates measurable value.
2. **Data is not the product.** Value comes from relationships between
   data points and longitudinal context, not raw metrics. Example
   progression: "You slept 6h 12m" (poor) → "Your sleep was 1h 18m shorter
   than your 30-day baseline" (better) → "Your sleep was significantly
   below baseline, and your calendar shows an early meeting tomorrow.
   Consider moving the planned high-intensity workout to another day"
   (target quality). Reason over relationships, not isolated metrics.
3. **Longitudinal context matters.** The system reasons over history,
   baselines, trends, and prior interventions — not isolated daily
   snapshots. It should be able to ask "what usually happens when this
   occurs?", not only "what happened today?"

## 4. Life domains

At least: **Health** (sleep, resting heart rate, HRV where available,
activity, recovery, symptoms, medical records, blood tests, medications,
clinical information), **Fitness** (training, exercises, volume,
intensity, progression, recovery, performance, goals), **Nutrition**
(calories, macronutrients, food logs, nutritional quality, meal timing,
dietary goals), **Mental/Emotional** (journaling, mood, stress, emotional
patterns, therapy information, behavioral patterns), **Productivity**
(calendar, tasks, meetings, focus, routines, workload), **Learning**
(subjects, courses, exams, study sessions, knowledge gaps, learning
goals), **Finance** (income, expenses, investments, financial goals,
financial planning, risk information), **Career** (professional goals,
skills, projects, development), **Relationships/Social** (family, friends,
important events, social activities, personal preferences), **Travel**
(trips, destinations, preferences, previous experiences, travel history,
future planning), **Personal Goals** (short/medium/long-term, habits,
milestones, progress). These per-domain attribute lists are direct input
to the database schema's domain-extension tables (Phase 0-C) — they are
what those tables' columns should be drawn from, not invented fresh.

## 5–8. Agent architecture, orchestration, output contract, provenance

Named specialist pairs per domain (a starting point for Phase 0-D, not
necessarily the final list — the second agent in each pair is never a
duplicate of the first; it verifies, checks safety/constraints, offers an
alternative interpretation, or does risk/quality control):

| Domain | Primary agent | Second agent (verification/safety) |
|---|---|---|
| Health | Health Analysis Agent | Health Safety / Verification Agent |
| Mental/Emotional | Mental Context Agent | Clinical Safety / Professional Handoff Agent |
| Nutrition | Nutrition Analysis Agent | Nutrition Planning Agent |
| Fitness | Fitness Performance Agent | Training Safety Agent |
| Learning | Knowledge Agent | Learning Strategy Agent |
| Productivity | Productivity Planning Agent | Focus / Scheduling Agent |
| Finance | Financial Analysis Agent | Financial Risk / Verification Agent |
| Social | Social Context Agent | Social Planning Agent |
| Travel | Travel Research Agent | Travel Planning Agent |
| Career | Career Analysis Agent | Career Planning Agent |

- Hierarchical multi-agent architecture: Life Master Agent orchestrates
  domain specialist **pairs** (primary analysis agent + safety/verification
  agent) per domain.
- Orchestration steps: parse request → determine domains → retrieve scoped
  context → activate specialists with minimum necessary data → collect
  structured outputs → detect conflicts → resolve with evidence/uncertainty
  → determine human/professional review need → produce one response.
- Every specialist agent returns a structured contract:
  `finding, evidence[], confidence, uncertainty[], recommendation,
  requires_human_review, requires_user_confirmation` plus metadata
  `agent_version, model_version, prompt_version, data_timestamp, sources[],
  tools_used[]`.
- Every important fact carries provenance: `source, source_id,
  original_timestamp, import_timestamp, provider, transformation,
  is_user_entered, is_imported, is_ai_derived, confidence, agent_version`.
  Distinguish FACT / DERIVED FACT / AI INFERENCE / RECOMMENDATION. Never
  represent AI inference as established fact.

## 9–10. Database & data model

PostgreSQL is the canonical source of truth for structured data. Object
storage for binaries (PDFs, images, audio, reports). Vector/semantic search
for retrieval, but the vector store is never the source of truth. Data
model must be extensible and not hard-coded to one provider. Must model:
User, Identity, Permissions, Goals, Habits, Journal, Health observations,
Fitness sessions, Nutrition records, Sleep records, Calendar events,
Financial records, Relationships, Trips, Documents, Professional access, AI
memories, AI-derived insights, Agent outputs, Integrations, Consent, Audit
logs, Subscription status.

## 11. Memory architecture

Short-term (session), episodic, semantic, behavioral, goal, and a separate
professional/clinical memory with stricter permissions. AI memories must be
attributable, editable, auditable, permission-controlled, deletable where
legally applicable, and clearly distinguishable from facts. The AI must
never silently convert speculation into permanent memory.

## 12–20. Security, multi-tenancy, auth, permissions

TLS everywhere, encryption at rest, secure secrets management, no plaintext
passwords, token rotation/revocation, rate limiting, brute-force
protection, reauthentication for sensitive ops, least privilege,
server-side authorization, audit logs, prod/staging separation, private DB
networking, encrypted/tested backups. Never trust the client or a
client-supplied `user_id`. Every sensitive query enforces authorization
server-side.

Multi-tenant isolation must be enforced independently of UI logic and
tested against IDOR, broken access control, privilege escalation,
cross-tenant leakage.

Auth: Sign in with Apple + Passkeys, with session revocation, device
management, suspicious-login detection, reauthentication for sensitive
operations. No invented custom auth schemes.

Permissions: granular resource.action scopes (e.g. `journal.read`,
`health.write`, `mental_health.read`, `finance.execute`,
`professional.share`), role-based (`USER, PROFESSIONAL, ADMIN, SUPPORT,
SYSTEM`) **and** resource/consent/purpose-based.

## 16. Professional/clinical handoff

The mental-health component does not replace a licensed professional. plos
may analyze, organize, summarize, and structure information into a draft
report for review by a licensed professional, who remains responsible for
clinical interpretation and decisions. plos must never autonomously
diagnose, prescribe, change medication, replace therapy, or make emergency
clinical decisions. High-risk situations need a safety escalation design.

## 17–20. Health data, integrations

Health data requires elevated privacy controls and minimum-necessary
permission requests. All external providers integrate through adapters
(`connect, authorize, sync, normalize, disconnect, revoke, healthCheck`)
mapping into a canonical internal model — never provider-specific logic in
the core. Roadmap: Tier 1 (Apple Health, Apple/Google Calendar, Strava),
Tier 2 (Garmin, MyFitnessPal, Fitbit, Oura, WHOOP, Health Connect, Adidas),
Tier 3 (banking, brokerage, medical providers, education, travel, other AI
systems) — legitimate APIs/SDKs only, no prohibited scraping.

## 21. Payments

StoreKit for iOS subscriptions with a server-side entitlement model; never
trust only the device for subscription status.

## 22–27. Legal, data control, export, deletion, backup, versioning

Compliance-by-design (Israeli privacy law, GDPR where applicable, App
Store requirements, health-data rules); qualified legal review before
commercial launch. A central "My Data & Privacy" control center. Structured
machine-readable data export. Real account-deletion workflow (revoke
integrations, invalidate sessions, delete active + derived data, object
storage, vector representations, handle backups per documented retention,
audit the deletion without retaining unnecessary PII). Encrypted, tested,
versioned backups with defined RPO/RTO — a backup that has never been
restored is not verified. Important objects (health records, goals,
memories, professional reports, permissions, financial info) keep version
history.

## 28–41. UX, notifications, "no AI slack," learning loop, domain intelligence

Apple-quality interaction principles (clarity, hierarchy, progressive
disclosure, minimal cognitive load) without copying Apple's visual
identity. Home screen is not a dashboard — "Today" + one relevant insight +
"Ask your Life Master Agent." Notifications are tiered (Critical /
Important / Useful / Optional / Silent) and default to fewer. **No AI
filler ever** — every insight must pass a 5-question usefulness test before
display (relevant? evidenced? novel? actionable? worth interrupting?).
Recommendations feed an outcome-learning loop (recommendation → response →
action → outcome → feedback → better recommendations). Recommendations are
goal-driven and must weigh routine vs. flexibility (e.g., valuing a rare
family trip over training-schedule adherence). Preferences are learned from
behavior + explicit feedback but held with uncertainty, not treated as
immutable. Domain intelligence sketched for Travel, Finance (never
autonomous transfers/trades), Learning, Productivity (empty time has
legitimate value), Journal (lightweight prompts, not long forms).

## 42. Longitudinal analysis

Surface patterns as associations ("appears associated with," "correlates
with," "has repeatedly occurred before"), never claim causation without
evidence. Example chains the system should be able to surface (as
associations, not causal claims): `sleep↓ → stress↑ → training
performance↓ → mood↓`; `social activity↑ → reported mood↑`; `late
caffeine → sleep latency↑`.

## 43–49. AI safety, tool access, observability, governance, evaluation, testing

All external content (PDFs, emails, journal text, websites, third-party API
data) is untrusted and must never override system instructions — guard
against prompt injection, exfiltration, tool abuse, privilege escalation.
The LLM never gets unrestricted DB access — only scoped, authorized,
validated, logged tools (`get_sleep_summary()`, `get_recent_training()`,
etc.). Observability on API/agent errors, latency, integration/auth
failures, security events, model/tool usage, AI decisions, subscription
events — without logging unnecessary sensitive data. Every AI output
traceable to model/agent/prompt version, tool calls, data sources,
timestamp. Model-agnostic — no hard dependency on one AI provider.
Automated evaluation for accuracy, safety, privacy, authorization,
consistency, hallucination, provenance, agent coordination, noise. Full
pre-production testing: SAST, dependency/secret/container scanning, DAST,
API auth/IDOR/privilege-escalation/rate-limit/session tests, prompt
injection and tool-abuse tests, subscription-bypass and payment-webhook
tests, backup restoration and failover drills. Professional penetration
test before serious commercial deployment.

## 50–53. Stack, phases, MVP

Preferred initial stack: SwiftUI (iOS), Sign in with Apple + Passkeys, API
layer + PostgreSQL, encrypted object storage, model-agnostic AI
orchestration layer, relational source of truth + semantic retrieval,
StoreKit, HealthKit-first, adapter-based integrations, audit +
monitoring, OWASP-oriented secure SDLC.

**Do not start coding.** Phase 0 first produces: ADR, system architecture
diagram, database schema, data model, API spec, auth architecture,
authorization model, integration architecture, agent architecture, memory
architecture, threat model, privacy model, backup/restore architecture,
subscription architecture, testing strategy, repository structure.

MVP (smallest version that proves the core loop): secure registration +
profile + goals; HealthKit; Apple Calendar; Journal (text + structured
check-in); Life Master Agent + Health specialist + Fitness specialist +
Journal/context specialist + safety/verification layer; Home screen
(context + one insight + Ask Agent); Privacy/data control center; full
auth/authorization/encryption/audit baseline.

## 54–57. Core loop, user control, non-negotiable rules

```
OBSERVE → UNDERSTAND → ANALYZE → INFORM → ASSIST → CONFIRM → ACT → LEARN
```

The user must always be able to inspect data, disconnect providers, revoke
permissions, edit memories, delete/export information, control professional
and AI access, manage subscriptions, and delete the account.

25 non-negotiable rules are recorded verbatim in the original prompt
(security is architecture; privacy is product design; user controls their
data; LLM never gets unrestricted DB access; AI inference ≠ fact; every AI
output has provenance; agents are scoped; Life Master Agent orchestrates;
disagreement is surfaced; high-risk domains get extra safeguards; AI never
replaces licensed professionals; financial actions require explicit
authorization; no silent autonomous sensitive actions; no unnecessary AI
noise or permissions; no provider-specific core logic; Postgres is the
source of truth; backups are restore-tested; deletion is a real process;
architecture is extensible, auditable, model-agnostic; user understands
what the system knows; build the smallest useful product first).

## 58. The important product insight (missing from the earlier condensed pass — restored)

The objective is **not** "an app containing many AI agents." The objective
is one intelligent personal system that understands the user's life across
domains and uses specialized AI capabilities invisibly behind one coherent
interface. **The agents are infrastructure. The Life Master Agent is the
product. The user's life is the context. The user's goals determine
priorities. The user's decisions remain their own.**

## 59. How to work on this project (missing from the earlier condensed pass — restored)

For every architectural or product decision: identify the actual problem
→ separate requirements from implementation choices → identify
security/privacy implications → identify scalability implications →
identify legal/compliance implications → identify UX complexity →
consider failure modes → prefer the simplest architecture that satisfies
the requirements → document major decisions → avoid premature complexity
→ never sacrifice security for development speed → never add AI
functionality merely because it is technically possible.

When uncertain: state the uncertainty, identify what information is
missing, present the relevant options, explain the trade-offs, and choose
only when the available evidence supports a choice. **Do not invent
requirements. Do not silently change previously established architectural
principles** — this is the specific rule behind `CLAUDE.md`'s instruction
to flag rather than silently resolve any apparent conflict between a new
request and these source documents.

## 60. First task (this is what `docs/01`–`docs/06` in this folder deliver)

A. Architecture Decision Record — B. System Architecture — C. Database
Schema — D. Agent Architecture — E. Threat Model — F. Privacy Model — G.
MVP definition. Implementation begins only once these are internally
consistent.
