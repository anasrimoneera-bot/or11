@echo off
title 蓝鲸跨境海外仓 ERP - 一键部署工具 v2
color 0A
setlocal enabledelayedexpansion

rem ============================================================
rem  连接配置（如服务器搬迁请修改这里）
rem ============================================================
set "SERVER=root@101.126.155.252"
set "REPO=/opt/lanjing-erp"
set "BRANCH=main"
set "PM2_NAME=lanjing-erp"

rem 把 Windows 自带 OpenSSH 加入 PATH（避免找不到 ssh）
if exist "%SystemRoot%\System32\OpenSSH\ssh.exe" (
  set "PATH=%SystemRoot%\System32\OpenSSH;%PATH%"
)

rem 检查 ssh 命令可用
ssh -V >nul 2>&1
if errorlevel 1 (
  cls
  echo ============================================================
  echo                  错误：找不到 ssh 命令
  echo ============================================================
  echo.
  echo 当前 Windows 系统未安装 OpenSSH 客户端。
  echo.
  echo 安装方法（Win10 1809+ 自带，启用即可）：
  echo   1. 打开 设置 -^> 应用 -^> 可选功能
  echo   2. 添加功能 -^> 搜索 "OpenSSH 客户端"
  echo   3. 安装后重新打开本 bat
  echo.
  pause
  exit /b 1
)

:MENU
cls
echo ============================================================
echo            蓝鲸跨境海外仓 ERP - 一键部署工具 v2
echo ============================================================
echo   服务器： %SERVER%
echo   目录：   %REPO%
echo   分支：   %BRANCH%
echo   进程：   %PM2_NAME%
echo ============================================================
echo.
echo   [1] 完整部署（备份 + 拉代码 + 装依赖 + 构建前端 + 重启） ^<推荐^>
echo   [2] 快速重启 pm2 进程（不拉代码）
echo   [3] 查看 pm2 进程状态 + 磁盘
echo   [4] 查看实时日志（按 Ctrl+C 退出日志）
echo   [5] 测试 SSH 连接 + 关键文件检查
echo.
echo   --- 数据备份管理 ---
echo   [6] 单独备份业务数据库（不部署）
echo   [7] 查看所有备份文件列表
echo   [8] 从某个备份回滚（出故障时用）
echo   [9] 清理 7 天前的旧备份
echo.
echo   [0] 在服务器上执行自定义命令
echo   [Q] 退出
echo.
set "CHOICE="
set /p "CHOICE=请选择: "

if /i "%CHOICE%"=="1" goto DEPLOY
if /i "%CHOICE%"=="2" goto RESTART
if /i "%CHOICE%"=="3" goto STATUS
if /i "%CHOICE%"=="4" goto LOGS
if /i "%CHOICE%"=="5" goto TEST
if /i "%CHOICE%"=="6" goto BACKUP
if /i "%CHOICE%"=="7" goto LIST_BACKUPS
if /i "%CHOICE%"=="8" goto ROLLBACK
if /i "%CHOICE%"=="9" goto CLEAN_BACKUPS
if /i "%CHOICE%"=="0" goto CUSTOM
if /i "%CHOICE%"=="Q" goto END
echo.
echo 输入无效，请输入菜单中的数字或 Q
timeout /t 2 >nul
goto MENU

rem ============================================================
:DEPLOY
rem ============================================================
cls
echo ============================================================
echo                       完整部署
echo ============================================================
echo 在服务器上将执行：
echo   1. 备份业务数据库 -^> data/erp.db.bak-YYYYMMDD-HHMMSS
echo   2. 检测未提交的本地改动（避免覆盖手工修改）
echo   3. 清掉自动生成的 lock 文件（防 git pull 冲突）
echo   4. git pull origin %BRANCH%
echo   5. npm install （触发 postinstall 自动构建前端）
echo   6. pm2 restart %PM2_NAME%
echo   7. 查看启动日志
echo.
echo 受保护的业务文件（绝不覆盖）：
echo   - data/erp.db          （SQLite 数据库）
echo   - data/inventory/      （各国库存源文件）
echo   - data/master/         （各国总表源文件）
echo   - data/uploads-tmp/    （上传临时目录）
echo   - .env                 （环境变量含 API token）
echo.
set "GO="
set /p "GO=确认开始？[Y/N]: "
if /i not "%GO%"=="Y" goto MENU
echo.
echo [开始部署...]
echo.

