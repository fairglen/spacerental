# The one instance: Ubuntu 24.04 arm64, no key pair, no port 22 — Session
# Manager through the instance profile is the only way in. cloud-init
# (deploy/cloud-init.yaml) provisions it at first boot; deploy.yml deploys
# every commit afterwards through SSM RunCommand.

data "aws_ssm_parameter" "ubuntu_arm64" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id"
}

data "aws_kms_alias" "ssm" {
  name = "alias/aws/ssm"
}

data "aws_iam_policy_document" "instance_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "instance" {
  name               = "${local.name}-instance"
  assume_role_policy = data.aws_iam_policy_document.instance_assume.json
}

resource "aws_iam_role_policy_attachment" "instance_managed" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
    "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
  ])

  role       = aws_iam_role.instance.name
  policy_arn = each.value
}

data "aws_iam_policy_document" "instance" {
  statement {
    sid       = "BackupsBucketList"
    effect    = "Allow"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.backups.arn]
  }

  # No s3:DeleteObject (E11): the host only ever adds — dumps every night,
  # media additively — and the lifecycle rules do the expiring.
  statement {
    sid       = "BackupsBucketReadWrite"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.backups.arn}/*"]
  }

  statement {
    sid       = "ReadTheEnv"
    effect    = "Allow"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${var.region}:${local.account_id}:parameter/spacerental/prod/*"]
  }

  statement {
    sid       = "DecryptTheEnv"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [data.aws_kms_alias.ssm.target_key_arn]
  }

  # The app role's secret only (E09): read on every deploy, written once by
  # db-bootstrap.sh when it has no value yet. The master secret is RDS's and
  # the host never reads it.
  statement {
    sid       = "TheAppDatabaseSecret"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:PutSecretValue", "secretsmanager:DescribeSecret"]
    resources = [aws_secretsmanager_secret.db_app.arn]
  }

  # E15: backup.sh's BackupSucceeded data point, in the one namespace the
  # alarm reads, and the failed-backup unit's email through the topic.
  statement {
    sid       = "BackupMetric"
    effect    = "Allow"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["FlowSpace"]
    }
  }

  statement {
    sid       = "BackupFailedEmail"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alarms.arn]
  }
}

resource "aws_iam_role_policy" "instance" {
  name   = "spacerental-host"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.instance.json
}

resource "aws_iam_instance_profile" "instance" {
  name = "${local.name}-instance"
  role = aws_iam_role.instance.name
}

resource "aws_instance" "app" {
  ami                         = data.aws_ssm_parameter.ubuntu_arm64.value
  instance_type               = var.instance_type
  subnet_id                   = sort(data.aws_subnets.default.ids)[0]
  vpc_security_group_ids      = [aws_security_group.web.id]
  iam_instance_profile        = aws_iam_instance_profile.instance.name
  associate_public_ip_address = true
  monitoring                  = false

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  user_data = templatefile("${path.module}/../../deploy/cloud-init.yaml", {
    deploy_ref        = var.deploy_ref
    repo              = var.github_repo
    backup_bucket     = aws_s3_bucket.backups.bucket
    aws_region        = var.region
    ecr_registry      = local.ecr_registry
    app_domain        = var.domain
    log_group         = local.log_group
    db_host           = aws_db_instance.main.address
    db_port           = aws_db_instance.main.port
    db_name           = aws_db_instance.main.db_name
    db_app_secret_arn = aws_secretsmanager_secret.db_app.arn
    alarm_topic_arn   = aws_sns_topic.alarms.arn
  })
  user_data_replace_on_change = false

  tags = { Name = local.name }

  lifecycle {
    # A newer Ubuntu AMI or a changed deploy_ref must not recreate the
    # server: the host patches itself and cloud-init runs at first boot only.
    ignore_changes = [ami, user_data]
  }
}

resource "aws_ebs_volume" "media" {
  availability_zone = aws_instance.app.availability_zone
  size              = 20
  type              = "gp3"
  encrypted         = true

  tags = {
    Name   = "${local.name}-media"
    Backup = "daily"
  }
}

resource "aws_volume_attachment" "media" {
  device_name                    = "/dev/sdf"
  volume_id                      = aws_ebs_volume.media.id
  instance_id                    = aws_instance.app.id
  stop_instance_before_detaching = true
}

resource "aws_eip" "app" {
  domain = "vpc"
  tags   = { Name = local.name }
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}
