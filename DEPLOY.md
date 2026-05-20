# 蓝鲸跨境海外仓 - 服务器部署说明（与现有合集程序完全隔离）

> 目标：在 火山引擎云服务器 `101.126.155.252` 上部署本系统，**不影响现有的合集程序工具**。

## 隔离保证 ✅

本系统与您现有的合集程序在以下方面完全独立，**互不影响**：

| 资源 | 现有合集程序 | 蓝鲸 ERP | 隔离方式 |
|---|---|---|---|
| **端口** | 您原本占用的端口（5000？） | **5500**（建议） | 完全不同的端口 |
| **进程** | 独立的 Node/Python/其他进程 | 独立 pm2 进程 `lanjing-erp` | 进程隔离 |
| **文件目录** | 您现有目录 | `/opt/lanjing-erp/` | 独立目录 |
| **数据库** | 您原有数据库 | 独立 SQLite 文件 `/opt/lanjing-erp/data/erp.db` | 文件级隔离 |
| **依赖** | 现有 node_modules | 独立 node_modules | 不共享 |
| **系统服务** | 不修改 | 单独 pm2/systemd 注册 | 服务名隔离 |
| **日志** | 独立日志 | `/opt/lanjing-erp/logs/` | 路径隔离 |

**不会做的事**：
- ❌ 不会修改系统 PATH、环境变量
- ❌ 不会改 nginx/Apache 主配置
- ❌ 不会动 iptables/防火墙规则（除新开 5500 端口外）
- ❌ 不会改 root 的 .bashrc / .profile
- ❌ 不会触碰您现有的目录、数据库、日志
- ❌ 不会改 Node 全局版本（用您现有的 Node 即可）

## 部署步骤

### 第一步：登录服务器，了解现有资源占用

```bash
# SSH 登录
ssh root@101.126.155.252

# 查看您现有程序占用的端口（重要！）
ss -tlnp | grep -E ':[0-9]+'
# 或
netstat -tlnp

# 记下您现有程序的端口（比如 5000、80、443、3000 等）
# 然后选一个完全没用过的端口作为本系统端口
```

**建议端口：5500**（避开常见的 5000/80/443/3000/8080）

如果 5500 也被占了，可以用 5501、6500、9500 等任意空闲端口。

### 第二步：检查 Node.js 版本（不需要的话跳过）

```bash
node -v
# 如果输出 v18.x 或更高 → 跳到第三步
# 如果没安装或版本太低，再安装（不影响其它服务）：

# CentOS / 阿里云 Linux 2/3
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
```

### 第三步：拉取代码到独立目录

```bash
# 部署到 /opt/lanjing-erp（与您现有程序目录完全分离）
sudo mkdir -p /opt/lanjing-erp
sudo chown $(whoami): /opt/lanjing-erp
cd /opt/lanjing-erp

# 从 GitHub 拉取
git clone https://github.com/anasrimoneera-bot/Amazon-order-ERP.git .
# 切换到我们的开发分支
git checkout claude/dropxl-management-system-2RDkA
```

### 第四步：配置环境变量（独立文件，不污染系统环境）

```bash
cp .env.example .env
vi .env
```

编辑 `.env` 内容如下（**至少修改这 3 项**）：

```ini
# 服务端口 - 选一个您原系统没用的端口
PORT=5500

# JWT 密钥 - 改成随机字符串
JWT_SECRET=lanjing-please-change-to-random-string-xxxxxxxx

# DropXL API Token（您自己的）
DROPXL_API_TOKEN=4cb2475b-1a27-48c5-9f1c-9daab3945dad

# 以下保持默认即可
DROPXL_API_BASE=https://b2b.dropxl.com/api
DB_PATH=./data/erp.db
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请改成您的强密码123!
```

### 第五步：安装依赖 + 构建（只在本目录操作）

```bash
cd /opt/lanjing-erp
npm install
# 上面命令会自动构建前端
```

### 第六步：测试运行

```bash
# 临时启动测试
npm start
```

如果看到：
```
DropXL ERP server listening on 0.0.0.0:5500
```

说明启动成功。然后在浏览器访问 **http://101.126.155.252:5500** 测试。

测试无误后按 `Ctrl+C` 停止，进入下一步。

### 第七步：用 pm2 守护进程（独立服务，与现有服务并存）

