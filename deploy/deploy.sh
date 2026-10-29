#!/usr/bin/env bash
# E08: deploy one commit on the production host. deploy.yml (E05) runs it
# through the spacerental-deploy SSM document (E10) after pushing the images
# and this commit's files:
#
#   /srv/spacerental/deploy.sh <git sha>
#
# Steps: the `.env` from SSM Parameter Store (0600) with DATABASE_URL
# appended from the app role's secret (E09) → this commit's Compose files,
# Caddyfile, scripts and units from s3://$BACKUP_BUCKET/deploy/<sha>/ → ECR
# login → pull the two images tagged sha-<7> → the media directory owned by
# the backend's user → `up -d --remove-orphans` → both HEALTHCHECKs healthy
# within 120 s; if not, and a previous deploy is recorded in CURRENT_SHA,
# its images come back up, health is awaited again, `rolled back to <sha>`
# is printed and the exit code stays 1 (E14: the workflow red, the site
# up) → CURRENT_SHA/PREVIOUS_SHA recorded → prune.
#
# Configuration from /etc/spacerental/deploy.env, written by cloud-init:
# BACKUP_BUCKET, AWS_REGION, ECR_REGISTRY, DB_HOST, DB_PORT, DB_NAME,
# DB_APP_SECRET_ARN (and the rest it carries). The `.env` itself is never
# read here beyond being written.
#
#   DEPLOY_DRY_RUN=1 BACKUP_BUCKET=b AWS_REGION=eu-west-1 ECR_REGISTRY=123.dkr.ecr.eu-west-1.amazonaws.com \
#     DB_HOST=h DB_PORT=5432 DB_NAME=spacerental DB_APP_SECRET_ARN=arn:… \
#     deploy/deploy.sh 0123456789abcdef   # prints every command, runs none
#
# DEPLOY_LOCAL=1 is the stack test's mode (scripts/tests/prod-stack.sh): no
# SSM, S3, ECR or pull — the env from DEPLOY_LOCAL_ENV, the images already
# present under ECR_REGISTRY/spacerental/*, the Compose files and project
# from DEPLOY_COMPOSE_FILES (space-separated) and DEPLOY_COMPOSE_PROJECT.
# The health wait and the rollback run exactly as on the host.
set -euo pipefail

SHA=${1:?usage: deploy.sh <git sha>}
[[ "$SHA" =~ ^[0-9a-f]{7,40}$ ]] || { echo "deploy: $SHA is not a git sha" >&2; exit 2; }
SHORT=${SHA:0:7}
# On the host this script sits next to the Compose files in /srv/spacerental;
# DEPLOY_DIR points a dry run at another directory (the checkout's root).
DEPLOY_DIR=${DEPLOY_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}
DRY=${DEPLOY_DRY_RUN:-0}
LOCAL=${DEPLOY_LOCAL:-0}
CONF=${DEPLOY_CONF:-/etc/spacerental/deploy.env}
if [ -f "$CONF" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$CONF"
  set +a
fi
: "${ECR_REGISTRY:?ECR_REGISTRY is required (from $CONF)}"
if [ "$LOCAL" = 1 ]; then
  : "${DEPLOY_LOCAL_ENV:?DEPLOY_LOCAL_ENV is the .env to install (DEPLOY_LOCAL=1)}"
  AWS_REGION=${AWS_REGION:-}
else
  : "${BACKUP_BUCKET:?BACKUP_BUCKET is required (from $CONF)}"
  : "${AWS_REGION:?AWS_REGION is required (from $CONF)}"
  : "${DB_HOST:?DB_HOST is required (from $CONF)}"
  : "${DB_PORT:?DB_PORT is required (from $CONF)}"
  : "${DB_NAME:?DB_NAME is required (from $CONF)}"
  : "${DB_APP_SECRET_ARN:?DB_APP_SECRET_ARN is required (from $CONF)}"
fi
ENV_PARAMETER=${ENV_PARAMETER:-/spacerental/prod/env}
MEDIA_HOST_DIR=${MEDIA_HOST_DIR:-/srv/media}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-120}
if [ -n "${DEPLOY_COMPOSE_FILES:-}" ]; then
  COMPOSE_FILES=()
  read -ra files <<< "$DEPLOY_COMPOSE_FILES"
  for f in "${files[@]}"; do COMPOSE_FILES+=(-f "$f"); done
else
  COMPOSE_FILES=(-f "$DEPLOY_DIR/docker-compose.prod.yml" -f "$DEPLOY_DIR/docker-compose.prod.awslogs.yml")
fi
# The .env written in step 1, named explicitly: Compose otherwise reads the
# one next to the first Compose file, which is this directory on the host
# but the checkout's root in the stack test.
COMPOSE=(docker compose --env-file "$DEPLOY_DIR/.env")
[ -z "${DEPLOY_COMPOSE_PROJECT:-}" ] || COMPOSE+=(-p "$DEPLOY_COMPOSE_PROJECT")
COMPOSE+=("${COMPOSE_FILES[@]}")
# The images for one commit; the rollback re-points them at the previous one.
images_for() { # sha
  export BACKEND_IMAGE="$ECR_REGISTRY/spacerental/backend:sha-${1:0:7}"
  export FRONTEND_IMAGE="$ECR_REGISTRY/spacerental/frontend:sha-${1:0:7}"
}
images_for "$SHA"
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
# The commit serving right now, if any: what a failed deploy rolls back to.
CURRENT=$(cat CURRENT_SHA 2> /dev/null || true)

