#!/usr/bin/env bash
# Reach the local stack from another device (README "Access from another
# device", TODO.md D19): writes .env.remote from .env.remote.example and starts
# the stack with that file layered on .env.
#
#   scripts/remote-up.sh lan   [--dry-run]   same Wi-Fi, via this host's LAN IP
#   scripts/remote-up.sh ngrok [--dry-run]   from anywhere, via two ngrok tunnels
#   scripts/remote-up.sh off                 back to localhost (plain .env)
#
# --dry-run prints the .env.remote it would write and touches neither that
# file nor Docker. REMOTE_HOST_IP=<ip> replaces the LAN detection (CI uses it).
# The script never edits .env and refuses to run without one.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

WEB_PORT=3000
API_PORT=8000
# The agent's local API; overridable so scripts/tests/remote-env.sh can serve a
# canned tunnel list instead of running ngrok.
NGROK_API=${NGROK_API:-http://127.0.0.1:4040/api/tunnels}
NGROK_LOG=${TMPDIR:-/tmp}/spacerental-ngrok.log

die() { echo "remote-up: $*" >&2; exit 1; }
usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; }

mode=${1:-}
[ $# -eq 0 ] || shift
dry_run=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    *) usage >&2; die "unknown argument: $arg" ;;
  esac
done
case "$mode" in
  lan|ngrok|off) ;;
  *) usage >&2; exit 2 ;;
esac
[ -f .env ] || die ".env is missing — cp .env.example .env first (README \"Setup\")"
[ -f .env.remote.example ] || die ".env.remote.example is missing"

# ── helpers ──────────────────────────────────────────────────────────────────

host_ip() {
  if [ -n "${REMOTE_HOST_IP:-}" ]; then
    echo "$REMOTE_HOST_IP"
    return
  fi
  local ip=""
  case "$(uname -s)" in
    Darwin) ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true) ;;
    Linux) ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true) ;;
  esac
  [ -n "$ip" ] || die "could not detect this host's LAN IP — run again with REMOTE_HOST_IP=<ip>"
  echo "$ip"
}

# The .env.remote for a WEB/API pair: the template with its two lines replaced,
# so every derived value stays the template's (one source of truth).
render_env() {
  local web api
  web=$(printf '%s' "$1" | sed 's/[&|\\]/\\&/g')
  api=$(printf '%s' "$2" | sed 's/[&|\\]/\\&/g')
  sed -e "s|^WEB=.*|WEB=$web|" -e "s|^API=.*|API=$api|" .env.remote.example
}

start_layered() { # WEB API
  if $dry_run; then
    echo "# --dry-run: .env.remote would be written as follows; Docker not touched."
    render_env "$1" "$2"
    return
  fi
  render_env "$1" "$2" > .env.remote
  echo "Wrote .env.remote (WEB=$1, API=$2)."
  docker compose --env-file .env --env-file .env.remote up -d -V
  print_next_steps "$1"
}

print_next_steps() { # WEB
  cat <<EOF

Open on the other device:   $1
On this machine too, use    $1   (not http://localhost:$WEB_PORT): the
session cookie is bound to NEXTAUTH_URL, which is now that address. Use a
fresh or incognito window after switching, so no cookie from the previous
address is in the way.
Back to localhost:          scripts/remote-up.sh off
EOF
}

# ── ngrok ────────────────────────────────────────────────────────────────────

ngrok_config_path() {
  case "$(uname -s)" in
    Darwin) echo "$HOME/Library/Application Support/ngrok/ngrok.yml" ;;
    *) echo "${XDG_CONFIG_HOME:-$HOME/.config}/ngrok/ngrok.yml" ;;
  esac
}

