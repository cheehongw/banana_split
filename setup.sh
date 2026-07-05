#!/usr/bin/env bash
#
# setup.sh — one-shot, idempotent bootstrap for a Banana Split homelab deploy.
#
# Run after cloning, on the Docker host (e.g. a Proxmox LXC with nesting=1):
#
#     ./setup.sh
#
# What it does:
#   1. verifies Docker + the compose plugin (offers to install Docker on Linux),
#   2. creates/completes the production .env — prompts for the 3 required secrets,
#      and only for ones still unset,
#   3. refuses to continue if DEV_USER_ID is set (matches the server's prod guard),
#   4. builds and starts the stack (docker compose up -d --build),
#   5. waits for the app's /health check to pass,
#   6. prints the public URL and the remaining @BotFather steps.
#
# Safe to re-run: an existing, valid .env is left untouched and the compose stack
# is simply rebuilt/reconciled. No secrets are printed back.
set -euo pipefail

# --- pretty logging ------------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; BLU=$'\033[34m'; RST=$'\033[0m'
else
  BOLD=''; RED=''; GRN=''; YLW=''; BLU=''; RST=''
fi
info() { printf '%s==>%s %s\n' "$BLU$BOLD" "$RST" "$*"; }
ok()   { printf '%s  ✓%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '%s  !%s %s\n' "$YLW" "$RST" "$*"; }
die()  { printf '%s  ✗%s %s\n' "$RED" "$RST" "$*" >&2; exit 1; }

# --- locate the repo root (this script's dir) so it works from anywhere --------
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
ENV_FILE="$ROOT/.env"
ENV_EXAMPLE="$ROOT/.env.production.example"

[ -f "$ROOT/docker-compose.yml" ] || die "docker-compose.yml not found — run this from the repo root."
[ -f "$ENV_EXAMPLE" ]             || die ".env.production.example missing — is this a full checkout?"

# sudo only when we're not root and it's available (typical LXC runs as root)
SUDO=''
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO='sudo'
fi

# --- 1. Docker + compose plugin ------------------------------------------------
install_docker() {
  [ "$(uname -s)" = "Linux" ] || die "Auto-install is Linux-only. Install Docker Desktop and re-run."
  if ! command -v curl >/dev/null 2>&1; then
    command -v apt-get >/dev/null 2>&1 || die "curl is required to install Docker; install it and re-run."
    info "Installing curl ..."
    $SUDO apt-get update && $SUDO apt-get install -y curl ca-certificates
  fi
  info "Installing Docker via get.docker.com ..."
  curl -fsSL https://get.docker.com | sh
}

if ! command -v docker >/dev/null 2>&1; then
  warn "Docker is not installed."
  if [ -t 0 ]; then
    read -rp "  Install it now via get.docker.com? [Y/n] " ans
    case "${ans:-Y}" in [Nn]*) die "Docker is required. Install it and re-run." ;; esac
    install_docker
  else
    die "Docker is required (non-interactive shell, not auto-installing). Install it and re-run."
  fi
fi

# pick a docker invocation that can actually reach the daemon
if docker info >/dev/null 2>&1; then
  DOCKER='docker'
elif [ -n "$SUDO" ] && $SUDO docker info >/dev/null 2>&1; then
  DOCKER="$SUDO docker"
  warn "Using sudo for Docker (add yourself to the 'docker' group to avoid this: usermod -aG docker \$USER)."
else
  die "Cannot reach the Docker daemon. Is it running?  (try: $SUDO systemctl start docker)"
fi

# prefer the 'docker compose' plugin; fall back to the standalone docker-compose
if $DOCKER compose version >/dev/null 2>&1; then
  COMPOSE="$DOCKER compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="${SUDO:+$SUDO }docker-compose"
else
  die "No Compose found. Install the 'docker-compose-plugin' package (or the standalone docker-compose)."
fi
ok "Using Compose: $COMPOSE"

# --- 2. .env -------------------------------------------------------------------
get_env() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true; }
set_env() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  [ -f "$ENV_FILE" ] && grep -vE "^$key=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
}

# values that are empty or still the example placeholder count as "unset"
is_placeholder() {
  case "$1" in
    ""|"123456:ABC-DEF..."|"https://banana.your-tailnet.ts.net"|"tskey-auth-...") return 0 ;;
    *) return 1 ;;
  esac
}

prompt_required() {
  local key="$1" desc="$2" cur val=''
  cur="$(get_env "$key")"
  if ! is_placeholder "$cur"; then ok "$key is set."; return; fi
  [ -t 0 ] || die "$key is unset in .env and this shell is non-interactive. Edit .env ($desc) and re-run."
  while [ -z "$val" ]; do read -rp "  Enter $key ($desc): " val; done
  set_env "$key" "$val"
  ok "$key saved to .env"
}

if [ ! -f "$ENV_FILE" ]; then
  info "Creating .env from .env.production.example"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  ok "Wrote $ENV_FILE"
else
  ok ".env already exists — keeping it."
fi

info "Checking required configuration"
prompt_required BOT_TOKEN  "bot token from @BotFather"
prompt_required WEBAPP_URL "public URL, e.g. https://banana.<your-tailnet>.ts.net"
prompt_required TS_AUTHKEY "reusable tskey-auth-... from the Tailscale admin console"

# production boot guard — the server throws if DEV_USER_ID is set under NODE_ENV=production
if [ -n "$(get_env DEV_USER_ID)" ]; then
  die "DEV_USER_ID is set in .env — the server won't boot in production. Remove it and re-run."
fi
ok "No DEV_USER_ID present (production-safe)."

# --- 3. build & start ----------------------------------------------------------
info "Building and starting the stack — docker compose up -d --build"
$COMPOSE up -d --build
ok "Containers are up."

# --- 4. health check (probe the app directly; the Funnel cert may lag) ---------
info "Waiting for the app to report healthy ..."
healthy=''
for _ in $(seq 1 30); do
  if $COMPOSE exec -T app node -e \
      'fetch("http://localhost:3000/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' \
      >/dev/null 2>&1; then
    healthy=1; break
  fi
  sleep 2
done
if [ -n "$healthy" ]; then
  ok "App is healthy (GET /health)."
else
  warn "App did not pass /health within ~60s. Inspect: $COMPOSE logs app"
fi

# --- 5. next steps -------------------------------------------------------------
WEBAPP_URL="$(get_env WEBAPP_URL)"
echo
info "${BOLD}Deploy complete.${RST}"
cat <<EOF

  Public URL : ${WEBAPP_URL}
  Health     : ${WEBAPP_URL}/health   (returns {"ok":true} once the Funnel TLS cert is issued)

  Finish in @BotFather:
    • Menu Button        → URL = ${WEBAPP_URL}
    • Configure Mini App → enable + same URL   (needed for ?startapp deep-link auto-join)

  Handy:
    ${COMPOSE} logs -f app         # app + bot logs
    ${COMPOSE} logs -f tailscale   # Funnel status
    ${COMPOSE} ps                  # container state
    ${COMPOSE} down                # stop the stack

EOF
