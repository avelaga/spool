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
bold "1/6  Docker"
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
bold "2/6  Film archive (mounted read-only)"
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
bold "3/6  Who can reach it"
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
ok "Will listen on $LISTEN:3000"

# .env is read by docker compose (paths + listen address only; no secrets)
{
  echo "# Written by scripts/setup-pi.sh"
  echo "SPOOL_ARCHIVE_HOST=\"$ARCHIVE\""
  echo "SPOOL_LISTEN=$LISTEN"
} >.env
ok "Wrote .env"

# ---------------------------------------------------------------- 4. Private view
bold "4/6  Private view + data"
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
bold "5/6  Start on boot"
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

# ---------------------------------------------------------------- 6. Build + start
bold "6/6  Build and start (first build takes a few minutes)"
"${DOCKER[@]}" compose up -d --build

echo "  Waiting for the app…"
for _ in $(seq 1 60); do
  curl -fs -o /dev/null "http://$LISTEN:3000/" && break
  sleep 2
done
curl -fs -o /dev/null "http://$LISTEN:3000/" || die "Not answering on http://$LISTEN:3000 — check: docker compose logs"
ok "Running at http://$LISTEN:3000"

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
bold "Done"
echo "  Open:          http://$LISTEN:3000"
[[ -n $UNLOCK ]] && echo "  Private view:  http://$LISTEN:3000/$UNLOCK"
echo "  Logs:          docker compose logs -f"
echo "  Update later:  git pull && docker compose up -d --build"
echo "  (No thumbnails copied? The first index runs in the background — photos appear as it goes.)"
echo
