#!/usr/bin/env bash
# Reach the local stack from another device (README "Access from another
# device", TODO.md D19/D20): writes .env.remote from .env.remote.example and
# starts the stack with that file layered on .env. The stack is ONE URL — the
# browser reaches the API through the frontend's own origin (/backend/*).
#
#   scripts/remote-up.sh lan   [--dry-run]   same Wi-Fi, via this host's LAN IP
#   scripts/remote-up.sh ngrok [--dry-run]   from anywhere, via one ngrok tunnel
#   scripts/remote-up.sh off                 back to localhost (plain .env)
#
# --dry-run prints the .env.remote it would write and touches neither that
# file nor Docker. REMOTE_HOST_IP=<ip> replaces the LAN detection (CI uses it).
# The script never edits .env and refuses to run without one.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

WEB_PORT=3000
# The agent's local API; overridable so scripts/tests/remote-env.sh can serve a
# canned tunnel list instead of running ngrok.
NGROK_API=${NGROK_API:-http://127.0.0.1:4040/api/tunnels}
NGROK_LOG=${TMPDIR:-/tmp}/spacerental-ngrok.log

die() { echo "remote-up: $*" >&2; exit 1; }
usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; }

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

# The .env.remote for a WEB URL: the template with its one line replaced, so
# every derived value stays the template's (one source of truth).
render_env() {
  local web
  web=$(printf '%s' "$1" | sed 's/[&|\\]/\\&/g')
  sed -e "s|^WEB=.*|WEB=$web|" .env.remote.example
}

start_layered() { # WEB
  if $dry_run; then
    echo "# --dry-run: .env.remote would be written as follows; Docker not touched."
    render_env "$1"
    return
  fi
  render_env "$1" > .env.remote
  echo "Wrote .env.remote (WEB=$1)."
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
remote-up: the ngrok configuration needs one tunnel, \`web\`, to port $WEB_PORT.
Add this to "$(ngrok_config_path)" (keep the existing \`version\` and authtoken
lines) and run again:

tunnels:
  web:
    proto: http
    addr: $WEB_PORT
    # One-off: reserve the free static domain at
    # https://dashboard.ngrok.com/domains and name it here, so the address
    # (the one the session cookie is bound to) is the same on every run.
    domain: <your-domain>.ngrok-free.dev
EOF
}

ngrok_api_up() { curl -sf "$NGROK_API" > /dev/null 2>&1; }

# The public URL of the tunnel whose upstream is the given local port, from the
# agent's local API (config.addr is "http://localhost:3000" or "3000"). With a
# `domain:` in ngrok.yml this is that domain, so the URL is stable across runs.
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

# "name (addr)" of every tunnel on URL that is not the one to PORT.
tunnels_sharing() { # URL PORT
  local json
  json=$(curl -sf "$NGROK_API") || return 0
  if command -v jq > /dev/null; then
    printf '%s' "$json" | jq -r --arg url "$1" --arg port "$2" \
      '[.tunnels[] | select(.public_url == $url) | select((.config.addr | tostring) | test(":" + $port + "$|^" + $port + "$") | not) | "\(.name) (\(.config.addr))"] | join(", ")'
  else
    printf '%s' "$json" | python3 -c '
import json, sys
url, port = sys.argv[1], sys.argv[2]
names = []
for t in json.load(sys.stdin).get("tunnels", []):
    addr = str(t.get("config", {}).get("addr", ""))
    if t.get("public_url") == url and not (addr == port or addr.endswith(":" + port)):
        names.append(f"{t.get(\"name\")} ({addr})")
print(", ".join(names))
' "$1" "$2"
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
  if ! grep -Eq '^[[:space:]]+web:' "$cfg"; then
    print_tunnel_yaml
    exit 1
  fi
  if ! grep -Eq '^[[:space:]]+domain:' "$cfg"; then
    echo "note: no \`domain:\` in $cfg — the URL changes at every ngrok start. Reserve the free static domain (https://dashboard.ngrok.com/domains) and set it on the \`web\` tunnel to keep it." >&2
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

  # The tunnel registers a moment after the agent's API is up.
  local web="" i
  for i in $(seq 1 30); do
    web=$(tunnel_url "$WEB_PORT")
    [ -n "$web" ] && break
    sleep 1
  done
  if [ -z "$web" ]; then
    echo "remote-up: ngrok is running but has no tunnel to port $WEB_PORT." >&2
    $started && echo "remote-up: it was started by this script — stop it with: pkill -f 'ngrok start'" >&2
    print_tunnel_yaml
    exit 1
  fi
  echo "ngrok tunnel: web=$web"
  # A free account has one domain: a second tunnel without its own `domain:`
  # (the `api` tunnel the two-URL setup of D19 needed) comes up on the SAME
  # URL, and ngrok pools them — requests would reach port 3000 or 8000 at
  # random. One tunnel is all the stack needs now.
  local others
  others=$(tunnels_sharing "$web" "$WEB_PORT")
  if [ -n "$others" ]; then
    cat >&2 <<EOF
remote-up: another tunnel shares the URL $web: $others
ngrok pools tunnels on one URL and spreads requests across them at random, so
the stack would answer from the wrong port by chance. Remove that tunnel from
"$cfg" (the stack needs only \`web\`, to port $WEB_PORT) and run again.
.env.remote was not written.
EOF
    $started && echo "remote-up: ngrok was started by this script — stop it with: pkill -f 'ngrok start'" >&2
    exit 1
  fi
  start_layered "$web"
}

# ── modes ────────────────────────────────────────────────────────────────────

case "$mode" in
  lan)
    start_layered "http://$(host_ip):$WEB_PORT"
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
