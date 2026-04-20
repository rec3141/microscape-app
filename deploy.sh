#!/bin/bash
# Quick deploy: push to GitHub, then pull/build/restart on a remote host.
#
# Usage:   ./deploy.sh
# Config:  override defaults via env vars or a local .deploy.env file
#
#   REMOTE      ssh host alias or user@host       (default: arbutus)
#   APP_DIR     install path on the remote        (default: /opt/microscape-app)
#   SERVICE     systemd unit to restart           (default: microscape-app)
#   BRANCH      branch to push and pull           (default: main)

set -euo pipefail

# Load local overrides if present (gitignored)
if [ -f ".deploy.env" ]; then
    set -a; . ./.deploy.env; set +a
fi

REMOTE="${REMOTE:-arbutus}"
APP_DIR="${APP_DIR:-/opt/microscape-app}"
SERVICE="${SERVICE:-microscape-app}"
BRANCH="${BRANCH:-main}"

echo "=== Deploying microscape-app ==="
echo "    remote:  $REMOTE"
echo "    app dir: $APP_DIR"
echo "    service: $SERVICE"
echo "    branch:  $BRANCH"
echo

echo ">> Pushing to GitHub..."
git push origin "$BRANCH"

echo ">> Pulling and building on $REMOTE..."
ssh "$REMOTE" APP_DIR="$APP_DIR" SERVICE="$SERVICE" BRANCH="$BRANCH" bash <<'EOF'
set -euo pipefail
cd "$APP_DIR"
git pull --ff-only origin "$BRANCH"
npm ci --production=false
npm run build
sudo systemctl restart "$SERVICE"
sudo systemctl status --no-pager "$SERVICE" | head -6
EOF

echo
echo "=== Deploy complete ==="
