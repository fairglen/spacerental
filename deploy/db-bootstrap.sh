#!/usr/bin/env bash
# E09: create the application's own database role, once, on the host through
# Session Manager — after the first `terraform apply`, before the first
# deploy (runbook 2.4):
#
#   sudo /srv/spacerental/db-bootstrap.sh          # asks for the master URL, not echoed
#   printf '%s' "$MASTER_URL" | sudo /srv/spacerental/db-bootstrap.sh
#
# The master connection URL (postgresql://spacerental:<password>@<host>:5432/<db>)
# is read from the master secret ON THE LAPTOP and pasted into the session;
# the host never writes it anywhere. The app password is generated here and
# stored in the app secret (DB_APP_SECRET_ARN, JSON {username, password})
# when that secret has no value yet; a later run reads it back, so the
# role's password always equals what deploy.sh composes DATABASE_URL from.
# Idempotent: every statement tolerates having run before.
#
# What it does as the master user: CREATE ROLE spacerental_app LOGIN if
# missing; set its password; GRANT spacerental_app TO <master> (on RDS the
# master is not a superuser, and owning a database needs membership of the
# new owner); ALTER DATABASE <db> OWNER TO spacerental_app; GRANT ALL ON
# SCHEMA public. `uuid-ossp` is a trusted extension, so the database owner
# can create it — the baseline migration does, as spacerental_app.
#
# Configuration from /etc/spacerental/deploy.env (cloud-init): DB_HOST,
# DB_PORT, DB_NAME, DB_APP_SECRET_ARN, AWS_REGION. psql runs in the pinned
# postgres:18-alpine image like backup.sh; DB_BOOTSTRAP_DOCKER_NETWORK is
# the network it joins (default bridge — reaches RDS; the local test passes
# its Compose project's network). DB_APP_PASSWORD, when set, replaces the
# secret entirely — for scripts/tests/prod-stack.sh, never on the host.
set -euo pipefail

CONF=${DEPLOY_CONF:-/etc/spacerental/deploy.env}
if [ -f "$CONF" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$CONF"
  set +a
fi
: "${DB_HOST:?DB_HOST is required (from $CONF)}"
: "${DB_PORT:?DB_PORT is required (from $CONF)}"
: "${DB_NAME:?DB_NAME is required (from $CONF)}"
APP_ROLE=${DB_APP_ROLE:-spacerental_app}
NETWORK=${DB_BOOTSTRAP_DOCKER_NETWORK:-bridge}
PG_IMAGE=postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
TAG=spacerental-db-bootstrap

log() { echo "$TAG: $*"; }

if [ -z "${MASTER_URL:-}" ]; then
  if [ -t 0 ]; then
    read -rsp "master connection URL (postgresql://spacerental:<password>@$DB_HOST:$DB_PORT/$DB_NAME), not echoed: " MASTER_URL
    echo
  else
    read -r MASTER_URL
  fi
fi
[ -n "$MASTER_URL" ] || { log "a master connection URL is required" >&2; exit 2; }
case "$MASTER_URL" in
  postgresql://*|postgres://*) ;;
  *) log "the master URL must start with postgresql://" >&2; exit 2 ;;
esac
# The user part of the URL: the role that receives membership of the app role.
rest=${MASTER_URL#*://}
MASTER_USER=${rest%%[:@]*}
[ -n "$MASTER_USER" ] || { log "the master URL carries no user" >&2; exit 2; }

# ── 1. the app password: the secret's value, or a new one stored there ──────
if [ -n "${DB_APP_PASSWORD:-}" ]; then
  APP_PASSWORD=$DB_APP_PASSWORD
  log "DB_APP_PASSWORD given (the local test): the secret is not consulted"
else
  : "${DB_APP_SECRET_ARN:?DB_APP_SECRET_ARN is required (from $CONF)}"
  : "${AWS_REGION:?AWS_REGION is required (from $CONF)}"
  if current=$(aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$DB_APP_SECRET_ARN" \
      --query SecretString --output text 2> /dev/null); then
    APP_PASSWORD=$(jq -r '.password' <<< "$current")
    [ -n "$APP_PASSWORD" ] && [ "$APP_PASSWORD" != null ] || { log "the secret's value has no .password" >&2; exit 1; }
    log "the app secret already has a value: the role's password is set to it"
  else
    # DECISION: URL-safe characters only (base64's + / = swapped out). deploy.sh
    # percent-encodes the password anyway; a value that needs no encoding is
    # one the operator can read in the host's .env and paste into psql.
    APP_PASSWORD=$(openssl rand -base64 36 | tr '+/' '-_' | tr -d '=\n')
    aws secretsmanager put-secret-value --region "$AWS_REGION" --secret-id "$DB_APP_SECRET_ARN" \
      --secret-string "$(jq -cn --arg u "$APP_ROLE" --arg p "$APP_PASSWORD" '{username: $u, password: $p}')" > /dev/null
    log "app password generated and stored in $DB_APP_SECRET_ARN"
  fi
fi

# ── 2. the role, its password, the database's ownership ─────────────────────
# Both secrets travel in the container's environment, never in an argv:
# psql reads them with backtick \set, so no process list shows them.
log "creating $APP_ROLE if missing and handing it $DB_NAME (as $MASTER_USER)"
docker run --rm -i --network "$NETWORK" -e PGCONNECT_TIMEOUT=15 \
  -e MASTER_URL="$MASTER_URL" -e APP_PASSWORD="$APP_PASSWORD" \
  -e APP_ROLE="$APP_ROLE" -e MASTER_USER="$MASTER_USER" -e DB_NAME="$DB_NAME" \
  "$PG_IMAGE" sh -c 'exec psql "$MASTER_URL" -q -v ON_ERROR_STOP=1' <<'SQL'
\set app_role `printenv APP_ROLE`
\set app_password `printenv APP_PASSWORD`
\set master_user `printenv MASTER_USER`
\set db_name `printenv DB_NAME`
SELECT format('CREATE ROLE %I LOGIN', :'app_role')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role') \gexec
ALTER ROLE :"app_role" WITH LOGIN PASSWORD :'app_password';
GRANT :"app_role" TO :"master_user";
ALTER DATABASE :"db_name" OWNER TO :"app_role";
GRANT ALL ON SCHEMA public TO :"app_role";
SELECT 'owner of ' || datname || ': ' || datdba::regrole FROM pg_database WHERE datname = :'db_name';
SQL

# ── 3. the app role can connect with that password ──────────────────────────
docker run --rm --network "$NETWORK" -e PGCONNECT_TIMEOUT=15 -e PGPASSWORD="$APP_PASSWORD" "$PG_IMAGE" \
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$APP_ROLE" -d "$DB_NAME" -qtAc "select 'connected as ' || current_user"
log "done — deploy.sh composes DATABASE_URL for $APP_ROLE from the secret on every deploy"
