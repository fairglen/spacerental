variable "region" {
  type    = string
  default = "eu-west-1"
}

variable "domain" {
  description = "The public name Caddy serves; the owner points its A record at the Elastic IP output."
  type        = string
  default     = "app.flowspace.pt"
}

variable "instance_type" {
  description = "arm64 (Graviton): the images are built for linux/arm64."
  type        = string
  default     = "t4g.small"
}

variable "db_engine_version" {
  description = "PostgreSQL major. The app runs on 16+; if the region's plan rejects 18, set 17 (runbook, Phase 2.3)."
  type        = string
  default     = "18"
}

variable "alarm_email" {
  description = "Where the CloudWatch alarms and the Budget notifications go (confirm the SNS subscription email once)."
  type        = string
  default     = "geral@flowspace.pt"
}

variable "deploy_ref" {
  description = "The git ref whose deploy/ files and Compose files the host fetches at FIRST boot (cloud-init); every later deploy ships its own copies from the bucket. Changing it never recreates the instance."
  type        = string
  default     = "main"
}

variable "github_repo" {
  type    = string
  default = "fairglen/spacerental"
}

variable "monthly_budget_usd" {
  type    = number
  default = 55
}
