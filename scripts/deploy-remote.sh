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
  # 只保留最近 5 份备份，删掉更旧的。备份是全量 cp（每份数百 MB），
  # 不清理会随部署次数无限堆积撑爆磁盘（曾把 59G 盘占满导致上传 500 / 白屏）。
  OLD=$(ls -t data/erp.db.bak-* 2>/dev/null | tail -n +6)
  if [ -n "$OLD" ]; then
    echo "$OLD" | xargs -r rm -f
    echo " pruned old backups (kept latest 5)"
  fi
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
echo "=== 4/8 sync code (fetch + reset, 直连/镜像自动切换) ==="
# 非交互兜底：公开仓 fetch 本是匿名的，但万一仍要凭据 / 编辑器，立刻失败而不是永久卡住。
export GIT_TERMINAL_PROMPT=0
export GIT_EDITOR=true
git config http.version HTTP/1.1
git config --global http.lowSpeedLimit 1000
git config --global http.lowSpeedTime 20

# 直连放第一位；被墙时 60s 内快速失败，自动逐个走镜像（已剔除关停的 ghproxy.com / mirror.ghproxy.com）。
ORIG_URL=$(git remote get-url origin)
ENDPOINTS=("" "https://ghfast.top/" "https://ghproxy.net/" "https://gh-proxy.com/")

# 临时关掉 set -e：timeout 返回 124 不应直接退出，要让镜像兜底跑完，自己判断退出码。
set +e
fetch_ok=0
for PFX in "${ENDPOINTS[@]}"; do
  LABEL=${PFX:-"直连 GitHub"}
  git remote set-url origin "${PFX}${ORIG_URL}"
  echo " fetch via ${LABEL} (timeout 60s) ..."
  OUT=$(timeout 60 git fetch --prune origin "$BRANCH" 2>&1)
  RC=$?
  echo "$OUT" | tail -8
  if [ $RC -eq 0 ]; then fetch_ok=1; echo " ${LABEL} OK"; break; fi
  echo " ${LABEL} FAILED (exit $RC)"
done
git remote set-url origin "$ORIG_URL"   # 还原直连地址，不把镜像写死
set -e

if [ $fetch_ok -eq 0 ]; then
  echo ""
  echo " ERROR: 直连与所有镜像都拉取失败，请检查服务器到 GitHub/镜像的网络。"
  echo " 手动兜底：cd $REPO && git fetch origin $BRANCH && git reset --hard origin/$BRANCH"
  exit 1
fi

# 部署机始终硬对齐远端：彻底避免本地分叉触发的合并提交 / 编辑器卡死
# （本地改动第 2 步已 stash，数据库第 1 步已备份）。
git reset --hard "origin/$BRANCH"
echo " synced to: $(git log -1 --oneline)"

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
