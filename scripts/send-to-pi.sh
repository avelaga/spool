#!/usr/bin/env bash
# Copy settings, the index/thumbnails and private-list backups from this machine to the Pi.
#
#   ./scripts/send-to-pi.sh pi@<pi-address>            # → ~/spool on the Pi
#   ./scripts/send-to-pi.sh pi@<pi-address> /opt/spool  # custom folder
#
# Run this before scripts/setup-pi.sh on the Pi. Only touches this repo's data/, backups/, .env.local.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET=${1:?usage: send-to-pi.sh user@pi [remote-folder]}
DEST=${2:-spool}

[[ -d data ]] || { echo "No data/ here — run npm run index first (or skip this; the Pi can index from scratch)."; exit 1; }

# Stop a local server so the database isn't mid-write, then fold the WAL into spool.db.
if pgrep -f "next (start|dev)" >/dev/null; then
  echo "Stopping the local Spool server…"
  pkill -f "next (start|dev)" || true
  sleep 1
fi
node --disable-warning=ExperimentalWarning -e "
  const { DatabaseSync } = require('node:sqlite');
  new DatabaseSync('data/spool.db').exec('PRAGMA wal_checkpoint(TRUNCATE)');" 2>/dev/null || true

echo "Copying to $TARGET:$DEST …"
ssh "$TARGET" "mkdir -p '$DEST'"
FILES=(data backups)
[[ -f .env.local ]] && FILES+=(.env.local)
# Large, mostly-unchanged thumbnail folders: rsync only sends what's new.
rsync -a --stats --exclude 'server.log' --exclude 'index.log' "${FILES[@]}" "$TARGET:$DEST/"

echo
echo "Done. On the Pi:  cd $DEST && ./scripts/setup-pi.sh"
