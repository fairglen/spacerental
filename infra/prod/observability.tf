# Logs (the awslogs overlay writes here), the CloudWatch agent's metrics
# (deploy/cloud-init.yaml), alarms to one email, daily snapshots of the data
# volume, and a monthly budget.

resource "aws_cloudwatch_log_group" "app" {
  name              = local.log_group
  retention_in_days = 30
}

resource "aws_sns_topic" "alarms" {
  name = "${local.name}-alarms"
}

resource "aws_sns_topic_subscription" "alarms_email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# The instance's hardware or hypervisor failed: EC2 recovers it (same id,
# same volumes, same EIP) and the email says so.
resource "aws_cloudwatch_metric_alarm" "instance_system_check" {
  alarm_name          = "${local.name}-status-check-system"
  alarm_description   = "StatusCheckFailed_System on the instance: recovered automatically"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  dimensions          = { InstanceId = aws_instance.app.id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"

  alarm_actions = [
    aws_sns_topic.alarms.arn,
    "arn:aws:automate:${var.region}:ec2:recover",
  ]
}

# E15: deploy/backup.sh publishes BackupSucceeded=1 at the end of every
# successful run (03:00 Lisbon). A day without that data point — the timer
# did not fire, the run failed, the host is down — breaches: missing data
# is the failure here, not noise. It fires from the apply until the first
# nightly run after the first deploy (runbook, Phase 3): expected. A run
# that fails also emails its journal (spacerental-backup-failed.service).
resource "aws_cloudwatch_metric_alarm" "backup_missing" {
  alarm_name          = "${local.name}-backup-missing"
  alarm_description   = "No successful nightly backup in the last 24 h (FlowSpace/BackupSucceeded from deploy/backup.sh)"
  namespace           = "FlowSpace"
  metric_name         = "BackupSucceeded"
  dimensions          = { Host = local.name }
  statistic           = "Maximum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

# Disk used % per mount, as the agent publishes it (CWAgent, InstanceId +
# path after `drop_device`, aggregated).
resource "aws_cloudwatch_metric_alarm" "disk" {
  for_each = {
    root  = "/"
    media = "/srv/media"
  }

  alarm_name          = "${local.name}-disk-${each.key}-above-80"
  alarm_description   = "${each.value} is more than 80 % full for 15 minutes"
  namespace           = "CWAgent"
  metric_name         = "disk_used_percent"
  dimensions          = { InstanceId = aws_instance.app.id, path = each.value }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage" {
  alarm_name          = "${local.name}-rds-free-storage-below-2gb"
  alarm_description   = "RDS has less than 2 GB free"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 1
  threshold           = 2 * 1024 * 1024 * 1024
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.name}-rds-cpu-above-80"
  alarm_description   = "RDS CPU above 80 % for 15 minutes"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

# ── Daily snapshots of every volume tagged Backup=daily, 7 kept ─────────────

data "aws_iam_policy_document" "dlm_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["dlm.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "dlm" {
  name               = "${local.name}-dlm"
  assume_role_policy = data.aws_iam_policy_document.dlm_assume.json
}

resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "daily_volume_snapshots" {
  # Letters, digits, space, _ and - only (the DLM API refuses the rest).
  description        = "${local.name} daily snapshot of Backup-daily volumes - 7 kept"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = { Backup = "daily" }

    schedule {
      name      = "daily"
      copy_tags = true

      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["04:00"]
      }

      retain_rule {
        count = 7
      }
    }
  }
}

# ── Budget: the whole account, monthly, 80 % and 100 % ─────────────────────

resource "aws_budgets_budget" "monthly" {
  name         = "spacerental-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alarm_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alarm_email]
  }
}
