provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "spacerental"
      Environment = "prod"
      ManagedBy   = "terraform/prod"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id   = data.aws_caller_identity.current.account_id
  name         = "spacerental-prod"
  ecr_registry = "${local.account_id}.dkr.ecr.${var.region}.amazonaws.com"
  log_group    = "/spacerental/prod"
}
