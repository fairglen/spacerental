#!/usr/bin/env bash
# D19: the layered env file does what README "Access from another device"
# says, and the default render is untouched. Runs in a scratch copy of the
# files involved, so the developer's .env and .env.remote are never read or
# written. Needs `docker compose` (v2.24+ for several --env-file flags) and jq.
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

echo "── 1. only .env: today's localhost values"
plain=$(render --env-file .env)
check "backend CORS_ORIGINS" "$(backend_env CORS_ORIGINS <<< "$plain")" "http://localhost:3000"
check "backend FRONTEND_URL" "$(backend_env FRONTEND_URL <<< "$plain")" "http://localhost:3000"
check "backend MEDIA_BASE_URL" "$(backend_env MEDIA_BASE_URL <<< "$plain")" "http://localhost:8000/media"
check "backend STRIPE_SUCCESS_URL" "$(backend_env STRIPE_SUCCESS_URL <<< "$plain")" "http://localhost:3000/dashboard?pagamento=sucesso"
check "backend STRIPE_CANCEL_URL" "$(backend_env STRIPE_CANCEL_URL <<< "$plain")" "http://localhost:3000/dashboard?pagamento=cancelado"
check "backend STRIPE_STUB_CHECKOUT_BASE_URL" "$(backend_env STRIPE_STUB_CHECKOUT_BASE_URL <<< "$plain")" "http://localhost:8000"
check "frontend NEXTAUTH_URL" "$(frontend_env NEXTAUTH_URL <<< "$plain")" "http://localhost:3000"
check "frontend NEXT_PUBLIC_API_URL" "$(frontend_env NEXT_PUBLIC_API_URL <<< "$plain")" "http://localhost:8000/api/v1"
check "frontend INTERNAL_API_URL" "$(frontend_env INTERNAL_API_URL <<< "$plain")" "http://backend:8000/api/v1"
# What `docker compose up` reads with no flags is the same render.
check_same "plain render equals the implicit .env render" "$(render | jq -S .)" "$(jq -S . <<< "$plain")"

echo "── 2. .env + .env.remote (the example as is): every browser-facing value follows WEB/API"
cp .env.remote.example .env.remote
WEB=$(sed -n 's/^WEB=//p' .env.remote)
API=$(sed -n 's/^API=//p' .env.remote)
check "example WEB" "$WEB" "http://192.168.1.42:3000"
check "example API" "$API" "http://192.168.1.42:8000"
layered=$(render --env-file .env --env-file .env.remote)
check "backend CORS_ORIGINS" "$(backend_env CORS_ORIGINS <<< "$layered")" "http://localhost:3000,$WEB"
check "backend FRONTEND_URL" "$(backend_env FRONTEND_URL <<< "$layered")" "$WEB"
check "backend MEDIA_BASE_URL" "$(backend_env MEDIA_BASE_URL <<< "$layered")" "$API/media"
check "backend STRIPE_SUCCESS_URL" "$(backend_env STRIPE_SUCCESS_URL <<< "$layered")" "$WEB/dashboard?pagamento=sucesso"
check "backend STRIPE_CANCEL_URL" "$(backend_env STRIPE_CANCEL_URL <<< "$layered")" "$WEB/dashboard?pagamento=cancelado"
check "backend STRIPE_STUB_CHECKOUT_BASE_URL" "$(backend_env STRIPE_STUB_CHECKOUT_BASE_URL <<< "$layered")" "$API"
check "frontend NEXTAUTH_URL" "$(frontend_env NEXTAUTH_URL <<< "$layered")" "$WEB"
check "frontend NEXT_PUBLIC_API_URL" "$(frontend_env NEXT_PUBLIC_API_URL <<< "$layered")" "$API/api/v1"
check "frontend INTERNAL_API_URL" "$(frontend_env INTERNAL_API_URL <<< "$layered")" "http://backend:8000/api/v1"
# The layer changes nothing but those values: same render once they are masked.
mask() { jq -S 'del(.services.backend.environment | .CORS_ORIGINS, .FRONTEND_URL, .MEDIA_BASE_URL, .STRIPE_SUCCESS_URL, .STRIPE_CANCEL_URL, .STRIPE_STUB_CHECKOUT_BASE_URL) | del(.services.frontend.environment | .NEXTAUTH_URL, .NEXT_PUBLIC_API_URL)'; }
check_same "the layer touches only the browser-facing values" "$(mask <<< "$layered")" "$(mask <<< "$plain")"
rm .env.remote

