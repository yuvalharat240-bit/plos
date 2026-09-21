# Milestone 8 (docs/09-phase1-implementation-plan.md) — the AWS staging
# skeleton ADR D4 commits to. Written and reviewable now; nothing here has
# ever been applied, because no AWS account exists in this environment
# (same category of gap as docs/11-ops-security-runbook.md §1, which
# explicitly deferred writing Terraform at all until now — the project's
# own stance is on record that this can't be verified by `terraform plan`
# until a real account is connected).

terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # No backend block on purpose: the first `terraform init` should pick
  # one deliberately (S3 + DynamoDB lock table, or Terraform Cloud) rather
  # than silently defaulting to local state for infrastructure that holds
  # a health/mental-health product's staging secrets. See README.md.
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "plos"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
