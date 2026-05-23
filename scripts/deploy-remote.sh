#!/bin/bash
# Remote deploy script for lanjing ERP.
# Invoked by scripts/deploy.bat via:
#   ssh ... "REPO=... BRANCH=... PM2_NAME=... bash -s" < scripts/deploy-remote.sh
# Env vars expected: REPO, BRANCH, PM2_NAME

set -e

: "${REPO:?REPO env var required}"
: "${BRANCH:?BRANCH env var required}"
: "${PM2_NAME:?PM2_NAME env var required}"

cd "$REPO"

echo "=== 1/8 backup database ==="
if [ -f data/erp.db ]; then
  BK="data/erp.db.bak-$(date +%Y%m%d-%H%M%S)"
  cp data/erp.db "$BK"
  echo " backed up to: $BK ($(du -h "$BK" | awk '{print $1}'))"
else
  echo " (skipped: no db file)"
fi

echo ""
echo "=== 2/8 check local changes ==="
DIRTY=$(git status --porcelain)
if [ -n "$DIRTY" ]; then
  echo " WARN: server has uncommitted changes:"
  echo "$DIRTY" | head -10
  echo " auto-stashed (recover via: git stash list / git stash pop)"
  git stash push -u -m "auto-stash-before-deploy-$(date +%Y%m%d-%H%M%S)"
else
  echo " clean"
fi

echo ""
echo "=== 3/8 remove auto lock files ==="
rm -f package-lock.json client/package-lock.json
echo " OK"

echo ""
echo "=== 4/8 git pull ==="
git config http.version HTTP/1.1
git pull origin "$BRANCH" 2>&1 | tail -20

echo ""
echo "=== 5/8 npm install (root) ==="
npm install --no-audit --no-fund 2>&1 | tail -5

echo ""
echo "=== 6/8 rebuild frontend ==="
cd client
rm -rf dist
npm install --no-audit --no-fund 2>&1 | tail -5
npm run build 2>&1 | tail -10
cd ..

echo ""
echo "=== 7/8 pm2 restart ==="
pm2 restart "$PM2_NAME" --update-env
pm2 ls

echo ""
echo "=== 8/8 startup log + dist time ==="
sleep 1
pm2 logs "$PM2_NAME" --lines 10 --nostream
echo ""
echo "HEAD: $(git log -1 --oneline)"
echo "dist files:"
ls -la client/dist/assets/index-*.js | head -1
echo ""
echo "=== deploy done ==="