print_tunnel_yaml() {
  cat >&2 <<EOF
remote-up: the ngrok configuration needs two tunnels, \`web\` (port $WEB_PORT) and
\`api\` (port $API_PORT). Add this to "$(ngrok_config_path)" (keep the existing
\`version\` and authtoken lines) and run again:

tunnels:
  web:
    proto: http
    addr: $WEB_PORT
  api:
    proto: http
    addr: $API_PORT

A free account gives one static domain (https://dashboard.ngrok.com/domains);
put it on \`web\` as \`domain: <name>.ngrok-free.app\` so the address the
session cookie is bound to stops changing between runs.
EOF
}

ngrok_api_up() { curl -sf "$NGROK_API" > /dev/null 2>&1; }

# The public URL of the tunnel whose upstream is the given local port, from the
# agent's local API (config.addr is "http://localhost:3000" or "3000").
tunnel_url() { # PORT
  local json
  json=$(curl -sf "$NGROK_API") || return 1
  if command -v jq > /dev/null; then
    printf '%s' "$json" | jq -r --arg port "$1" \
      '[.tunnels[] | select((.config.addr | tostring) | test(":" + $port + "$|^" + $port + "$")) | .public_url] | first // empty'
  elif command -v python3 > /dev/null; then
    printf '%s' "$json" | python3 -c '
import json, sys
port = sys.argv[1]
for t in json.load(sys.stdin).get("tunnels", []):
    addr = str(t.get("config", {}).get("addr", ""))
    if addr == port or addr.endswith(":" + port):
        print(t["public_url"])
        break
' "$1"
  else
    die "needs jq or python3 to read the ngrok tunnel list"
  fi
}

ngrok_mode() {
  command -v ngrok > /dev/null || die "ngrok is not on PATH — https://ngrok.com/download, then \`ngrok config add-authtoken <token>\`"
  local cfg
  cfg=$(ngrok config check 2>&1 | sed -n 's/^Valid configuration file at //p' | head -1)
  if [ -z "$cfg" ]; then
    echo "remote-up: ngrok has no valid configuration (\`ngrok config check\` failed) — run \`ngrok config add-authtoken <token>\` first." >&2
    print_tunnel_yaml
    exit 1
  fi
  if ! grep -Eq '^[[:space:]]+web:' "$cfg" || ! grep -Eq '^[[:space:]]+api:' "$cfg"; then
    print_tunnel_yaml
    exit 1
  fi

  local started=false
  if ! ngrok_api_up; then
    echo "Starting ngrok (all tunnels of $cfg; log: $NGROK_LOG)…"
    nohup ngrok start --all --log "$NGROK_LOG" > /dev/null 2>&1 &
    started=true
    local i
    for i in $(seq 1 30); do
      ngrok_api_up && break
      sleep 1
    done
    ngrok_api_up || die "ngrok did not answer on $NGROK_API within 30 s — see $NGROK_LOG"
  fi

  # The tunnels register a moment after the agent's API is up.
  local web="" api="" i
  for i in $(seq 1 30); do
    web=$(tunnel_url "$WEB_PORT")
    api=$(tunnel_url "$API_PORT")
    [ -n "$web" ] && [ -n "$api" ] && break
    sleep 1
  done
  if [ -z "$web" ] || [ -z "$api" ]; then
    echo "remote-up: ngrok is running but has no tunnel to port $WEB_PORT and/or $API_PORT (web='$web', api='$api')." >&2
    $started && echo "remote-up: it was started by this script — stop it with: pkill -f 'ngrok start'" >&2
    print_tunnel_yaml
    exit 1
  fi
  echo "ngrok tunnels: web=$web  api=$api"
  if [ "$web" = "$api" ]; then
    cat >&2 <<EOF
remote-up: both tunnels came up on the SAME URL ($web).
ngrok pools endpoints that share a URL and spreads requests across them at
random, so the stack would answer from port $WEB_PORT or $API_PORT by chance. This is
what a free account does with two tunnels and no \`domain:\` — it has one
domain. The two-tunnel flow needs a second domain on the account (put each on
its tunnel as \`domain:\`), or the one-origin setup of TODO.md D20.
.env.remote was not written.
EOF
    $started && echo "remote-up: ngrok was started by this script — stop it with: pkill -f 'ngrok start'" >&2
    exit 1
  fi
  start_layered "$web" "$api"
}

# ── modes ────────────────────────────────────────────────────────────────────

case "$mode" in
  lan)
    ip=$(host_ip)
    start_layered "http://$ip:$WEB_PORT" "http://$ip:$API_PORT"
    ;;
  ngrok)
    ngrok_mode
    ;;
  off)
    docker compose up -d -V
    cat <<EOF

Back on plain .env: open http://localhost:$WEB_PORT in a fresh or incognito
window (the cookie set for the remote address does not apply here).
.env.remote is kept on disk and ignored until the layered command runs again.
EOF
    if ngrok_api_up; then
      echo "ngrok is still running — stop it with: pkill -f 'ngrok start'"
    fi
    ;;
esac
