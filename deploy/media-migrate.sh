#!/usr/bin/env bash
# E18: copy what the host's media directory holds into the media bucket,
# once, before the .env switches to MEDIA_STORAGE=s3 (docs/runbooks/aws.md,
# Phase 4). Run on the host through Session Manager, as root:
#
#   sudo /srv/spacerental/media-migrate.sh <media-bucket> [media-dir]
#
# Additive and idempotent: `aws s3 sync` without --delete copies what the
# bucket lacks or has an older copy of, and a second run copies nothing. The
# keys are the paths under the directory, under the application's prefix
# (MEDIA_S3_PREFIX, default media/), so every photo URL already stored in
# the database keeps working. The public photos get the content type and
# the one-year immutable cache header the application sets on its own
# uploads (app/media.py); the private PDFs get theirs and never a public
# cache. Nothing on the host is removed: the directory stays until the
# volume goes (E19), and the nightly backup keeps copying it until the
# .env switches.
#
#   MEDIA_S3_PREFIX          the application's prefix (default media/)
#   MEDIA_MIGRATE_DRY_RUN    1 = print every aws call instead of making it
#                            (scripts/tests/backup-restore.sh)
set -euo pipefail

BUCKET=${1:?usage: media-migrate.sh <media-bucket> [media-dir]}
MEDIA_DIR=${2:-${MEDIA_DIR:-/srv/media}}
PREFIX=${MEDIA_S3_PREFIX:-media/}
PREFIX=${PREFIX#/}
PREFIX=${PREFIX%/}/
DEST="s3://$BUCKET/$PREFIX"
TAG=spacerental-media-migrate

log() {
  logger -t "$TAG" -- "$*" 2> /dev/null || true
  echo "$TAG: $*"
}
trap 'log "FAILED at line $LINENO"' ERR
[ -d "$MEDIA_DIR" ] || { echo "$TAG: $MEDIA_DIR is not a directory" >&2; exit 1; }

aws() {
  if [ "${MEDIA_MIGRATE_DRY_RUN:-0}" = 1 ]; then
    printf '+ aws'
    printf ' %q' "$@"
    echo
  else
    command aws "$@"
  fi
}

log "public photos: $MEDIA_DIR → $DEST (additive; image/webp, immutable for a year)"
aws s3 sync "$MEDIA_DIR" "$DEST" --only-show-errors \
  --exclude '*' --include '*.webp' --exclude 'private/*' --exclude 'lost+found/*' \
  --content-type image/webp --cache-control 'public, max-age=31536000, immutable'

log "private PDFs: $MEDIA_DIR/private → ${DEST}private/ (additive; application/pdf, never cached)"
aws s3 sync "$MEDIA_DIR" "$DEST" --only-show-errors \
  --exclude '*' --include 'private/*.pdf' \
  --content-type application/pdf --cache-control 'private, no-store'

# Anything that is neither is not the application's and is not copied.
others=$(find "$MEDIA_DIR" -type f ! -name '*.webp' ! -path "$MEDIA_DIR/private/*.pdf" ! -path "$MEDIA_DIR/lost+found/*" | wc -l | tr -d ' ')
[ "$others" = 0 ] || log "note: $others file(s) that are not photos or invoice PDFs were left behind (find $MEDIA_DIR -type f ! -name '*.webp')"

local_count=$(find "$MEDIA_DIR" -type f \( -name '*.webp' -o -path "$MEDIA_DIR/private/*.pdf" \) ! -path "$MEDIA_DIR/lost+found/*" | wc -l | tr -d ' ')
if [ "${MEDIA_MIGRATE_DRY_RUN:-0}" = 1 ]; then
  log "dry run: $local_count file(s) would be checked against $DEST"
else
  bucket_count=$(command aws s3 ls "$DEST" --recursive | wc -l | tr -d ' ')
  log "done: $local_count file(s) here, $bucket_count object(s) under $DEST"
  [ "$bucket_count" -ge "$local_count" ] || { log "the bucket holds fewer objects than the directory has files"; exit 1; }
fi