ssh -o StrictHostKeyChecking=accept-new %SERVER% "set -e; cd %REPO% && echo '=== 1/8 备份业务数据库 ===' && (if [ -f data/erp.db ]; then BK=data/erp.db.bak-$(date +%%Y%%m%%d-%%H%%M%%S) && cp data/erp.db $BK && echo \" 已备份到: $BK ($(du -h $BK | awk '{print $1}'))\"; else echo ' (跳过：无数据库文件)'; fi) && echo '' && echo '=== 2/8 检测本地未提交改动 ===' && DIRTY=$(git status --porcelain) && if [ -n \"$DIRTY\" ]; then echo ' 警告：服务器上有未提交改动:'; echo \"$DIRTY\" | head -10; echo ' 已自动 stash 暂存（可用 git stash list 查看，git stash pop 恢复）'; git stash push -u -m \"auto-stash-before-deploy-$(date +%%Y%%m%%d-%%H%%M%%S)\"; else echo ' 无未提交改动'; fi && echo '' && echo '=== 3/8 清理自动生成的 lock 文件（避免冲突）===' && rm -f package-lock.json client/package-lock.json && echo ' OK' && echo '' && echo '=== 4/8 拉取最新代码 ===' && git config http.version HTTP/1.1 && git pull origin %BRANCH% 2>&1 | tail -20 && echo '' && echo '=== 5/8 安装根目录依赖 ===' && npm install --no-audit --no-fund 2>&1 | tail -5 && echo '' && echo '=== 6/8 强制重建前端 (关键) ===' && cd client && rm -rf dist && npm install --no-audit --no-fund 2>&1 | tail -5 && npm run build 2>&1 | tail -10 && cd .. && echo '' && echo '=== 7/8 重启 pm2 服务 ===' && pm2 restart %PM2_NAME% --update-env && pm2 ls && echo '' && echo '=== 8/8 启动日志 + 前端 dist 时间 ===' && sleep 1 && pm2 logs %PM2_NAME% --lines 10 --nostream && echo '' && echo \"当前 HEAD: $(git log -1 --oneline)\" && echo '前端 dist 文件:' && ls -la client/dist/assets/index-*.js | head -1 && echo '' && echo '=== 部署完成 ==='"

set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  color 0A
  echo ============================================================
  echo                    [成功] 部署完成
  echo ============================================================
  echo [OK] 数据库已自动备份
  echo [OK] 业务文件未被触碰
  echo [OK] 前端已重新构建
  echo.
  echo 浏览器请强制刷新 Ctrl+Shift+R 加载最新前端
) else (
  color 0C
  echo ============================================================
  echo                  [失败] 错误码 %RC%
  echo ============================================================
  echo 翻看上方日志查找原因。常见问题：
  echo   - git pull 卡住或断流：GitHub 网络问题，重试本菜单 [1]
  echo   - npm install 卡住：npm 镜像问题或磁盘满
  echo     可在 [0] 自定义命令里跑 'df -h' 查磁盘
  echo   - pm2 启动失败：跑 [4] 看实时日志找堆栈
  echo.
  echo 如果应用打不开了，跑 [8] 从最近备份回滚数据库
)
echo.
pause
goto MENU

rem ============================================================
:RESTART
rem ============================================================
cls
echo === 重启 pm2 ===
ssh -o StrictHostKeyChecking=accept-new %SERVER% "pm2 restart %PM2_NAME% && pm2 ls"
echo.
pause
goto MENU

rem ============================================================
:STATUS
rem ============================================================
cls
echo === pm2 状态 ===
ssh -o StrictHostKeyChecking=accept-new %SERVER% "pm2 ls && echo '' && echo '--- 磁盘占用 ---' && df -h /opt | head -2 && echo '' && echo '--- 当前 Git HEAD ---' && cd %REPO% && git log -1 --oneline && echo '' && echo '--- 业务数据 ---' && du -sh %REPO%/data/erp.db %REPO%/data/inventory %REPO%/data/master 2>/dev/null"
echo.
pause
goto MENU

rem ============================================================
:LOGS
rem ============================================================
cls
echo === 实时日志（按 Ctrl+C 退出，不影响服务） ===
echo.
ssh -o StrictHostKeyChecking=accept-new %SERVER% "pm2 logs %PM2_NAME% --lines 40"
echo.
pause
goto MENU

