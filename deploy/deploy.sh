#!/usr/bin/env bash
# E08: deploy one commit on the production host. deploy.yml (E05) runs it
# through SSM after pushing the images and this commit's files:
#
#   /srv/spacerental/deploy.sh <git sha>
#
# Steps: the `.env` from SSM Parameter Store (0600) with DATABASE_URL
# appended from the app role's secret (E09) → this commit's Compose files,
# Caddyfile, scripts and units from s3://$BACKUP_BUCKET/deploy/<sha>/ → ECR
# login → pull the two images tagged sha-<7> → the media directory owned by
# the backend's user → `up -d --remove-orphans` → both HEALTHCHECKs healthy
# within 120 s, else the last 200 log lines and exit 1 → prune.
#
# Configuration from /etc/spacerental/deploy.env, written by cloud-init:
# BACKUP_BUCKET, AWS_REGION, ECR_REGISTRY, DB_HOST, DB_PORT, DB_NAME,
# DB_APP_SECRET_ARN (and the rest it carries). The `.env` itself is never
# read here beyond being written.
#
#   DEPLOY_DRY_RUN=1 BACKUP_BUCKET=b AWS_REGION=eu-west-1 ECR_REGISTRY=123.dkr.ecr.eu-west-1.amazonaws.com \
#     DB_HOST=h DB_PORT=5432 DB_NAME=spacerental DB_APP_SECRET_ARN=arn:… \
#     deploy/deploy.sh 0123456789abcdef   # prints every command, runs none
set -euo pipefail

SHA=${1:?usage: deploy.sh <git sha>}
[[ "$SHA" =~ ^[0-9a-f]{7,40}$ ]] || { echo "deploy: $SHA is not a git sha" >&2; exit 2; }
SHORT=${SHA:0:7}
# On the host this script sits next to the Compose files in /srv/spacerental;
# DEPLOY_DIR points a dry run at another directory (the checkout's root).
DEPLOY_DIR=${DEPLOY_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}
DRY=${DEPLOY_DRY_RUN:-0}
CONF=${DEPLOY_CONF:-/etc/spacerental/deploy.env}
if [ -f "$CONF" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$CONF"
  set +a
fi
: "${BACKUP_BUCKET:?BACKUP_BUCKET is required (from $CONF)}"
: "${AWS_REGION:?AWS_REGION is required (from $CONF)}"
: "${ECR_REGISTRY:?ECR_REGISTRY is required (from $CONF)}"
: "${DB_HOST:?DB_HOST is required (from $CONF)}"
: "${DB_PORT:?DB_PORT is required (from $CONF)}"
: "${DB_NAME:?DB_NAME is required (from $CONF)}"
: "${DB_APP_SECRET_ARN:?DB_APP_SECRET_ARN is required (from $CONF)}"
ENV_PARAMETER=${ENV_PARAMETER:-/spacerental/prod/env}
MEDIA_HOST_DIR=${MEDIA_HOST_DIR:-/srv/media}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-120}
COMPOSE_FILES=(-f "$DEPLOY_DIR/docker-compose.prod.yml" -f "$DEPLOY_DIR/docker-compose.prod.awslogs.yml")
export BACKEND_IMAGE="$ECR_REGISTRY/spacerental/backend:sha-$SHORT"
export FRONTEND_IMAGE="$ECR_REGISTRY/spacerental/frontend:sha-$SHORT"
export MEDIA_HOST_DIR
export AWS_REGION

step() { echo "── $*"; }
# Every side effect goes through here: in a dry run the command is printed
# and nothing runs; otherwise it runs as given.
run() {
  if [ "$DRY" = 1 ]; then
    printf '+'
    printf ' %q' "$@"
    echo
  else
    "$@"
  fi
}
# A step whose shell shape (redirections, pipes) cannot be a plain argv:
# the text for the dry run, the function for the real one.
run_fn() { # "<what the dry run prints>" <function>
  if [ "$DRY" = 1 ]; then
    echo "+ $1"
  else
    "$2"
  fi
}

cd "$DEPLOY_DIR"

