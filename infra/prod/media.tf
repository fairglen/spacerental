# E18: the photos and the private invoice PDFs live in this bucket, not on
# the host — MEDIA_STORAGE=s3 in the production .env, app/media.py's
# S3MediaStorage. The browser reads the public ones through CloudFront
# (origin access control: the bucket stays private, the distribution signs
# its reads), with the origin path set to the prefix so a key is the same
# string in the URL, in the bucket and in the database. The private ones
# (media/private/…, I05) are denied to CloudFront and to everyone but the
# host and the owner by the bucket policy; the API streams them itself.
#
# `media_domain` empty (the default) serves from the distribution's own
# *.cloudfront.net name: no certificate, no DNS, one apply. With a name
# (media.flowspace.pt) the certificate is requested in us-east-1 — the only
# region CloudFront reads from — validated by a DNS record the owner adds
# (output `media_certificate_validation`), and the apply waits for it.

locals {
  media_prefix = "media"
  media_custom = var.media_domain != ""
  media_url    = local.media_custom ? "https://${var.media_domain}" : "https://${aws_cloudfront_distribution.media.domain_name}"
}

resource "aws_s3_bucket" "media" {
  bucket = "spacerental-media-${local.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# A deleted or replaced photo keeps its previous version for 30 days: the
# application's delete is a delete marker, and the nightly bucket-to-bucket
# copy (deploy/backup.sh) is the longer-lived copy.
resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "noncurrent-versions-30-days-and-abandoned-uploads"
    status = "Enabled"

    filter {
      prefix = ""
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# The cache key is the path alone — no query string, no cookies, no headers
# — and the objects' own Cache-Control (one year, immutable, app/media.py)
# sets the TTL between the bounds below. Our own policy rather than the
# AWS-managed "CachingOptimized" one: the first apply failed with
# NoSuchCachePolicy on its well-known id in this account (E18), and a
# resource of ours has no such dependency.
resource "aws_cloudfront_cache_policy" "media" {
  name        = "${local.name}-media"
  comment     = "Path-only key; TTL from the objects' Cache-Control"
  min_ttl     = 0
  default_ttl = 86400
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_gzip   = false
    enable_accept_encoding_brotli = false
  }
}

resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "${local.name}-media"
  description                       = "CloudFront signs its reads of the media bucket; the bucket stays private"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "media" {
  enabled         = true
  comment         = "${local.name} media: the public photos (WebP, immutable keys); private/ is denied at the bucket"
  http_version    = "http2and3"
  is_ipv6_enabled = true
  # Europe and North America: where the one location's visitors are.
  price_class = "PriceClass_100"
  aliases     = local.media_custom ? [var.media_domain] : []

  origin {
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_id                = "media"
    origin_path              = "/${local.media_prefix}"
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  default_cache_behavior {
    target_origin_id       = "media"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    viewer_protocol_policy = "redirect-to-https"
    # WebP is already compressed; gzip would only cost CPU.
    compress        = false
    cache_policy_id = aws_cloudfront_cache_policy.media.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = !local.media_custom
    acm_certificate_arn            = local.media_custom ? aws_acm_certificate_validation.media[0].certificate_arn : null
    ssl_support_method             = local.media_custom ? "sni-only" : null
    minimum_protocol_version       = local.media_custom ? "TLSv1.2_2021" : "TLSv1"
  }

  tags = { Name = "${local.name}-media" }
}

# E11 again, for this bucket: CloudFront (this distribution only) may read
# the public prefix; the private prefix is readable to the host, the owner's
# Identity Center role and the account root only — not to CloudFront, not
# to a plan role carrying ReadOnlyAccess. Bucket configuration stays the
# apply role's. tests/infra/policies.test.sh asserts the document.
resource "aws_s3_bucket_policy" "media" {
  bucket = aws_s3_bucket.media.id
  policy = templatefile("${path.module}/policies/media-bucket.json.tftpl", {
    account_id        = local.account_id
    bucket_arn        = aws_s3_bucket.media.arn
    prefix            = local.media_prefix
    distribution_arn  = aws_cloudfront_distribution.media.arn
    instance_role_arn = aws_iam_role.instance.arn
  })

  depends_on = [aws_s3_bucket_public_access_block.media]
}

resource "aws_acm_certificate" "media" {
  count    = local.media_custom ? 1 : 0
  provider = aws.us_east_1

  domain_name       = var.media_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Waits for the owner's DNS record (output `media_certificate_validation`):
# the distribution cannot be created with an alias before the certificate
# is issued, so the first apply with `media_domain` set pauses here.
resource "aws_acm_certificate_validation" "media" {
  count    = local.media_custom ? 1 : 0
  provider = aws.us_east_1

  certificate_arn = aws_acm_certificate.media[0].arn

  timeouts {
    create = "60m"
  }
}
