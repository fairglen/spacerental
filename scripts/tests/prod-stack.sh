#!/usr/bin/env bash
# E01: the production stack end to end, without AWS. docker-compose.prod.yml
# plus scripts/tests/prod-stack.compose.yml (a throwaway Postgres where RDS
# would be, Caddy on PROD_STACK_HTTPS_PORT/PROD_STACK_HTTP_PORT) and a scratch
# `.env` made from .env.production.example — APP_ENV=production, so the
# backend's interlock (E02) runs for real. Through Caddy and the Next.js
# proxy it proves:
#   1. the two health probes answer;
#   2. `python -m app.bootstrap` creates the organisation once and `app.seed`
#      refuses to run (E03);
#   3. sign-up and a booking;
#   4. proxy identity: the auth tier throttles the host's 11th request, a
#      spoofed X-Forwarded-For does not reset it, a second client container
#      is a distinct client;
#   5. a Stripe webhook signed with the stack's secret reaches the API with
#      its raw body intact — it fails on the unknown session, never on the
#      signature — and a wrong secret is refused.
# scripts/tests/backup-restore.sh then runs against the same stack (E06).
#
#   scripts/tests/prod-stack.sh            # up, test, down
#   KEEP=1 scripts/tests/prod-stack.sh     # up, test, leave it running
#   scripts/tests/prod-stack.sh down       # tear it down, volumes included
#
# Never reads the checkout's `.env` or touches the default Compose project.
# Needs docker compose v2, curl, openssl and python3.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PROJECT=${PROD_STACK_PROJECT:-spacerental-prod-local}
HTTPS_PORT=${PROD_STACK_HTTPS_PORT:-443}
HTTP_PORT=${PROD_STACK_HTTP_PORT:-80}
WORK=${PROD_STACK_WORK:-${TMPDIR:-/tmp}/spacerental-prod-stack-$PROJECT}
ENV_FILE="$WORK/.env"
BASE="https://localhost:$HTTPS_PORT"
API="$BASE/backend/api/v1"
# The API's health route has no /api/v1 prefix (backend/app/main.py).
HEALTH="$BASE/backend/health"
# postgres:18-alpine, the same digest as the Compose files (Q53): a shell
# with root for the scratch files the containers chowned.
PG_IMAGE=postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873

compose() {
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" \
    -f "$ROOT/docker-compose.prod.yml" -f "$ROOT/scripts/tests/prod-stack.compose.yml" "$@"
}

# The app role's password, as deploy/db-bootstrap.sh sets it: deliberately
# full of the characters a URL must encode (+ / = @), so the percent-encoded
# DATABASE_URL below exercises deploy.sh's composition, the backend's URL
# parsing and alembic's `%%` escape (E09) end to end.
APP_ROLE=spacerental_app
APP_PASSWORD="pw+/=@$(openssl rand -hex 6)"
url_encode() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"; }

