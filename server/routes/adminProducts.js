const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../db');
const dropxl = require('../dropxl');
const { authRequired, ownerRequired } = require('../middleware/auth');
const { setAudit } = require('../middleware/audit');

const router = express.Router();
// 整个商品库存价格管理仅店主可见，员工/分销商无权访问
router.use(authRequired, ownerRequired);

const INVENTORY_DIR = path.join(__dirname, '..', '..', 'data', 'inventory');
if (!fs.existsSync(INVENTORY_DIR)) fs.mkdirSync(INVENTORY_DIR, { recursive: true });
const MASTER_DIR = path.join(__dirname, '..', '..', 'data', 'master');
if (!fs.existsSync(MASTER_DIR)) fs.mkdirSync(MASTER_DIR, { recursive: true });

const COUNTRIES = ['美国', '英国', '德国', '法国', '荷兰', '意大利', '西班牙', '波兰'];
const COUNTRY_TO_CODE = { 美国: 'US', 英国: 'GB', 德国: 'DE', 法国: 'FR', 荷兰: 'NL', 意大利: 'IT', 西班牙: 'ES', 波兰: 'PL' };
const COUNTRY_CODE_TO_NAME = Object.fromEntries(Object.entries(COUNTRY_TO_CODE).map(([k, v]) => [v, k]));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// 总表可能 20+ 万行（如德国），最大放宽到 500MB 并落盘避免内存撑爆
const TMP_UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads-tmp');
if (!fs.existsSync(TMP_UPLOAD_DIR)) fs.mkdirSync(TMP_UPLOAD_DIR, { recursive: true });
const masterUpload = multer({
  storage: multer.diskStorage({
    destination: TMP_UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});
// 包装一层，把 multer 的 LIMIT_FILE_SIZE 等错误转成 JSON 响应
function masterUploadMw(req, res, next) {
  masterUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: '文件超过 500MB 限制；建议拆成多个文件分批上传，或联系后端调整阈值' });
    }
    return res.status(400).json({ error: err.message || '上传失败' });
  });
}

function resolveCountry(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (COUNTRIES.includes(s)) return s;
  return COUNTRY_CODE_TO_NAME[s.toUpperCase()] || null;
}

// 解析上传的 DropXL 国家库存 xlsx（3 列：SKU / B2B_price / Stock）
function parseInventoryXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('文件不含工作表');
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows.map(r => {
    // 字段名不区分大小写匹配
    const lower = {};
    for (const k of Object.keys(r)) lower[String(k).toLowerCase().trim()] = r[k];
    const sku = String(lower['sku'] ?? '').trim();
    const price = Number(lower['b2b_price'] ?? lower['price'] ?? 0) || 0;
    const stock = Number(lower['stock'] ?? lower['quantity'] ?? 0) || 0;
    return sku ? { sku, price, stock } : null;
  }).filter(Boolean);
}

