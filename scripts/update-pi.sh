#!/usr/bin/env bash
# Update Spool on the Pi: pull, rebuild only if something changed, restart, check it answers.
#
#   cd ~/spool && ./scripts/update-pi.sh          # normal update
#   ./scripts/update-pi.sh --force                # rebuild even if git says nothing changed
#
# No questions — settings stay as setup-pi.sh left them. Re-run setup-pi.sh only to change settings.
set -euo pipefail
cd "$(dirname "$0")/.."

if docker info >/dev/null 2>&1; then DOCKER=(docker); else DOCKER=(sudo docker); fi
env_get() { [[ -f $2 ]] && sed -n "s/^$1=//p" "$2" | tail -1 | sed -e "s/^[\"']//" -e "s/[\"']$//" || true; }

START=$SECONDS
# The commit that's actually running (written after each successful deploy). Comparing against
# this — not just what `git pull` fetched — means a manual `git pull` still gets deployed.
STAMP=.deployed-commit
DEPLOYED=$(cat "$STAMP" 2>/dev/null || true)
git pull --ff-only --quiet
HEAD_NOW=$(git rev-parse HEAD)

if [[ $DEPLOYED == "$HEAD_NOW" && ${1:-} != --force ]]; then
  echo "Already up to date ($(git log -1 --format='%h %s'))."
  exit 0
fi
if [[ -n $DEPLOYED ]] && git cat-file -e "$DEPLOYED" 2>/dev/null; then
  git --no-pager log --oneline "$DEPLOYED..$HEAD_NOW"
fi

# Builds while the old version keeps serving; the swap at the end takes a few seconds.
"${DOCKER[@]}" compose up -d --build --remove-orphans

LISTEN=$(env_get SPOOL_LISTEN .env); PORT=$(env_get SPOOL_PORT .env)
HOST=$([[ -z $LISTEN || $LISTEN == 0.0.0.0 ]] && echo 127.0.0.1 || echo "$LISTEN")
URL="http://$HOST:${PORT:-3000}/"
for _ in $(seq 1 45); do curl -fs -o /dev/null "$URL" && break; sleep 2; done
curl -fs -o /dev/null "$URL" || { echo "✗ Not answering at $URL — check: docker compose logs"; exit 1; }

echo "$HEAD_NOW" >"$STAMP"
# Old image layers pile up with every build; drop the dangling ones.
"${DOCKER[@]}" image prune -f >/dev/null
echo "✓ Updated and running ($((SECONDS - START))s)"
