#!/usr/bin/env bash
# Spool — set up and start on a Raspberry Pi (or any Debian-ish Linux box).
#
#   cd ~/spool && ./scripts/setup-pi.sh
#
# Safe to re-run: keeps existing settings unless you choose to change them.
# Never writes to the archive: it only lists it, and Docker mounts it read-only.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '\n  \033[31m✗ %s\033[0m\n\n' "$*" >&2; exit 1; }
ask() { local a; read -r -p "  $1 " a </dev/tty; printf '%s' "$a"; }
yes_no() { local a; a=$(ask "$1 [y/N]"); [[ $a =~ ^[Yy] ]]; }
# Read KEY from an env file (no sourcing — values may contain spaces/specials)
env_get() { [[ -f $2 ]] && sed -n "s/^$1=//p" "$2" | tail -1 | sed -e "s/^[\"']//" -e "s/[\"']$//" || true; }

APP_UID=1000 # the container's "node" user

# ---------------------------------------------------------------- 1. Docker
bold "1/7  Docker"
if ! command -v docker >/dev/null; then
  yes_no "Docker isn't installed. Install it now (official get.docker.com script)?" || die "Docker is required."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  ok "Docker installed (log out and back in later to use docker without sudo)"
fi
if docker info >/dev/null 2>&1; then DOCKER=(docker); else DOCKER=(sudo docker); fi
"${DOCKER[@]}" compose version >/dev/null 2>&1 || die "Docker Compose plugin missing (sudo apt install docker-compose-plugin)."
ok "$("${DOCKER[@]}" --version)"

# ---------------------------------------------------------------- 2. Archive
bold "2/7  Film archive (mounted read-only)"
ARCHIVE=$(env_get SPOOL_ARCHIVE_HOST .env)
if [[ -n $ARCHIVE ]] && ! yes_no "Archive is set to \"$ARCHIVE\". Change it?"; then
  :
else
  if command -v testparm >/dev/null; then
    echo "  Samba shares on this machine:"
    testparm -s 2>/dev/null | awk '/^\[/{s=$0} /path =/{print "    " s "  " $3}' || true
  fi
  while :; do
    ARCHIVE=$(ask "Full path to the film folder (e.g. /srv/nas/000 FILM 2.0):")
    ARCHIVE=${ARCHIVE%/}
    [[ -d $ARCHIVE ]] && break
    warn "Not a folder: $ARCHIVE"
  done
