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
git config --global http.lowSpeedLimit 1000
git config --global http.lowSpeedTime 20  # 20s under 1KB/s is treated as stuck

# NOTE: do NOT pipe through tail in the if-condition; pipe exit code = tail's = always 0
# We capture output, check git's actual exit code, then print last 20 lines.
pull_ok=0
for i in 1 2 3; do
  echo "[attempt $i/3] git pull origin $BRANCH"
  OUT=$(timeout 60 git pull origin "$BRANCH" 2>&1)
  RC=$?
  echo "$OUT" | tail -20
  if [ $RC -eq 0 ]; then
    pull_ok=1
    break
  fi
  echo " attempt $i FAILED (exit $RC), retrying in 3s..."
  sleep 3
done

if [ $pull_ok -eq 0 ]; then
  echo ""
  echo " direct GitHub failed all 3 attempts, trying ghproxy mirror..."
  ORIG_URL=$(git remote get-url origin)
  PROXY_URL="https://ghproxy.com/$ORIG_URL"
  git remote set-url origin "$PROXY_URL"
  OUT=$(timeout 90 git pull origin "$BRANCH" 2>&1)
  RC=$?
  echo "$OUT" | tail -20
  if [ $RC -eq 0 ]; then
    pull_ok=1
    echo " ghproxy success."
  else
    echo " ghproxy also failed (exit $RC)."
  fi
  # restore origin url regardless, prefer direct on next deploy
  git remote set-url origin "$ORIG_URL"
fi

if [ $pull_ok -eq 0 ]; then
  echo ""
  echo " ERROR: git pull failed via direct AND ghproxy. Network blocked?"
  echo " manual debug on server: cd $REPO && git pull origin $BRANCH"
  exit 1
fi

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
# 必须 delete + start 才能强制应用 ecosystem.config.js 里新的 node_args
# (pm2 startOrRestart / restart 都不会改已运行进程的 node-args)
pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
pm2 start ecosystem.config.js --update-env
pm2 save >/dev/null 2>&1 || true
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