rem ============================================================
:TEST
rem ============================================================
cls
echo === SSH 连接 + 关键文件检查 ===
ssh -o StrictHostKeyChecking=accept-new %SERVER% "echo '[OK] SSH 连接成功' && echo '主机: '$(uname -n) && echo '系统: '$(uname -srm) && echo '时间: '$(date) && echo 'Node: '$(node -v) && echo 'PM2: '$(pm2 -v) && echo '' && echo '--- 关键文件 ---' && ls -la %REPO%/.env %REPO%/data/erp.db 2>/dev/null && echo '' && echo '--- 业务目录 ---' && ls -ld %REPO%/data/inventory %REPO%/data/master %REPO%/data/uploads-tmp 2>/dev/null"
echo.
pause
goto MENU

rem ============================================================
:BACKUP
rem ============================================================
cls
echo === 单独备份业务数据库 ===
ssh -o StrictHostKeyChecking=accept-new %SERVER% "cd %REPO% && BK=data/erp.db.bak-$(date +%%Y%%m%%d-%%H%%M%%S) && cp data/erp.db $BK && echo \"已备份到: $BK\" && ls -lh $BK"
echo.
pause
goto MENU

rem ============================================================
:LIST_BACKUPS
rem ============================================================
cls
echo === 所有备份文件 ===
ssh -o StrictHostKeyChecking=accept-new %SERVER% "cd %REPO% && (ls -lht data/erp.db.bak-* 2>/dev/null || echo '尚无备份') | head -20"
echo.
echo （只显示最近 20 个备份；如果太多可在 [9] 清理旧备份）
echo.
pause
goto MENU

rem ============================================================
:ROLLBACK
rem ============================================================
cls
echo ============================================================
echo                     从备份回滚业务数据库
echo ============================================================
echo.
echo 服务器上所有备份：
ssh -o StrictHostKeyChecking=accept-new %SERVER% "cd %REPO% && ls -lht data/erp.db.bak-* 2>/dev/null | head -20"
echo.
echo 请输入要回滚到的备份文件名（如 erp.db.bak-20260522-150000）：
set "BAKFILE="
set /p "BAKFILE=> "
if "%BAKFILE%"=="" goto MENU
echo.
echo 即将执行：
echo   1. 停止 pm2 进程
echo   2. 把当前数据库再备份一次（万一搞错可以再回滚）
echo   3. 用 %BAKFILE% 覆盖当前 data/erp.db
echo   4. 重启 pm2
echo.
set "GO="
set /p "GO=确认回滚？[Y/N]: "
if /i not "%GO%"=="Y" goto MENU
echo.
ssh -o StrictHostKeyChecking=accept-new %SERVER% "set -e; cd %REPO% && test -f data/%BAKFILE% && pm2 stop %PM2_NAME% && cp data/erp.db data/erp.db.bak-before-rollback-$(date +%%Y%%m%%d-%%H%%M%%S) && cp data/%BAKFILE% data/erp.db && pm2 restart %PM2_NAME% && pm2 logs %PM2_NAME% --lines 10 --nostream && echo '=== 回滚完成 ==='"
echo.
pause
goto MENU

rem ============================================================
:CLEAN_BACKUPS
rem ============================================================
cls
echo === 清理 7 天前的旧备份 ===
echo.
ssh -o StrictHostKeyChecking=accept-new %SERVER% "cd %REPO%/data && find . -name 'erp.db.bak-*' -mtime +7 -print | head -50 && echo '---' && CNT=$(find . -name 'erp.db.bak-*' -mtime +7 2>/dev/null | wc -l) && echo \"上述 $CNT 个文件将被删除（最近 7 天的备份会保留）\""
echo.
set "GO="
set /p "GO=确认删除？[Y/N]: "
if /i not "%GO%"=="Y" goto MENU
ssh -o StrictHostKeyChecking=accept-new %SERVER% "cd %REPO%/data && find . -name 'erp.db.bak-*' -mtime +7 -delete && echo '已清理。剩余备份：' && ls -lht erp.db.bak-* 2>/dev/null | wc -l"
echo.
pause
goto MENU

rem ============================================================
:CUSTOM
rem ============================================================
cls
echo === 在服务器上执行自定义命令 ===
echo 例如：
echo   ls -la /opt/lanjing-erp
echo   cat /opt/lanjing-erp/.env ^| grep -v TOKEN
echo   pm2 logs %PM2_NAME% --err --lines 30 --nostream
echo   du -sh /opt/lanjing-erp/data/*
echo.
set "CMD="
set /p "CMD=输入命令（回车取消）: "
if "%CMD%"=="" goto MENU
echo.
ssh -o StrictHostKeyChecking=accept-new %SERVER% "%CMD%"
echo.
pause
goto MENU

rem ============================================================
:END
rem ============================================================
cls
echo 已退出。再见 ^^_^^
timeout /t 1 >nul
endlocal
exit /b 0