fi
[[ -d $ARCHIVE ]] || die "Archive folder not found: $ARCHIVE"
# `|| true`: head closes the pipe early on big archives, which makes find exit non-zero (SIGPIPE)
JPGS=$( (find "$ARCHIVE" -maxdepth 4 -type f \( -iname '*.jpg' -o -iname '*.jpeg' \) 2>/dev/null || true) | head -2000 | wc -l)
JPGS=${JPGS// /}
ok "Found $( ((JPGS >= 2000)) && echo '2000+' || echo "$JPGS") JPEGs near the top of $ARCHIVE"
if id -u "$APP_UID" >/dev/null 2>&1 && ! sudo -u "#$APP_UID" test -r "$ARCHIVE" -a -x "$ARCHIVE"; then
  die "User $APP_UID (the app inside Docker) can't read $ARCHIVE. Fix its permissions, then re-run."
fi
ok "Readable by the app user ($APP_UID)"

# ---------------------------------------------------------------- 3. Network
bold "3/7  Who can reach it"
LISTEN=$(env_get SPOOL_LISTEN .env)
WG_IP=$(ip -4 -o addr show wg0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 || true)
if [[ -z $LISTEN ]] || yes_no "Listening on ${LISTEN}. Change it?"; then
  if [[ -n $WG_IP ]]; then
    echo "  WireGuard (wg0) address found: $WG_IP"
    if yes_no "Listen on WireGuard ($WG_IP), so only devices on your VPN can open it?"; then LISTEN=$WG_IP; fi
  fi
  if [[ -z $LISTEN ]]; then
    echo "  Leave blank for this machine only (e.g. behind 'tailscale serve')."
    LISTEN=$(ask "IP address to listen on:")
    LISTEN=${LISTEN:-127.0.0.1}
  fi
fi
PORT=$(env_get SPOOL_PORT .env)
PORT=${PORT:-3000}
if [[ $PORT != 80 ]]; then
  if ss -ltnH 'sport = :80' 2>/dev/null | grep -q .; then
    warn "Port 80 is already used by another program, so Spool stays on :$PORT"
  elif yes_no "Use port 80, so addresses don't need \":$PORT\" (e.g. http://pi5.local)?"; then
    PORT=80
  fi
fi
url() { [[ $PORT == 80 ]] && echo "http://$1" || echo "http://$1:$PORT"; }
ok "Will listen on $LISTEN, port $PORT"

# .env is read by docker compose (paths + listen address only; no secrets)
{
  echo "# Written by scripts/setup-pi.sh"
  echo "SPOOL_ARCHIVE_HOST=\"$ARCHIVE\""
  echo "SPOOL_LISTEN=$LISTEN"
  echo "SPOOL_PORT=$PORT"
} >.env
ok "Wrote .env"

# ---------------------------------------------------------------- 4. Private view
bold "4/7  Private view + data"
mkdir -p data backups
if [[ $(stat -c %u data) != "$APP_UID" || $(stat -c %u backups) != "$APP_UID" ]]; then
  sudo chown -R "$APP_UID:$APP_UID" data backups
fi
ok "data/ and backups/ ready (owned by $APP_UID)"
[[ -f backups/privacy-latest.json ]] && ok "Found a private-list backup ($(grep -c '"private": 1' backups/privacy-latest.json || true) private photos)"

if [[ ! -f .env.local ]]; then
  if yes_no "No .env.local (copy it with scripts/send-to-pi.sh). Create one here with a private-view password?"; then
    SUGGEST=$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 10 || true)
    UPATH=$(ask "Unlisted unlock path [$SUGGEST]:")
    UPATH=${UPATH:-$SUGGEST}
    while :; do
      read -r -s -p "  Password: " PW </dev/tty; echo
      read -r -s -p "  Again: " PW2 </dev/tty; echo
      [[ $PW == "$PW2" && -n $PW && $PW != *"'"* ]] && break
      warn "Didn't match, was empty, or contained a single quote. Try again."
    done
    (umask 077 && printf "SPOOL_UNLOCK_PATH=%s\nSPOOL_PASSWORD='%s'\n" "$UPATH" "$PW" >.env.local)
    ok "Wrote .env.local (private view at /$UPATH)"
  else
    : >.env.local
    warn "Private view disabled (empty .env.local)"
  fi
fi
chmod 600 .env.local
if [[ -f backups/privacy-latest.json ]] && ! grep -q '^SPOOL_PRIVACY_REQUIRED=1' .env.local; then
  echo "SPOOL_PRIVACY_REQUIRED=1" >>.env.local
  ok "Enabled SPOOL_PRIVACY_REQUIRED=1 (guests see nothing if the private list ever goes missing)"
fi

# ---------------------------------------------------------------- 5. Boot order
bold "5/7  Start on boot"
if [[ $LISTEN == "$WG_IP" && -n $WG_IP ]]; then
  if systemctl list-unit-files 'wg-quick@*' >/dev/null 2>&1 && systemctl is-enabled wg-quick@wg0 >/dev/null 2>&1; then
    DROPIN=/etc/systemd/system/docker.service.d/after-wireguard.conf
    if [[ ! -f $DROPIN ]]; then
      sudo mkdir -p "$(dirname "$DROPIN")"
      printf '[Unit]\nAfter=wg-quick@wg0.service\nWants=wg-quick@wg0.service\n' | sudo tee "$DROPIN" >/dev/null
      sudo systemctl daemon-reload
    fi
    ok "Docker starts after WireGuard (so $WG_IP exists when Spool binds to it)"
  else
    warn "WireGuard isn't the wg-quick@wg0 service — make sure it's up before Docker at boot."
  fi
else
  ok "Nothing extra needed"
fi

# ---------------------------------------------------------------- 6. Friendly name
bold "6/7  A nicer name on your home network"
MDNS_NAME=""
if [[ $LISTEN == 127.0.0.1 || ( -n $WG_IP && $LISTEN == "$WG_IP" ) ]]; then
  ok "Skipped (Spool isn't listening on your home network)"
elif systemctl is-enabled spool-mdns >/dev/null 2>&1; then
  MDNS_NAME=$(sed -n 's|^ExecStart=/usr/local/bin/spool-mdns ||p' /etc/systemd/system/spool-mdns.service)
  ok "Already announced as $MDNS_NAME"