// ============ 国家 API 同步（内存任务） ============
// 任务 key 用国家中文名；同一国家同一时间只允许 1 个任务
const apiSyncJobs = new Map();
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runCountryApiSync(country, job) {
  const PAGE_SIZE = 500;
  const RATE_LIMIT_MS = 1100;
  const upsert = db.prepare(`
    INSERT INTO dropxl_products (country, code, b2b_price, stock, image_url, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(country, code) DO UPDATE SET
      b2b_price = excluded.b2b_price,
      stock = excluded.stock,
      image_url = COALESCE(excluded.image_url, dropxl_products.image_url),
      uploaded_at = excluded.uploaded_at
  `);
  // DropXL listProducts 实际字段名未知，尝试多候选取主图链接
  const extractImage = (p) => {
    const candidates = [p.image, p.image_url, p.main_image, p.thumbnail, p.picture, p.img];
    for (const v of candidates) if (v && typeof v === 'string') return v;
    if (Array.isArray(p.images) && p.images.length > 0) {
      const first = p.images[0];
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object') return first.url || first.src || null;
    }
    return null;
  };
  let offset = 0;
  let total = null;
  const now = new Date().toISOString();
  try {
    while (true) {
      // DropXL 商品 API 不支持 country 参数，但每个国家有独立 API 账户（独立 token）
      // 用对应国家的 token 调用即可拿到该国可销售的商品（DropXL 按 token 权限过滤）
      const data = await dropxl.listProducts({ limit: PAGE_SIZE, offset }, country);
      // DropXL 响应格式：通常是数组 [{...}, ...]；少数情况会包成 { data: [...], pagination: { total } }
      const items = Array.isArray(data) ? data : (data?.data || []);
      const paginationTotal = Array.isArray(data)
        ? Number(items[items.length - 1]?.pagination?.total) || null
        : (data?.pagination?.total != null ? Number(data.pagination.total) : null);
      if (paginationTotal != null) total = paginationTotal;
      const tx = db.transaction((arr) => {
        for (const p of arr) {
          if (!p.code) continue;
          upsert.run(
            country,
            String(p.code),
            Number(p.price) || 0,
            Number(p.quantity) || 0,
            extractImage(p),
            now,
          );
          job.upserted++;
        }
      });
      tx(items);
      job.fetched += items.length;
      job.progress = { fetched: job.fetched, total: total ?? job.fetched };
      if (!items.length || items.length < PAGE_SIZE || (total != null && job.fetched >= total)) break;
      offset += PAGE_SIZE;
      await sleep(RATE_LIMIT_MS);
    }
    // 记录到 inventory_uploads
    const inStock = db.prepare('SELECT COUNT(*) AS c FROM dropxl_products WHERE country = ? AND stock > 0').get(country).c;
    const totalCount = db.prepare('SELECT COUNT(*) AS c FROM dropxl_products WHERE country = ?').get(country).c;
    db.prepare(`
      INSERT INTO inventory_uploads (country, original_filename, stored_filename, rows_count, in_stock_count, uploaded_by, uploaded_at, source)
      VALUES (?, NULL, NULL, ?, ?, ?, ?, 'api')
    `).run(country, totalCount, inStock, job.startedBy, now);
    job.status = 'done';
    job.finishedAt = new Date().toISOString();
    job.in_stock = inStock;
    job.total = totalCount;
  } catch (e) {
    job.status = 'failed';
    job.error = e.message;
    job.finishedAt = new Date().toISOString();
  }
}

// 一键同步全部国家：在内存中串行调用各国 API 同步任务
router.post('/sync-all', async (req, res) => {
  for (const c of COUNTRIES) {
    if (apiSyncJobs.get(c)?.status === 'running') {
      return res.status(409).json({ error: `${c} 同步任务已在运行中，请等待完成` });
    }
  }
  // 启动 8 个串行 job：第 1 个跑完才跑第 2 个，避免对 DropXL 限速并发
  const now = new Date().toISOString();
  for (const c of COUNTRIES) {
    apiSyncJobs.set(c, {
      country: c, countryCode: COUNTRY_TO_CODE[c],
      status: 'pending', progress: { fetched: 0, total: null },
      fetched: 0, upserted: 0, error: null,
      startedAt: now, finishedAt: null, startedBy: req.user.username,
    });
  }
  setAudit(res, { summary: `启动 DropXL API 全量同步（8 个国家串行）` });
  res.json({ ok: true, countries: COUNTRIES });

  // 异步串行运行，不阻塞响应
  (async () => {
    for (const c of COUNTRIES) {
      const job = apiSyncJobs.get(c);
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      await runCountryApiSync(c, job);
    }
  })();
});

