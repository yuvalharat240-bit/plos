# plos — Ops & Security Runbook (Phase 1 Milestone 7)

> Written for [09-phase1-implementation-plan.md](09-phase1-implementation-plan.md)'s
> Milestone 7 ("security & ops hardening pass"). Two of that milestone's
> four items — least-privilege DB roles and an IDOR test suite — are code
> (`apps/api/migrations/028_least_privilege_worker_role.js`,
> `apps/api/test/idor.e2e-spec.ts`) and are not repeated here. This
> document is the other two, which are not code: the infra-level
> break-glass procedure the plan says gets resolved "as IAM/infra policy,"
> and the CloudTrail/GuardDuty baseline, which needs a real AWS account
> (Milestone 8) to actually enable. Both are written now, in full, so
> Milestone 8 applies a ready decision instead of designing one under
> deploy pressure.

## 1. Why this is a document, not a Terraform/CloudFormation file

There is no AWS account behind this project yet — [09](09-phase1-implementation-plan.md)'s
own Milestone 8 is titled "Deploy the AWS skeleton (staging first)" and
hasn't run. Writing IaC against an account that doesn't exist would be
unverifiable by construction: nothing here could be applied, so nothing
here could be checked. That's the same category of environment limitation
already recorded elsewhere in this project (no Docker, no real Apple
Developer Team, no live AWS account for S3 — see
[10-progress-checklist.md](10-progress-checklist.md)) — the honest response
is a concrete, reviewable decision document, not a fabricated `.tf` file
nobody can `terraform plan` against. Section 3 and 4 below are written to
be turned directly into Terraform/console steps once the account exists.

## 2. Least-privilege DB roles — what changed and why (code, referenced here for completeness)

`021_role_grants.js`'s own header flagged this from Milestone 1: `plos_app`
and `plos_worker` were granted identical, full CRUD on every table —
"deliberately broad-but-functional," explicitly deferred to this
milestone. `028_least_privilege_worker_role.js` tightens `plos_worker` to
exactly what the worker's real code does: `SELECT` on `users` and the
handful of domain/extension tables its baseline and calendar-density
queries join across, `INSERT`/`UPDATE` on `baselines` only, and nothing
else — no `DELETE` anywhere. `permission_scopes` (a seed-once catalog only
ever written by migrations, never application code) is now read-only for
both roles.

**Real finding while doing this**: no application code had ever actually
connected as `plos_worker` — every prior "ran the real worker" verification
in this project used `plos_app` credentials for both processes. That's
fixed going forward: `test/worker.e2e-spec.ts` now connects as
`plos_worker`, proving the tightened grant is sufficient for the worker's
actual code path, not just written and assumed. **`plos_app` was
deliberately left broad** — it is the one role backing every authenticated
HTTP request across the entire resource surface, including
`AccountDeletionService`'s real hard-deletes across most of the schema
(Milestone 6); narrowing it further would need a per-endpoint role split
this plan doesn't call for and that isn't proportionate at MVP's request
volume.

**Real deployment note for Milestone 8**: this role split only does
anything if the `api` and `worker` Fargate tasks are actually configured
with *different* `DATABASE_URL` secrets (`plos_app` for the API task,
`plos_worker` for the worker task) in their respective task definitions.
Nothing in the application code hardcodes a role — `TenantDatabaseService`
just reads `DATABASE_URL` — so this is a one-line difference in each
task's Secrets Manager reference at deploy time, not a code change. Flag
this explicitly in the Milestone 8 task-definition review; getting it
wrong (both tasks sharing one `plos_app` secret) would silently undo this
milestone's work without any test catching it, since both roles can
currently do the same job — just with different blast radii if either
process is ever compromised or buggy.

## 3. Infrastructure-level break-glass — IAM policy and procedure

[07-privacy-model.md](07-privacy-model.md) §6.2 established the
application-layer rule: no `SUPPORT`/`ADMIN` role gets an implicit path to
tenant data — any access requires an explicit, time-boxed
`permission_grants` row first, the same mechanism a professional uses.
That section, and [06-threat-model.md](06-threat-model.md) T10, both name
the gap this section closes: **that rule governs the application's own
`permission_grants`/RLS layer. It says nothing about whoever holds RDS
superuser, AWS IAM admin, or KMS key-usage permission** — those bypass RLS
and the application entirely, by design (a database superuser bypasses
`FORCE ROW LEVEL SECURITY` per Postgres's own semantics; an IAM admin can
grant themselves any AWS permission; a KMS key admin can authorize
decryption of anything the key protects). T10 calls this "the single
largest gap this document found." This is the resolution.

### 3.1 Principle

**No standing human credential ever holds RDS superuser, AWS `AdministratorAccess`,
or KMS key-administrator permission for the production account.** Every
use of that level of access is: (a) requested explicitly, (b) time-boxed,
(c) logged somewhere the requester cannot themselves erase, and (d)
reviewed after the fact. This is the same shape as the application-layer
rule in privacy-model §6.2 — deliberately, so there is one mental model
for "elevated access" across the whole system, not two.

### 3.2 Concrete mechanism (apply at Milestone 8)

1. **No IAM user ever holds these permissions directly.** All human access
   to AWS is via IAM Identity Center (or equivalent SSO) roles, never
   long-lived IAM user access keys. The break-glass role itself
   (`plos-breakglass-admin` or similar) exists but has **no one permanently
   assigned to it**.
