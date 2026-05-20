# DropXL 分销管理系统

一套对接 DropXL 平台的 B2B 分销商订单管理系统，包含订单、售后、采购、余额变动、子账户管理等模块。

## 技术栈

- **后端**：Node.js + Express + SQLite (better-sqlite3)
- **前端**：React 18 + Vite + Tailwind CSS + ECharts
- **认证**：JWT
- **DropXL API**：Bearer Token

## 项目结构

```
├── server/              # Express 后端
│   ├── index.js
│   ├── db.js            # SQLite 初始化
│   ├── dropxl.js        # DropXL API 客户端
│   ├── middleware/auth.js
│   └── routes/          # API 路由
├── client/              # React 前端 (Vite)
│   └── src/pages/       # 9 个核心页面
├── .env.example
└── package.json
```

## 功能模块

| 页面 | 路径 | 说明 |
|---|---|---|
| 仪表板 | `/dashboard` | 余额、订单、工单总览，饼图 / 折线图 / 柱状图 |
| 订单管理 | `/orders` | 订单列表、状态卡片、多条件筛选、DropXL 同步 |
| 售后工单 | `/after-sales` | 工单列表、统计、新建工单、状态流转 |
| 售后政策 | `/after-sales-policy` | 折叠文档展示 |
| 采购商品 | `/products` | 新建采购订单（调用 DropXL 创建订单 API），自动算汇率人民币 |
| 下载支持 | `/downloads` | 各国库存下载、工具文件下载 |
| 我的余额记录 | `/balance` | 余额、变动流水、充值/扣款 |
| 账户管理 | `/accounts` | 子账户管理、店铺管理 |
| 个人资料 | `/profile` | 编辑资料、修改密码 |

## 部署到火山引擎云服务器（http://101.126.155.252:5000）

### 1. 服务器准备

确保服务器已安装 Node.js 18+：

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs   # CentOS / 阿里云 Linux
# 或 Ubuntu / Debian:
# sudo apt install -y nodejs
```

### 2. 上传代码

```bash
git clone <你的Git仓库地址> /opt/dropxl-erp
cd /opt/dropxl-erp
```

### 3. 配置环境变量

```bash
cp .env.example .env
vim .env
```

至少修改以下几项：
- `JWT_SECRET` 改成随机字符串（强烈建议）
- `DROPXL_API_TOKEN` 替换为你自己的 API Token
- `ADMIN_PASSWORD` 改成你的初始密码

### 4. 安装并构建

```bash
npm install        # 安装根目录依赖（会自动构建前端 dist）
```

### 5. 启动

测试启动：
```bash
PORT=5000 npm start
```

生产环境使用 pm2 守护：
```bash
sudo npm install -g pm2
pm2 start server/index.js --name dropxl-erp
pm2 save
pm2 startup
```

### 6. 开放安全组

火山引擎控制台 → 安全组 → 入站规则放行 TCP 5000 端口。

浏览器访问： **http://101.126.155.252:5000**

默认账号：`admin / admin123`（请登录后立刻修改）

## DropXL API 对接说明

API 客户端封装在 `server/dropxl.js`，已实现以下端点（基于 DropXL 官方文档与你的 Token Scope）：

| 方法 | 端点 | 用途 |
|---|---|---|
| `GET` | `/orders` | 列出订单 |
| `GET` | `/orders/:id` | 订单详情 |
| `POST` | `/orders` | 创建订单（采购商品时调用） |
| `GET` | `/products` | 商品列表 |

如果实际端点路径有差异（如 `/api/v1/orders`），只需要修改 `.env` 里的 `DROPXL_API_BASE`，或在 `server/dropxl.js` 中调整路径。

> 注意：API Token Scope 限制了你可以调用的范围，若调用失败先到 DropXL 后台检查 Scope。

## 本地开发

```bash
npm install
cd client && npm install && cd ..
npm run dev        # 同时启动后端 (5000) 和前端 (5173)，前端通过代理访问 /api
```

## 默认账号

- 用户名：`admin`
- 密码：`admin123`（请在 `.env` 中修改后再启动）
