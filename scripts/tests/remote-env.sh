#!/usr/bin/env bash
# D19/D20: the layered env file does what README "Access from another device"
# says, and the default render is untouched. Runs in a scratch copy of the
# files involved, so the developer's .env and .env.remote are never read or
# written. Needs `docker compose` (v2.24+ for several --env-file flags), jq
# and python3 (a canned ngrok API for the `ngrok` mode).
#
#   scripts/tests/remote-env.sh
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp "$ROOT/docker-compose.yml" "$ROOT/.env.remote.example" "$work/"
cp "$ROOT/.env.example" "$work/.env"
mkdir -p "$work/scripts"
cp "$ROOT/scripts/remote-up.sh" "$work/scripts/"
cd "$work"

docker compose version
fail=0
check() { # label actual expected
  if [ "$2" = "$3" ]; then
    echo "ok    $1 = $2"
  else
    echo "FAIL  $1 = '$2' (expected '$3')"
    fail=1
  fi
}
check_same() { # label actual expected — for whole renders, without echoing them
  if [ "$2" = "$3" ]; then
    echo "ok    $1 (identical)"
  else
    echo "FAIL  $1 — differs:"
    diff <(printf '%s\n' "$3") <(printf '%s\n' "$2") || true
    fail=1
  fi
}
# `docker compose <global flags> config`: the rendered service environment.
render() { docker compose "$@" config --format json; }
backend_env() { jq -r --arg k "$1" '.services.backend.environment[$k]'; }
frontend_env() { jq -r --arg k "$1" '.services.frontend.environment[$k]'; }

echo "── 1. only .env: today's defaults — one origin, the browser never needs port 8000"
plain=$(render --env-file .env)
check "backend CORS_ORIGINS" "$(backend_env CORS_ORIGINS <<< "$plain")" "http://localhost:3000"
check "backend FRONTEND_URL" "$(backend_env FRONTEND_URL <<< "$plain")" "http://localhost:3000"
# Empty = derived from FRONTEND_URL by the backend (app/config.py, D20).
check "backend MEDIA_BASE_URL (derived)" "$(backend_env MEDIA_BASE_URL <<< "$plain")" ""
check "backend STRIPE_STUB_CHECKOUT_BASE_URL (derived)" "$(backend_env STRIPE_STUB_CHECKOUT_BASE_URL <<< "$plain")" ""
check "backend STRIPE_SUCCESS_URL (derived)" "$(backend_env STRIPE_SUCCESS_URL <<< "$plain")" ""
check "backend STRIPE_CANCEL_URL (derived)" "$(backend_env STRIPE_CANCEL_URL <<< "$plain")" ""
check "backend RATE_LIMIT_TRUSTED_PROXIES" "$(backend_env RATE_LIMIT_TRUSTED_PROXIES <<< "$plain")" "frontend"
check "backend RATE_LIMIT_TRUST_FORWARDED_FOR" "$(backend_env RATE_LIMIT_TRUST_FORWARDED_FOR <<< "$plain")" "false"
check "frontend NEXTAUTH_URL" "$(frontend_env NEXTAUTH_URL <<< "$plain")" "http://localhost:3000"
check "frontend NEXT_PUBLIC_API_URL (relative, through the proxy)" "$(frontend_env NEXT_PUBLIC_API_URL <<< "$plain")" "/backend/api/v1"
check "frontend INTERNAL_API_URL" "$(frontend_env INTERNAL_API_URL <<< "$plain")" "http://backend:8000/api/v1"
# The production image bakes the /backend proxy's target at build time (Next
# compiles rewrites into the routes manifest): its build-arg default must be
# the address Compose gives the frontend at runtime, or the two would differ.
check "frontend/Dockerfile ARG INTERNAL_API_URL default = Compose's runtime value" \
  "$(sed -n 's/^ARG INTERNAL_API_URL=//p' "$ROOT/frontend/Dockerfile")" "$(frontend_env INTERNAL_API_URL <<< "$plain")"
# What `docker compose up` reads with no flags is the same render.
check_same "plain render equals the implicit .env render" "$(render | jq -S .)" "$(jq -S . <<< "$plain")"

echo "── 2. .env + .env.remote (the example as is): NEXTAUTH_URL and FRONTEND_URL follow WEB, nothing else differs"
cp .env.remote.example .env.remote
WEB=$(sed -n 's/^WEB=//p' .env.remote)
check "example WEB" "$WEB" "http://192.168.1.42:3000"
check "the example sets one variable" "$(grep -c '^[A-Z_]*=' .env.remote)" "3"
layered=$(render --env-file .env --env-file .env.remote)
check "frontend NEXTAUTH_URL" "$(frontend_env NEXTAUTH_URL <<< "$layered")" "$WEB"
check "backend FRONTEND_URL" "$(backend_env FRONTEND_URL <<< "$layered")" "$WEB"
check "frontend NEXT_PUBLIC_API_URL unchanged" "$(frontend_env NEXT_PUBLIC_API_URL <<< "$layered")" "/backend/api/v1"
check "frontend INTERNAL_API_URL unchanged" "$(frontend_env INTERNAL_API_URL <<< "$layered")" "http://backend:8000/api/v1"
check "backend CORS_ORIGINS unchanged" "$(backend_env CORS_ORIGINS <<< "$layered")" "http://localhost:3000"
# The layer changes nothing but those two values: same render once they are masked.
mask() { jq -S 'del(.services.backend.environment.FRONTEND_URL) | del(.services.frontend.environment.NEXTAUTH_URL)'; }
check_same "the layer touches only NEXTAUTH_URL and FRONTEND_URL" "$(mask <<< "$layered")" "$(mask <<< "$plain")"
rm .env.remote

