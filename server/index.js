require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/orders/batch', require('./routes/batchOrders'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/aftersales', require('./routes/aftersales'));
app.use('/api/balance', require('./routes/balance'));
app.use('/api/products', require('./routes/products'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin/products', require('./routes/adminProducts'));
app.use('/api/aftersales-policies', require('./routes/aftersalesPolicies'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/tools', require('./routes/tools'));
app.use('/api/settings', require('./routes/settings'));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  // index.html 不缓存，让浏览器每次都拿最新 hash；带 hash 的 assets 永久缓存
  app.use(express.static(clientDist, {
    setHeaders: (res, filePath) => {
      const base = path.basename(filePath);
      if (base === 'index.html') {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (/\.(js|css)$/.test(base)) {
        // Vite 在文件名里加 content hash，可以放心 long cache
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  app.get(/^\/(?!api).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.send('Client not built. Run: cd client && npm install && npm run build'));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || '服务器错误' });
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`DropXL ERP server listening on 0.0.0.0:${PORT}`);
  // 启动自动同步调度器（6 小时一次，跑商品+订单双同步）
  // 可通过 DISABLE_AUTO_SYNC=1 关闭
  if (process.env.DISABLE_AUTO_SYNC !== '1') {
    try { require('./scheduler').start(); }
    catch (e) { console.error('[scheduler] failed to start:', e); }
  } else {
    console.log('[scheduler] disabled by env DISABLE_AUTO_SYNC=1');
  }
});

// 总表/库存大文件(可达 170MB+)在慢上行下可能要传好几分钟。
// Node 18 默认 requestTimeout=5min 会把还没传完的上传连接掐断
// （表现为"上传中"转一会儿消失、且无报错）。这里放开整请求超时。
server.requestTimeout = 0;        // 不限制整个请求耗时（含大文件 body 上传）
server.headersTimeout = 120000;   // 仅头部 2 分钟，防慢速头攻击
server.keepAliveTimeout = 120000;
