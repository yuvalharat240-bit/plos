variable "aws_region" {
  description = "AWS region for the staging stack."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name — this stack is staging-only per docs/09 Milestone 8 ('staging first'); production is a separate, later decision."
  type        = string
  default     = "staging"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zones" {
  description = "Two AZs — RDS Multi-AZ (ADR D4) needs at least two subnets in different AZs regardless of instance count."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "single_nat_gateway" {
  description = "MVP-sized tradeoff (ADR D4: 'not a large multi-service buildout'): one NAT Gateway instead of one per AZ. Real cost/availability tradeoff, not a silent default — if either AZ's private subnet loses its NAT path, that AZ's Fargate tasks lose internet egress (Apple JWKS, Anthropic API) until it's re-routed. Fine for staging; revisit before this stack ever serves production traffic."
  type        = bool
  default     = true
}

variable "db_instance_class" {
  description = "RDS instance class. Small on purpose (ADR D4: 'a single small RDS instance') — this is staging, not a sizing decision for real user load."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 20
}

variable "db_name" {
  type    = string
  default = "plos"
}

variable "db_master_username" {
  description = "The RDS master (superuser) username — used only for running migrations and genuine incident response, per docs/11-ops-security-runbook.md §3.2 step 4. Application traffic never connects as this user."
  type        = string
  default     = "plos_admin"
}

variable "container_image" {
  description = "Full ECR image URI:tag for the api/worker task definitions (e.g. <account>.dkr.ecr.<region>.amazonaws.com/plos-api:<sha>). Built and pushed by the deploy pipeline from apps/api/Dockerfile — see README.md. Left with no default: Terraform should fail loudly if this isn't supplied, not silently deploy a placeholder image."
  type        = string
}

variable "migrate_container_image" {
  description = "Full ECR image URI:tag for the one-off migration task, built from Dockerfile's `migrate` stage (docker build --target migrate). Distinct from container_image because the slim runtime image deliberately excludes node-pg-migrate and the migrations/ directory."
  type        = string
}

variable "api_cpu" {
  description = "Fargate task CPU units for the api service (256 = 0.25 vCPU). MVP-sized per ADR D4."
  type        = number
  default     = 256
}

variable "api_memory" {
  type    = number
  default = 512
}

variable "worker_cpu" {
  type    = number
  default = 256
}

variable "worker_memory" {
  type    = number
  default = 512
}

variable "api_desired_count" {
  description = "Number of api Fargate tasks. 1 for staging — ADR D4 explicitly does not call for a large multi-service buildout; bump this (not the task's own CPU/memory) if staging needs more headroom."
  type        = number
  default     = 1
}

variable "domain_name" {
  description = "Optional. If set, an ACM certificate is requested for this domain (DNS validation, so the zone must already exist in Route 53 — see README.md) and the ALB listens on 443. If left empty, the ALB listens on plain HTTP:80 only — acceptable for a staging skeleton with no real user data yet, but PlosAPI.baseURL and apps/ios/plos/Info.plist's NSAllowsLocalNetworking exception both explicitly call out that a real deployment should be HTTPS-only. Do not point real user traffic at the HTTP-only staging listener."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Required only if domain_name is set."
  type        = string
  default     = ""
}

variable "anthropic_api_key" {
  description = "Sensitive. Stored in Secrets Manager, never in a .tfvars file committed to version control — pass via TF_VAR_anthropic_api_key or an equivalent secret-injection mechanism at apply time."
  type        = string
  sensitive   = true
}

variable "apple_audience" {
  description = "The real Sign-in-with-Apple Service ID / bundle identifier once an Apple Developer team is configured (docs/10-progress-checklist.md's Known Blockers #2). Defaults to the existing placeholder so this stack can still be applied before that's resolved."
  type        = string
  default     = "com.plos.app.not-yet-configured"
}

variable "webauthn_rp_id" {
  description = "The passkey Relying Party ID — must match domain_name once one is set; a passkey ceremony fails cross-origin otherwise."
  type        = string
  default     = ""
}
