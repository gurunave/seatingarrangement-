#!/bin/sh
# Update Seat Draft to the latest code and restart it. Safe to run any time:
# your saved layout (data/layout.json) and your service settings (passcode,
# timers in /etc/systemd/system/seat-draft.service) are not touched.
#
#   Run inside the container, as root:
#     sh /opt/seat-draft/deploy/update.sh
#
# Works however the app was first installed (git clone or copied folder): it
# fetches a fresh copy of the branch and hands it to install.sh, which copies
# the code over /opt/seat-draft, reinstalls dependencies, and restarts the
# service.
set -eu

REPO_URL="${REPO_URL:-https://github.com/gurunave/seatingarrangement-.git}"
BRANCH="${BRANCH:-claude/team-seating-game-98ldlr}"

[ "$(id -u)" = 0 ] || { echo "Run as root (inside the container)."; exit 1; }

TMP="$(mktemp -d /tmp/seat-draft-update.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

echo "== Fetching the latest code =="
if ! git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$TMP/src" 2>&1; then
  cat <<'MSG'

Could not reach GitHub from this container (often the DNS filtering we saw
before). Two ways forward:

  1) Point the container at a public DNS server and re-run this script:
       printf "nameserver 8.8.8.8\n" > /etc/resolv.conf

  2) Or update via your laptop: download the branch ZIP in a browser,
     extract it, copy it across, and run its installer:
       scp -r <extracted-folder> root@<container-ip>:/root/seat-draft-new
       ssh root@<container-ip> "cd /root/seat-draft-new && sh deploy/install.sh"
MSG
  exit 1
fi

sh "$TMP/src/deploy/install.sh"
