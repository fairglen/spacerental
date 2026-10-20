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
