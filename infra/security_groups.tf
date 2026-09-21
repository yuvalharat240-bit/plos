# Least-privilege network path, mirroring the same discipline
# docs/11-ops-security-runbook.md §2 applied at the DB-role level:
# internet -> ALB -> Fargate tasks -> RDS, nothing skips a hop.

resource "aws_security_group" "alb" {
  name_prefix = "plos-${var.environment}-alb-"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  dynamic "ingress" {
    for_each = var.domain_name != "" ? [443] : []
    content {
      description = "HTTPS"
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "plos-${var.environment}-alb-sg" }
}

resource "aws_security_group" "fargate" {
  name_prefix = "plos-${var.environment}-fargate-"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "From ALB only — the api task's own port"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "Outbound only — Apple JWKS, Anthropic API, RDS, S3/Secrets Manager/ECR via NAT or VPC endpoints"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "plos-${var.environment}-fargate-sg" }
}

resource "aws_security_group" "rds" {
  name_prefix = "plos-${var.environment}-rds-"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "From Fargate tasks (api, worker, one-off migrate) only — no public DB endpoint (ADR D4)"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.fargate.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "plos-${var.environment}-rds-sg" }
}
