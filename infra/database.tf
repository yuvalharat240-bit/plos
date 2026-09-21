# ADR D4: "RDS for PostgreSQL (Multi-AZ) in a private subnet, no public
# database endpoint". docs/11-ops-security-runbook.md §2's plos_app/
# plos_worker role split only does anything if their DATABASE_URL secrets
# actually differ (see that doc's own "real deployment note") — this file
# generates three genuinely distinct, random passwords (master, app,
# worker) rather than the single shared credential an RDS module default
# would otherwise nudge toward.
#
# Alphanumeric only (no `special` characters): DATABASE_URL is a plain
# connection-string URL — an unescaped `@`, `/`, `:`, or `#` in the
# password would corrupt it, and pg-connection-string's own parsing
# doesn't percent-decode automatically. Simpler to avoid the character
# class than to thread URL-encoding through every place a secret is read.
resource "random_password" "rds_master" {
  length  = 32
  special = false
}

resource "random_password" "plos_app" {
  length  = 32
  special = false
}

resource "random_password" "plos_worker" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = "plos-${var.environment}-db-subnets"
  subnet_ids = aws_subnet.private[*].id
  tags       = { Name = "plos-${var.environment}-db-subnets" }
}

resource "aws_db_instance" "main" {
  identifier     = "plos-${var.environment}"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage_gb
  max_allocated_storage = var.db_allocated_storage_gb * 3 # storage autoscaling ceiling, not a second sizing knob
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.main.arn

  db_name  = var.db_name
  username = var.db_master_username
  password = random_password.rds_master.result
  port     = 5432

  multi_az               = true # ADR D4, non-negotiable even at MVP size
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false # ADR D4: "no public database endpoint"

  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:30-sun:05:30"

  # docs/11 §5: the local restore-drill script proves the *concept*; RDS's
  # own automated-snapshot mechanism is the real production one this
  # deployment should actually rely on. deletion_protection stays true —
  # a staging RDS holding real (even if test) data shouldn't be one
  # `terraform destroy` away from silently vanishing.
  deletion_protection      = true
  skip_final_snapshot      = false
  final_snapshot_identifier = "plos-${var.environment}-final-snapshot"

  performance_insights_enabled = true

  tags = { Name = "plos-${var.environment}-rds" }
}