write_env() {
  # The example as the template, so a variable the stack needs and the
  # example forgot surfaces here; the local values replace its lines. The
  # example carries no DATABASE_URL (deploy.sh composes it on the host, E09):
  # here the composed shape, for the role db-bootstrap.sh creates below.
  mkdir -p "$WORK/media" "$WORK/certs"
  local overrides=(
    "APP_ENV=production"
    "SECRET_KEY=$(openssl rand -hex 32)"
    "NEXTAUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
    "CADDY_DOMAIN=localhost"
    "FRONTEND_URL=$BASE"
    "NEXTAUTH_URL=$BASE"
    "CORS_ORIGINS=$BASE"
    "DATABASE_URL=postgresql+asyncpg://$APP_ROLE:$(url_encode "$APP_PASSWORD")@db:5432/spacerental?ssl=require"
    "CUSTOMER_ENROLLMENT_ORG_SLUG=flowspace"
    "STRIPE_MODE=stub"
    "STRIPE_WEBHOOK_SECRET=whsec_prod_stack_$(openssl rand -hex 8)"
    "EMAIL_MODE=stub"
    "MEDIA_HOST_DIR=$WORK/media"
    "LOG_DRIVER=json-file"
    "APP_VERSION=prod-stack"
    # Read by the overlay, ignored by the app.
    "PROD_STACK_ENV_FILE=$ENV_FILE"
    "PROD_STACK_HTTP_PORT=$HTTP_PORT"
    "PROD_STACK_HTTPS_PORT=$HTTPS_PORT"
    "PROD_STACK_CERTS=$WORK/certs"
  )
  local keys
  keys=$(printf '%s\n' "${overrides[@]}" | cut -d= -f1 | paste -sd'|' -)
  grep -Ev "^($keys)=" "$ROOT/.env.production.example" > "$ENV_FILE"
  printf '%s\n' "${overrides[@]}" >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

down() {
  [ -f "$ENV_FILE" ] || write_env
  compose down -v --remove-orphans
  # The media directory belongs to the backend's user after the chown below.
  docker run --rm -v "$WORK:/work" "$PG_IMAGE" sh -c 'rm -rf /work/media /work/backups'
  rm -rf "$WORK"
}

if [ "${1:-}" = down ]; then
  down
  exit 0
fi

fail=0
check() { # label actual expected
  if [ "$2" = "$3" ]; then
    echo "ok    $1 = $2"
  else
    echo "FAIL  $1 = '$2' (expected '$3')"
    fail=1
  fi
}
status_of() { # curl args… (with their own -o) → the HTTP status
  curl -ksS -w '%{http_code}' "$@"
}
json_field() { # file expression — python, so a quoted value never goes through a shell
  python3 -c 'import json, sys; print(eval(sys.argv[2], {"d": json.load(open(sys.argv[1]))}))' "$1" "$2"
}
on_error() {
  echo "prod-stack: FAILED (the stack's last 100 log lines follow)" >&2
  compose logs --no-color --tail 100 >&2 || true
}
trap on_error ERR

echo "── 0. scratch .env from .env.production.example, the stack up (project $PROJECT, Caddy on $HTTPS_PORT/$HTTP_PORT)"
write_env
docker compose version
if [ "${PROD_STACK_BUILD:-1}" = 1 ]; then
  compose build
fi
# The database first, with TLS as RDS enforces it (a self-signed pair the
# overlay hands to the server), then the app role the way the host gets it:
# deploy/db-bootstrap.sh as the master user, exactly as runbook 2.4 runs it
# through Session Manager — DB_APP_PASSWORD standing in for the secret.
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=db \
  -keyout "$WORK/certs/server.key" -out "$WORK/certs/server.crt" 2> /dev/null
chmod 644 "$WORK/certs/server.key" "$WORK/certs/server.crt"
compose up -d --no-build --wait --wait-timeout 120 db
printf 'DB_HOST=db\nDB_PORT=5432\nDB_NAME=spacerental\n' > "$WORK/deploy.env"
db_bootstrap() {
  DEPLOY_CONF="$WORK/deploy.env" DB_APP_PASSWORD="$APP_PASSWORD" DB_BOOTSTRAP_DOCKER_NETWORK="${PROJECT}_default" \
    MASTER_URL=postgresql://spacerental:spacerental@db:5432/spacerental "$ROOT/deploy/db-bootstrap.sh"
}
first_bootstrap=$(db_bootstrap)
check "db-bootstrap.sh hands the database to $APP_ROLE" "$(grep -c "owner of spacerental: $APP_ROLE" <<< "$first_bootstrap")" 1
check "db-bootstrap.sh connects as $APP_ROLE with that password" "$(grep -c "connected as $APP_ROLE" <<< "$first_bootstrap")" 1
check "db-bootstrap.sh a second time changes nothing and still passes" "$(db_bootstrap | grep -c "connected as $APP_ROLE")" 1
# The media directory is owned by the image's `app` user, as deploy.sh does
# on the host, so APP_ENV=production's writable-MEDIA_ROOT check is real.
compose run --rm --no-deps --user root --entrypoint chown backend app:app /app/media
compose up -d --no-build --wait --wait-timeout 300
wait_for() { # url label
  for _ in $(seq 1 60); do
    if curl -ksf "$1" > /dev/null; then echo "$2 answers"; return 0; fi
    sleep 2
  done
  echo "$2 did not answer within 120 s" >&2
  return 1
}
wait_for "$HEALTH" "the API through Caddy"
wait_for "$BASE/api/auth/providers" "the frontend through Caddy"

echo "── 1. health probes through Caddy; the database side of E09"
check "GET / (the landing page)" "$(status_of -o /dev/null "$BASE/")" 200
check "GET /backend/health (the API through the Next.js proxy)" "$(status_of -o /dev/null "$HEALTH")" 200
check "health body" "$(curl -ksS "$HEALTH")" '{"status":"ok"}'
check "GET /api/auth/providers (NextAuth)" "$(status_of -o /dev/null "$BASE/api/auth/providers")" 200
sql() { compose exec -T db psql -U spacerental -d spacerental -tAc "$1"; }
check "the migrations ran as $APP_ROLE (every public table is its)" \
  "$(sql "select count(*) > 0 and count(*) = count(*) filter (where tableowner = '$APP_ROLE') from pg_tables where schemaname = 'public'")" t
check "the backend's connections are TLS (pg_stat_ssl; the URL says ssl=require)" \
  "$(sql "select count(*) > 0 and bool_and(s.ssl) from pg_stat_ssl s join pg_stat_activity a using (pid) where a.usename = '$APP_ROLE'")" t

echo "── 2. bootstrap once (E03): the organisation, its space, rooms, pack and admin; the seed refuses"
bootstrap() {
  compose exec -T backend python -m app.bootstrap \
    --name FlowSpace --slug flowspace --admin-email admin@example.com --admin-name "Administração"
}
first=$(bootstrap)
check "first run creates the organisation" "$(grep -c '^Created organisation: FlowSpace \[flowspace\]' <<< "$first")" 1
check "first run creates three rooms" "$(grep -c '^Created room: ' <<< "$first")" 3
check "first run prints the set-password link" "$(grep -c "$BASE/reset-password/" <<< "$first")" 1
second=$(bootstrap)
check "second run changes nothing" "$(grep -c "already exists" <<< "$second")" 1
if compose exec -T backend python -m app.seed > /dev/null 2> "$WORK/seed.err"; then
  check "app.seed under APP_ENV=production" "ran" "refused"
else
  check "app.seed refuses under APP_ENV=production" "$(grep -c 'refuses to run with APP_ENV=production' "$WORK/seed.err")" 1
fi

echo "── 3. sign-up through the proxy (auth-tier request 1 of this client)"
EMAIL="cliente@example.com"
PASSWORD="Prod-Stack-Test-$(openssl rand -hex 4)"
# JSON bodies are built by python and passed as one variable: a brace-and-
# comma literal written inline is brace-expanded by bash inside a quoted
# `$(…)` (the first run sent `"name":"Cliente Teste"` alone).
json_body() { # key=value… → a JSON object
  python3 -c 'import json, sys; print(json.dumps(dict(a.split("=", 1) for a in sys.argv[1:])))' "$@"
}
REGISTER_BODY=$(json_body "email=$EMAIL" "password=$PASSWORD" "name=Cliente Teste")
check "POST /auth/register" \
  "$(status_of -o "$WORK/register.json" -H 'Content-Type: application/json' -d "$REGISTER_BODY" "$API/auth/register")" 201
TOKEN=$(json_field "$WORK/register.json" 'd["access_token"]')
check "the token names the member role" "$(json_field "$WORK/register.json" 'd["role"]')" member

echo "── 4. proxy identity: the auth tier throttles this client, a spoofed X-Forwarded-For stays throttled, another container is another client"
# RATE_LIMIT_AUTH_MAX_REQUESTS a minute, per uvicorn worker: the limiter is
# in-process (Q55) and the stack runs WEB_CONCURRENCY workers, each with its
# own window, and which worker answers depends on the connection the Next.js
# proxy reuses. What holds for any routing: no 429 among a client's first
# LIMIT requests; a first 429 by request LIMIT × WORKERS + 1 (some worker has
# then seen LIMIT + 1); and of any further batch of N requests under the same
# identity at most LIMIT × WORKERS are accepted, so at least
# N − LIMIT × WORKERS are 429 — whereas a spoofed header that did work would
# make every request a new client and give zero.
LIMIT=$(sed -n 's/^RATE_LIMIT_AUTH_MAX_REQUESTS=//p' "$ENV_FILE")
WORKERS=$(sed -n 's/^WEB_CONCURRENCY=//p' "$ENV_FILE")
: "${LIMIT:?RATE_LIMIT_AUTH_MAX_REQUESTS missing from $ENV_FILE}" "${WORKERS:?WEB_CONCURRENCY missing from $ENV_FILE}"
BATCH=$((LIMIT * WORKERS * 2))
MIN_REFUSED=$((BATCH - LIMIT * WORKERS))
login() { # extra curl args… (the password is wrong on purpose unless overridden)
  local body
  body=$(json_body "email=$EMAIL" "password=${LOGIN_PASSWORD:-wrong-password-on-purpose}")
  status_of -o /dev/null -H 'Content-Type: application/json' -d "$body" "$@" "$API/auth/login"
}
first429=0
for n in $(seq 2 $((LIMIT * WORKERS + 1))); do
  s=$(login)
  if [ "$s" = 429 ]; then first429=$n; break; fi
  [ "$s" = 401 ] || { echo "FAIL  auth-tier request $n answered $s (expected 401)"; fail=1; }
done
echo "      (first 429 at auth-tier request $first429; LIMIT=$LIMIT, WORKERS=$WORKERS)"
check "no 429 among the first $LIMIT auth-tier requests, one by request $((LIMIT * WORKERS + 1))" \
  "$((first429 > LIMIT && first429 <= LIMIT * WORKERS + 1))" 1
refused() { # N [extra login args…] → how many of N requests were 429
  local n=$1 count=0 i
  shift
  for i in $(seq 1 "$n"); do
    [ "$(login "$@")" = 429 ] && count=$((count + 1))
  done
  echo "$count"
}
at_least() { # label actual minimum
  echo "      ($1: $2 of $BATCH)"
  check "$1 ≥ $3" "$(( $2 >= $3 ))" 1
}
at_least "429s among $BATCH more requests from this client" "$(refused "$BATCH")" "$MIN_REFUSED"
# Each spoofed request names a different address: were the header believed,
# each would be a new client and none would be refused.
spoofed=0
for i in $(seq 1 "$BATCH"); do
  [ "$(login -H "X-Forwarded-For: 10.$((i / 256 % 256)).$((i % 256)).7")" = 429 ] && spoofed=$((spoofed + 1))
done
at_least "429s among $BATCH requests spoofing X-Forwarded-For (Caddy overwrote it)" "$spoofed" "$MIN_REFUSED"
OTHER_BODY=$(json_body "email=outro@example.com" "password=x")
retry_after=0
for _ in $(seq 1 $((LIMIT * WORKERS + 1))); do
  if curl -ksS -o /dev/null -D - -H 'Content-Type: application/json' -d "$OTHER_BODY" "$API/auth/login" | grep -qi '^retry-after:'; then
    retry_after=1
    break
  fi
done
check "a 429 carries Retry-After" "$retry_after" 1
# A one-off container of the backend image on the stack's network: the
# peer Caddy sees is its address, not the host's, so its bucket is fresh.
# Python because the image has no curl; the TLS name is `localhost` (the
# site Caddy serves) while the socket goes to the `caddy` service.
other_client() {
  compose run --rm --no-deps -T --entrypoint python backend - "$EMAIL" "$PASSWORD" <<'PY'
import http.client, json, socket, ssl, sys
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

class ViaCaddy(http.client.HTTPSConnection):
    def connect(self):
        sock = socket.create_connection((self.host, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname="localhost")

conn = ViaCaddy("caddy", 443, context=ctx, timeout=20)
body = json.dumps({"email": sys.argv[1], "password": sys.argv[2]})
conn.request("POST", "/backend/api/v1/auth/login", body=body,
             headers={"Host": "localhost", "Content-Type": "application/json"})
print(conn.getresponse().status)
PY
}
check "the first request from a second client container is 200" "$(other_client | tr -d '\r')" 200
at_least "429s among $BATCH right-password requests from the host (the bucket is the client's, not the account's)" \
  "$(LOGIN_PASSWORD=$PASSWORD refused "$BATCH")" "$MIN_REFUSED"

echo "── 5. a booking through the proxy (hourly checkout hold, stub Stripe)"
curl -ksS -o "$WORK/spaces.json" "$API/spaces"
SPACE_ID=$(json_field "$WORK/spaces.json" 'd["spaces"][0]["id"]')
curl -ksS -o "$WORK/space.json" "$API/spaces/$SPACE_ID"
ROOM_ID=$(json_field "$WORK/space.json" 'd["rooms"][0]["id"]')
check "the bootstrapped space lists its rooms" "$(json_field "$WORK/space.json" 'len(d["rooms"])')" 3
read -r START END < <(python3 -c '
from datetime import datetime, timedelta, timezone
start = (datetime.now(timezone.utc) + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
print(start.isoformat(), (start + timedelta(hours=1)).isoformat())
')
BOOKING_BODY=$(json_body "room_id=$ROOM_ID" "start_time=$START" "end_time=$END" "payment_method=hourly")
check "POST /bookings" \
  "$(status_of -o "$WORK/booking.json" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "$BOOKING_BODY" "$API/bookings")" 201
check "the booking is a pending hold" "$(json_field "$WORK/booking.json" 'd["booking"]["status"]')" pending
check "the checkout URL is on this origin, through the proxy" \
  "$(json_field "$WORK/booking.json" 'd["checkout_url"].startswith("'"$BASE"'/backend/checkout/stub/")')" True
check "GET /bookings/me lists it" \
  "$(curl -ksS -H "Authorization: Bearer $TOKEN" "$API/bookings/me" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["bookings"]))')" 1

echo "── 6. a Stripe webhook through Caddy + Next: the signature covers the raw body"
WEBHOOK_SECRET=$(sed -n 's/^STRIPE_WEBHOOK_SECRET=//p' "$ENV_FILE")
BODY='{"id":"evt_prod_stack","object":"event","type":"checkout.session.completed","data":{"object":{"id":"cs_prod_stack_unknown","object":"checkout.session","payment_status":"paid","metadata":{"kind":"booking","reference_id":"00000000-0000-4000-8000-000000000001","org_id":"00000000-0000-4000-8000-000000000002"}}}}'
sign() { # secret → Stripe-Signature, the way backend/app/payments.py computes it
  local ts digest
  ts=$(date +%s)
  digest=$(printf '%s.%s' "$ts" "$BODY" | openssl dgst -sha256 -hmac "$1" | sed 's/^.*= *//')
  echo "t=$ts,v1=$digest"
}
check "signed with the stack's secret: 200, received, not handled (unknown session)" \
  "$(curl -ksS -H 'Content-Type: application/json' -H "Stripe-Signature: $(sign "$WEBHOOK_SECRET")" --data-binary "$BODY" "$API/webhooks/stripe")" \
  '{"received":true,"handled":false}'
check "signed with another secret: 400" \
  "$(status_of -o /dev/null -H 'Content-Type: application/json' -H "Stripe-Signature: $(sign whsec_not_the_secret)" --data-binary "$BODY" "$API/webhooks/stripe")" 400
check "…and the reason is the signature" \
  "$(curl -ksS -H 'Content-Type: application/json' -H "Stripe-Signature: $(sign whsec_not_the_secret)" --data-binary "$BODY" "$API/webhooks/stripe")" \
  '{"detail":"Invalid Stripe signature"}'

echo "── 7. the production interlock is armed (E02): the backend logs the explicit stub modes"
# Once per process that imports app.config (the migration, each worker).
warned=$(compose logs --no-color backend | grep -c 'EMAIL_MODE=stub under APP_ENV=production' || true)
check "EMAIL_MODE=stub warning in the backend log" "$([ "$warned" -ge 1 ] && echo yes || echo no)" yes

trap - ERR
if [ "$fail" -ne 0 ]; then
  echo "prod-stack: FAILED" >&2
  [ "${KEEP:-0}" = 1 ] || down
  exit 1
fi
echo "prod-stack: all checks passed"
if [ "${KEEP:-0}" = 1 ]; then
  echo "prod-stack: stack left up as project $PROJECT (scripts/tests/prod-stack.sh down to remove it)"
else
  down
fi
