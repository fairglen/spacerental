# RDS PostgreSQL: the master password is managed by RDS in Secrets Manager
# (`rds_secret_arn` output); nothing here or in the state holds it.

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_db_instance" "main" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = "db.t4g.micro"

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
