# plos — Strategy: Moat, Hazards, and Premium Positioning (source)

> Condensed from strategic analysis provided 2026-09-20. This is input to
> Phase 0 architecture (ADR, agent architecture) and to product strategy —
> not itself an architecture decision. Where a claim below implies a
> specific system (e.g. "Context Engine"), Phase 0 must decide whether and
> how to build it; this document records the *requirement*, not the design.

## Central strategic thesis

> plos should not win by having the most features. It should win by having
> the deepest, most trusted understanding of the individual across domains.
> Breadth is a moat **only if** every domain feeds a shared personal context
> graph — otherwise plos is just a bundle of disconnected integrations.

Formula: **Breadth → surface area. Context → intelligence. Memory →
personalization. Outcomes → moat. Trust → retention.**

## Hazard register (to carry into the threat/privacy model)

| Hazard | Why it matters | Mitigation direction |
|---|---|---|
| One breach exposes an entire life (health+finance+relationships+calendar+journal) | Unusually concentrated target | Zero-trust, compartmentalization, encryption, least privilege, aggressive audit |
| AI makes a consequential mistake | Bad health/financial/scheduling/relationship advice has real consequences | Risk-tier every action (see below); confirmation required above Tier 0 |
| False correlations | Longitudinal data makes coincidence look causal | Statistical confidence + cautious language ("appears associated with") + provenance |
| Over-personalization / creepiness | System becomes intrusive or overly influential | Visible memory, explicit controls, explainable personalization |
| AI dependency | User outsources judgment instead of using AI as support | User stays the decision-maker; present options + evidence, not verdicts |
| Prompt injection / malicious data | Documents, emails, external sources can carry adversarial instructions | All external content is untrusted data; strict per-tool scoping |
| Permission creep | "More data = better AI" gradually asks for everything | Purpose-based, progressive consent — request only what a feature needs |
| Data centralization | Usefulness makes plos an unusually attractive breach target | Minimize retained data; compartmentalize sensitive domains from each other |
| Regulatory complexity | Health, mental health, and finance are each separately regulated | Build compliance architecture before adding each regulated capability |
| Integration fragility | Provider APIs change, get revoked, or add licensing restrictions | Adapter architecture + canonical internal model (already required — see product vision §18) |
| Hallucination | A confident fabrication destroys trust | Evidence-backed outputs, provenance required on every claim |
| Wrong memory becomes permanent "fact" | An incorrect inference persists and compounds | Strict FACT / DERIVED FACT / AI INFERENCE / RECOMMENDATION separation (already required — product vision §8) |
| Business-model conflict with trust | Monetizing personal context undermines the whole proposition | Structural rule: plos never sells personal data or uses health data for advertising |

The first five rows are treated as **existential risks**, not ordinary
backlog items.

## The moat: a shared Personal Context Graph

Do not model the product as `Health + Finance + Fitness + Calendar +
Travel` (parallel silos). Model it as one graph of primitives that every
domain is an *interpretation* of:

```
Person → Goal → Behavior → Event → Outcome → Relationship → Context
```

Universal primitives: **Person, Event, Entity, Goal, Observation,
Relationship, Decision, Action, Outcome, Memory.** A workout, an exam, a
flight, and a dinner are all `Event`s; an investment is an `Action`; sleep
is an `Observation`; a friend is an `Entity`. This is what lets plos add
domains without becoming architecturally fragmented, and it directly
informs the [database schema](04-database-schema.md)'s core-entity design
— reconciled there via a shared `core_objects` spine plus per-primitive
core tables plus domain-extension tables, per that document's §1.

**Memory must be relational, not just factual** — this is the "Identity
Graph" idea, and it's a specific, non-obvious requirement on top of the
primitives above: storing "user enjoys destination X" is much less useful
than storing *why* — "enjoyed destination X because it combined beaches +
nightlife + food + nature + flexibility, disliked the long transfers." The
extra clauses are what make a later recommendation actually useful instead
of a shallow lookup. Concretely: a `Memory`/`Preference` record's schema
should carry structured reasons/qualities alongside the subject, not just
a subject and a polarity — a requirement on the memory architecture
(product vision §11), not a new subsystem.

**Do not treat "more integrations" as the moat** — any competitor can add
Garmin, Strava, or a bank feed. The moat is what plos understands *after*
two years of accumulated, connected context: a genuine flywheel (more
connected life → more context → better personalization → better outcomes →
more trust → more connected life) that doesn't require selling data.

### Supporting subsystems this thesis implies

