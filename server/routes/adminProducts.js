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

const COUNTRIES = ['美国', '英国', '德国', '法国', '荷兰', '意大利', '西班牙', '波兰'];
const COUNTRY_TO_CODE = { 美国: 'US', 英国: 'GB', 德国: 'DE', 法国: 'FR', 荷兰: 'NL', 意大利: 'IT', 西班牙: 'ES', 波兰: 'PL' };
const COUNTRY_CODE_TO_NAME = Object.fromEntries(Object.entries(COUNTRY_TO_CODE).map(([k, v]) => [v, k]));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

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
      // 传 country 给 DropXL listProducts。若 DropXL 不支持该参数，
      // 各国会拿到相同数据 - 店主可对比不同国家的数据是否一致来判断
      const data = await dropxl.listProducts({ country: job.countryCode, limit: PAGE_SIZE, offset });
      const items = data?.data || [];
      if (data?.pagination?.total != null) total = data.pagination.total;
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

  const conds = ['country = ?'];
  const args = [country_zh];
  if (q.trim()) { conds.push('code LIKE ?'); args.push(`%${q.trim()}%`); }
  if (min_price !== '' && !isNaN(Number(min_price))) { conds.push('b2b_price >= ?'); args.push(Number(min_price)); }
  if (max_price !== '' && !isNaN(Number(max_price))) { conds.push('b2b_price <= ?'); args.push(Number(max_price)); }
  if (min_stock !== '' && !isNaN(Number(min_stock))) { conds.push('stock >= ?'); args.push(Number(min_stock)); }
  if (max_stock !== '' && !isNaN(Number(max_stock))) { conds.push('stock <= ?'); args.push(Number(max_stock)); }
  if (stock_filter === 'in_stock') { conds.push('stock > 0'); }
  else if (stock_filter === 'out_of_stock') { conds.push('stock = 0'); }
  const where = 'WHERE ' + conds.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) AS c FROM dropxl_products ${where}`).get(...args).c;
  const rows = db.prepare(`
    SELECT country, code, b2b_price, stock, image_url, uploaded_at
    FROM dropxl_products
    ${where}
    ORDER BY CAST(code AS INTEGER) ASC, code ASC
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

module.exports = router;
