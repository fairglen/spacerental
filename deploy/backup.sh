#!/usr/bin/env bash
# E06: the nightly backup — a `pg_dump -Fc` of the database and a copy of the
# media directory (photos, private invoice PDFs). Runs on the host from
# deploy/spacerental-backup.timer (03:00 Europe/Lisbon) with
# /etc/spacerental/deploy.env as its environment; needs Docker (the dump is
# made by a one-off postgres:18-alpine container, the same digest as the
# Compose files, so the client matches the server) and the AWS CLI.
#
#   BACKUP_BUCKET          the backups bucket; unset = write under BACKUP_DIR
#                          instead (the local test, scripts/tests/backup-restore.sh)
#   BACKUP_DIR             local target without a bucket (default ./backups)
#   ENV_FILE               the app's .env, read for DATABASE_URL only
#                          (default: .env next to this script)
#   MEDIA_DIR              what to copy (default /srv/media)
#   BACKUP_DOCKER_NETWORK  the network the dump container joins (default
#                          bridge — reaches RDS; the local test passes its
#                          Compose project's network)
#   AWS_REGION             for the CLI
#
# Non-zero on any failure; every step is also logged with
# `logger -t spacerental-backup` for the host's journal.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ENV_FILE=${ENV_FILE:-$HERE/.env}
MEDIA_DIR=${MEDIA_DIR:-/srv/media}
BACKUP_DIR=${BACKUP_DIR:-$HERE/backups}
NETWORK=${BACKUP_DOCKER_NETWORK:-bridge}
PG_IMAGE=postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
TAG=spacerental-backup

log() {
  logger -t "$TAG" -- "$*" 2> /dev/null || true
  echo "$TAG: $*"
}
trap 'log "FAILED at line $LINENO"' ERR

# The app's URL names the asyncpg driver; libpq wants the plain scheme.
database_url() {
  local raw
  raw=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2-)
  raw=${raw#\"}
  raw=${raw%\"}
  [ -n "$raw" ] || { echo "$TAG: DATABASE_URL not found in $ENV_FILE" >&2; exit 1; }
  echo "${raw/postgresql+asyncpg:/postgresql:}"
}

URL=$(database_url)
DATE=$(date -u +%F)
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

log "dumping the database to $DATE.dump"
docker run --rm --network "$NETWORK" -v "$STAGE:/dumps" -e PGCONNECT_TIMEOUT=15 "$PG_IMAGE" \
  pg_dump --format=custom --no-owner --dbname="$URL" --file="/dumps/$DATE.dump"
[ -s "$STAGE/$DATE.dump" ] || { log "the dump is empty"; exit 1; }
# The container wrote as root; the host keeps the file readable to root only.
chmod 600 "$STAGE/$DATE.dump" 2> /dev/null || true

if [ -n "${BACKUP_BUCKET:-}" ]; then
  log "uploading $DATE.dump to s3://$BACKUP_BUCKET/dumps/"
  aws s3 cp "$STAGE/$DATE.dump" "s3://$BACKUP_BUCKET/dumps/$DATE.dump" --only-show-errors
  log "syncing $MEDIA_DIR to s3://$BACKUP_BUCKET/media/ (additive, never --delete)"
  aws s3 sync "$MEDIA_DIR" "s3://$BACKUP_BUCKET/media/" --only-show-errors
  log "done: s3://$BACKUP_BUCKET/dumps/$DATE.dump ($(du -h "$STAGE/$DATE.dump" | cut -f1))"
else
  mkdir -p "$BACKUP_DIR/dumps" "$BACKUP_DIR/media"
  cp "$STAGE/$DATE.dump" "$BACKUP_DIR/dumps/$DATE.dump"
  cp -a "$MEDIA_DIR/." "$BACKUP_DIR/media/"
  log "done (no BACKUP_BUCKET): $BACKUP_DIR/dumps/$DATE.dump ($(du -h "$BACKUP_DIR/dumps/$DATE.dump" | cut -f1)), media under $BACKUP_DIR/media/"
fi