- **Context Engine** — a layer between integrations and agents that turns
  normalized provider data into baselines, relationships, timelines,
  memories, preferences, goals, constraints, patterns, and outcomes. This
  is the layer to protect as the durable IP — and it must be
  **model-independent**: structured context outlives whichever LLM
  currently powers the Life Master Agent (reinforces product vision
  non-negotiable rule #23, model-agnosticism).
- **Personal Baseline Engine** — continuously computed *individualized*
  baselines per domain (sleep, activity, training load, mood, stress,
  spend, productivity, social activity, travel, nutrition, learning,
  calendar density), classified as normal / improving / deteriorating /
  anomalous / repeated pattern / new pattern. Answers "what's normal for
  *this* person," not "what's normal."
- **Outcome Learning Loop** — extend the existing feedback loop
  (product vision §33) into a full personal intervention history:
  `Observation → Recommendation → User decision → Action → Outcome →
  Feedback → Personal learning`. Over time this builds a record of what
  interventions actually work for this specific person under specific
  conditions — the hardest layer for a competitor to copy.
- **Personal Constitution** — a user-authored, explicit record of values,
  current priorities, hard constraints, general preferences, risk
  tolerance, and life philosophy. Exists so goal-driven optimization
  (product vision §34–35) doesn't optimize a person into a mathematically
  efficient but personally undesirable life (e.g. "maximize career growth"
  must not silently become "schedule every available hour").
- **"Why?" engine** — every non-trivial recommendation must support a
  user-facing "why am I seeing this" answer listing the specific evidence
  used (sleep, training, calendar, goal, similar past situations) —
  concise rationale, never raw chain-of-thought (matches brand doc's
  confidence/uncertainty rules).
- **"What if?" engine** (later-phase, not MVP) — structured scenario
  comparison ("study tonight" vs "study tomorrow" and their downstream
  effects) that the user compares; the system presents options, it does
  not decide.
- **Life Timeline** (later-phase, not MVP) — a zoomable day→week→month→
  year→life view answering "what changed in my life this year," as an
  alternative home surface to a dashboard.

### The moat as five layers

A clean way to rank how defensible each part of this is, from easiest to
hardest for a competitor to copy:

1. **Integrations** — connecting the user's world. Copyable by anyone.
2. **Personal Context** — normalizing and understanding it. Some
   competitors can copy this.
3. **Longitudinal Memory** — understanding the user's history. Gets
   harder to replicate.
4. **Outcome Learning** — understanding what actually works for *this*
   person. Substantially harder.
5. **Decision Intelligence** — using all of the above to help navigate
   future decisions. This is the real moat.

Layers 1–2 are necessary but not sufficient; don't mistake shipping them
for having built the moat. The point of naming the layers is to keep
architecture and roadmap effort weighted toward 3–5, not stalled at 1–2.

### The end-state, in one line

The differentiated experience is not "ask plos anything" — it's that the
user doesn't have to re-explain their life every time they ask a question,
because plos already has the relevant where/when/who/budget/recent-history/
constraints loaded. Everything above (Context Graph, Baseline Engine,
Outcome Learning, five-layer moat) exists to make that one line true.

## Risk-tier model for agent actions (feeds agent architecture + threat model)

Every capability the Life Master Agent or a specialist can invoke should
carry an explicit tier, checked in code — not left to prompt instructions:

- **Tier 0 — Informational**: e.g. "Your sleep was lower than usual." No
  confirmation required.
- **Tier 1 — Low consequence**: e.g. moving a study block by an hour.
  Confirmation optional depending on the surface.
- **Tier 2 — Meaningful**: e.g. cancelling a scheduled workout. Requires
  explicit user confirmation.
- **Tier 3 — High consequence**: financial transactions, medical-adjacent
  decisions, professional disclosures. Requires explicit confirmation plus
  the relevant safeguard from the security/privacy model (reauthentication,
  audit, etc.).
- **Tier 4 — Restricted**: never autonomously executed by any agent,
  regardless of confirmation (e.g. money movement, medication changes —
  already prohibited outright by product-vision non-negotiable rules #12,
  #16).

Architectural consequence: agents never get direct "hands." The only path
to action is `Agent → Scoped tool → Authorization check → Validation →
Risk-tier check → Confirmation if required → Execution → Audit`. This is
the same shape as product-vision §44 (scoped tools) with the risk tier
made an explicit, code-enforced gate rather than an implicit prompt norm.

## Compartmentalization ("privacy by architecture," not just encryption)

The Life Master Agent should, by default, receive **derived** context
rather than raw sensitive material — e.g. "stress has increased 18% over
three weeks per journal-derived signals" rather than 400 raw journal
entries. Raw material is retrieved only when a specific tool call is
genuinely necessary and authorized for that request. This bounds blast
radius on both a compromised agent and a prompt-injection attempt, and
should be reflected as a concrete scoping rule in the agent/tool-contract
design (which specialist gets which category of raw vs. derived context).

## Premium positioning

- **Trust before intelligence.** Priority order: trust → accuracy →
  privacy → UX → intelligence → breadth. If the user doesn't trust plos
  with their life, capability doesn't matter.
- **Privacy is a structural product property, not a legal page**: no
  selling personal data, no health-data advertising, no data-broker model,
  explicit permissions, transparent/editable memory, easy export/deletion,
  professional-access controls, auditable AI. (Reinforces product-vision
  §17, §22–26 and the brand doc's "privacy as a visual value.")
- **"Premium" means reliable, not decorative**: instant, stable,
  predictable, quiet, accurate, never confused about context, never loses
  data, never over-asks for permissions, never repeats itself, handles
  edge cases elegantly. Latency is a first-class design constraint —
  architect for cached/precomputed context, async ingestion, background
  sync, incremental analysis, and model routing (cheap model for routine
  classification, expensive reasoning only when warranted).
- **Progressive adoption, not a data-dump onboarding.** Day 1: connect one
  source. Week 1: add another. Month 1: meaningful context. Month 6: feels
  like it knows the user's life. Never open with "connect everything."
- **Calibrated uncertainty is a premium trait**, not a hedge: "poor sleep
  and higher stress have co-occurred several times; the data doesn't
  establish that stress caused it" beats a confident causal claim.

## Competitive strategy: don't compete with specialists

plos should not try to replace Garmin, Strava, MyFitnessPal, banks,
brokers, calendars, or booking platforms — let each remain excellent at
its narrow job. plos is the orchestration/context layer *above* them:
`Provider → adapter → canonical data → Context Engine → agents → user`.
A specialist knows one dimension (fitness, time, food, money); plos knows
how the dimensions the user has permitted relate to their goals. That
relational understanding — not feature count — is the pitch. A longer-term
extension (`plos Connect`, a standardized third-party integration
interface) is a plausible network-effect play once the canonical-model
adapter architecture (product-vision §18) is proven, but is out of scope
before MVP.

## UX consequence: no dashboard as the killer feature

The most differentiated experience is not "ask plos anything" — it's that
the user doesn't have to re-explain their life on every question, because
plos already has the relevant where/when/who/budget/recent-history/
constraints loaded. This is a restatement, in product terms, of why the
Context Graph + Baseline Engine + Outcome Learning are the moat: they are
what makes a short question answerable with a long, specific context
implicitly attached.

## Note: two domains beyond the original list — flagged, not yet decided

Framing plos's breadth as "Life Surface Area" (Body, Mind, Time, Money,
Work, People, Experiences, **Environment**, **Digital Life**, Goals)
surfaces two categories not present in the product vision's original life-
domain list (§4: Health, Fitness, Nutrition, Mental/Emotional,
Productivity, Learning, Finance, Career, Relationships/Social, Travel,
Personal Goals): **Environment** (home, location, weather, mobility) and
**Digital Life** (email, documents, files, communications). Recording this
here rather than silently editing the vision doc — whether these become
real domains is a product-scope decision for whoever owns that doc, not
something this strategy analysis should decide unilaterally. Likely not
MVP regardless (see the MVP note below).

## Where this document plugs into Phase 0

- **Database schema**: evaluate the universal-primitive model (Person /
  Event / Entity / Goal / Observation / Relationship / Decision / Action /
  Outcome / Memory) against the domain-specific table list already
  required in the product vision, and decide the actual normalization
  strategy.
- **Agent architecture**: encode the risk-tier gate as a first-class field
  on every tool contract; encode compartmentalized/derived-context access
  as a scoping rule per specialist.
- **Threat model**: fold the hazard register above into the enumerated
  threats (most rows map directly to existing required threats: IDOR,
  prompt injection, backup compromise, insider access, etc.).
- **MVP**: the Personal Baseline Engine and a minimal Outcome Learning
  loop are strong candidates for MVP inclusion (they're what makes even a
  two-specialist MVP feel differentiated); the Context Engine, Personal
  Constitution, Why/What-If engines, and Life Timeline are explicitly
  **post-MVP** — do not let this document's ambition scope-creep the MVP
  defined in product-vision §52.

## The closing non-negotiable

> plos must become better at understanding a person without becoming more
> invasive.

If that holds, breadth compounds into an advantage instead of turning into
a feature-list/attack-surface trade-off. This is added to `CLAUDE.md`'s
non-negotiables list alongside the product-vision §57 rules.
