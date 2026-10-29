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

output "media_bucket" {
  description = "E18: MEDIA_S3_BUCKET in the production .env; deploy/media-migrate.sh's argument."
  value       = aws_s3_bucket.media.bucket
}

output "media_url" {
  description = "E18: MEDIA_BASE_URL in the production .env and NEXT_PUBLIC_MEDIA_ORIGIN (repository variable MEDIA_ORIGIN)."
  value       = local.media_url
}

output "media_distribution_domain" {
  description = "Where media_domain's CNAME points when a custom name is used."
  value       = aws_cloudfront_distribution.media.domain_name
}

output "media_certificate_validation" {
  description = "With media_domain set: the DNS record that validates the certificate (add it, the apply then continues)."
  value = local.media_custom ? [
    for option in aws_acm_certificate.media[0].domain_validation_options : {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  ] : []
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
