#!/usr/bin/env bash
# E06: restore a dump over the live database, and optionally the media.
#
#   deploy/restore.sh <dump> [media-prefix]
#
#   <dump>          a local .dump file, or a key under s3://$BACKUP_BUCKET/dumps/
#                   (2026-10-13.dump) when BACKUP_BUCKET is set
#   [media-prefix]  where the media comes back from: a local directory, or a
#                   prefix in the bucket (media/) — synced INTO MEDIA_DIR,
#                   nothing already there is deleted
#
# `pg_restore --clean --if-exists --no-owner`: every object in the dump is
# dropped and recreated, data included — the database is the dump afterwards.
# Stop the application first (`docker compose -f docker-compose.prod.yml …
# stop backend frontend`) so no request writes between the drop and the
# restore, and start it again after. The prompt names the target database;
# RESTORE_YES=1 skips it (the test). Same variables as backup.sh
# (ENV_FILE, MEDIA_DIR, BACKUP_BUCKET, BACKUP_DOCKER_NETWORK, AWS_REGION) plus
#   MEDIA_OWNER   uid:gid the restored media is given (default 999:999, the
#                 backend image's `app` user — `docker compose exec backend id`)
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ENV_FILE=${ENV_FILE:-$HERE/.env}
MEDIA_DIR=${MEDIA_DIR:-/srv/media}
MEDIA_OWNER=${MEDIA_OWNER:-999:999}
NETWORK=${BACKUP_DOCKER_NETWORK:-bridge}
PG_IMAGE=postgres:18-alpine@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5
TAG=spacerental-restore

DUMP=${1:?usage: restore.sh <dump> [media-prefix]}
MEDIA_FROM=${2:-}

log() {
  logger -t "$TAG" -- "$*" 2> /dev/null || true
  echo "$TAG: $*"
}
trap 'log "FAILED at line $LINENO"' ERR

database_url() {
  local raw
  raw=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2-)
  raw=${raw#\"}
  raw=${raw%\"}
  [ -n "$raw" ] || { echo "$TAG: DATABASE_URL not found in $ENV_FILE" >&2; exit 1; }
  raw=${raw/postgresql+asyncpg:/postgresql:}
  # asyncpg's `ssl=require` (E09) is libpq's `sslmode=require`.
  raw=${raw/\?ssl=/?sslmode=}
  echo "${raw/&ssl=/&sslmode=}"
}

URL=$(database_url)
# postgresql://user:pass@host:port/name?… → host and name, for the prompt.
rest=${URL#*://}
rest=${rest#*@}
DB_HOST=${rest%%/*}
DB_NAME=${rest#*/}
DB_NAME=${DB_NAME%%\?*}

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
if [ -f "$DUMP" ]; then
  cp "$DUMP" "$STAGE/restore.dump"
elif [ -n "${BACKUP_BUCKET:-}" ]; then
  log "fetching s3://$BACKUP_BUCKET/dumps/$DUMP"
  aws s3 cp "s3://$BACKUP_BUCKET/dumps/$DUMP" "$STAGE/restore.dump" --only-show-errors
else
  echo "$TAG: $DUMP is not a file and BACKUP_BUCKET is not set" >&2
  exit 1
fi

echo "About to restore $(basename "$DUMP") into database '$DB_NAME' on $DB_HOST."
echo "Every object in the dump is dropped and recreated; what is in the database now is lost."
if [ "${RESTORE_YES:-0}" != 1 ]; then
  read -r -p "Type the database name to continue: " answer
  [ "$answer" = "$DB_NAME" ] || { echo "$TAG: aborted"; exit 1; }
fi

log "restoring $(basename "$DUMP") into $DB_NAME on $DB_HOST"
docker run --rm --network "$NETWORK" -v "$STAGE/restore.dump:/restore.dump:ro" -e PGCONNECT_TIMEOUT=15 "$PG_IMAGE" \
  pg_restore --clean --if-exists --no-owner --exit-on-error --dbname="$URL" /restore.dump
log "database restored"

if [ -n "$MEDIA_FROM" ]; then
  if [ -d "$MEDIA_FROM" ]; then
    log "copying media from $MEDIA_FROM into $MEDIA_DIR"
    # In a container: the media directory belongs to the backend's user,
    # which whoever runs this is not.
    docker run --rm -v "$MEDIA_FROM:/from:ro" -v "$MEDIA_DIR:/media" "$PG_IMAGE" cp -a /from/. /media/
  elif [ -n "${BACKUP_BUCKET:-}" ]; then
    log "syncing media from s3://$BACKUP_BUCKET/$MEDIA_FROM into $MEDIA_DIR (additive)"
    aws s3 sync "s3://$BACKUP_BUCKET/$MEDIA_FROM" "$MEDIA_DIR" --only-show-errors
  else
    echo "$TAG: $MEDIA_FROM is not a directory and BACKUP_BUCKET is not set" >&2
    exit 1
  fi
  # Written by root here; the backend must own what it serves and replaces.
  docker run --rm -v "$MEDIA_DIR:/media" "$PG_IMAGE" chown -R "$MEDIA_OWNER" /media
  log "media restored"
fi
log "done — start the application again if it was stopped"
