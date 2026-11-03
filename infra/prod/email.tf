# E20: the application's email goes through Amazon SES with the instance
# role's credentials — no provider account, no API key in the .env
# (EMAIL_MODE=ses, app/email.py). Terraform verifies the sending domain
# (Easy DKIM) and sets a custom MAIL FROM subdomain so SPF aligns with the
# From header under DMARC; the owner adds the DNS records the
# `email_dns_records` output lists and, once, asks AWS to take the account
# out of the SES sandbox (runbook, Phase 4.1) — a sandbox account can only
# mail verified addresses.

resource "aws_sesv2_email_identity" "domain" {
  email_identity = var.email_domain

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  email_identity   = aws_sesv2_email_identity.domain.email_identity
  mail_from_domain = "mail.${var.email_domain}"
  # If the MX record is missing, SES still sends with its own MAIL FROM
  # (SPF then does not align, DMARC still passes on DKIM).
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

locals {
  email_dns_records = concat(
    [
      for token in aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens : {
        name  = "${token}._domainkey.${var.email_domain}"
        type  = "CNAME"
        value = "${token}.dkim.amazonses.com"
      }
    ],
    [
      {
        name  = "mail.${var.email_domain}"
        type  = "MX"
        value = "10 feedback-smtp.${var.region}.amazonses.com"
      },
      {
        name  = "mail.${var.email_domain}"
        type  = "TXT"
        value = "v=spf1 include:amazonses.com ~all"
      },
      {
        name  = "_dmarc.${var.email_domain}"
        type  = "TXT"
        value = "v=DMARC1; p=none; rua=mailto:${var.alarm_email}"
      },
    ]
  )
}