echo "── 3. remote-up.sh lan --dry-run with REMOTE_HOST_IP: prints the env, writes nothing"
dry=$(REMOTE_HOST_IP=10.0.0.5 scripts/remote-up.sh lan --dry-run)
check "dry-run WEB line" "$(sed -n 's/^WEB=//p' <<< "$dry")" "http://10.0.0.5:3000"
check "dry-run API line" "$(sed -n 's/^API=//p' <<< "$dry")" "http://10.0.0.5:8000"
check ".env.remote not written" "$([ -e .env.remote ] && echo written || echo absent)" "absent"
check ".env untouched" "$(cmp -s .env "$ROOT/.env.example" && echo same || echo changed)" "same"
# The printed env is a working layer: feed it to Compose.
sed -n '/^[A-Z_]*=/p' <<< "$dry" > dry.env
fromdry=$(render --env-file .env --env-file dry.env)
check "frontend NEXTAUTH_URL from the dry-run env" "$(frontend_env NEXTAUTH_URL <<< "$fromdry")" "http://10.0.0.5:3000"
check "frontend NEXT_PUBLIC_API_URL from the dry-run env" "$(frontend_env NEXT_PUBLIC_API_URL <<< "$fromdry")" "http://10.0.0.5:8000/api/v1"
check "backend CORS_ORIGINS from the dry-run env" "$(backend_env CORS_ORIGINS <<< "$fromdry")" "http://localhost:3000,http://10.0.0.5:3000"

echo "── 4. no .env: the script refuses"
mv .env env.aside
if REMOTE_HOST_IP=10.0.0.5 scripts/remote-up.sh lan --dry-run > /dev/null 2> refused.txt; then
  check "exit status without .env" "0" "non-zero"
else
  check "refusal names .env" "$(grep -c '\.env is missing' refused.txt)" "1"
fi
mv env.aside .env

echo "── 5. remote-up.sh ngrok --dry-run against a canned agent API: URLs by upstream port; one shared URL is refused"
# A stand-in `ngrok` on PATH (only `config check` is called when the agent's
# API already answers) and a static tunnel list served where NGROK_API points.
mkdir -p bin fake/api
printf 'version: 3\ntunnels:\n  web:\n    proto: http\n    addr: 3000\n  api:\n    proto: http\n    addr: 8000\n' > ngrok.yml
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

printf '{"tunnels":[{"name":"api","public_url":"https://api-1234.ngrok-free.dev","config":{"addr":"http://localhost:8000"}},{"name":"web","public_url":"https://web-1234.ngrok-free.dev","config":{"addr":"http://localhost:3000"}}]}' > fake/api/tunnels
dry=$(ngrok_env)
check "ngrok dry-run WEB line (tunnel to :3000)" "$(sed -n 's/^WEB=//p' <<< "$dry")" "https://web-1234.ngrok-free.dev"
check "ngrok dry-run API line (tunnel to :8000)" "$(sed -n 's/^API=//p' <<< "$dry")" "https://api-1234.ngrok-free.dev"
check "ngrok dry-run CORS line" "$(sed -n 's/^CORS_ORIGINS=//p' <<< "$dry")" 'http://localhost:3000,${WEB}'
check ".env.remote not written" "$([ -e .env.remote ] && echo written || echo absent)" "absent"

printf '{"tunnels":[{"name":"api","public_url":"https://one.ngrok-free.dev","config":{"addr":"http://localhost:8000"}},{"name":"web","public_url":"https://one.ngrok-free.dev","config":{"addr":"http://localhost:3000"}}]}' > fake/api/tunnels
if ngrok_env > /dev/null 2> shared.txt; then
  check "exit status with one shared URL" "0" "non-zero"
else
  check "refusal names the shared URL" "$(grep -c 'SAME URL (https://one.ngrok-free.dev)' shared.txt)" "1"
fi
check ".env.remote still not written" "$([ -e .env.remote ] && echo written || echo absent)" "absent"

if [ "$fail" -ne 0 ]; then
  echo "remote-env: FAILED" >&2
  exit 1
fi
echo "remote-env: all checks passed"
