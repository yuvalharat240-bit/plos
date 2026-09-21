# Two IAM roles per ECS task, not one — the execution role is what ECS
# itself uses to pull the image and resolve `secrets` before the
# container even starts; the task role is what the *running application
# code* can do via the SDK's default credential chain (this is exactly
# what export-bundle-storage.service.ts's `new S3Client({})` relies on —
# no access key ever appears in the container, in an env var, or in this
# Terraform).

data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# --- Execution role: shared by api, worker, and the one-off migrate task ---

resource "aws_iam_role" "ecs_execution" {
  name               = "plos-${var.environment}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# The managed policy above covers ECR pull + CloudWatch Logs; it does NOT
# cover reading the specific Secrets Manager secrets each task definition
# references, or decrypting them with a customer-managed KMS key — both
# have to be granted explicitly, scoped to exactly the secrets/key this
# stack created (never `secretsmanager:*`/`kms:*` on `*`).
data "aws_iam_policy_document" "ecs_execution_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.database_url_app.arn,
      aws_secretsmanager_secret.database_url_worker.arn,
      aws_secretsmanager_secret.database_url_master.arn,
      aws_secretsmanager_secret.plos_app_role_password.arn,
      aws_secretsmanager_secret.plos_worker_role_password.arn,
      aws_secretsmanager_secret.anthropic_api_key.arn,
      aws_secretsmanager_secret.jwt_access_secret.arn,
      aws_secretsmanager_secret.agent_confirmation_secret.arn,
      aws_secretsmanager_secret.export_download_secret.arn,
    ]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.main.arn]
  }
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name   = "read-task-secrets"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution_secrets.json
}

# --- Task role: api (needs S3, for ExportBundleStorageService) ---

resource "aws_iam_role" "api_task" {
  name               = "plos-${var.environment}-api-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

data "aws_iam_policy_document" "api_task_s3" {
  statement {
    sid = "ExportBundlesReadWrite"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:ListBucketVersions",
    ]
    resources = [
      aws_s3_bucket.export_bundles.arn,
      "${aws_s3_bucket.export_bundles.arn}/*",
    ]
  }
  statement {
    sid       = "SSEKMSForExportBucket"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.main.arn]
  }
}

resource "aws_iam_role_policy" "api_task_s3" {
  name   = "export-bundle-s3"
  role   = aws_iam_role.api_task.id
  policy = data.aws_iam_policy_document.api_task_s3.json
}

# --- Task role: worker (no AWS SDK calls today — least privilege means
# an empty policy, not a copy of the api role's S3 access) ---

resource "aws_iam_role" "worker_task" {
  name               = "plos-${var.environment}-worker-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

# --- Task role: migrate (same as worker — no runtime AWS SDK calls,
# node-pg-migrate only talks to Postgres over the network) ---

resource "aws_iam_role" "migrate_task" {
  name               = "plos-${var.environment}-migrate-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}