step "1/6 the .env for this host from SSM ($ENV_PARAMETER), DATABASE_URL from the app role's secret"
fetch_env() {
  aws ssm get-parameter --region "$AWS_REGION" --name "$ENV_PARAMETER" --with-decryption \
    --query Parameter.Value --output text > .env.new
  chmod 600 .env.new
  # E09: the app connects as its own role; the URL is composed here from the
  # secret db-bootstrap.sh filled and the endpoint cloud-init wrote, so no
  # file anywhere carries a database password by hand — and never the
  # master's, which RDS rotates.
  if grep -qE '^DATABASE_URL=' .env.new; then
    echo "deploy: the SSM .env must not carry DATABASE_URL — it is composed here from $DB_APP_SECRET_ARN (E09)" >&2
    rm -f .env.new
    return 1
  fi
  local secret user password
  secret=$(aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$DB_APP_SECRET_ARN" \
    --query SecretString --output text)
  user=$(jq -r '.username // empty' <<< "$secret")
  password=$(jq -r '.password // empty | @uri' <<< "$secret")
  if [ -z "$user" ] || [ -z "$password" ]; then
    echo "deploy: $DB_APP_SECRET_ARN has no {username, password} — run db-bootstrap.sh first (runbook 2.4)" >&2
    rm -f .env.new
    return 1
  fi
  printf 'DATABASE_URL=postgresql+asyncpg://%s:%s@%s:%s/%s?ssl=require\n' \
    "$user" "$password" "$DB_HOST" "$DB_PORT" "$DB_NAME" >> .env.new
  mv -f .env.new .env
}
run_fn "aws ssm get-parameter --region $AWS_REGION --name $ENV_PARAMETER --with-decryption --query Parameter.Value --output text > .env (0600; refused if it carries DATABASE_URL) && aws secretsmanager get-secret-value --secret-id $DB_APP_SECRET_ARN → DATABASE_URL=postgresql+asyncpg://<user>:<password %-encoded>@$DB_HOST:$DB_PORT/$DB_NAME?ssl=require >> .env" fetch_env

step "2/6 this commit's files from s3://$BACKUP_BUCKET/deploy/$SHA/"
install_release() {
  local release="releases/$SHA"
  rm -rf "$release"
  mkdir -p "$release" deploy
  aws s3 cp --recursive --only-show-errors "s3://$BACKUP_BUCKET/deploy/$SHA/" "$release/"
  # Renames, not copies: this very script may be among the files replaced,
  # and bash keeps reading the old inode.
  mv -f "$release/docker-compose.prod.yml" "$release/docker-compose.prod.awslogs.yml" .
  mv -f "$release/deploy/Caddyfile" deploy/Caddyfile
  local script
  for script in deploy.sh backup.sh restore.sh db-bootstrap.sh; do
    chmod 755 "$release/deploy/$script"
    mv -f "$release/deploy/$script" "./$script"
  done
  local unit changed=0
  for unit in spacerental-backup.service spacerental-backup.timer; do
    if ! cmp -s "$release/deploy/$unit" "/etc/systemd/system/$unit"; then
      install -m 0644 "$release/deploy/$unit" "/etc/systemd/system/$unit"
      changed=1
    fi
  done
  if [ "$changed" = 1 ]; then
    systemctl daemon-reload
    systemctl enable --now spacerental-backup.timer
  fi
  rm -rf "$release"
}
run_fn "aws s3 cp --recursive s3://$BACKUP_BUCKET/deploy/$SHA/ releases/$SHA/ && mv the Compose files, deploy/Caddyfile, *.sh and the systemd units into place" install_release

step "3/6 ECR login"
ecr_login() {
  aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"
}
run_fn "aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY" ecr_login

step "4/6 pull $BACKEND_IMAGE and $FRONTEND_IMAGE"
run docker compose "${COMPOSE_FILES[@]}" pull --quiet

step "5/6 up (the media directory owned by the backend's user first)"
run mkdir -p "$MEDIA_HOST_DIR"
run docker run --rm --user root -v "$MEDIA_HOST_DIR:/app/media" --entrypoint chown "$BACKEND_IMAGE" -R app:app /app/media
run docker compose "${COMPOSE_FILES[@]}" up -d --remove-orphans
wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) service state pending
  while :; do
    pending=""
    for service in backend frontend; do
      state=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose "${COMPOSE_FILES[@]}" ps -q "$service")" 2> /dev/null || echo missing)
      [ "$state" = healthy ] || pending="$pending $service=$state"
    done
    if [ -z "$pending" ]; then
      echo "backend and frontend healthy"
      return 0
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "deploy: not healthy after ${HEALTH_TIMEOUT}s:$pending" >&2
      docker compose "${COMPOSE_FILES[@]}" logs --no-color --tail 200 >&2
      return 1
    fi
    sleep 3
  done
}
run_fn "wait up to ${HEALTH_TIMEOUT}s for backend and frontend to report healthy, else 'docker compose logs --tail 200' and exit 1" wait_healthy

step "6/6 prune"
run docker image prune -f
write_current() { echo "$SHA" > CURRENT_SHA; }
run_fn "echo $SHA > CURRENT_SHA" write_current
echo "deployed $SHA (images sha-$SHORT)"