echo "── 3. remote-up.sh lan --dry-run with REMOTE_HOST_IP: prints the one-URL env, writes nothing"
dry=$(REMOTE_HOST_IP=10.0.0.5 scripts/remote-up.sh lan --dry-run)
check "dry-run WEB line" "$(sed -n 's/^WEB=//p' <<< "$dry")" "http://10.0.0.5:3000"
check "dry-run has no API line" "$(grep -c '^API=' <<< "$dry" || true)" "0"
check ".env.remote not written" "$([ -e .env.remote ] && echo written || echo absent)" "absent"
check ".env untouched" "$(cmp -s .env "$ROOT/.env.example" && echo same || echo changed)" "same"
# The printed env is a working layer: feed it to Compose.
sed -n '/^[A-Z_]*=/p' <<< "$dry" > dry.env
fromdry=$(render --env-file .env --env-file dry.env)
check "frontend NEXTAUTH_URL from the dry-run env" "$(frontend_env NEXTAUTH_URL <<< "$fromdry")" "http://10.0.0.5:3000"
check "backend FRONTEND_URL from the dry-run env" "$(backend_env FRONTEND_URL <<< "$fromdry")" "http://10.0.0.5:3000"
check "frontend NEXT_PUBLIC_API_URL from the dry-run env" "$(frontend_env NEXT_PUBLIC_API_URL <<< "$fromdry")" "/backend/api/v1"

echo "── 4. no .env: the script refuses"
mv .env env.aside
if REMOTE_HOST_IP=10.0.0.5 scripts/remote-up.sh lan --dry-run > /dev/null 2> refused.txt; then
  check "exit status without .env" "0" "non-zero"
else
  check "refusal names .env" "$(grep -c '\.env is missing' refused.txt)" "1"
fi
mv env.aside .env

echo "── 5. remote-up.sh ngrok --dry-run against a canned agent API: one URL, the tunnel to :3000"
# A stand-in `ngrok` on PATH (only `config check` is called when the agent's
# API already answers) and a static tunnel list served where NGROK_API points.
mkdir -p bin fake/api
printf 'version: 3\ntunnels:\n  web:\n    proto: http\n    addr: 3000\n    domain: stable.ngrok-free.dev\n' > ngrok.yml
cat > bin/ngrok <<EOF
#!/usr/bin/env bash
[ "\$1 \$2" = "config check" ] && { echo "Valid configuration file at $work/ngrok.yml"; exit 0; }
echo "fake ngrok: unexpected call: \$*" >&2; exit 99
EOF
chmod +x bin/ngrok
port=47040
python3 -m http.server "$port" --bind 127.0.0.1 --directory fake > /dev/null 2>&1 &
server=$!
trap 'kill $server 2> /dev/null; rm -rf "$work"' EXIT
for _ in $(seq 1 20); do curl -sf "http://127.0.0.1:$port/" > /dev/null && break; sleep 0.5; done
ngrok_env() { PATH="$work/bin:$PATH" NGROK_API="http://127.0.0.1:$port/api/tunnels" scripts/remote-up.sh ngrok --dry-run; }

# The usual shape: one tunnel, on the reserved domain.
printf '{"tunnels":[{"name":"web","public_url":"https://stable.ngrok-free.dev","config":{"addr":"http://localhost:3000"}}]}' > fake/api/tunnels
dry=$(ngrok_env)
check "ngrok dry-run WEB line (the tunnel to :3000)" "$(sed -n 's/^WEB=//p' <<< "$dry")" "https://stable.ngrok-free.dev"
check "ngrok dry-run has no API line" "$(grep -c '^API=' <<< "$dry" || true)" "0"
check ".env.remote not written" "$([ -e .env.remote ] && echo written || echo absent)" "absent"

# A config that still has an `api` tunnel is fine: only the one to :3000 is read.
printf '{"tunnels":[{"name":"api","public_url":"https://other.ngrok-free.dev","config":{"addr":"http://localhost:8000"}},{"name":"web","public_url":"https://stable.ngrok-free.dev","config":{"addr":"http://localhost:3000"}}]}' > fake/api/tunnels
check "ngrok dry-run ignores a tunnel to another port" "$(ngrok_env | sed -n 's/^WEB=//p')" "https://stable.ngrok-free.dev"

# A leftover `api` tunnel on the SAME URL (a free account's one domain, pooled): refused.
printf '{"tunnels":[{"name":"api","public_url":"https://one.ngrok-free.dev","config":{"addr":"http://localhost:8000"}},{"name":"web","public_url":"https://one.ngrok-free.dev","config":{"addr":"http://localhost:3000"}}]}' > fake/api/tunnels
if ngrok_env > /dev/null 2> shared.txt; then
  check "exit status with a pooled tunnel on the same URL" "0" "non-zero"
else
  check "refusal names the pooled tunnel" "$(grep -c 'another tunnel shares the URL https://one.ngrok-free.dev: api (http://localhost:8000)' shared.txt)" "1"
fi
check ".env.remote not written after the refusal" "$([ -e .env.remote ] && echo written || echo absent)" "absent"

# No tunnel to :3000: the YAML to add, exit 1.
printf '{"tunnels":[{"name":"api","public_url":"https://other.ngrok-free.dev","config":{"addr":"http://localhost:8000"}}]}' > fake/api/tunnels
if ngrok_env > /dev/null 2> missing.txt; then
  check "exit status without a tunnel to :3000" "0" "non-zero"
else
  check "the message prints the web tunnel YAML" "$(grep -c 'addr: 3000' missing.txt)" "1"
fi
check ".env.remote still not written" "$([ -e .env.remote ] && echo written || echo absent)" "absent"

if [ "$fail" -ne 0 ]; then
  echo "remote-env: FAILED" >&2
  exit 1
fi
echo "remote-env: all checks passed"