router.post('/sync-country/:country', async (req, res) => {
  const country = resolveCountry(req.params.country);
  if (!country) return res.status(400).json({ error: '不支持的国家' });
  if (apiSyncJobs.get(country)?.status === 'running') {
    return res.status(409).json({ error: `${country} 同步任务已在运行中` });
  }
  const job = {
    country, countryCode: COUNTRY_TO_CODE[country],
    status: 'running',
    progress: { fetched: 0, total: null },
    fetched: 0, upserted: 0,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    startedBy: req.user.username,
  };
  apiSyncJobs.set(country, job);
  setAudit(res, { target_name: country, summary: `启动 ${country} DropXL API 同步` });
  runCountryApiSync(country, job);
  res.json({ ok: true, country });
});

router.get('/sync-country', (req, res) => {
  res.json(Array.from(apiSyncJobs.values()));
});

router.get('/sync-country/:country', (req, res) => {
  const country = resolveCountry(req.params.country);
  if (!country) return res.status(400).json({ error: '不支持的国家' });
  const j = apiSyncJobs.get(country);
  if (!j) return res.status(404).json({ error: '该国家暂无同步任务' });
  res.json(j);
});

// ============ 国家库存上传（仅店主） ============
router.post('/inventory-upload/:country', upload.single('file'), (req, res) => {
  const country = resolveCountry(req.params.country);
  if (!country) return res.status(400).json({ error: '不支持的国家' });
  if (!req.file) return res.status(400).json({ error: '请选择文件' });

  let rows;
  try {
    rows = parseInventoryXlsx(req.file.buffer);
  } catch (e) {
    return res.status(400).json({ error: '解析失败：' + e.message });
  }
  if (rows.length === 0) return res.status(400).json({ error: '文件中未找到有效行（需含 SKU 列）' });

  // 原始文件落盘，分销商下载时原样下发
  const code = COUNTRY_TO_CODE[country];
  const storedFilename = `${code}.xlsx`;
  const storedPath = path.join(INVENTORY_DIR, storedFilename);
  fs.writeFileSync(storedPath, req.file.buffer);

  const now = new Date().toISOString();
  const inStock = rows.filter(r => r.stock > 0).length;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM dropxl_products WHERE country = ?').run(country);
    const ins = db.prepare('INSERT OR REPLACE INTO dropxl_products (country, code, b2b_price, stock, uploaded_at) VALUES (?, ?, ?, ?, ?)');
    for (const r of rows) ins.run(country, r.sku, r.price, r.stock, now);
    db.prepare(`
      INSERT INTO inventory_uploads (country, original_filename, stored_filename, rows_count, in_stock_count, uploaded_by, uploaded_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'upload')
    `).run(country, req.file.originalname, storedFilename, rows.length, inStock, req.user.username, now);
  });
  tx();

  setAudit(res, {
    target_name: country,
    summary: `上传 ${country} 库存：${rows.length} 条（有库存 ${inStock}），文件 ${req.file.originalname}`,
  });
  res.json({ ok: true, country, rows: rows.length, in_stock: inStock });
});

// 每个国家的最近一次更新状态（上传 or API 同步取最新）
router.get('/inventory-status', (req, res) => {
  const rows = db.prepare(`
    SELECT iu.country, iu.original_filename, iu.rows_count, iu.in_stock_count,
           iu.uploaded_by, iu.uploaded_at, iu.source,
           (SELECT COUNT(*) FROM dropxl_products dp WHERE dp.country = iu.country) AS db_total,
           (SELECT COUNT(*) FROM dropxl_products dp WHERE dp.country = iu.country AND dp.stock > 0) AS db_in_stock
    FROM inventory_uploads iu
    INNER JOIN (
      SELECT country, MAX(uploaded_at) AS mx FROM inventory_uploads GROUP BY country
    ) latest ON latest.country = iu.country AND latest.mx = iu.uploaded_at
    ORDER BY iu.country
  `).all();
  const map = Object.fromEntries(rows.map(r => [r.country, r]));
  const list = COUNTRIES.map(c => {
    const job = apiSyncJobs.get(c);
    return {
      country: c,
      code: COUNTRY_TO_CODE[c],
      ...(map[c] || {
        rows_count: 0, in_stock_count: 0, db_total: 0, db_in_stock: 0,
        uploaded_at: null, uploaded_by: null, original_filename: null, source: null,
      }),
      api_sync_status: job?.status || null,
      api_sync_progress: job ? { fetched: job.fetched, total: job.progress?.total } : null,
    };
  });
  res.json(list);
});

