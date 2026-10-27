output "state_bucket" {
  description = "The S3 bucket infra/prod keeps its state in (pass as -backend-config=\"bucket=…\")."
  value       = aws_s3_bucket.state.bucket
}

output "plan_role_arn" {
  description = "Assumed by infra.yml on pull requests (read-only)."
  value       = aws_iam_role.plan.arn
}

output "apply_role_arn" {
  description = "Assumed by infra.yml's apply job in the production environment."
  value       = aws_iam_role.apply.arn
}

output "deploy_role_arn" {
  description = "Assumed by deploy.yml on main."
  value       = aws_iam_role.deploy.arn
}
