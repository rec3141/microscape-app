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
# The running server keeps serving while the new version builds: dependencies are installed in a separate directory
# (only when package-lock.json changed) and the app is built into build.next. Then the directories are swapped and the
# service restarted, so the site is down only while node starts. If the new build does not answer, the old one goes back.
ssh "$REMOTE" APP_DIR="$APP_DIR" SERVICE="$SERVICE" BRANCH="$BRANCH" HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3100/}" bash <<'EOF'
set -euo pipefail
cd "$APP_DIR"
git pull --ff-only origin "$BRANCH"
want=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ "$(cat node_modules/.deploy-lock.sha 2>/dev/null)" != "$want" ]; then
    echo ">> package-lock.json changed: installing dependencies beside the running ones"
    rm -rf .deploy-deps && mkdir .deploy-deps && cp package.json package-lock.json .deploy-deps/
    (cd .deploy-deps && npm ci --production=false)
    echo "$want" > .deploy-deps/node_modules/.deploy-lock.sha
    rm -rf node_modules.old
    if [ -d node_modules ]; then mv node_modules node_modules.old; fi
    mv .deploy-deps/node_modules node_modules && rm -rf .deploy-deps
fi
rm -rf build.next
BUILD_OUT=build.next npm run build
rm -rf build.old
mv build build.old && mv build.next build
sudo systemctl restart "$SERVICE"
ok=
for k in $(seq 40); do
    if curl -fsS -o /dev/null --max-time 2 "$HEALTH_URL"; then ok=1; break; fi
    sleep 0.25
done
if [ -z "$ok" ]; then
    echo "!! the new build does not answer at $HEALTH_URL: putting the previous one back" >&2
    rm -rf build.failed && mv build build.failed && mv build.old build
    sudo systemctl restart "$SERVICE"
    exit 1
fi
echo ">> answering after $k checks; the previous build is kept in build.old"
rm -rf node_modules.old
sudo systemctl status --no-pager "$SERVICE" | head -6
EOF

echo
echo "=== Deploy complete ==="