// 店主侧下载源文件（验证用）
router.get('/inventory-file/:country', (req, res) => {
  const country = resolveCountry(req.params.country);
  if (!country) return res.status(400).json({ error: '不支持的国家' });
  const code = COUNTRY_TO_CODE[country];
  const file = path.join(INVENTORY_DIR, `${code}.xlsx`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: '该国家尚未上传库存文件' });
  const latest = db.prepare(`
    SELECT original_filename FROM inventory_uploads
    WHERE country = ? ORDER BY uploaded_at DESC LIMIT 1
  `).get(country);
  res.download(file, latest?.original_filename || `${code}-inventory.xlsx`);
});

// ============ 商品列表（按国家筛选，必填国家） ============
router.get('/', (req, res) => {
  const {
    country, q = '', min_price = '', max_price = '',
    min_stock = '', max_stock = '', stock_filter = 'all',
    limit = 50, offset = 0,
  } = req.query;

  const country_zh = resolveCountry(country);
  if (!country_zh) return res.status(400).json({ error: '请指定国家 (country=美国/US/...)' });

  // 该国是否上传了总表？没有则不过滤（向后兼容老数据），有则只显示总表里的 SKU
  const hasMaster = db.prepare('SELECT 1 FROM country_master_uploads WHERE country = ? LIMIT 1').get(country_zh);

  const conds = ['p.country = ?'];
  const args = [country_zh];
  if (hasMaster) {
    // INNER JOIN 白名单：只返回总表里有的 SKU
    conds.push('m.sku IS NOT NULL');
  }
  if (q.trim()) { conds.push('p.code LIKE ?'); args.push(`%${q.trim()}%`); }
  if (min_price !== '' && !isNaN(Number(min_price))) { conds.push('p.b2b_price >= ?'); args.push(Number(min_price)); }
  if (max_price !== '' && !isNaN(Number(max_price))) { conds.push('p.b2b_price <= ?'); args.push(Number(max_price)); }
  if (min_stock !== '' && !isNaN(Number(min_stock))) { conds.push('p.stock >= ?'); args.push(Number(min_stock)); }
  if (max_stock !== '' && !isNaN(Number(max_stock))) { conds.push('p.stock <= ?'); args.push(Number(max_stock)); }
  if (stock_filter === 'in_stock') { conds.push('p.stock > 0'); }
  else if (stock_filter === 'out_of_stock') { conds.push('p.stock = 0'); }
  const where = 'WHERE ' + conds.join(' AND ');

  const joinClause = `
    FROM dropxl_products p
    LEFT JOIN country_master_skus m ON m.country = p.country AND m.sku = p.code
  `;
  const total = db.prepare(`SELECT COUNT(*) AS c ${joinClause} ${where}`).get(...args).c;
  const rows = db.prepare(`
    SELECT p.country, p.code, p.b2b_price, p.stock,
           COALESCE(m.image_url, p.image_url) AS image_url,
           p.uploaded_at
    ${joinClause}
    ${where}
    ORDER BY CAST(p.code AS INTEGER) ASC, p.code ASC
    LIMIT ? OFFSET ?
  `).all(...args, Number(limit), Number(offset));

  const markup = db.prepare('SELECT markup_pct FROM country_markup WHERE country = ?').get(country_zh);

  res.json({
    rows,
    total,
    country: country_zh,
    markup_pct: markup?.markup_pct ?? null,
  });
});

