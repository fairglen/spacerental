#!/usr/bin/env bash
# E06: dump → drop a table and a media file → restore → both are back, against
# the stack test's throwaway Postgres. Run after `KEEP=1
# scripts/tests/prod-stack.sh` (the bootstrap and the booking are the data
# the dump must carry); the same PROD_STACK_* variables select the stack.
#
#   KEEP=1 scripts/tests/prod-stack.sh && scripts/tests/backup-restore.sh && scripts/tests/prod-stack.sh down
#
# deploy/backup.sh and deploy/restore.sh run exactly as on the host, with
# BACKUP_BUCKET unset (local copies under the scratch directory) and the
# Compose project's network for the one-off postgres containers.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PROJECT=${PROD_STACK_PROJECT:-spacerental-prod-local}
WORK=${PROD_STACK_WORK:-${TMPDIR:-/tmp}/spacerental-prod-stack-$PROJECT}
ENV_FILE="$WORK/.env"
[ -f "$ENV_FILE" ] || { echo "backup-restore: $ENV_FILE is missing — run KEEP=1 scripts/tests/prod-stack.sh first" >&2; exit 1; }

compose() {
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" \
    -f "$ROOT/docker-compose.prod.yml" -f "$ROOT/scripts/tests/prod-stack.compose.yml" "$@"
}
sql() { compose exec -T db psql -U spacerental -d spacerental -tAc "$1"; }
in_backend() { compose exec -T backend "$@"; }

fail=0
check() { # label actual expected
  if [ "$2" = "$3" ]; then
    echo "ok    $1 = $2"
  else
    echo "FAIL  $1 = '$2' (expected '$3')"
    fail=1
  fi
}

export ENV_FILE
export MEDIA_DIR="$WORK/media"
export BACKUP_DIR="$WORK/backups"
export BACKUP_DOCKER_NETWORK="${PROJECT}_default"
unset BACKUP_BUCKET

echo "── 1. what the database and the media hold before the backup"
orgs=$(sql "select count(*) from organizations")
bookings=$(sql "select count(*) from bookings")
rules=$(sql "select count(*) from availability_rules")
revision=$(sql "select version_num from alembic_version")
check "organisations (the bootstrap's)" "$orgs" 1
check "bookings (the stack test's)" "$bookings" 1
check "availability rules (3 rooms × 7 days)" "$rules" 21
in_backend sh -c 'echo "kept through a restore" > /app/media/backup-marker.txt'

echo "── 2. deploy/backup.sh without BACKUP_BUCKET: a dump and a media copy under $BACKUP_DIR; the E15 metric call (dry) and the no-.env exit"
# Before the first deploy the timer still fires: no .env, exit 0, no metric.
nothing_yet=$(ENV_FILE="$WORK/no-such-env" "$ROOT/deploy/backup.sh")
check "without an .env backup.sh exits 0 and says nothing is deployed" "$(grep -c 'nothing deployed yet' <<< "$nothing_yet")" 1
check "…and publishes no metric" "$(grep -c 'put-metric-data' <<< "$nothing_yet")" 0
rm -rf "$BACKUP_DIR"
backup_out=$(BACKUP_DRY_RUN=1 "$ROOT/deploy/backup.sh")
check "a successful run ends with the BackupSucceeded data point (printed: BACKUP_DRY_RUN=1)" \
  "$(grep -c '^+ aws cloudwatch put-metric-data .* --namespace FlowSpace --metric-name BackupSucceeded --value 1 --dimensions Host=spacerental-prod' <<< "$backup_out")" 1
DUMP="$BACKUP_DIR/dumps/$(date -u +%F).dump"
check "the dump exists and is not empty" "$([ -s "$DUMP" ] && echo yes || echo no)" yes
check "the dump is pg_dump's custom format" "$(head -c 5 "$DUMP")" "PGDMP"
check "the media copy carries the marker" "$(cat "$BACKUP_DIR/media/backup-marker.txt")" "kept through a restore"

echo "── 3. lose a table and the media file"
sql "drop table bookings cascade" > /dev/null
in_backend rm /app/media/backup-marker.txt
check "bookings is gone" "$(sql "select to_regclass('public.bookings') is null")" t
check "the marker is gone" "$(in_backend sh -c 'test -e /app/media/backup-marker.txt && echo present || echo absent')" absent

echo "── 4. deploy/restore.sh <dump> <media-prefix> (RESTORE_YES=1 stands in for the prompt)"
RESTORE_YES=1 "$ROOT/deploy/restore.sh" "$DUMP" "$BACKUP_DIR/media"

echo "── 5. everything is back"
check "organisations" "$(sql "select count(*) from organizations")" "$orgs"
check "bookings" "$(sql "select count(*) from bookings")" "$bookings"
check "availability rules" "$(sql "select count(*) from availability_rules")" "$rules"
check "alembic revision" "$(sql "select version_num from alembic_version")" "$revision"
check "the overlap guard (bookings_no_overlap) survived the round trip" \
  "$(sql "select count(*) from pg_constraint where conname = 'bookings_no_overlap'")" 1
check "the marker is back" "$(in_backend cat /app/media/backup-marker.txt)" "kept through a restore"
check "the backend still owns the restored media" "$(in_backend sh -c 'stat -c %U /app/media/backup-marker.txt')" app
check "the API still answers after the restore" \
  "$(compose exec -T backend python -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=5).status)')" 200

if [ "$fail" -ne 0 ]; then
  echo "backup-restore: FAILED" >&2
  exit 1
fi
echo "backup-restore: all checks passed"
