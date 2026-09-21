output "alb_dns_name" {
  description = "Point PlosAPI.baseURL (apps/ios) or a manual smoke-test curl at this (or at domain_name, once DNS propagates)."
  value       = aws_lb.main.dns_name
}

output "ecr_repository_url" {
  description = "Push both the runtime image and the `migrate`-stage image here, under distinct tags — see README.md's deploy sequence."
  value       = aws_ecr_repository.api.repository_url
}

output "rds_endpoint" {
  value = aws_db_instance.main.address
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "migrate_task_definition_arn" {
  description = "Run this once per deploy with new migrations, via `aws ecs run-task` — see README.md. Never a standing service."
  value       = aws_ecs_task_definition.migrate.arn
}

output "s3_export_bundle_bucket" {
  value = aws_s3_bucket.export_bundles.bucket
}

output "private_subnet_ids" {
  description = "Needed as `--network-configuration` when running the one-off migrate task manually."
  value       = aws_subnet.private[*].id
}

output "fargate_security_group_id" {
  value = aws_security_group.fargate.id
}
