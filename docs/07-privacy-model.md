# plos — Privacy Model (Phase 0-F)

> This is Phase 0-F of the sequence fixed in
> [00-product-vision-master-prompt.md](00-product-vision-master-prompt.md) §60
> (A. ADR — B. System architecture — C. Database schema — D. Agent
> architecture — E. Threat model — F. **Privacy model** — G. MVP). It takes
> the tables and RLS mechanism fixed in
> [04-database-schema.md](04-database-schema.md) and the tool/scope/
> compartmentalization roster fixed in
> [05-agent-architecture.md](05-agent-architecture.md) as given, and answers
> what both documents deliberately left to this one: which sensitivity tier
> each table belongs to and what that tier's access rule actually is; the
> literal `permission_scopes` catalog rows (flagged as unseeded by
> [05-agent-architecture.md](05-agent-architecture.md) §12); the consent
> taxonomy behind `consent_records`; concrete retention numbers (flagged as
> undecided by [04-database-schema.md](04-database-schema.md) §4.3 for
> `agent_conversations`/`agent_turns` and left unstated everywhere else); the
> account-deletion workflow's 8 steps against real tables (product vision
> §25); the export bundle's actual file structure (product vision §24); and
> professional sharing as schema/workflow, not UX description (product
> vision §16, §29; [00-brand-design-master-prompt.md](00-brand-design-master-prompt.md)
> "Connections, privacy UX, professional sharing").
>
> **Dependency gap — resolved by the reconciliation pass.** This document
> was drafted in parallel with `06-threat-model.md`, before either could
> see the other (flagged at the time per `CLAUDE.md`). `06-threat-model.md`
> now exists; see §10 for exactly what got reconciled (§6.2's break-glass
> scope against T10) and what's still a real, separate open item (T10's
> infrastructure-access gap; T6's malware-scanning handoff).
>
> **Out of scope here**: legal-basis analysis under GDPR/Israeli
> privacy law/health-data rules (vision §22 explicitly reserves this for
> qualified legal review before commercial launch — this document gives
> legal review a concrete data model and workflow to review, not a
> substitute for it); the actual UI copy/screens for the Privacy & Data
> Control Center (that is a design-phase deliverable per
> [00-brand-design-master-prompt.md](00-brand-design-master-prompt.md)'s
> sequencing note, which waits on Phase 0 completing); MVP scope (which of
> this document's rules ship first is Phase 0-G's call, not this one's).

## 1. Purpose and how this fits with what's already fixed

Two enforcement mechanisms already exist and are **not redesigned here**:
row-level tenant isolation ([04-database-schema.md](04-database-schema.md)
§10 — every tenant-scoped table refuses a cross-user row at the database
level, `FORCE ROW LEVEL SECURITY`, regardless of application-code bugs) and
the per-tool authorization/risk-tier chain
([05-agent-architecture.md](05-agent-architecture.md) §6 — every Scoped Tool
call is authorized, validated, tier-checked, confirmed if required, and
audited, in that order). This document's job is the layer above both: which
**category** of data gets which rule, stated once per category rather than
re-derived per table, so that "is journal text more sensitive than a
calendar event" has one documented answer, not an implicit one buried in
which scopes happen to gate which tools.

## 2. Data sensitivity tiers

### 2.1 The five tiers and their access rules

| Tier | Definition | RLS | Agent read | Professional sharing | Export | Deletion |
|---|---|---|---|---|---|---|
| **General** | Non-sensitive life data: Learning, Productivity, Social, Travel, Career, and domain-agnostic Goals/Entities/Relationships | Standard per-row policy ([04-database-schema.md](04-database-schema.md) §10.2) | Any specialist's own `<domain>.read`/`.read_raw` ceiling ([05-agent-architecture.md](05-agent-architecture.md) §3); Life Master Agent gets derived context only via `get_context_snapshot` | Generic mechanism exists (§9 below) but no domain-specific report tool is wired outside Mental/Emotional (flagged §10) | Included by default | Hard-deleted, step 3/4 of §7 |
| **Financial** | Finance domain: balances, transactions, snapshots, accounts | Standard | `finance.read`/`finance.read_raw` only (`financial_analysis`, `financial_risk`); `finance.execute` is a reserved scope no tool is ever registered under ([05-agent-architecture.md](05-agent-architecture.md) §3.7) | Same generic mechanism, no financial-advisor report tool wired yet (flagged §10) | Included by default, full detail | Hard-deleted; `financial_account_history` needs an explicit purge (not FK-cascaded) |
| **Sensitive-Health** | Health (physical), Fitness, Nutrition domains: vitals, sleep, symptoms, injury flags, lab results, training sessions, nutrition logs, `health_profile` | Standard | `health.*`/`fitness.*`/`nutrition.*` ceilings; **any raw-data tool call is audit-logged even though it is risk tier 0** ([05-agent-architecture.md](05-agent-architecture.md) §3.1's "raw (read, logged)" convention) — this document adopts that as this tier's minimum bar, not an incidental detail | Same generic mechanism, no non-clinical report tool wired yet | Included by default | Hard-deleted; `health_profile_history` needs an explicit purge |
| **Mental-Health & Clinical** | Mental/Emotional domain (journal, mood/stress/energy scores) plus `clinical_memories` specifically | Standard **plus** the extended `clinical_memories_shared_professional` policy — the only table in the schema with a second, viewer-is-not-owner RLS policy ([04-database-schema.md](04-database-schema.md) §10.3) | `mental_health.read`/`.read_raw` (`mental_context`, `clinical_safety_handoff`); `get_clinical_memory_flags`/`check_crisis_risk_signals` restricted to `clinical_safety_handoff` only — even the pair's own primary agent doesn't get the most sensitive read; the Life Master Agent never sees raw journal text at any point, only the derived mood/stress baseline deviation | The **only** domain with a fully wired share workflow (`draft_professional_report` tier 1 → `share_professional_report` tier 3, reauthentication required) — §9 | Requires a fresh reauthentication step before inclusion; explicit opt-in callout, never silently bundled (§8) | Hard-deleted; `clinical_memory_history` needs an explicit purge; a professional's own external copy is outside plos's deletion authority (stated, not implied away) |
| **Account, Identity & Security** | `users`, `sessions`, `webauthn_credentials`, `professionals`, `subscriptions`, `integrations` (connection state), `permission_grants`, `consent_records`, `audit_log` | "Own row" policies; `audit_log` has its own read-own-only policy ([04-database-schema.md](04-database-schema.md) §11) | **Never.** No Scoped Tool in the entire [05-agent-architecture.md](05-agent-architecture.md) roster (§3–§5) reads any table in this tier, including `permission_grants`/`consent_records`/`audit_log` — this tier is structurally invisible to every agent, not merely omitted by convention | Never — a professional's grant scopes them to specific domains/documents, never to another user's account/security metadata | Profile/account section only, sanitized (no `credentials_secret_ref`, no `refresh_token_hash`, no `ip_hash`) — §8 | Handled specially: revoked/invalidated immediately (steps 1–2 of §7); the `users` row itself is anonymized, not deleted (step 8) |

### 2.2 Domain → tier lookup (used by every join-dependent table in §2.4)

| `domain` value | Tier |
|---|---|
| `health`, `fitness`, `nutrition` | Sensitive-Health |
| `mental_health` | Mental-Health & Clinical |
| `finance` | Financial |
| `learning`, `productivity`, `social`, `travel`, `career` | General |

### 2.3 Table-by-table tiering

Every table in [04-database-schema.md](04-database-schema.md), tiered.
"Structural" means the tier follows directly from the table's fixed shape
(a dedicated domain extension table, or a `domain` column); "Join" means the
tier must be resolved at query/application time via §2.2 and is not a fixed
property of the table (see §2.4).

| Table(s) | Schema § | Tier | Basis |
|---|---|---|---|
| `entities`, `entity_person_detail` | 3.1 | General | Structural — descriptive, not fact-bearing |
| `events`, `event_participants` | 3.2 | General (base) | Structural — tier lives on the extension table |
| `event_fitness_session`, `fitness_session_set` | 3.2 | Sensitive-Health | Structural |
| `event_travel_trip`, `event_learning_session`, `event_calendar_item`, `event_task`, `event_social_activity`, `event_career_milestone` | 3.2 | General | Structural — see §2.5 for the free-text-title caveat on the calendar/task pair |
| `observations` | 3.3 | — (base) | Structural — tier lives on the extension table |
| `observation_vital`, `observation_sleep`, `observation_symptom`, `observation_injury_flag`, `observation_lab_result` | 3.3 | Sensitive-Health | Structural — see §2.5 for a per-row-sensitivity caveat on lab results |
| `observation_nutrition_log`, `nutrition_log_item` | 3.3 | Sensitive-Health | Structural |
| `observation_journal_entry` | 3.3 | Mental-Health & Clinical | Structural |
| `observation_financial_snapshot`, `financial_accounts` | 3.3 | Financial | Structural |
| `health_profile`, `health_profile_history` | 3.3, 12.2 | Sensitive-Health | Structural — see §2.5 for the psychiatric-content caveat |
| `goals`, `goal_habit_detail`, `goal_history` | 3.4, 12.2 | Join | Via `goals.domain` |
| `actions` (base) | 3.5 | Join | Via `actions.domain`/`action_type` |
| `action_financial_transaction` | 3.5 | Financial | Structural |
| `action_medication_log` | 3.5 | Sensitive-Health (default) | Structural, with the same psychiatric-content caveat as `health_profile` (§2.5) — **and no Scoped Tool reads this table at all today**, flagged §10 |
| `decisions`, `outcomes` | 3.5 | Join | Via the linked `actions`/`agent_outputs` row's domain |
| `relationships` | 3.6 | Join | Via `subject_id`/`object_id` → owning domain; `relationship_class='social'` rows are General by default |
| `memories`, `memory_reasons`, `memory_history` | 4.1, 12.2 | Join | Via `subject_core_object_id`; see §2.4's most-restrictive-wins rule when `subject_core_object_id IS NULL` or reasons span domains |
| `clinical_memories`, `clinical_memory_history` | 4.2, 12.2 | Mental-Health & Clinical | Structural — the one clean, table-level case in the memory layer, deliberately (schema §4.2's own rationale) |
| `agent_conversations`, `agent_turns` | 4.3 | Mental-Health & Clinical (default, conservative) | Most-restrictive-wins (§2.4) — a turn can aggregate any domain including raw journal content |
| `embeddings` | 4.4 | Join | Via the owning `core_objects` row; never queried without that join per ADR D5, so no separate access rule is needed |
| `agent_outputs`, `agent_output_sources` | 5 | Join | Via `agent_name` → `domain_key` (roster, [05-agent-architecture.md](05-agent-architecture.md) §3); `life_master_agent` outputs use most-restrictive-wins across `agent_output_sources` |
| `baselines`, `timeline_entries` | 6 | Structural | Direct `domain` column |
| `users`, `user_roles`, `webauthn_credentials`, `sessions` | 7.1 | Account, Identity & Security | Structural |
| `professionals` | 7.2 | Account, Identity & Security | Structural (catalog-like) |
| `subscriptions` | 7.3 | Account, Identity & Security | Structural — no payment-card data lives here (StoreKit/RevenueCat hold that, ADR D8) |
| `integrations` | 7.4 | Account, Identity & Security (connection row itself); data flowing through it takes the tier of the domain it feeds | Structural + note |
| `permission_scopes` | 8.1 | — (catalog, not user data) | — |
| `permission_grants`, `consent_records` | 8.2, 8.3 | Account, Identity & Security | Structural — retained indefinitely, §5 |
| `documents`, `document_links`, `document_history` | 9, 12.2 | Join | Via `document_type` + linked core object; `document_type='professional_report'` defaults to Mental-Health & Clinical today (§9) |
| `audit_log` | 11 | Account, Identity & Security (strictest in practice) | Structural — no Scoped Tool reads it at all, read-own RLS policy only |
| `financial_account_history` | 12.2 | Financial | Structural |

### 2.4 Join-dependent tables and the most-restrictive-wins rule

Several tables (`goals`, `relationships`, `memories`, `agent_outputs`,
`documents`, `decisions`, `outcomes`) don't carry a fixed tier because their
domain is a runtime value (a `domain` column) or must be resolved by joining
to a subject/evidence row, not a property of the table's shape the way
`event_fitness_session` vs. `event_travel_trip` is. Two sub-cases:

- **Single clean domain** (a `goals` row with `domain='finance'`, an
  `agent_outputs` row from `financial_risk`): tier = §2.2's lookup for that
  domain. No ambiguity, resolved by application code at read/export/
  deletion time via a `resolve_tier(core_object_id)` helper — **not** a
  stored column, to avoid a denormalized value going stale as evidence sets
  change (the schema's own reasoning for computing `sources[]` rather than
  storing it, [05-agent-architecture.md](05-agent-architecture.md) §2.2,
  applies identically here).
- **Multi-domain or untied** (a `memories` row with
  `subject_core_object_id IS NULL` — "a general behavioral pattern"; a
  `life_master_agent` output whose `agent_output_sources` span Health and
  Social; a `memory_reasons` set whose evidence spans two domains): **the
  most sensitive tier among all resolvable domains wins.** A memory like
  "avoids social gatherings when stressed" spans `social` and
  `mental_health` — it is governed as Mental-Health & Clinical, not
  General, even though half its evidence is a Social-domain event. This is
  a conservative default, deliberately: the cost of under-classifying a
  genuinely sensitive cross-domain memory is much higher than the cost of
  applying a stricter rule to a handful of borderline General-only ones.

### 2.5 Known cross-tier leakage risks (flagged, not solved by a schema change)

Three real gaps between "the table's assigned tier" and "what a specific
row might actually contain" — table-level tiering is the schema's practical
granularity, and these are the concrete places that granularity is too
coarse:

1. **`event_calendar_item`/`event_task` free-text titles.** A title like
   "Therapy with Dr. Cohen" or "Pay off Amex balance" sits in a General-tier
   table but is Mental-Health/Financial content in substance. This is
   exactly why [05-agent-architecture.md](05-agent-architecture.md) §3.6
   makes `get_calendar_raw` (which exposes titles) the deliberate last
   resort, restricted to `focus_scheduling` only, and why
   `get_calendar_density_tomorrow` is backed by a `baselines` row instead of
   a live query — this document adds the explicit reasoning that
   compartmentalization decision was implicitly protecting against.
2. **`health_profile.chronic_conditions`/`medications_current` and
   `action_medication_log`.** Both default to the Sensitive-Health tier,
   but a chronic condition or medication name can itself be
   psychiatric/clinical (e.g. "bipolar disorder," "sertraline"). Worse:
   **no Scoped Tool gives `mental_context`/`clinical_safety_handoff` any
   read of `health_profile` at all** ([05-agent-architecture.md](05-agent-architecture.md)
   §3.1 gives `get_health_profile_summary` only to the Health pair) — so
   `check_crisis_risk_signals` cannot see a documented psychiatric diagnosis
   sitting in `health_profile` unless the Health pair happens to be
   separately dispatched. Flagged again in §10 as an agent-architecture gap
   this document surfaces but cannot itself fix.
3. **`observation_lab_result` per-row sensitivity.** A cholesterol panel and
   an HIV/genetic/reproductive-health panel are the same table, same tier.
   No column exists to mark an individual result as warranting
   Mental-Health & Clinical-equivalent handling. Not fixing this now
   (avoids over-engineering a column with no consumer yet) but naming it as
   the natural extension point (an `elevated_sensitivity BOOLEAN` on
   `observation_lab_result`, or a more general per-row override on
   `core_objects`) if a real need surfaces later.

## 3. Permission-scope model on real tables

### 3.1 Scopes vs. roles vs. consent — recap

[04-database-schema.md](04-database-schema.md) §8.1 already draws this
distinction: `user_roles` is coarse (what *kind* of access an account could
ever hold); `permission_scopes`/`permission_grants` are fine-grained (which
specific `resource.action` a specific grantee currently has, for what
purpose); `consent_records` (§4 below) is broader still (whether plos has a
lawful basis to process a category of data at all, independent of any
specific grantee). This document seeds the first of those three — the
`permission_scopes` catalog rows — which
[05-agent-architecture.md](05-agent-architecture.md) §12 flagged as needed
but never populated, "chosen with the tier-consistency constraint in mind."

### 3.2 The seeded `permission_scopes` catalog

Every row a tool in [05-agent-architecture.md](05-agent-architecture.md)
§3–§5 actually requires, plus the account-level scopes this document needs
for §7–§9's workflows. `risk_tier` here is the scope's **ceiling** — per
that document's build-time rule, every tool wired to a scope must declare
`riskTier ≤` this value.

| `scope` | `resource` | `action` | `risk_tier` | Backing table(s) | Description |
|---|---|---|---|---|---|
| `health.read` | health | read | 0 | `baselines`, `health_profile` (summary) | Derived health context |
| `health.read_raw` | health | read_raw | 0 | `observation_vital`, `observation_sleep`, `observation_lab_result` | Raw vitals/sleep/labs; every call audit-logged (§2.1) |
| `mental_health.read` | mental_health | read | 0 | `baselines` (mood/stress/energy) | Derived mental/emotional context |
| `mental_health.read_raw` | mental_health | read_raw | 0 | `observation_journal_entry` | Raw journal text |
| `professional.share` | professional | share | 3 | `permission_grants` (`grantee_type='professional'`), `documents`, `clinical_memories.shared_via_grant_id` | Gates both drafting (tier 1) and sharing (tier 3) a professional report — one scope, ceiling set by the higher-tier action it also gates |
| `nutrition.read` / `.read_raw` | nutrition | read / read_raw | 0 | `observation_nutrition_log`, `nutrition_log_item` | — |
| `fitness.read` / `.read_raw` | fitness | read / read_raw | 0 | `event_fitness_session`, `fitness_session_set` | — |
| `fitness.write` | fitness | write | 2 | `actions` (`action_type='workout_cancellation'`), `events` | Gates `cancel_scheduled_workout` |
| `learning.read` / `.read_raw` | learning | read / read_raw | 0 | `event_learning_session` | — |
| `productivity.read` / `.read_raw` | productivity | read / read_raw | 0 | `event_task`, `event_calendar_item`, `baselines` | — |
| `productivity.write` | productivity | write | 1 | `actions` (`action_type='calendar_change'`), `event_calendar_item` | Gates `move_calendar_event` |
| `finance.read` / `.read_raw` | finance | read / read_raw | 0 | `financial_accounts`, `observation_financial_snapshot`, `action_financial_transaction` | — |
| `finance.execute` | finance | execute | 4 | — | **Reserved, dormant.** No tool is ever registered under it ([05-agent-architecture.md](05-agent-architecture.md) §3.7) — exists in the catalog only to hold the name/tier so a future money-movement capability cannot be silently wired in below Tier 4 |
| `social.read` / `.read_raw` | social | read / read_raw | 0 | `relationships` (`social`), `event_social_activity` | — |
| `travel.read` / `.read_raw` | travel | read / read_raw | 0 | `event_travel_trip`, `memories` (travel preferences) | — |
| `career.read` / `.read_raw` | career | read / read_raw | 0 | `event_career_milestone`, `entities` (`entity_type='skill'`) | — |
| `account.export` | account | export | 2 | `documents` (`document_type='export_bundle'`) | Gates §8's export bundle; including the Mental-Health & Clinical section escalates that specific request to the reauthentication treatment (§8) |
| `account.delete` | account | delete | 3 | `users.status` | Gates initiating §7's deletion workflow; irreversible after the grace period |
| `consent.manage` | consent | write | 1 | `consent_records` | Granting/withdrawing a lawful-basis consent; can turn off a feature (§4) |

### 3.3 Reconciling vision §15's example scopes with the actual catalog

Product vision §15 gives `journal.read, health.write, mental_health.read,
finance.execute, professional.share` as *illustrative* scope names. Three
of the five (`mental_health.read`, `finance.execute`, `professional.share`)
appear verbatim in §3.2 above. The other two do not, and that is a
deliberate reconciliation, not an oversight:

- **`journal.read` doesn't exist as its own scope.** Journal entries are an
  `observation_journal_entry` row, gated by `mental_health.read`/
  `.read_raw` like every other Mental/Emotional-domain read
  ([05-agent-architecture.md](05-agent-architecture.md) §3.2) — a separate
  `journal.*` scope would fragment one domain's access rule across two
  scope families for no operational benefit.
- **`health.write` doesn't exist as its own scope**, because
  [05-agent-architecture.md](05-agent-architecture.md) §3.1 registers no
  Scoped Tool that writes health data on an agent's behalf at all — health
  observations are written by integrations or the user directly (the same
  "no tool exists" discipline used for Tier 4 actions elsewhere). If a
  future feature genuinely needs an agent-initiated health write, the scope
  gets added then, at whatever risk tier that tool's contract requires —
  not seeded speculatively now.

## 4. Consent model

### 4.1 `consent_records` taxonomy

`consent_records` (schema §8.3) answers "does plos have a lawful basis to
process this category of data," independent of which specific
agent/professional/integration can currently touch it
(`permission_grants`'s question). Seeded `consent_type` values:

| `consent_type` | What it covers | Effect of withdrawal |
|---|---|---|
| `tos` | Terms of service | Account cannot remain active; treated as an account-deletion trigger, not a feature toggle |
| `health_data_processing` | Processing of Sensitive-Health-tier data for any purpose beyond raw storage (baselines, agent reads) | `health.*`/`fitness.*`/`nutrition.*` grants are revoked; the Health/Fitness/Nutrition specialist pairs are never dispatched; existing rows are **not** deleted (that's `account.delete`'s job, not a consent withdrawal) — the data sits inert |
| `mental_health_data_processing` | Processing of Mental-Health & Clinical-tier data | Same pattern, scoped to `mental_health.*` and `clinical_safety_handoff`'s dispatch |
| `financial_data_processing` | Processing of Financial-tier data | Same pattern, scoped to `finance.*` |
| `professional_sharing_default` | Whether professional-sharing is offered as a feature at all (separate from any individual `professional.share` grant, which is always a distinct, explicit act) | Withdrawing hides the "share with a professional" affordance entirely; does not revoke grants already made — those are revoked individually via `permission_grants.revoked_at` |
| `marketing` | Marketing communication | Revokes marketing-channel sends only; never gates in-product functionality |

Each row's `version` column pins which policy text a consent applies to,
per the table's own design — a policy-text update requires a fresh
`granted_at` row at the new `version`, not an in-place edit of the old one,
so "what did the user actually agree to on date X" is always answerable.

### 4.2 Purpose-based grants and progressive onboarding

`permission_grants.purpose` (schema §8.2) is the concrete field that makes
scope-granting purpose-based, not just resource-based — vision §15's "role-
based **and** resource/consent/purpose-based" requirement. Each grant
records *why* it was requested (`granted_via='onboarding_flow'` vs.
`'feature_prompt'`), which is what lets the Privacy & Data Control Center
show "you granted `fitness.read_raw` on 2026-09-12 when you connected
Strava" rather than an undifferentiated scope list. This is also the
mechanism behind the brand doc's progressive-onboarding rule ("relevant
permissions first, then progressively more; never a 25-permission wall") —
each `granted_via='feature_prompt'` row is, by construction, a request tied
to one feature the user just tried to use, never a batch pre-grant.

## 5. Retention policy

| Category | Active retention | Post-deletion / backup handling | Notes |
|---|---|---|---|
| All `core_objects`-backed facts (General/Financial/Sensitive-Health/Mental-Health&Clinical tiers) | Indefinite while the account is active — longitudinal history is the product's core value | Hard-deleted in §7 steps 3–4; persists in RDS automated backups up to 35 days and in any pre-deletion monthly snapshot up to 12 months, purged faster only on a specific legal erasure request (operational exception, not schema-enforced) | — |
| `agent_conversations`, `agent_turns` | **90 days, rolling**, purged by a scheduled `worker` job regardless of account status | Not retained past 90 days for anyone; excluded from the default export bundle (§8) | This document's own decision, closing the gap [04-database-schema.md](04-database-schema.md) §4.3 left open — raw chat turns aren't memory (anything worth keeping is promoted to `memories` explicitly), and unbounded retention of a table that can carry raw journal text ([05-agent-architecture.md](05-agent-architecture.md) §3.2's `mental_context` raw-journal tool calls land in `tool_calls` JSONB here) increases breach blast radius for no proportionate benefit — the strategy doc's "minimize retained data" hazard mitigation, made concrete |
| `baselines`, `timeline_entries` | Not retained historically at all — continuously overwritten (schema §6.1) | N/A — moot | — |
| `_history` tables (`goal_history`, `memory_history`, `clinical_memory_history`, `document_history`, `financial_account_history`, `health_profile_history`) | Same as their live row | Purged explicitly at deletion (not FK-cascaded — see §7 step 4) | — |
| `permission_grants`, `consent_records` | **Indefinite**, including past account deletion | Never deleted; kept attached to the anonymized `users` tombstone (§7 step 8) | Legal defensibility of the consent/permission ledger outweighs data minimization here — this is the one category where "delete everything" would itself create a compliance gap |
| `audit_log` | 3 years in queryable partitions | Archived (not deleted) via `DETACH PARTITION` (schema §11's own suggested mechanism) to cold storage for up to 7 years total, then dropped; survives account deletion attached to the anonymized `acting_as_user_id` | 7-year figure is a placeholder consistent with typical financial/health audit windows — subject to the legal review vision §22 requires before commercial launch |
| RDS backups (automated + snapshots) | 35-day automated backup window (continuous, RPO ≤ 15 min); monthly snapshots retained 12 months for disaster recovery | — | RTO target ≤ 4 hours; restore-tested **quarterly** — an operational commitment this document adds to make vision's "a backup that has never been restored is not verified" concrete with a cadence, not just a principle |
| S3 documents (ADR D6, versioned) | Noncurrent versions retained 30 days by lifecycle rule during normal operation | All versions explicitly purged at deletion, not left to the lifecycle rule (§7 step 5 — waiting 30 days would leave old versions recoverable past the deletion the user requested) | — |
| Export bundles (`documents.document_type='export_bundle'`) | 7-day presigned download window | S3 object and its `documents` row both deleted after 7 days — every export request regenerates a fresh bundle, never a standing copy | — |

## 6. Access model

### 6.1 Per-actor access summary

| Actor | Path | Governed by |
|---|---|---|
| The user (self) | App → API, `RequestContext.user_id` from verified session | RLS "own row" policies everywhere ([04-database-schema.md](04-database-schema.md) §10.1–10.2) |
| A specialist agent | Scoped Tool call within its per-request allow-list | [05-agent-architecture.md](05-agent-architecture.md) §1, §6–§7 (ceiling + dynamic allow-list + authorization/risk-tier chain) |
| Life Master Agent | `get_context_snapshot` only, derived data, no raw tool ever | [05-agent-architecture.md](05-agent-architecture.md) §5, §7 |
| A professional | Authenticates as a `users` row holding `PROFESSIONAL` role, acting on a different user's data via an active `permission_grants` row | [05-agent-architecture.md](05-agent-architecture.md) §6.1 (`RequestContext.professional_id`); [04-database-schema.md](04-database-schema.md) §10.3's extended RLS policy — currently `clinical_memories` only (gap, §10) |
| The `worker` Fargate task (Context Engine, retention jobs) | One user at a time, `SET LOCAL app.current_user_id` per user's transaction, never a pooled bypass | [04-database-schema.md](04-database-schema.md) §10.2 |
| SUPPORT / ADMIN | No implicit path — see §6.2 | This document, new rule |

### 6.2 Support/admin break-glass: no implicit superuser path

A real finding from reading the schema closely: `FORCE ROW LEVEL SECURITY`
(schema §10.2) applies "even to the table owner role," and no RLS policy
anywhere grants `ADMIN`/`SUPPORT` an exception. Combined with the fact that
`user_roles` lists `ADMIN`/`SUPPORT`/`SYSTEM` as roles an account can hold
but no policy or Scoped Tool references them, the schema as written has
**no support/admin access path to a user's tenant-scoped data at all** —
not a gap to close, but a property worth stating as an explicit rule so it
is never "fixed" later by quietly adding a bypass role:

- **Rule**: any support/admin access to a specific user's data requires an
  explicit, time-boxed `permission_grants` row (`grantee_type='support'`)
  before any query runs — the same mechanism a professional uses, not a
  separate superuser path. For account-recovery/fraud cases where the user
  cannot grant it themselves in the moment, the documented exception is a
  break-glass procedure that still inserts an audited grant (with a
  `purpose` value like `'fraud_investigation'` and a short `expires_at`,
  once §9's `expires_at` addendum lands) **before** the access, reviewed
  after the fact — never a standing bypass credential.
- This is consistent with, and operationalizes, the strategy doc's
  "aggressive audit" mitigation for the "one breach exposes an entire life"
  hazard and CLAUDE.md's "the LLM never gets unrestricted DB access" rule
  extended to human operators.
- **Scope limit, reconciled against `06-threat-model.md` T10 (written
  after this section was drafted in parallel with it): this rule covers
  application-layer access only.** It governs `SUPPORT`/`ADMIN` rows in
  `user_roles` going through `permission_grants` — it says nothing about,
  and cannot bind, whoever holds Postgres superuser on the RDS instance,
  AWS IAM admin, or KMS key-usage permission. `FORCE ROW LEVEL SECURITY`
  binds the `plos_app`/`plos_worker` roles; it does not bind a superuser,
  who bypasses RLS by Postgres design regardless of what this section
  says. T10 names this — not this section's application-layer rule — "the
  single largest gap this document found" at the infrastructure level:
  who actually holds those credentials, and whether their use is audited
  anywhere outside the application's own (superuser-bypassable)
  `audit_log`, is unresolved in every Phase 0 document including this
  one. Closing it is IAM/infra policy work, not a schema or privacy-model
  change — recorded here so this section is never mistaken for having
  already closed it.

### 6.3 Agent compartmentalization — recap, not restated

[05-agent-architecture.md](05-agent-architecture.md) §7's per-agent
raw-tool grant table is the authoritative compartmentalization rule and is
not reproduced here. This document's contribution is §2's tiering (which
category each grant actually touches) and the confirmation that the tier
boundaries in §2.1 line up with that table's boundaries with no
contradiction found — e.g. `mental_context`/`clinical_safety_handoff` are
the only agents with any Mental-Health & Clinical raw access, matching §2.1
exactly.

## 7. Account deletion workflow (product vision §25)

Vision §25's own parenthetical — "revoke integrations, invalidate sessions,
delete active + derived data, object storage, vector representations,
handle backups per documented retention, audit the deletion without
retaining unnecessary PII" — is eight distinct steps once "active + derived
data" is read as two (it is: "active" and "derived" are different
`epistemic_status` populations, see step 3 vs. 4). This document runs them
in this order, against real tables.

**Preamble — soft-delete grace period.** Deletion is triggered by
`account.delete` (§3.2). It first sets `users.status='pending_deletion'` —
the one deliberate soft-delete exception the schema's own conventions carve
out ([04-database-schema.md](04-database-schema.md) §0: "used only where
the product needs an undo window"). A configurable grace period (default:
14 days) lets the user cancel before any hard deletion below runs; the user
may also choose "delete immediately," skipping the grace period. Steps 1–2
run immediately regardless of the grace period (security-sensitive
revocation shouldn't wait); steps 3–8 run only once the grace period
expires (or immediately, on the "delete immediately" path).

1. **Revoke integrations.** For every `integrations` row belonging to the
   user: call that provider's adapter `disconnect`/`revoke` (vision §18's
   adapter contract) to invalidate the token at the provider itself, set
   `integrations.status='revoked'`, and delete the pointed-to secret from
   Secrets Manager (ADR D4) — `credentials_secret_ref` never held the raw
   token in Postgres to begin with, so this step's Postgres-side work is
   just the status flip; the real revocation happens against Secrets
   Manager and the provider's own API.
2. **Invalidate sessions.** Set `revoked_at`, `revoked_reason='account_deletion'`
   on every `sessions` row for the user (forces re-auth on next refresh
   attempt); delete every `webauthn_credentials` row (a passkey can't be
   remotely revoked on the device, but deleting our stored public key row
   ends its usability against plos).
3. **Delete active data.** Hard `DELETE` every user-entered/imported fact:
   the `core_objects` rows with `object_type IN ('entity','event','observation','goal')`
   and `is_ai_derived=false`, cascading (per the schema's `ON DELETE CASCADE`
   1:1 pattern) through every domain extension table in §3.2/§3.3, plus the
   directly-owned `actions`/`decisions` rows, `health_profile` +
   `health_profile_history`, `financial_accounts` + `financial_account_history`,
   `relationships` (`relationship_class='social'`), `documents` metadata
   (binaries handled in step 5), `agent_conversations`/`agent_turns`, and
   `integrations` rows themselves (now `revoked`, no longer needed).
4. **Delete derived data.** Hard `DELETE` everything the system computed
   about the user rather than recorded on their behalf: `memories` +
   `memory_reasons` + `memory_history`, `clinical_memories` +
   `clinical_memory_history`, `agent_outputs` + `agent_output_sources`,
   `outcomes`, `relationships` (`causal_association`/`temporal_sequence`/
   `derivation` classes), `baselines`, `timeline_entries`. Note per §5:
   `document_history` is purged in this pass too when it tracks a
   Mental-Health & Clinical-tier document (join-resolved per §2.4);
   otherwise it goes with step 3.
5. **Delete object storage.** For every `documents` row captured before
   step 3/4 removed its metadata: delete the S3 object at `s3_bucket`/
   `s3_key` for **every** `s3_version_id`, not just the current one — ADR
   D6's S3 versioning means a plain delete-object call only writes a
   delete marker, leaving prior versions recoverable, so this step must
   issue per-version deletes (or a batch delete-all-versions call), not
   rely on the 30-day lifecycle rule (§5) to eventually catch up.
6. **Delete vector representations.** `embeddings` rows are already gone by
   construction — every row shares its primary key with a `core_objects`
   row deleted in steps 3–4, and `embeddings.core_object_id REFERENCES
   core_objects(id) ON DELETE CASCADE` (schema §4.4). This step exists as
   an explicit checklist item, not extra work, precisely because vision §25
   calls it out separately: per ADR D5 there is no second vector database
   to separately purge (pgvector lives in the same RDS instance), so
   confirming this step is "already done by cascade" is itself the
   verification, and the item this step exists to catch if that ever
   changes (e.g. a future migration to a standalone vector store) is
   exactly a second store this schema's own D5 rationale was written to
   avoid.
7. **Handle backups per documented retention.** Backups are point-in-time
   captures and cannot be selectively scrubbed the moment deletion
   completes. Per §5's retention table: the deleted user's data persists in
   RDS automated backups for up to 35 days and in any pre-deletion monthly
   snapshot for up to 12 months, purged faster only via the documented
   legal-erasure-request exception. This is stated to the user in the
   deletion confirmation flow, not silently assumed — "instant everywhere"
   is not a claim this architecture can make and vision §25's own phrase
   ("handle... per documented retention") doesn't require it to.
8. **Audit the deletion without retaining unnecessary PII.** Insert
   `audit_log` rows for each step above (`action` values like
   `'account.integrations_revoked'`, `'account.data_deleted'`,
   `'account.s3_purged'`, `'account.deletion_completed'`; `actor_type='system'`,
   `acting_as_user_id=<the deleted user>`, no PII in `metadata`). Then
   **anonymize, don't delete, the `users` row**: null `apple_sub`, `email`,
   `display_name`; keep `id`, `status='deleted'`, `deleted_at`. This is the
   resolution this document adds — `permission_grants`, `consent_records`,
   and `audit_log` all `REFERENCES users(id)` and are retained indefinitely
   per §5 as the legal consent/audit trail; deleting the `users` row
   outright would either orphan that trail against a dangling reference or
   require making those foreign keys nullable, both worse than keeping the
   smallest possible identity stub the ledger needs to remain meaningful,
   with zero recoverable PII in it.

## 8. Data export bundle (product vision §24)

A generated ZIP requested via `account.export`, built as a `documents` row
(`document_type='export_bundle'`) with a 7-day presigned download link
(§5), and recorded with `audit_log.action='export.request'` — the literal
example value already present in [04-database-schema.md](04-database-schema.md)
§11's own DDL comment.

```
export_<user_id>_<timestamp>.zip
├── manifest.json                  — user_id, generated_at, schema version, section list, SHA-256 per file
├── profile/
│   ├── account.json               — users (sanitized), user_roles, subscription status
│   ├── consent_history.json       — consent_records, all rows incl. revoked
│   └── permission_history.json    — permission_grants, all rows incl. revoked/expired
├── goals/goals.json                — goals + goal_habit_detail + goal_history
├── health/
│   ├── vitals.json, sleep.json, symptoms.json, injury_flags.json, lab_results.json
│   └── health_profile.json         — + health_profile_history
├── fitness/sessions.json           — event_fitness_session + fitness_session_set
├── nutrition/logs.json
├── mental_health/                — INCLUDED ONLY AFTER A FRESH REAUTHENTICATION STEP (see note below)
│   ├── journal.json
│   └── clinical_memories.json
├── finance/accounts.json, transactions.json, snapshots.json
├── productivity/calendar.json, tasks.json
├── learning/sessions.json
├── social/relationships.json        — + entities (entity_type='person') + entity_person_detail
├── travel/trips.json
├── career/milestones.json
├── memories/memories.json           — memories + memory_reasons + memory_history (excludes clinical_memories, above)
├── ai/
│   ├── agent_outputs.json           — finding/recommendation/evidence/confidence/provenance, full epistemic_status
│   └── baselines_snapshot.json      — current baselines at export time (not historical — schema §6.2)
├── documents/
│   ├── index.json                   — metadata: type, filename, uploaded_at, checksum, links
│   └── files/                       — binaries fetched via presigned URL at export-build time
├── audit/my_actions.json            — audit_log WHERE acting_as_user_id = self, via the existing audit_log_read_own policy — never another user's row or the full system log
└── professional_sharing/grants.json  — permission_grants WHERE grantee_type='professional', incl. revoked/expired
```

Notes:

- **Raw conversation history is not in the default bundle.**
  `agent_conversations`/`agent_turns` are 90-day ephemeral working context
  (§5), not a persisted memory class; the persisted, provenanced trail
  vision §45–46 requires be inspectable is `agent_outputs`, which **is**
  included. Raw transcripts are offered only as a separate, explicitly
  opt-in export addendum — bundling them by default would silently include
  raw journal text that even `mental_context`'s own compartmentalization
  keeps away from the Life Master Agent (§2.1).
- **The `mental_health/` section requires the same reauthentication step
  as a Tier 3 action** ([05-agent-architecture.md](05-agent-architecture.md)
  §6 step 6), not merely the export job's normal auth — a fresh
  credential/passkey assertion is required before that section is built,
  and the export request UI states explicitly that the bundle will include
  mental-health/clinical content before the user confirms. This mirrors
  §2.1's Mental-Health & Clinical access rule rather than treating export
  as a lower-scrutiny path around it.
- **Provenance is never stripped.** Every JSON section retains
  `source`, `is_ai_derived`, `confidence`, `epistemic_status`, and
  `agent_version` from the `core_objects` spine — a user's own export must
  preserve the FACT/DERIVED FACT/AI INFERENCE/RECOMMENDATION distinction
  (non-negotiable rule #6), not present everything as flat fact once it
  leaves the product.

## 9. Professional sharing (product vision §16, §29)

The concrete schema/workflow behind
[00-brand-design-master-prompt.md](00-brand-design-master-prompt.md)'s
"Professional-sharing UI must always show who receives access, what's
shared, expiry, read/write, and a revoke path" — expressed as real tables,
not UI language.

1. **Initiate.** User-initiated only, from the Privacy/Data Control Center
   or a specialist's own share affordance — never system-initiated.
2. **Draft.** `draft_professional_report(user_id, focus_domain)`
   ([05-agent-architecture.md](05-agent-architecture.md) §3.2, tier 1)
   creates a `documents` row (`document_type='professional_report'`) plus
   `document_links` rows to every specific `core_objects` row (journal
   entries, lab results, clinical memories) that backs it — this **is**
   "what's shared," concretely inspectable by the user before anything
   sends, not a UI promise layered on top of an opaque payload.
3. **Pick the professional.** An existing `professionals` row (already
   `verified_at`) or a new invite (creates one, `verified_at` NULL pending
   verification — the verification flow itself is out of scope here).
4. **Set scope and duration.** Today this can only be read-only (§3.2's
   `documents_shared_professional` path, once built — see the gap below —
   grants `SELECT` only; no scoped tool anywhere lets a professional write
   back into plos) and duration is manual-revoke-only. **Schema addendum
   needed**: `permission_grants.expires_at TIMESTAMPTZ NULL`. Until that
   migration lands, "expiry" in the brand doc's UI requirement is not
   actually enforceable server-side — flagged prominently in §10, not
   quietly treated as already satisfied by `revoked_at`.
5. **Confirm and share.** `share_professional_report(document_id, professional_id)`
   (tier 3, reauthentication required) inserts the `permission_grants` row
   (`scope='professional.share'`, `purpose=<focus_domain>`,
   `granted_via='feature_prompt'`) and sets `shared_via_grant_id` on every
   included `clinical_memories` row. **It should do the same for the
   `documents` row itself** — but `documents` has no `shared_via_grant_id`
   column today (only `clinical_memories` does, schema §4.2). This is a
   real, load-bearing gap: see §10.
6. **Access.** The professional authenticates as a `users` row holding
   `PROFESSIONAL` role, `RequestContext.professional_id` set, activating
   `app.current_professional_id` and the `clinical_memories_shared_professional`
   RLS policy (schema §10.3). **That policy covers `clinical_memories`
   only** — there is currently no equivalent policy on `documents`, so a
   professional has no RLS-enforced read path to the actual
   `professional_report` document `draft_professional_report` produced,
   even though that's the object the whole workflow exists to share. See
   §10.
7. **Revoke.** The user sets `permission_grants.revoked_at = now()` from
   the Connections/Privacy screen at any time; RLS re-evaluates per query
   with no cache to invalidate, so revocation is effective immediately —
   the brand doc's explicit "revoke path" requirement, satisfied as-is by
   the existing mechanism.
8. **Expire** (once §10's `expires_at` addendum exists): a scheduled
   `worker` job (same per-user-transaction discipline as schema §10.2)
   sweeps `permission_grants WHERE expires_at < now() AND revoked_at IS NULL`,
   sets `revoked_at = expires_at`, and logs it with `actor_type='system'` —
   distinguishable in `audit_log` from a user-initiated revoke.
9. **Audit.** Every professional read of shared content is audited like any
   other Scoped Tool call ([05-agent-architecture.md](05-agent-architecture.md)
   §6 step 8) — `audit_log.actor_type='professional'` is already a listed
   enum value (schema §11), so this needs no schema change, only the
   implementation confirming every `clinical_memories`/`documents` read
   under a professional `RequestContext` is logged the same way an agent's
   tool call is.
10. **Non-clinical domains, deliberately not generalized here.** The
    `permission_grants`/`documents` mechanism above is domain-agnostic in
    principle — sharing lab results with a physical therapist or a spend
    summary with a financial advisor could use the identical shape. But
    `draft_professional_report`/`share_professional_report` are the *only*
    scoped tools wired to it today
    ([05-agent-architecture.md](05-agent-architecture.md) §3.2), reflecting
    that document's MVP-scope note (§11 of that document) that Mental/
    Emotional is the pair vision §16 specifically constrains. Extending
    professional sharing to other domains is a future tool-registration
    decision, not a schema change — flagged, not built speculatively.

## 10. Open questions / inconsistencies vs. the database schema

- **FK cascade gap on single-record deletion.** Vision §54 requires the
  user be able to delete individual pieces of information, not only the
  whole account. But `relationships.subject_id`/`object_id`,
  `outcomes.outcome_of_id`, and `memory_reasons.supporting_core_object_id`
  all `REFERENCES core_objects(id)` **without an `ON DELETE` clause** in
  [04-database-schema.md](04-database-schema.md)'s DDL — Postgres defaults
  to `NO ACTION`, meaning a targeted delete of a single fact that anything
  else references would fail with a foreign-key violation instead of
  succeeding. Recommend: `ON DELETE CASCADE` on `relationships.subject_id`/
  `object_id` (a relationship about a deleted thing is meaningless once
  that thing is gone) and on `outcomes.outcome_of_id` (an outcome without
  its action/decision is orphaned), and `ON DELETE SET NULL` on
  `memory_reasons.supporting_core_object_id` (the memory and its other
  reasons should survive losing one piece of supporting evidence). This is
  a schema addendum for whoever implements migrations, not something this
  document can fix by itself.
- **Professional sharing's `documents` gap (§9 steps 5–6).** `clinical_memories`
  has `shared_via_grant_id` and a matching extended RLS policy
  (schema §10.3); `documents` — the table `draft_professional_report`
  actually writes to — has neither. Recommend adding
  `documents.shared_via_grant_id UUID REFERENCES permission_grants(id)`
  and a `documents_shared_professional` policy mirroring §10.3 exactly.
  Without this, the professional-sharing workflow as specified in
  [05-agent-architecture.md](05-agent-architecture.md) §3.2 has no actual
  database-enforced read path for the professional to the report they were
  just granted access to.
- **No `expires_at` on `permission_grants`.** The brand doc requires every
  professional share show an expiry; the schema only supports manual
  revocation. Recommend `permission_grants.expires_at TIMESTAMPTZ NULL`
  plus the sweep job described in §9 step 8.
- **No professional write-back path exists.** The brand doc's sharing UI
  spec includes a read/write toggle, but no Scoped Tool or RLS policy
  anywhere lets a professional write into plos (annotate a report, correct
  a clinical memory). Either the brand doc's "write" option should be
  scoped out for MVP (read-only professional sharing, stated plainly to
  the user rather than shown as a toggle with no effect), or a
  `professional_annotations` table and a corresponding write-capable RLS
  policy are a real, undesigned addition for a later phase. Not resolved
  here.
- **`action_medication_log` has no Scoped Tool.** No specialist in
  [05-agent-architecture.md](05-agent-architecture.md) §3 has a tool that
  reads this table, despite it sitting at Sensitive-Health tier and
  intersecting the psychiatric-content caveat in §2.5. Confirm whether this
  is deliberate (medication adherence isn't yet a feature) or a gap to
  close alongside the `health_profile`-visibility gap below.
- **`health_profile` is invisible to the Mental/Emotional pair.** §2.5
  already states the mechanism; recorded here as an open question for
  whoever owns [05-agent-architecture.md](05-agent-architecture.md): should
  `check_crisis_risk_signals` gain a read of `health_profile`'s
  `chronic_conditions`/`medications_current` fields, given a documented
  psychiatric diagnosis or psychiatric medication is directly relevant to
  crisis-risk assessment and currently reaches that tool only if the
  unrelated Health pair happens to also be dispatched?
- **Per-row sensitivity override, deferred.** §2.5's lab-result and
  memory/agent-output most-restrictive-wins discussion both point at the
  same missing primitive: no table has a way to mark one row more sensitive
  than its table's default tier. Not built here — flagged as the natural
  extension point if a real case (e.g. a specific abnormal lab category)
  demands it.
- **`06-threat-model.md` now exists — reconciled where it mattered, one
  gap picked up here, one still open.** This document was drafted in
  parallel with the threat model and couldn't see it; two consequences,
  both now addressed:
  - §6.2's break-glass rule has been scoped explicitly against threat
    model T10 (see §6.2's added note) — it covers application-layer
    access only; T10's infrastructure-layer gap (who holds RDS/AWS/KMS
    admin credentials) is real and remains open, IAM/infra work, not a
    privacy-model or schema fix.
  - T6 (malicious documents — malware scanning, file-type allowlisting,
    upload/decompression-bomb limits) explicitly named this document as
    where that gap should land. It doesn't fit any existing section here
    because it's a pure upload-time infrastructure control with no
    privacy-model-shaped angle (no consent, sensitivity-tier, or
    access-rule question attaches to it) — recording that explicitly
    rather than leaving the handoff silently unpicked-up.
    [08-mvp-definition.md](08-mvp-definition.md) §6 already correctly
    tracks it as moot at MVP (no user-uploaded document exists yet); it
    must be designed — as infra/upload-pipeline work, likely alongside
    whichever document-storage code actually implements uploads — before
    the lab-result/professional-report upload feature ships.