// 单查（给批量采购匹配用）：必须同时给 country + code
router.get('/by-code/:country/:code', (req, res) => {
  const country = resolveCountry(req.params.country);
  if (!country) return res.status(400).json({ error: '不支持的国家' });
  const row = db.prepare('SELECT * FROM dropxl_products WHERE country = ? AND code = ?').get(country, req.params.code);
  if (!row) return res.status(404).json({ error: '未找到商品' });
  res.json(row);
});

// ============ 国家加价规则 ============
router.get('/country-markup', (req, res) => {
  const rows = db.prepare('SELECT country, markup_pct, updated_at FROM country_markup ORDER BY country').all();
  res.json(rows);
});

router.put('/country-markup/:country', (req, res) => {
  const { markup_pct } = req.body || {};
  const v = Number(markup_pct);
  if (!isFinite(v) || v < 0) return res.status(400).json({ error: '加价百分比必须是非负数' });
  const country = req.params.country;
  const cur = db.prepare('SELECT markup_pct FROM country_markup WHERE country = ?').get(country);
  if (cur) {
    db.prepare('UPDATE country_markup SET markup_pct = ?, updated_at = CURRENT_TIMESTAMP WHERE country = ?').run(v, country);
    setAudit(res, { target_name: country, summary: `${country} 加价: ${cur.markup_pct}% → ${v}%` });
  } else {
    db.prepare('INSERT INTO country_markup (country, markup_pct) VALUES (?, ?)').run(country, v);
    setAudit(res, { target_name: country, summary: `新增 ${country} 加价规则: ${v}%` });
  }
  res.json({ ok: true });
});

// ============ DropXL 多国账户凭据管理 ============

// 列出所有国家的账户状态（不返回明文 token，仅返回是否已配置）
router.get('/dropxl-accounts', (req, res) => {
  const rows = db.prepare(`
    SELECT country, email, base_url, enabled, last_test_at, last_test_ok, last_test_error, updated_at,
           CASE WHEN token IS NOT NULL AND length(token) > 0 THEN 1 ELSE 0 END AS has_token
    FROM dropxl_accounts
  `).all();
  const byCountry = new Map(rows.map(r => [r.country, r]));
  const result = COUNTRIES.map(c => byCountry.get(c) || { country: c, email: null, has_token: 0, enabled: 0 });
  res.json(result);
});

// 更新某国账户凭据
router.put('/dropxl-accounts/:country', (req, res) => {
  const country = decodeURIComponent(req.params.country);
  if (!COUNTRIES.includes(country)) return res.status(400).json({ error: '不支持的国家' });
  const { email, token, base_url, enabled } = req.body || {};
  if (!email || !token) return res.status(400).json({ error: '邮箱和 token 必填' });
  const existing = db.prepare('SELECT country FROM dropxl_accounts WHERE country = ?').get(country);
  if (existing) {
    db.prepare(`
      UPDATE dropxl_accounts
      SET email = ?, token = ?, base_url = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE country = ?
    `).run(email, token, base_url || null, enabled === false ? 0 : 1, country);
  } else {
    db.prepare(`
      INSERT INTO dropxl_accounts (country, email, token, base_url, enabled)
      VALUES (?, ?, ?, ?, ?)
    `).run(country, email, token, base_url || null, enabled === false ? 0 : 1);
  }
  setAudit(res, { target_name: country, summary: `更新 ${country} DropXL 账户凭据` });
  res.json({ ok: true });
});

// 测试某国账户凭据：调一次 listProducts(limit=1) 看是否能拿到数据
router.post('/dropxl-accounts/:country/test', async (req, res) => {
  const country = decodeURIComponent(req.params.country);
  if (!COUNTRIES.includes(country)) return res.status(400).json({ error: '不支持的国家' });
  const r = await dropxl.testCredentials(country);
  db.prepare(`
    UPDATE dropxl_accounts
    SET last_test_at = CURRENT_TIMESTAMP, last_test_ok = ?, last_test_error = ?
    WHERE country = ?
  `).run(r.ok ? 1 : 0, r.ok ? null : (r.error || '未知错误'), country);
  res.json(r);
});

