resource "aws_ecs_cluster" "main" {
  name = "plos-${var.environment}"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/plos-${var.environment}/api"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/plos-${var.environment}/worker"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/ecs/plos-${var.environment}/migrate"
  retention_in_days = 30
}

# Config that isn't a secret — every other process.env.* reference in
# apps/api/src, checked directly (see infra/secrets.tf's header comment
# for the same check on the sensitive half). Shared between api and
# worker since both processes read the same rate-limit/model/webauthn
# config today; split this if that ever stops being true.
locals {
  common_environment = [
    { name = "APPLE_AUDIENCE", value = var.apple_audience },
    { name = "WEBAUTHN_RP_ID", value = var.webauthn_rp_id },
    { name = "WEBAUTHN_ORIGIN", value = var.domain_name != "" ? "https://${var.domain_name}" : "" },
    { name = "PLOS_OBJECT_STORE_DRIVER", value = "s3" },
  ]
}

resource "aws_ecs_task_definition" "api" {
  family                   = "plos-${var.environment}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.api_cpu)
  memory                   = tostring(var.api_memory)
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = var.container_image
      essential = true
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]
      environment = concat(local.common_environment, [
        { name = "PORT", value = "3000" },
      ])
      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url_app.arn },
        { name = "ANTHROPIC_API_KEY", valueFrom = aws_secretsmanager_secret.anthropic_api_key.arn },
        { name = "JWT_ACCESS_SECRET", valueFrom = aws_secretsmanager_secret.jwt_access_secret.arn },
        { name = "AGENT_CONFIRMATION_SECRET", valueFrom = aws_secretsmanager_secret.agent_confirmation_secret.arn },
        { name = "EXPORT_DOWNLOAD_SECRET", valueFrom = aws_secretsmanager_secret.export_download_secret.arn },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "api" {
  name            = "plos-${var.environment}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.fargate.id]
    # No public IP: this task is only ever reached via the ALB, in a
    # private subnet, matching ADR D4's "application tier in private
    # subnets" — the NAT Gateway (network.tf) is what gives it outbound
    # internet for Apple JWKS / Anthropic, not a public IP of its own.
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.http]
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "plos-${var.environment}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.worker_cpu)
  memory                   = tostring(var.worker_memory)
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.worker_task.arn

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = var.container_image
      command     = ["node", "dist/worker-main.js"]
      essential   = true
      environment = local.common_environment
      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url_worker.arn },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])
}

# No aws_ecs_service for worker: docs/09 Milestone 4 already documents
# this as "a scheduled job, nightly is enough... no separate Fargate task
# exists until Milestone 8" — Milestone 8 is this file, and the correct
# shape per that plan is a scheduled EventBridge rule invoking RunTask,
# not a long-running service restarting a process meant to exit after one
# pass. See aws_scheduler_schedule.worker_nightly below.

resource "aws_ecs_task_definition" "migrate" {
  family                   = "plos-${var.environment}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.migrate_task.arn

  container_definitions = jsonencode([
    {
      name      = "migrate"
      image     = var.migrate_container_image
      essential = true
      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url_master.arn },
        { name = "PLOS_APP_ROLE_PASSWORD", valueFrom = aws_secretsmanager_secret.plos_app_role_password.arn },
        { name = "PLOS_WORKER_ROLE_PASSWORD", valueFrom = aws_secretsmanager_secret.plos_worker_role_password.arn },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.migrate.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "migrate"
        }
      }
    }
  ])
}

# --- Worker: scheduled, not a standing service (see comment above) ---

resource "aws_iam_role" "scheduler_invoke_ecs" {
  name = "plos-${var.environment}-scheduler-invoke-ecs"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "scheduler_invoke_ecs" {
  name = "run-worker-task"
  role = aws_iam_role.scheduler_invoke_ecs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "ecs:RunTask"
        Resource = aws_ecs_task_definition.worker.arn
      },
      {
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = [aws_iam_role.ecs_execution.arn, aws_iam_role.worker_task.arn]
      }
    ]
  })
}

resource "aws_scheduler_schedule" "worker_nightly" {
  name       = "plos-${var.environment}-worker-nightly"
  group_name = "default"

  # docs/09 Milestone 4: "a scheduled job, nightly is enough" — the exact
  # cadence this plan already committed to, not a new sizing decision.
  schedule_expression = "cron(0 9 * * ? *)" # 09:00 UTC nightly

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_ecs_cluster.main.arn
    role_arn = aws_iam_role.scheduler_invoke_ecs.arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.worker.arn
      launch_type         = "FARGATE"
      network_configuration {
        subnets          = aws_subnet.private[*].id
        security_groups  = [aws_security_group.fargate.id]
        assign_public_ip = false
      }
    }
  }
}