if [ "$LOCAL" = 1 ]; then
  step "1/6 the .env from $DEPLOY_LOCAL_ENV (DEPLOY_LOCAL: no SSM)"
  install_local_env() {
    # The stack test's scratch .env may already be this directory's .env.
    if ! [ "$DEPLOY_LOCAL_ENV" -ef .env ]; then
      install -m 0600 "$DEPLOY_LOCAL_ENV" .env
    fi
  }
  run_fn "install -m 0600 $DEPLOY_LOCAL_ENV .env" install_local_env
else
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
fi

if [ "$LOCAL" = 1 ]; then
  step "2/6 this commit's files: the checkout's own (DEPLOY_LOCAL: no S3)"
else
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
    for script in deploy.sh backup.sh restore.sh db-bootstrap.sh media-migrate.sh; do
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
fi

if [ "$LOCAL" = 1 ]; then
  step "3/6 ECR login — skipped (DEPLOY_LOCAL)"
  step "4/6 pull — skipped (DEPLOY_LOCAL: $BACKEND_IMAGE and $FRONTEND_IMAGE are present)"
else
  step "3/6 ECR login"
  ecr_login() {
    aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"
  }
  run_fn "aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY" ecr_login

  step "4/6 pull $BACKEND_IMAGE and $FRONTEND_IMAGE"
  run "${COMPOSE[@]}" pull --quiet
fi

step "5/6 up (the media directory owned by the backend's user first), then health — or the rollback"
run mkdir -p "$MEDIA_HOST_DIR"
run docker run --rm --user root -v "$MEDIA_HOST_DIR:/app/media" --entrypoint chown "$BACKEND_IMAGE" -R app:app /app/media
wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) service id health status restarts pending
  while :; do
    pending=""
    for service in backend frontend; do
      id=$("${COMPOSE[@]}" ps -q "$service" 2> /dev/null || true)
      if [ -z "$id" ]; then
        pending="$pending $service=missing"
        continue
      fi
      read -r health status restarts < <(docker inspect --format '{{.State.Health.Status}} {{.State.Status}} {{.RestartCount}}' "$id" 2> /dev/null || echo "missing missing 0")
      # A container that keeps dying never gets healthy: say so now rather
      # than at the deadline (restart: unless-stopped keeps relaunching it).
      if [ "$restarts" -ge 3 ]; then
        echo "deploy: $service restarted $restarts times ($status)" >&2
        "${COMPOSE[@]}" logs --no-color --tail 200 "$service" >&2
        return 1
      fi
      [ "$health" = healthy ] || pending="$pending $service=$health"
    done
    if [ -z "$pending" ]; then
      echo "backend and frontend healthy"
      return 0
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "deploy: not healthy after ${HEALTH_TIMEOUT}s:$pending" >&2
      "${COMPOSE[@]}" logs --no-color --tail 200 >&2
      return 1
    fi
    sleep 3
  done
}
up_and_wait() {
  "${COMPOSE[@]}" up -d --remove-orphans
  wait_healthy
}
if [ "$DRY" = 1 ]; then
  run "${COMPOSE[@]}" up -d --remove-orphans
  echo "+ wait up to ${HEALTH_TIMEOUT}s for backend and frontend to report healthy (a service restarting 3 times fails at once), else 'docker compose logs --tail 200'"
  echo "+ on failure with CURRENT_SHA (${CURRENT:-none}) ≠ $SHA: up -d the sha-${CURRENT:0:7} images, wait again, print 'rolled back to $CURRENT', exit 1 (E14); without one, exit 1"
elif ! up_and_wait; then
  if [ -n "$CURRENT" ] && [ "$CURRENT" != "$SHA" ]; then
    # E14: the previous release's images are still on the host (E13 keeps
    # them); the schema is not touched — every migration leaves the previous
    # release working (CLAUDE.md §6.5), so the old code runs on the new schema.
    echo "deploy: $SHA is not healthy — rolling back to $CURRENT" >&2
    images_for "$CURRENT"
    if up_and_wait; then
      echo "rolled back to $CURRENT"
    else
      echo "deploy: the rollback to $CURRENT is not healthy either" >&2
    fi
  fi
  exit 1
fi

step "6/6 record the deploy, keep this release's images and the previous one's, prune"
write_current() {
  if [ -n "$CURRENT" ] && [ "$CURRENT" != "$SHA" ]; then
    echo "$CURRENT" > PREVIOUS_SHA
  fi
  echo "$SHA" > CURRENT_SHA
}
run_fn "echo ${CURRENT:-<none>} > PREVIOUS_SHA (when it differs); echo $SHA > CURRENT_SHA" write_current
# E13: the host keeps the images of this release and of the previous one
# (the rollback's) and nothing else under the registry's spacerental/
# repositories, so a year of deploys cannot fill the root disk. A removal
# that fails (an image still in use) is reported, not fatal: the deploy
# itself succeeded.
retain_images() {
  local keep_current="sha-$SHORT" keep_previous="" image tag
  [ ! -f PREVIOUS_SHA ] || keep_previous="sha-$(cut -c1-7 PREVIOUS_SHA)"
  while IFS= read -r image; do
    [ -n "$image" ] || continue
    tag=${image##*:}
    if [ "$tag" != "$keep_current" ] && [ "$tag" != "$keep_previous" ]; then
      docker rmi "$image" > /dev/null && echo "removed $image" || echo "deploy: could not remove $image" >&2
    fi
  done < <(docker images --format '{{.Repository}}:{{.Tag}}' --filter "reference=$ECR_REGISTRY/spacerental/*")
}
run_fn "docker rmi every $ECR_REGISTRY/spacerental/* image tagged neither sha-$SHORT nor sha-<PREVIOUS_SHA> (E13)" retain_images
run docker image prune -f
echo "deployed $SHA (images sha-$SHORT)"
