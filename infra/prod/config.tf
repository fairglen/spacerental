# The production .env lives here, as one SecureString the owner writes with
# `aws ssm put-parameter … --overwrite` (runbook, Phase 2.4) and deploy.sh
# reads on every deploy. Terraform creates the parameter with a placeholder
# and never reads or writes its value again: the real file is not in the
# state, not in a plan, not in a log. Advanced tier: 8 KB, room for the
# commented template.

resource "aws_ssm_parameter" "env" {
  name        = "/spacerental/prod/env"
  description = "The production .env (docker-compose.prod.yml); written by the owner, read by deploy.sh"
  type        = "SecureString"
  tier        = "Advanced"
  value       = "REPLACE-ME: aws ssm put-parameter --name /spacerental/prod/env --type SecureString --value file://.env.production --overwrite"

  lifecycle {
    ignore_changes = [value]
  }
}

# E10: the one command deploy.yml may send to the instance. The deploy role
# (infra/bootstrap) is allowed this document and nothing else — not
# AWS-RunShellScript — so the whole surface of a deploy from GitHub is "run
# /srv/spacerental/deploy.sh with a git sha". The pattern is deploy.sh's own
# check; the timeout matches deploy.yml's execution timeout.
resource "aws_ssm_document" "deploy" {
  name            = "spacerental-deploy"
  document_type   = "Command"
  document_format = "JSON"

  content = jsonencode({
    schemaVersion = "2.2"
    description   = "FlowSpace: /srv/spacerental/deploy.sh <sha> on the production host (E10)"
    parameters = {
      sha = {
        type           = "String"
        description    = "The git sha to deploy (deploy.yml ships its files to the bucket and its images to ECR first)"
        allowedPattern = "^[0-9a-f]{7,40}$"
      }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "deploy"
      inputs = {
        timeoutSeconds = "900"
        runCommand     = ["/srv/spacerental/deploy.sh {{ sha }}"]
      }
    }]
  })

  tags = { Name = local.name }
}