2. **Assumption requires a second party.** Assuming the break-glass role
   requires either (a) a change-management ticket referencing a specific
   incident, approved by a second engineer before assumption, or (b) for
   a genuine emergency where no second party is reachable, a solo
   assumption that is *automatically* flagged for mandatory post-hoc review
   within 24 hours — never a silent, unreviewed elevation. This mirrors
   privacy-model §6.2's own "reviewed after the fact... never a standing
   bypass credential" line, applied to infra instead of application data.
3. **Every assumption is logged outside the application's own audit_log.**
   CloudTrail (§4 below) records every `AssumeRole` call against the
   break-glass role, every API call made while it's assumed, and every KMS
   `Decrypt`/`GenerateDataKey` call against the production CMK, in a
   **separate AWS account** (a dedicated log-archive account, or at minimum
   a CloudTrail organization trail with S3 Object Lock enabled) that the
   production account's own admins cannot delete from — this is the literal
   fix for T10's "audited outside the application's own (superuser-
   bypassable) audit_log" gap. `audit_log` is a Postgres table; a
   superuser can `ALTER ROLE ... BYPASSRLS` or disable the append-only
   trigger outright (schema §11 says this explicitly). CloudTrail-to-a-
   separate-account cannot be silenced by anyone with only production-
   account access.
4. **Database-level superuser access** (the RDS master user) is used only
   for: applying migrations (already the pattern this whole project uses
   — the `postgres` role runs migrations, `plos_app`/`plos_worker` never
   do), and genuine incident response. It is never used for routine
   reads/writes of tenant data — those go through `plos_app`, same as the
   application. A break-glass session that queries tenant data directly as
   the RDS master user, for any reason short of active incident response,
   is itself the kind of event step 2's mandatory review exists to catch.
5. **KMS**: the production CMK's key policy grants `kms:Decrypt`/
   `kms:GenerateDataKey` to the application's own IAM role (what RDS/S3
   use transparently for encryption-at-rest) but **not** to the
   break-glass admin role by default — key *usage* for routine encryption
   is separate from key *administration* (rotation, policy changes,
   deletion), and only the latter should ever be reachable via
   break-glass, gated by the same second-party-or-reviewed rule as step 2.
6. **Quarterly access review**: who currently has permission to *assume*
   the break-glass role (not who has used it — a separate, smaller list)
   is reviewed every quarter, alongside the restore-drill cadence (§5).

### 3.3 What this document does not do

It does not create any of the above in AWS — there is no AWS account.
It is the decision Milestone 8 applies verbatim when the account is
created, rather than a decision made under the time pressure of a live
deploy. If a human reviewing this disagrees with any specific mechanism
above (e.g., prefers a different SSO provider or a different log-archive
pattern), that's a real, open decision for that human to make — this
section states plos's own default, not an externally-mandated standard.

## 4. CloudTrail / GuardDuty baseline (apply at Milestone 8)

Both require a real AWS account and cannot be turned on here. The
checklist, so Milestone 8 has a concrete, reviewed task instead of
rediscovering "we should probably enable logging":

- [ ] **CloudTrail**: an organization (or account-level, if no AWS
  Organization exists yet) trail, logging to a dedicated log-archive
  account/bucket with S3 Object Lock (write-once) enabled, covering all
  regions and all management + data events for at least RDS, KMS, and IAM.
  This is what §3.2 step 3 depends on.
- [ ] **GuardDuty**: enabled in the production account (and the log-archive
  account, if separate) with the RDS Protection and Malware Protection
  features on — RDS Protection specifically matters here since RDS is the
  one datastore this whole architecture depends on (ADR D5's "deliberately
  one database").
- [ ] **Alerting**: GuardDuty findings and any `AssumeRole` into the
  break-glass role (§3.2) route to a real notification channel (not just
  a console you have to remember to check) before Milestone 8 is
  considered done — a detective control nobody looks at is not a control.
- [ ] Re-run this checklist's items against the actual Terraform/console
  state before Milestone 8 is marked complete, the same "verify, don't
  assert" standard every other milestone in this project has been held to.

## 5. Backup/restore verification

[06-threat-model.md](06-threat-model.md)/CLAUDE.md's rule: "a backup that
has never been restored is not verified." `apps/api/scripts/restore-drill.js`
(`npm run restore-drill`) is a real, working drill against this
environment's actual Postgres tooling — full rationale and exactly what it
does and doesn't prove is in that file's own header comment (short version:
no `pg_dump`/`pg_restore`/AWS RDS snapshot tooling exists in this
environment, so it uses Postgres's own stop-and-copy-the-data-directory
physical backup method instead, which is a real, standard mechanism, not
an invented one). It was run for real while writing this milestone —
output logged in [10-progress-checklist.md](10-progress-checklist.md).

**At Milestone 8**, once RDS exists, this drill should be re-authored
against RDS's actual automated-snapshot-and-restore mechanism (the
literal thing [07-privacy-model.md](07-privacy-model.md) §5 describes) —
the local version here proves the *concept* (a stopped/copied Postgres
data directory round-trips real data through a simulated disaster
correctly) but is not itself the production backup mechanism. Cadence:
quarterly, per privacy-model §5's own adopted placeholder — track this
alongside §3.2 step 6's access review so both quarterly obligations land
on the same recurring calendar entry, not two independently-forgotten ones.