elif yes_no "Also announce it as spool.local, so http://spool.local works at home? (doesn't rename the Pi)"; then
  echo "  Plain names (spool) work on the most devices; dotted ones (spool.pi5) are less reliable on Windows/Android."
  while :; do
    NAME=$(ask "Name, without .local [spool]:")
    NAME=${NAME:-spool}
    NAME=${NAME%.local}
    [[ $NAME =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$ ]] && break
    warn "Use lowercase letters, numbers and hyphens (dots between parts are OK)."
  done
  MDNS_NAME="$NAME.local"
  systemctl is-active avahi-daemon >/dev/null 2>&1 || die "avahi-daemon isn't running (it's what makes pi5.local work)."
  command -v avahi-publish >/dev/null || sudo apt-get install -y avahi-utils >/dev/null
  sudo tee /usr/local/bin/spool-mdns >/dev/null <<'SH'
#!/bin/sh
# Announce an extra mDNS name (e.g. spool.local) for this machine's home-network address.
# Installed by spool's scripts/setup-pi.sh. Doesn't change the machine's own hostname.
IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}')
[ -n "$IP" ] || { echo "spool-mdns: no network address yet" >&2; exit 1; }
exec /usr/bin/avahi-publish -a -R "$1" "$IP"
SH
  sudo chmod 755 /usr/local/bin/spool-mdns
  sudo tee /etc/systemd/system/spool-mdns.service >/dev/null <<UNIT
[Unit]
Description=Announce $MDNS_NAME on the local network (Spool)
After=avahi-daemon.service network-online.target
Wants=network-online.target
Requires=avahi-daemon.service

[Service]
ExecStart=/usr/local/bin/spool-mdns $MDNS_NAME
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable --now spool-mdns >/dev/null 2>&1
  sleep 1
  systemctl is-active spool-mdns >/dev/null && ok "Announcing $MDNS_NAME" || warn "spool-mdns didn't start — check: journalctl -u spool-mdns"
else
  ok "Skipped"
fi

# ---------------------------------------------------------------- 7. Build + start
bold "7/7  Build and start (first build takes a few minutes)"
"${DOCKER[@]}" compose up -d --build
git rev-parse HEAD >.deployed-commit 2>/dev/null || true # lets update-pi.sh know what's running

echo "  Waiting for the app…"
CHECK_HOST=$([[ $LISTEN == 0.0.0.0 ]] && echo 127.0.0.1 || echo "$LISTEN")
for _ in $(seq 1 60); do
  curl -fs -o /dev/null "$(url "$CHECK_HOST")/" && break
  sleep 2
done
curl -fs -o /dev/null "$(url "$CHECK_HOST")/" || die "Not answering on $(url "$CHECK_HOST") — check: docker compose logs"
ok "Running"

# Read-only check without writing anything: ask Docker how /archive is mounted.
RW=$("${DOCKER[@]}" inspect spool --format '{{range .Mounts}}{{if eq .Destination "/archive"}}{{.RW}}{{end}}{{end}}')
[[ $RW == false ]] || { "${DOCKER[@]}" compose stop; die "/archive is NOT read-only (RW=$RW). Stopped Spool."; }
ok "Archive is mounted read-only"

STATUS=$("${DOCKER[@]}" compose exec -T spool npm run -s privacy:status 2>/dev/null || true)
if grep -q 'lockdown: true' <<<"$STATUS"; then
  warn "Privacy LOCKDOWN — guests see nothing. Restore with: docker compose exec spool npm run privacy:restore"
else
  ok "Private list OK ($(grep -o 'actual: [0-9]*' <<<"$STATUS" | cut -d' ' -f2) markings)"
fi

UNLOCK=$(env_get SPOOL_UNLOCK_PATH .env.local)
LAN_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}' || true)
bold "Done — open it at:"
if [[ $LISTEN == 0.0.0.0 ]]; then
  [[ -n $MDNS_NAME ]] && echo "  At home:       $(url "$MDNS_NAME")"
  echo "  At home:       $(url "$(hostname).local")   or   $(url "$LAN_IP")"
  [[ -n $WG_IP ]] && echo "  Via WireGuard: $(url "$WG_IP")"
else
  [[ -n $MDNS_NAME ]] && echo "  At home:       $(url "$MDNS_NAME")"
  echo "  Address:       $(url "$LISTEN")"
fi
[[ -n $UNLOCK ]] && echo "  Private view:  add /$UNLOCK to any of these"
echo "  Logs:          docker compose logs -f"
echo "  Update later:  git pull && docker compose up -d --build"
echo "  (No thumbnails copied? The first index runs in the background — photos appear as it goes.)"
echo