// 删除某国账户凭据
router.delete('/dropxl-accounts/:country', (req, res) => {
  const country = decodeURIComponent(req.params.country);
  db.prepare('DELETE FROM dropxl_accounts WHERE country = ?').run(country);
  setAudit(res, { target_name: country, summary: `删除 ${country} DropXL 账户凭据` });
  res.json({ ok: true });
});

// ============ 各国销售白名单"总表"管理 ============
// 总表：店主上传的精选 SKU 名单 + 主图链接（A 列）
// 商品库存价格管理 / 批量采购匹配 / 分销商下载 都以总表为白名单过滤

// 稀疏单元格直读：避免 sheet_to_json 全表对象化，180MB 文件可降到峰值 ~500MB
// 通过 generator 流式吐出行，配合事务分批写入，控制内存峰值
function* iterMasterXlsxRows(filePath) {
  // 只读结构、跳过 cellNF/HTML，关掉日期转换以省 CPU 和内存
  const wb = XLSX.readFile(filePath, { cellHTML: false, cellNF: false, cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet || !sheet['!ref']) return;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  // 找 SKU 列 + Image 列（用首行表头）
  let skuCol = -1, imgCol = -1;
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })];
    if (!cell) continue;
    const v = String(cell.v || '').trim().toLowerCase();
    if (v === 'sku' && skuCol < 0) skuCol = c;
    if ((v === 'image 1' || v === 'image' || v === 'image_url' || v === 'image1') && imgCol < 0) imgCol = c;
  }
  if (skuCol < 0) return;
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const skuCell = sheet[XLSX.utils.encode_cell({ r, c: skuCol })];
    if (!skuCell || skuCell.v == null) continue;
    const sku = String(skuCell.v).trim();
    if (!sku) continue;
    let img = null;
    if (imgCol >= 0) {
      const imgCell = sheet[XLSX.utils.encode_cell({ r, c: imgCol })];
      if (imgCell?.v) {
        const u = String(imgCell.v).trim();
        if (/^https?:\/\//i.test(u)) img = u;
      }
    }
    yield { sku, image_url: img };
  }
}

// 内存中跟踪每个国家的总表导入进度（用于前端轮询）
// key=country, value={ status: 'parsing'|'writing'|'done'|'failed', rows, error, started_at, finished_at }
const masterImportJobs = new Map();

