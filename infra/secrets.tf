# Every value the running api/worker process actually reads from the
# environment (apps/api/src/**/*.ts's own process.env.* references,
# checked directly rather than guessed) — split into "secret" (Secrets
# Manager, injected as `secrets` in the ECS task definition) vs "config"
# (plain, non-sensitive `environment` entries in ecs.tf). Getting the
# plos_app-vs-plos_worker DATABASE_URL split right here is the one thing
# docs/11-ops-security-runbook.md §2 explicitly flags as able to silently
# undo that milestone's work if two tasks ever share one secret.

resource "aws_secretsmanager_secret" "database_url_app" {
  name       = "plos/${var.environment}/database-url-app"
  kms_key_id = aws_kms_key.main.arn
}

resource "aws_secretsmanager_secret_version" "database_url_app" {
  secret_id = aws_secretsmanager_secret.database_url_app.id
  secret_string = "postgres://plos_app:${random_password.plos_app.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${var.db_name}"
}

resource "aws_secretsmanager_secret" "database_url_worker" {
  name       = "plos/${var.environment}/database-url-worker"
  kms_key_id = aws_kms_key.main.arn
}

resource "aws_secretsmanager_secret_version" "database_url_worker" {
  secret_id = aws_secretsmanager_secret.database_url_worker.id
  secret_string = "postgres://plos_worker:${random_password.plos_worker.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${var.db_name}"
}

# The migrate task connects as the RDS master user (docs/11 §3.2 step 4:
# "used only for applying migrations... and genuine incident response"),
# and separately needs the app/worker passwords to hand to
# migrations/001_roles_and_extensions.js's own env-var-parameterized
# CREATE ROLE statements (apps/api/migrations/001_roles_and_extensions.js)
# — that migration only ever runs the CREATE ROLE branch once (it's
# gated on the role not already existing), so this only matters on the
# very first migrate run against a fresh database.
resource "aws_secretsmanager_secret" "database_url_master" {
  name       = "plos/${var.environment}/database-url-master"
  kms_key_id = aws_kms_key.main.arn
}

resource "aws_secretsmanager_secret_version" "database_url_master" {
  secret_id = aws_secretsmanager_secret.database_url_master.id
  secret_string = "postgres://${var.db_master_username}:${random_password.rds_master.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${var.db_name}"
}

resource "aws_secretsmanager_secret" "plos_app_role_password" {
  name       = "plos/${var.environment}/plos-app-role-password"
  kms_key_id = aws_kms_key.main.arn
}
resource "aws_secretsmanager_secret_version" "plos_app_role_password" {
  secret_id     = aws_secretsmanager_secret.plos_app_role_password.id
  secret_string = random_password.plos_app.result
}

resource "aws_secretsmanager_secret" "plos_worker_role_password" {
  name       = "plos/${var.environment}/plos-worker-role-password"
  kms_key_id = aws_kms_key.main.arn
}
resource "aws_secretsmanager_secret_version" "plos_worker_role_password" {
  secret_id     = aws_secretsmanager_secret.plos_worker_role_password.id
  secret_string = random_password.plos_worker.result
}

resource "aws_secretsmanager_secret" "anthropic_api_key" {
  name       = "plos/${var.environment}/anthropic-api-key"
  kms_key_id = aws_kms_key.main.arn
}
resource "aws_secretsmanager_secret_version" "anthropic_api_key" {
  secret_id     = aws_secretsmanager_secret.anthropic_api_key.id
  secret_string = var.anthropic_api_key
}

# JWT_ACCESS_SECRET / AGENT_CONFIRMATION_SECRET / EXPORT_DOWNLOAD_SECRET —
# all HMAC signing secrets read once at process start (auth/token.service.ts,
# agent/tools/confirmation-token.service.ts, privacy/export-bundle-storage.service.ts),
# not values a human ever needs to type in. Random-generated here rather
# than left for whoever runs `terraform apply` to invent one inline.
resource "random_password" "jwt_access_secret" {
  length  = 64
  special = false
}
resource "aws_secretsmanager_secret" "jwt_access_secret" {
  name       = "plos/${var.environment}/jwt-access-secret"
  kms_key_id = aws_kms_key.main.arn
}
resource "aws_secretsmanager_secret_version" "jwt_access_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_access_secret.id
  secret_string = random_password.jwt_access_secret.result
}

resource "random_password" "agent_confirmation_secret" {
  length  = 64
  special = false
}
resource "aws_secretsmanager_secret" "agent_confirmation_secret" {
  name       = "plos/${var.environment}/agent-confirmation-secret"
  kms_key_id = aws_kms_key.main.arn
}
resource "aws_secretsmanager_secret_version" "agent_confirmation_secret" {
  secret_id     = aws_secretsmanager_secret.agent_confirmation_secret.id
  secret_string = random_password.agent_confirmation_secret.result
}

resource "random_password" "export_download_secret" {
  length  = 64
  special = false
}
resource "aws_secretsmanager_secret" "export_download_secret" {
  name       = "plos/${var.environment}/export-download-secret"
  kms_key_id = aws_kms_key.main.arn
}
resource "aws_secretsmanager_secret_version" "export_download_secret" {
  secret_id     = aws_secretsmanager_secret.export_download_secret.id
  secret_string = random_password.export_download_secret.result
}
