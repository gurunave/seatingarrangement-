#!/bin/sh
# One-shot installer for Seat Draft on a fresh Debian 12 / Ubuntu 22.04+ system
# — written for a Proxmox/LXD container but works on any plain box.
#
#   Run inside the container, as root:
#     apt update && apt install -y curl
#     curl -fsSL https://raw.githubusercontent.com/gurunave/seatingarrangement-/claude/team-seating-game-98ldlr/deploy/install.sh | sh
#
# Or clone first and run ./deploy/install.sh — it detects that and skips cloning.
# Safe to re-run: it just updates the code and restarts the service.

set -eu

REPO_URL="${REPO_URL:-https://github.com/gurunave/seatingarrangement-.git}"
BRANCH="${BRANCH:-claude/team-seating-game-98ldlr}"
APP_DIR="${APP_DIR:-/opt/seat-draft}"
RUN_USER="${RUN_USER:-seatdraft}"
PORT="${PORT:-3000}"

[ "$(id -u)" = 0 ] || { echo "Run as root (inside the container)."; exit 1; }

echo "== Installing packages (nodejs, npm, git) =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nodejs npm git ca-certificates >/dev/null

NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
[ "$NODE_MAJOR" -ge 18 ] || { echo "Node $NODE_MAJOR is too old (need 18+)."; exit 1; }
echo "   node $(node --version)"

echo "== Fetching the app =="
# When run from inside a checkout, install that checkout; otherwise clone.
SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd || echo /)"
if [ -f "$SCRIPT_DIR/../package.json" ] && [ "$SCRIPT_DIR" != / ]; then
  SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
  if [ "$SRC" != "$APP_DIR" ]; then
    mkdir -p "$APP_DIR"
    cp -r "$SRC/server" "$SRC/public" "$SRC/package.json" "$SRC/package-lock.json" "$SRC/deploy" "$APP_DIR/"
  fi
elif [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
else
  git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

echo "== Installing dependencies =="
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund --silent
mkdir -p data

echo "== Creating service user =="
id "$RUN_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$RUN_USER"
chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR/data"

echo "== Installing the systemd service =="
sed -e "s|^User=.*|User=$RUN_USER|" \
    -e "s|^WorkingDirectory=.*|WorkingDirectory=$APP_DIR|" \
    -e "s|^ReadWritePaths=.*|ReadWritePaths=$APP_DIR/data|" \
    -e "s|^Environment=PORT=.*|Environment=PORT=$PORT|" \
    deploy/seat-draft.service > /etc/systemd/system/seat-draft.service

if [ -d /run/systemd/system ]; then
  systemctl daemon-reload
  systemctl enable --now seat-draft
  systemctl restart seat-draft
  sleep 1
  systemctl --no-pager --lines=0 status seat-draft || true
else
  echo "   (no systemd detected — start manually with: node $APP_DIR/server/index.js)"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo ""
echo "== Done =="
echo "   Setup (your desks):  http://${IP:-<container-ip>}:$PORT/setup"
echo "   Big screen:          http://${IP:-<container-ip>}:$PORT/host"
echo "   Phones:              http://${IP:-<container-ip>}:$PORT"
