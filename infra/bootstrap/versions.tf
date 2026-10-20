# infra/bootstrap (E04): applied ONCE from the owner's laptop, with local
# state (docs/runbooks/aws.md, Phase 2.1) — it creates what every later
# `terraform` run from GitHub needs: the state bucket, the OIDC provider and
# the three CI roles. Keep infra/bootstrap/terraform.tfstate (gitignored).
terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
