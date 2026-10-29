#!/usr/bin/env bash
# E11 (and E18, the media bucket): the bucket policies, asserted without AWS. `terraform validate`
# accepts any string as a policy, and a plan needs credentials, so the
# document infra/prod/policies/backups-bucket.json.tftpl is rendered here
# with stand-in values and read as JSON: one Deny, the three object actions,
# the dumps/ and media/ prefixes only, the account root excluded
# unconditionally (NotPrincipal), the instance role and the owner's Identity
# Center role excluded by ArnNotLike on aws:PrincipalArn, and the template's
# placeholders exactly the names storage.tf passes. Limitation: this proves
# the document, not AWS's evaluation of it — the owner's first `terraform
# plan` and a `aws s3 cp` as the plan role would be that proof.
#
#   tests/infra/policies.test.sh
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
TEMPLATE="$ROOT/infra/prod/policies/backups-bucket.json.tftpl"
STORAGE="$ROOT/infra/prod/storage.tf"
MEDIA_TEMPLATE="$ROOT/infra/prod/policies/media-bucket.json.tftpl"
MEDIA_TF="$ROOT/infra/prod/media.tf"

python3 - "$TEMPLATE" "$STORAGE" "$MEDIA_TEMPLATE" "$MEDIA_TF" <<'PY'
import json
import re
import sys

template_path, storage_path = sys.argv[1:3]
template = open(template_path).read()
values = {
    "account_id": "123456789012",
    "bucket_arn": "arn:aws:s3:::spacerental-backups-123456789012",
    "instance_role_arn": "arn:aws:iam::123456789012:role/spacerental-prod-instance",
}

failures = []


def check(label, actual, expected):
    if actual == expected:
        print(f"ok    {label}")
    else:
        print(f"FAIL  {label} = {actual!r} (expected {expected!r})")
        failures.append(label)


# The placeholders are exactly what storage.tf hands to templatefile().
placeholders = set(re.findall(r"\$\{(\w+)\}", template))
storage = open(storage_path).read()
block = re.search(r'templatefile\("\$\{path\.module\}/policies/backups-bucket\.json\.tftpl",\s*\{(.*?)\}\)', storage, re.S)
passed = set(re.findall(r"^\s*(\w+)\s*=", block.group(1), re.M)) if block else set()
check("template placeholders == the values storage.tf passes", sorted(placeholders), sorted(passed))
check("the stand-in values cover every placeholder", sorted(placeholders - set(values)), [])

rendered = template
for key, value in values.items():
    rendered = rendered.replace("${" + key + "}", value)
doc = json.loads(rendered)
check("policy version", doc.get("Version"), "2012-10-17")
statements = doc.get("Statement", [])
check("exactly one statement", len(statements), 1)
s = statements[0] if statements else {}
check("the statement denies", s.get("Effect"), "Deny")
check("no Allow anywhere", any(x.get("Effect") == "Allow" for x in statements), False)
check("Principal is not used (NotPrincipal carries the root exception)", "Principal" in s, False)
check("the account root is excluded unconditionally", s.get("NotPrincipal"), {"AWS": "arn:aws:iam::123456789012:root"})
check("the three object actions, nothing else", sorted(s.get("Action", [])), ["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:GetObject"])
check(
    "dumps/ and media/ only (deploy/<sha>/ stays readable)",
    sorted(s.get("Resource", [])),
    ["arn:aws:s3:::spacerental-backups-123456789012/dumps/*", "arn:aws:s3:::spacerental-backups-123456789012/media/*"],
)
condition = s.get("Condition", {})
check("one condition operator: ArnNotLike", list(condition), ["ArnNotLike"])
arns = condition.get("ArnNotLike", {}).get("aws:PrincipalArn", [])
check("the instance role is excluded by its role ARN (what aws:PrincipalArn is for a session)", arns[:1], [values["instance_role_arn"]])
sso = arns[1] if len(arns) > 1 else ""
check("the owner's Identity Center administrator role is excluded by pattern", sso, "arn:aws:iam::123456789012:role/aws-reserved/sso.amazonaws.com/*AdministratorAccess*")
check("nothing else is excluded", len(arns), 2)

# ── E18: the media bucket — CloudFront reads the public prefix (this
# distribution only), the private prefix is for the host and the owner.
media_template = open(sys.argv[3]).read()
media_tf = open(sys.argv[4]).read()
media_values = {
    "account_id": "123456789012",
    "bucket_arn": "arn:aws:s3:::spacerental-media-123456789012",
    "prefix": "media",
    "distribution_arn": "arn:aws:cloudfront::123456789012:distribution/E2EXAMPLE",
    "instance_role_arn": "arn:aws:iam::123456789012:role/spacerental-prod-instance",
}
placeholders = set(re.findall(r"\$\{(\w+)\}", media_template))
block = re.search(r'templatefile\("\$\{path\.module\}/policies/media-bucket\.json\.tftpl",\s*\{(.*?)\}\)', media_tf, re.S)
passed = set(re.findall(r"^\s*(\w+)\s*=", block.group(1), re.M)) if block else set()
check("media: template placeholders == the values media.tf passes", sorted(placeholders), sorted(passed))
check("media: the stand-in values cover every placeholder", sorted(placeholders - set(media_values)), [])
rendered = media_template
for key, value in media_values.items():
    rendered = rendered.replace("${" + key + "}", value)
doc = json.loads(rendered)
statements = doc.get("Statement", [])
check("media: exactly two statements", len(statements), 2)
allow = next((x for x in statements if x.get("Effect") == "Allow"), {})
deny = next((x for x in statements if x.get("Effect") == "Deny"), {})
check("media: the allow is for the CloudFront service principal", allow.get("Principal"), {"Service": "cloudfront.amazonaws.com"})
check("media: ...reading only", allow.get("Action"), "s3:GetObject")
check("media: ...the public prefix only", allow.get("Resource"), "arn:aws:s3:::spacerental-media-123456789012/media/*")
check("media: ...from this distribution only", allow.get("Condition"), {"StringEquals": {"AWS:SourceArn": media_values["distribution_arn"]}})
check("media: the deny covers the private prefix", deny.get("Resource"), "arn:aws:s3:::spacerental-media-123456789012/media/private/*")
check("media: ...for reads, current and previous versions", sorted(deny.get("Action", [])), ["s3:GetObject", "s3:GetObjectVersion"])
check("media: ...the account root excluded unconditionally", deny.get("NotPrincipal"), {"AWS": "arn:aws:iam::123456789012:root"})
arns = deny.get("Condition", {}).get("ArnNotLike", {}).get("aws:PrincipalArn", [])
check("media: ...the host and the owner's Identity Center role excluded, nobody else (so not CloudFront)", arns, [media_values["instance_role_arn"], "arn:aws:iam::123456789012:role/aws-reserved/sso.amazonaws.com/*AdministratorAccess*"])
# The prefix the policy guards is the one the distribution reads from and
# the application writes to (MEDIA_S3_PREFIX's default in app/config.py).
check("media: media.tf's origin path is the policy's prefix", re.search(r'origin_path\s*=\s*"/\$\{local\.media_prefix\}"', media_tf) is not None, True)
check("media: the prefix is the application's default", re.search(r'media_prefix\s*=\s*"media"', media_tf) is not None, True)

if failures:
    print(f"policies: FAILED ({len(failures)})")
    sys.exit(1)
print("policies: all checks passed")
PY
