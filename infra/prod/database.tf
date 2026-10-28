# RDS PostgreSQL: the master password is managed by RDS in Secrets Manager
# (`rds_secret_arn` output) and rotated by RDS every 7 days; nothing here,
# in the state or on the host holds it. The application connects as its own
# role, `spacerental_app`, whose password lives in the secret below (E09):
# deploy/db-bootstrap.sh creates the role once, deploy/deploy.sh composes
# DATABASE_URL from the secret on every deploy.

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = data.aws_subnets.default.ids
}

# The shell of the app role's secret: no version here, so its value is never
# in the state or a plan. db-bootstrap.sh writes {username, password} once.
resource "aws_secretsmanager_secret" "db_app" {
  name                    = "spacerental/prod/db-app"
  description             = "The application's own database role (spacerental_app): {username, password}, written by deploy/db-bootstrap.sh, read by deploy/deploy.sh"
  recovery_window_in_days = 7
}

# TLS on every connection (the app's URL says ssl=require, the server
# refuses the rest) and a trace of slow statements for the operator.
resource "aws_db_parameter_group" "main" {
  name   = local.name
  family = "postgres${var.db_engine_version}"

  # `rds.force_ssl` is static: RDS stores it as pending-reboot whatever the
  # request said, so the provider's default (immediate) was an in-place
  # change on every plan and apply (E17). Saying pending-reboot ends that;
  # the value has been 1 since the first apply.
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
}

resource "aws_db_instance" "main" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = "db.t4g.micro"

  parameter_group_name = aws_db_parameter_group.main.name

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  db_name                     = "spacerental"
  username                    = "spacerental"
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false

  # Automated backups keep 7 days; the host's own pg_dump (E06) is the
  # off-box copy. Windows in UTC, clear of the 03:00 Lisbon dump.
  backup_retention_period = 7
  backup_window           = "00:30-01:30"
  maintenance_window      = "sun:04:00-sun:05:00"
  copy_tags_to_snapshot   = true

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-final"

  auto_minor_version_upgrade = true
  # DECISION: single AZ — cost; the final snapshot and the daily dumps are
  # the recovery path for a single location's booking system.
  multi_az = false

  tags = { Name = local.name }
}
