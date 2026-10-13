# The backups bucket: dumps/ (30 days), media/ (synced additively, kept),
# deploy/<sha>/ (what deploy.yml ships and deploy.sh installs).

resource "aws_s3_bucket" "backups" {
  bucket = "spacerental-backups-${local.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# E11: dumps and media are the production data; the bucket says who may read
# or delete them — the host (its instance role), the owner's Identity Center
# administrator role, and the account root user, unconditionally, so a
# mistyped role pattern can never lock the owner out. Everything else,
# including a plan role carrying ReadOnlyAccess, is denied at the object
# level only: bucket configuration (lifecycle, this policy) stays the apply
# role's to manage, and deploy/<sha>/ stays readable to whoever may list it.
# The document lives in policies/ so tests/infra/policies.test.sh can assert
# on it without AWS.
resource "aws_s3_bucket_policy" "backups" {
  bucket = aws_s3_bucket.backups.id
  policy = templatefile("${path.module}/policies/backups-bucket.json.tftpl", {
    account_id        = local.account_id
    bucket_arn        = aws_s3_bucket.backups.arn
    instance_role_arn = aws_iam_role.instance.arn
  })

  depends_on = [aws_s3_bucket_public_access_block.backups]
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "dumps-expire-after-30-days"
    status = "Enabled"

    filter {
      prefix = "dumps/"
    }

    expiration {
      days = 30
    }
  }

  rule {
    id     = "noncurrent-versions-90-days-and-abandoned-uploads"
    status = "Enabled"

    filter {
      prefix = ""
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}
