# The production .env is one SecureString, `/spacerental/prod/env`, that
# the owner writes with `aws ssm put-parameter … --overwrite` (runbook,
# Phase 2.4) and deploy.sh reads on every deploy. It is NOT a Terraform
# resource (E17): managing it here meant every `terraform plan` had to read
# it back, and the plan role is denied `ssm:GetParameter*` on that prefix on
# purpose (E11) — so every pull-request plan of this module failed with
# AccessDeniedException from #110 on. The value was never in the state
# (ignore_changes = [value]); now nothing is. The one-time creation is the
# same put-parameter the owner runs anyway, with `--tier Advanced` (8 KB).
#
# This block takes the existing parameter out of the state without
# deleting it; it is a no-op once that has happened and can go in a later
# clean-up.
removed {
  from = aws_ssm_parameter.env

  lifecycle {
    destroy = false
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
