# plos — Milestone 8 staging deploy

Written 2026-09-22, reviewable and unapplied. There is no AWS account
connected to this project — nothing in this directory has ever run
`terraform plan`, let alone `apply`. That's the same honest gap
[docs/11-ops-security-runbook.md](../docs/11-ops-security-runbook.md) §1
already recorded for the break-glass/CloudTrail sections; this directory
exists because the project's owner explicitly chose "write the IaC now,
deploy later" over waiting for an account to exist first. Treat every
resource size, region, and default in here as a starting point to review,
not a decision already made on your behalf.

## What this builds

RDS Postgres 16 (Multi-AZ, private, encrypted), an ALB, one `api` Fargate
service, a nightly-scheduled (not standing) `worker` Fargate task, S3
(versioned, SSE-KMS) for export bundles, Secrets Manager for every
credential the app reads, one KMS CMK, and an ECR repo — the exact list
[docs/09-phase1-implementation-plan.md](../docs/09-phase1-implementation-plan.md)'s
Milestone 8 section names, sized per ADR D4 ("a single small RDS instance
and a couple of Fargate tasks, not a large multi-service buildout").
Staging only; production is explicitly a separate, later decision.

## What this does NOT build

- **CloudTrail / GuardDuty / the break-glass IAM role** —
  [docs/11](../docs/11-ops-security-runbook.md) §3/§4 already wrote the
  exact procedure and checklist for these; they're account-level/
  organization-level setup more than they are this stack's Terraform, and
  depend on decisions (SSO provider, log-archive account) that doc
  explicitly leaves to a human. Apply that document's checklist against
  the real account before this deployment is considered done, per its own
  final line: "re-run this checklist... before Milestone 8 is marked
  complete."
- **A real domain / HTTPS by default** — see `variables.tf`'s
  `domain_name` comment. Leaving it unset gets a working HTTP-only ALB,
  intentionally, so this can be applied and smoke-tested before a domain
  is decided. Do not point real user traffic (or a real Sign-in-with-Apple/
  passkey flow, which needs a stable RP ID) at the HTTP-only listener.
- **A CI/CD pipeline** — the build/push/apply/migrate sequence below is
  manual. Wiring it into GitHub Actions (or similar) is a reasonable next
  step once this has been applied and verified manually at least once.

## Prerequisites

- An AWS account with billing enabled, and credentials for it (`aws
  configure` or equivalent) in whatever environment runs `terraform
  apply` and the `docker build`/`push` steps.
- Terraform >= 1.7, Docker, and the AWS CLI installed there. None of the
  three exist in this project's own sandboxed dev environment (no
  Docker, no AWS CLI — see [docs/10](../docs/10-progress-checklist.md)'s
  own list of environment limitations), which is the concrete reason this
  was never applied here.
