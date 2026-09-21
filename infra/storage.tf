# apps/api/src/privacy/export-bundle-storage.service.ts's S3 backend
# (PLOS_OBJECT_STORE_DRIVER=s3) needs exactly two properties from this
# bucket to behave correctly: versioning enabled (so `put` gets a real
# VersionId back and `deleteAllVersions` has multiple versions to find),
# and SSE-KMS (ADR D4: "S3 for object storage" alongside "KMS for
# encryption keys" — not treated as two independent, optional choices).

resource "aws_s3_bucket" "export_bundles" {
  bucket = "plos-${var.environment}-export-bundles"
  tags   = { Name = "plos-${var.environment}-export-bundles" }
}

resource "aws_s3_bucket_versioning" "export_bundles" {
  bucket = aws_s3_bucket.export_bundles.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "export_bundles" {
  bucket = aws_s3_bucket.export_bundles.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.main.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "export_bundles" {
  bucket                  = aws_s3_bucket.export_bundles.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ECR — one repo, two tags in practice (api build, migrate build); a
# second repo would only add ops overhead for an MVP-sized stack (ADR D4).
resource "aws_ecr_repository" "api" {
  name                 = "plos-${var.environment}-api"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 20 images — this is staging, not an audit trail."
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}
