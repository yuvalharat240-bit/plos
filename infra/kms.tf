# One customer-managed key for the whole stack (RDS, S3, Secrets Manager)
# — ADR D4's "KMS for encryption keys", sized for MVP rather than a
# per-resource key sprawl. docs/11-ops-security-runbook.md §3.2 step 5's
# break-glass separation (key *usage* vs key *administration*) is a policy
# to apply once real IAM Identity Center roles exist for this account —
# noted here rather than encoded, since there is no break-glass role to
# reference yet (see README.md's "what this does not do" section).

resource "aws_kms_key" "main" {
  description             = "plos ${var.environment} — RDS/S3/Secrets Manager encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = { Name = "plos-${var.environment}-cmk" }
}

resource "aws_kms_alias" "main" {
  name          = "alias/plos-${var.environment}"
  target_key_id = aws_kms_key.main.key_id
}
