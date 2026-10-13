# infra/prod (E04): everything app.flowspace.pt runs on — planned on pull
# requests and applied from main behind the production environment's
# approval (infra.yml, E05). State in the bucket infra/bootstrap created;
# its name carries the account id, which a backend block cannot read, so
# it is passed at init:
#
#   terraform init -backend-config="bucket=spacerental-tfstate-<account-id>"
terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    key          = "prod/terraform.tfstate"
    region       = "eu-west-1"
    use_lockfile = true
  }
}
