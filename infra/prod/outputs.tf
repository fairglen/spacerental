output "elastic_ip" {
  description = "Point app.flowspace.pt's A record here."
  value       = aws_eip.app.public_ip
}

output "instance_id" {
  value = aws_instance.app.id
}

output "rds_endpoint" {
  description = "host:port for DATABASE_URL"
  value       = aws_db_instance.main.endpoint
}

output "rds_secret_arn" {
  description = "Secrets Manager secret with the master password (aws secretsmanager get-secret-value --secret-id …)."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "backups_bucket" {
  value = aws_s3_bucket.backups.bucket
}

output "ecr_backend_url" {
  value = aws_ecr_repository.images["backend"].repository_url
}

output "ecr_frontend_url" {
  value = aws_ecr_repository.images["frontend"].repository_url
}

output "log_group" {
  value = aws_cloudwatch_log_group.app.name
}

output "ssm_session_command" {
  description = "A shell on the host, no SSH."
  value       = "aws ssm start-session --region ${var.region} --target ${aws_instance.app.id}"
}
