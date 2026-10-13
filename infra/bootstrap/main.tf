provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "spacerental"
      ManagedBy = "terraform/bootstrap"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  # Both names carry the account id so they are globally unique and
  # predictable: infra/prod reads the first as its backend, creates the
  # second, and the deploy role below is scoped to a prefix of it.
  state_bucket   = "spacerental-tfstate-${local.account_id}"
  backups_bucket = "spacerental-backups-${local.account_id}"
  oidc_host      = "token.actions.githubusercontent.com"
}

# ── Terraform state for infra/prod ──────────────────────────────────────────

resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── GitHub's OIDC provider: workflows get short-lived credentials, no secret
#    ever lives in the repository ─────────────────────────────────────────────

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://${local.oidc_host}"
  client_id_list = ["sts.amazonaws.com"]
  # GitHub's root CA thumbprints; AWS validates the chain itself since 2023
  # and keeps these for compatibility.
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

# One trust policy shape, three subjects: who may assume which role is the
# whole authorisation model, so the subject patterns are deliberately exact
# (`StringEquals`, no wildcards).
data "aws_iam_policy_document" "assume_from_github" {
  for_each = {
    plan   = ["repo:${var.github_repo}:pull_request"]
    apply  = ["repo:${var.github_repo}:environment:production"]
    deploy = ["repo:${var.github_repo}:ref:refs/heads/main", "repo:${var.github_repo}:environment:production", "repo:${var.github_repo}:environment:production-app"]
  }

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = each.value
    }
  }
}

# ── spacerental-gh-plan: `terraform plan` on pull requests ──────────────────

resource "aws_iam_role" "plan" {
  name                 = "spacerental-gh-plan"
  description          = "infra.yml on a pull request: read everything, change nothing"
  assume_role_policy   = data.aws_iam_policy_document.assume_from_github["plan"].json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "plan_readonly" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "plan_state" {
  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn]
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.state.arn}/*"]
  }
}

resource "aws_iam_role_policy" "plan_state" {
  name   = "read-terraform-state"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan_state.json
}

# ── spacerental-gh-apply: `terraform apply` behind the production
#    environment's approval ───────────────────────────────────────────────────
#
# DECISION: AdministratorAccess. infra/prod creates IAM roles, instance
# profiles and an OIDC-trusting policy set, so a narrower policy for v1 is
# not realistic; the required reviewer on the `production` environment is
# the control — nothing assumes this role without a human's click.

resource "aws_iam_role" "apply" {
  name                 = "spacerental-gh-apply"
  description          = "infra.yml apply job, environment production (owner-approved)"
  assume_role_policy   = data.aws_iam_policy_document.assume_from_github["apply"].json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "apply_admin" {
  role       = aws_iam_role.apply.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# ── spacerental-gh-deploy: push images, run deploy.sh on the instance ───────

resource "aws_iam_role" "deploy" {
  name                 = "spacerental-gh-deploy"
  description          = "deploy.yml: ECR push, SSM RunCommand on the tagged instance, the deploy/ prefix of the backups bucket"
  assume_role_policy   = data.aws_iam_policy_document.assume_from_github["deploy"].json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "EcrLogin"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid    = "EcrPush"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:DescribeImages",
      "ecr:DescribeRepositories",
      "ecr:ListImages",
    ]
    resources = [
      "arn:aws:ecr:${var.region}:${local.account_id}:repository/spacerental/backend",
      "arn:aws:ecr:${var.region}:${local.account_id}:repository/spacerental/frontend",
    ]
  }

  statement {
    sid       = "FindTheInstance"
    effect    = "Allow"
    actions   = ["ec2:DescribeInstances"]
    resources = ["*"]
  }

  statement {
    sid     = "RunDeployOnTheTaggedInstance"
    effect  = "Allow"
    actions = ["ssm:SendCommand"]
    resources = [
      "arn:aws:ec2:${var.region}:${local.account_id}:instance/*",
    ]

    condition {
      test     = "StringEquals"
      variable = "ssm:resourceTag/Name"
      values   = ["spacerental-prod"]
    }
  }

  statement {
    sid       = "RunShellScriptDocument"
    effect    = "Allow"
    actions   = ["ssm:SendCommand"]
    resources = ["arn:aws:ssm:${var.region}::document/AWS-RunShellScript"]
  }

  statement {
    sid       = "ReadCommandResult"
    effect    = "Allow"
    actions   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
    resources = ["*"]
  }

  statement {
    sid       = "UploadTheCommitsFiles"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["arn:aws:s3:::${local.backups_bucket}/deploy/*"]
  }

  statement {
    sid       = "ListTheDeployPrefix"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${local.backups_bucket}"]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["deploy/*"]
    }
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