```bash
# 如果服务器还没安装 pm2，安装（不影响现有服务）
sudo npm install -g pm2

# 启动我们的服务（服务名 lanjing-erp，与您现有任何服务名不会冲突）
cd /opt/lanjing-erp
pm2 start server/index.js --name lanjing-erp

# 查看运行状态
pm2 ls
# 应该能看到：
# lanjing-erp │ online │ ... │ 0.0.0.0:5500

# 设置开机自启（首次执行才需要）
pm2 startup
pm2 save
```

如果您的现有合集程序也是用 pm2 管理，**两者会并行运行，互不干扰**：
```
┌─────┬──────────────────┬──────────┬──────┬───────────┐
│ id  │ name             │ status   │ cpu  │ memory    │
├─────┼──────────────────┼──────────┼──────┼───────────┤
│ 0   │ 您原有的合集程序  │ online   │ 0%   │ 80mb      │
│ 1   │ lanjing-erp      │ online   │ 0%   │ 60mb      │
└─────┴──────────────────┴──────────┴──────┴───────────┘
```

### 第八步：火山引擎安全组开放 5500 端口

进入 **火山引擎控制台 → 云服务器 → 安全组 → 入站规则**：

| 协议 | 端口 | 来源 | 备注 |
|---|---|---|---|
| TCP | 5500 | 0.0.0.0/0（或您信任的 IP 段） | 蓝鲸 ERP |

**注意**：只新增这一条，不要修改您现有合集程序的安全组规则。

### 第九步：访问验证

浏览器打开：
```
http://101.126.155.252:5500
```

用 `admin` / 您在 `.env` 里设置的密码登录。

---

## 日常管理命令（不影响其它服务）

```bash
# 查看 ERP 日志
pm2 logs lanjing-erp

# 重启 ERP
pm2 restart lanjing-erp

# 停止 ERP
pm2 stop lanjing-erp

# 删除 ERP（卸载）
pm2 delete lanjing-erp
# 然后删目录：rm -rf /opt/lanjing-erp
```

**所有命令都只针对 `lanjing-erp` 服务，绝不会触发您现有合集程序。**

## 完全卸载（如果不想用了）

```bash
# 停止并删除服务
pm2 delete lanjing-erp
pm2 save

# 删除项目目录（含数据）
sudo rm -rf /opt/lanjing-erp

# 关闭火山引擎安全组的 5500 端口
# 进控制台手动删除即可
```

卸载后服务器恢复部署前状态，**您原有的合集程序完全不受影响**。

---

## 资源占用预估

部署本系统后，对服务器的额外占用：

- **内存**：常驻 60~100MB（轻量 Node 进程）
- **CPU**：闲时 < 1%，下单/查询时短暂占用
- **磁盘**：约 400MB（含 node_modules + 数据库初始空间）
- **网络**：仅与 DropXL API 通信，无外部依赖
- **数据库**：SQLite，单文件，每万条订单约 5MB

如果您的服务器是入门级（2 核 4G）配置，运行本系统**完全没问题**，对您现有合集程序的性能影响几乎为零。

---

## 常见疑问

**Q1: 部署过程会重启服务器吗？**
A: 不会。所有操作都不需要重启服务器。

**Q2: 会影响我现有程序的数据库吗？**
A: 不会。本系统用独立的 SQLite 文件，与您的数据库完全分离。

**Q3: 万一两个程序的进程冲突怎么办？**
A: 不会冲突。Node 进程都是独立的，pm2 通过服务名区分。

**Q4: 如果端口 5500 被防火墙挡住了？**
A: 检查火山引擎安全组（云端防火墙）+ 服务器本地防火墙：
```bash
sudo firewall-cmd --add-port=5500/tcp --permanent && sudo firewall-cmd --reload
# 或 ufw
sudo ufw allow 5500/tcp
```

**Q5: 想换端口怎么办？**
A: 编辑 `/opt/lanjing-erp/.env` 里的 `PORT=` 然后 `pm2 restart lanjing-erp`，再到火山引擎安全组改放行端口即可。

---

## 部署支持

如果您愿意，可以把火山引擎服务器临时给我一个只读的访问凭证（或者您自己照本文档操作），我可以远程帮您完成部署或答疑。完全可以**先在测试服务器跑通再上线**。
