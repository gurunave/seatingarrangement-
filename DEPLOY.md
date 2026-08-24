# Deploying Seat Draft on your own server

The app is one Node process on one port. It needs Node 18+, and writes exactly
one file (`data/layout.json` — your saved room layout) that should survive
restarts. Pick **one** of the options below.

## Option 0 — LXC container (Proxmox / LXD): the simplest of all

An LXC **is** already a container, so skip Docker — nesting it inside LXC adds
setup for no benefit. Create a minimal container and run one script:

1. Create the container: Debian 12 or Ubuntu 22.04+ template, **512 MB RAM /
   4 GB disk is plenty**, unprivileged is fine, give it a network address.
2. Inside it, as root:

   ```bash
   apt update && apt install -y curl
   curl -fsSL https://raw.githubusercontent.com/gurunave/seatingarrangement-/claude/team-seating-game-98ldlr/deploy/install.sh | sh
   ```

That installs Node from the distro's own packages (Debian 12 and Ubuntu 24.04
both ship Node 18+ — no third-party repo needed), fetches the app to
`/opt/seat-draft`, creates a locked-down `seatdraft` service user, installs the
systemd service, starts it, and prints the three URLs. **Safe to re-run any
time** — that's also how you upgrade.

Prefer to read before you pipe to sh? Clone the repo inside the container and
run `./deploy/install.sh` — it installs the local checkout instead of cloning.

To change port or paths: `PORT=8080 APP_DIR=/srv/seat-draft sh deploy/install.sh`.

## Option A — Docker (if your server already runs Docker)

```bash
git clone <this repo> && cd seatingarrangement-
docker compose up -d
```

That builds the image, starts it on port 3000, restarts it if it crashes or the
server reboots, and keeps the layout in a named volume across upgrades. To
upgrade later: `git pull && docker compose up -d --build`.

Without compose:

```bash
docker build -t seat-draft .
docker run -d --name seat-draft --restart unless-stopped \
  -p 3000:3000 -v seat-draft-data:/app/data seat-draft
```

## Option B — plain Node + systemd (no Docker needed)

```bash
sudo git clone <this repo> /opt/seat-draft
cd /opt/seat-draft
sudo npm ci --omit=dev
sudo chown -R www-data:www-data /opt/seat-draft/data
sudo cp deploy/seat-draft.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now seat-draft
```

Check it with `systemctl status seat-draft` and `curl localhost:3000/api/layout`.
To upgrade later: `git pull && sudo npm ci --omit=dev && sudo systemctl restart seat-draft`.

## Reaching it from phones

- **Same office network:** open port 3000 in the firewall
  (`sudo ufw allow 3000`) and phones use `http://<server-ip>:3000`. Done —
  no proxy needed.
- **Nice URL and/or HTTPS:** put nginx in front using `deploy/nginx.conf`.
  Two lines in it are load-bearing: the `Upgrade`/`Connection` headers
  (without them WebSockets fail — phones join and then never update) and
  `X-Forwarded-Proto` (the QR code uses it to encode https correctly).
  Point a DNS record at the server, then `certbot --nginx` for TLS.

## Before game day

1. Open `http://<server>:3000/setup` and lay out your real desks. Saved to
   `data/layout.json`, reused every quarter.
2. Do a 5-minute dry run **from the actual office WiFi with 2–3 phones**.
   Corporate/guest WiFi sometimes blocks arbitrary ports or WebSockets —
   that's the one failure mode a test on your desk won't catch. If the office
   WiFi is hostile, phones on mobile data work fine when the server has a
   public address.

## Knobs

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | Port the app listens on |
| `SPRINT_SECONDS` | 90 | Length of the maths sprint |
| `DRAFT_SECONDS` | 15 | Per-person pick timer in the draft |