- A Terraform state backend decided and configured in `versions.tf`'s
  empty `backend` slot before the first `init` — an S3 bucket + DynamoDB
  lock table (bootstrapped once, by hand or a tiny separate Terraform
  config, since state can't describe the bucket that holds it) is the
  standard choice; Terraform Cloud is the other common one. Do not leave
  this on local state for anything past a throwaway first `plan`.

## Deploy sequence

1. **Bootstrap the state backend** (one-time, outside this config) and
   fill in `versions.tf`'s `backend` block.
2. **`docker build`** from `apps/api/`:
   ```bash
   docker build -t <ecr-repo-url>:api-<sha> .
   docker build --target migrate -t <ecr-repo-url>:migrate-<sha> .
   ```
   (The ECR repo doesn't exist yet the very first time — apply once with
   placeholder `container_image`/`migrate_container_image` values to
   create `aws_ecr_repository.api`, push the real images, then apply
   again with the real tags. This chicken-and-egg step only happens once;
   every later deploy just pushes new tags to the existing repo.)
3. **`aws ecr get-login-password | docker login ...`**, then
   `docker push` both tags.
4. Copy `terraform.tfvars.example` → `terraform.tfvars`, fill in
   `container_image`/`migrate_container_image` with the real pushed tags,
   pass `anthropic_api_key` via `TF_VAR_anthropic_api_key` (never
   committed to a file).
5. `terraform init && terraform plan && terraform apply`.
6. **Run migrations** — the slim runtime image deliberately excludes
   `node-pg-migrate` (see `apps/api/Dockerfile`'s own comment), and RDS
   has no public endpoint (ADR D4), so this has to run as a one-off task
   *inside* the VPC, not from a local machine:
   ```bash
   aws ecs run-task \
     --cluster "$(terraform output -raw ecs_cluster_name)" \
     --task-definition "$(terraform output -raw migrate_task_definition_arn)" \
     --launch-type FARGATE \
     --network-configuration "awsvpcConfiguration={subnets=[$(terraform output -json private_subnet_ids | jq -r 'join(",")')],securityGroups=[$(terraform output -raw fargate_security_group_id)],assignPublicIp=DISABLED}"
   ```
   Watch it in CloudWatch Logs (`/ecs/plos-staging/migrate`) or via `aws
   ecs describe-tasks` until it exits 0. Re-run this same command for
   every later deploy that adds new migrations — the api/worker services
   themselves never run migrations on startup.
7. **Smoke test**: `curl http://$(terraform output -raw alb_dns_name)/health`
   should return `{"status":"ok"}` — this is a real DB round trip
   (`apps/api/src/health.controller.ts`), not a hardcoded 200.

## Verification (docs/09 Milestone 8's own stated bar)

- [ ] Staging is reachable — the `/health` curl above.
- [ ] RLS is still enforced remotely — re-run the same cross-tenant proof
  `test/rls.e2e-spec.ts` does locally, but against the real RDS endpoint
  (a session bound to `plos_app`, querying another user's `user_id`,
  expecting zero rows, not an error).
- [ ] Milestone 7's restore drill, repeated against staging specifically
  — [docs/11](../docs/11-ops-security-runbook.md) §5 already flags that
  the local `restore-drill.js` script proves the *concept*
  (stop-and-copy a Postgres data directory) but RDS's own automated-
  snapshot-and-restore is the real mechanism this environment should be
  drilled against once it exists. Re-author that drill against a real RDS
  snapshot restore before calling this item done.
- [ ] Apply [docs/11](../docs/11-ops-security-runbook.md) §3/§4's
  checklist (break-glass role, CloudTrail, GuardDuty, alerting) against
  the real account.

## Known gaps this pass found and fixed in application code, not just infra

Writing this Terraform surfaced two real bugs the code side needed fixing
before any of this would have worked correctly — both already fixed,
noted here so the reasoning isn't lost:

1. `apps/api/migrations/001_roles_and_extensions.js` hardcoded the
   `plos_app`/`plos_worker` Postgres role passwords as plaintext literals.
   Applying it unmodified against a real RDS instance would have given
   the production database roles these exact, public, repo-visible
   passwords. Now reads `PLOS_APP_ROLE_PASSWORD`/`PLOS_WORKER_ROLE_PASSWORD`
   from the environment (this stack's `migrate` task injects the real
   Secrets-Manager-backed values — see `secrets.tf`), falling back to the
   original dev-only literals when unset, so local dev/CI/the test suite
   are unaffected.
2. `apps/api/src/privacy/export-bundle-storage.service.ts` only ever
   wrote to the local container filesystem — provisioning a real S3
   bucket without this fix would have left it completely unused, with
   exports silently landing in a Fargate task's ephemeral, non-shared
   storage instead. Now has a real `@aws-sdk/client-s3`-backed path,
   switched on by `PLOS_OBJECT_STORE_DRIVER=s3` (set in `ecs.tf`'s task
   definitions), behind the exact same interface the local implementation
   already had.

Neither of these two code changes has been tested against a real AWS
account (none exists) — verified by build, type-check, and manual review
only, the same honest limit as the rest of this stack.