// 上传/替换某国总表（大文件 流式 sparse 读 + 批次写入，避免内存撑爆）
router.post('/master-upload/:country', masterUploadMw, (req, res) => {
  const country = resolveCountry(req.params.country);
  const cleanup = () => { if (req.file?.path && fs.existsSync(req.file.path)) { try { fs.unlinkSync(req.file.path); } catch {} } };
  if (!country) { cleanup(); return res.status(400).json({ error: '不支持的国家' }); }
  if (!req.file) return res.status(400).json({ error: '请选择文件' });

  const code = COUNTRY_TO_CODE[country];
  const tempPath = req.file.path;
  const storedFilename = `${code}.xlsx`;
  const storedPath = path.join(MASTER_DIR, storedFilename);

  // 立即响应客户端：上传完成，进入后台导入阶段
  // 客户端轮询 GET /admin/products/master-upload-status/:country 查询进度
  masterImportJobs.set(country, {
    status: 'parsing', rows: 0, error: null,
    original_filename: req.file.originalname,
    started_at: new Date().toISOString(),
  });
  res.json({ ok: true, country, queued: true });

  // 异步处理（不 await，让 response 已发送）
  setImmediate(() => {
    const job = masterImportJobs.get(country);
    const username = req.user.username;
    try {
      // 先把上传的临时文件原子重命名到正式目录（供下载源文件用）
      try { fs.renameSync(tempPath, storedPath); }
      catch {
        // 跨设备 rename 失败的兜底：复制 + 删
        fs.copyFileSync(tempPath, storedPath);
        try { fs.unlinkSync(tempPath); } catch {}
      }

      job.status = 'writing';
      const now = new Date().toISOString();
      // 先清旧数据
      db.prepare('DELETE FROM country_master_skus WHERE country = ?').run(country);
      const ins = db.prepare(
        'INSERT OR REPLACE INTO country_master_skus (country, sku, image_url, uploaded_at) VALUES (?, ?, ?, ?)'
      );
      // 分批写入：每 5000 行一个事务，释放对象给 GC
      const BATCH = 5000;
      let batch = [];
      let total = 0;
      const flushBatch = db.transaction((arr) => {
        for (const r of arr) ins.run(country, r.sku, r.image_url, now);
      });
      for (const row of iterMasterXlsxRows(storedPath)) {
        batch.push(row);
        if (batch.length >= BATCH) {
          flushBatch(batch);
          total += batch.length;
          job.rows = total;
          batch = [];
        }
      }
      if (batch.length) { flushBatch(batch); total += batch.length; job.rows = total; }

      if (total === 0) throw new Error('文件中未找到有效行（需含 SKU 列）');

      db.prepare(`
        INSERT OR REPLACE INTO country_master_uploads
          (country, original_filename, stored_filename, rows_count, uploaded_by, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(country, job.original_filename, storedFilename, total, username, now);

      job.status = 'done';
      job.rows = total;
      job.finished_at = new Date().toISOString();
    } catch (e) {
      console.error('[master-upload] failed', country, e);
      job.status = 'failed';
      job.error = String(e.message || e);
      cleanup();
    }
  });
});

// 总表导入进度查询（前端轮询）
router.get('/master-upload-status/:country', (req, res) => {
  const country = resolveCountry(req.params.country);
  if (!country) return res.status(400).json({ error: '不支持的国家' });
  const job = masterImportJobs.get(country);
  if (!job) return res.json({ status: 'idle' });
  res.json(job);
});

// 各国总表上传状态
router.get('/master-status', (req, res) => {
  const rows = db.prepare(`
    SELECT country, original_filename, rows_count, uploaded_by, uploaded_at
    FROM country_master_uploads
  `).all();
  const map = Object.fromEntries(rows.map(r => [r.country, r]));
  res.json(Object.keys(COUNTRY_TO_CODE).map(c => {
    const job = masterImportJobs.get(c);
    return {
      country: c,
      code: COUNTRY_TO_CODE[c],
      available: !!map[c],
      rows_count: map[c]?.rows_count || 0,
      uploaded_at: map[c]?.uploaded_at || null,
      original_filename: map[c]?.original_filename || null,
      // 导入任务实时状态（前端轮询用）
      import_status: job?.status || null,   // null/parsing/writing/done/failed
      import_rows: job?.rows || 0,
      import_error: job?.error || null,
    };
  }));
});

// 下载店主上传的总表源文件（仅店主）
router.get('/master-file/:country', (req, res) => {
  const country = resolveCountry(req.params.country);
  if (!country) return res.status(400).json({ error: '不支持的国家' });
  const meta = db.prepare('SELECT * FROM country_master_uploads WHERE country = ?').get(country);
  if (!meta) return res.status(404).json({ error: '该国家总表暂未上传' });
  const file = path.join(MASTER_DIR, meta.stored_filename);
  if (!fs.existsSync(file)) return res.status(410).json({ error: '源文件不存在，请重新上传总表' });
  res.download(file, meta.original_filename || `${country}-master.xlsx`);
});

module.exports = router;
// 供 scheduler 调用：自动同步时复用同一套 job 跟踪逻辑
module.exports.runCountryApiSync = runCountryApiSync;
module.exports.apiSyncJobs = apiSyncJobs;
