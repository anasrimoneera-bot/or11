const express = require('express');
const db = require('../db');
const dropxl = require('../dropxl');
const { authRequired, adminRequired, ownerRequired } = require('../middleware/auth');
const { audit, setAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authRequired, adminRequired, audit);

// 同步任务在内存维护，重启后丢失（产品数据本身在 DB 里，重启不影响）
const syncJobs = new Map();
const JOB_RETENTION_MS = 24 * 60 * 60 * 1000;

function cleanupOldSyncJobs() {
  const cutoff = Date.now() - JOB_RETENTION_MS;
  for (const [id, job] of syncJobs.entries()) {
    if (job.finishedAt && new Date(job.finishedAt).getTime() < cutoff) {
      syncJobs.delete(id);
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runProductSync(job) {
  const PAGE_SIZE = 500;
  const RATE_LIMIT_MS = 1100;
  const upsert = db.prepare(`
    INSERT INTO dropxl_products
      (code, dropxl_id, name, category_path, quantity, price, currency, country, dropxl_updated_at, synced_at, sync_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      dropxl_id = excluded.dropxl_id,
      name = excluded.name,
      category_path = excluded.category_path,
      quantity = excluded.quantity,
      price = excluded.price,
      currency = excluded.currency,
      country = excluded.country,
      dropxl_updated_at = excluded.dropxl_updated_at,
      synced_at = excluded.synced_at,
      sync_id = excluded.sync_id
  `);
  let offset = 0;
  let total = null;
  const now = new Date().toISOString();

  try {
    while (true) {
      const data = await dropxl.listProducts({ limit: PAGE_SIZE, offset });
      const items = data?.data || [];
      if (data?.pagination?.total != null) total = data.pagination.total;

      const tx = db.transaction((arr) => {
        for (const p of arr) {
          const qty = Number(p.quantity) || 0;
          if (qty <= 0) { job.skippedNoStock++; continue; }
          if (!p.code) continue;
          upsert.run(
            String(p.code),
            p.id != null ? Number(p.id) : null,
            p.name || null,
            p.category_path || null,
            qty,
            Number(p.price) || 0,
            p.currency || null,
            null,                  // country: DropXL 当前 API 不带国家维度，留空
            p.updated_at || null,
            now,
            job.syncId,
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

    // 清理上一轮同步遗留的、本轮没出现的商品（含已不再有库存的）
    const del = db.prepare('DELETE FROM dropxl_products WHERE sync_id != ? OR sync_id IS NULL').run(job.syncId);
    job.deleted = del.changes;

    job.status = 'done';
    job.finishedAt = new Date().toISOString();
  } catch (e) {
    job.status = 'failed';
    job.error = e.message;
    job.finishedAt = new Date().toISOString();
  }
}

// ============ 同步任务 ============
router.post('/sync', ownerRequired, (req, res) => {
  for (const j of syncJobs.values()) {
    if (j.status === 'running') {
      return res.status(409).json({ error: '已有商品同步任务在运行中，请等待完成' });
    }
  }
  cleanupOldSyncJobs();
  const syncId = Date.now();
  const job = {
    syncId,
    status: 'running',
    progress: { fetched: 0, total: null },
    fetched: 0,
    upserted: 0,
    skippedNoStock: 0,
    deleted: 0,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    startedBy: req.user.username,
  };
  syncJobs.set(String(syncId), job);
  runProductSync(job);
  setAudit(res, { summary: `启动 DropXL 商品同步` });
  res.json({ syncId });
});

router.get('/sync', (req, res) => {
  const list = Array.from(syncJobs.values()).sort((a, b) => b.syncId - a.syncId).slice(0, 20);
  res.json({ jobs: list });
});

router.get('/sync/:id', (req, res) => {
  const job = syncJobs.get(String(req.params.id));
  if (!job) return res.status(404).json({ error: '同步任务不存在或已过期' });
  res.json(job);
});

// ============ 商品列表（带筛选） ============
router.get('/', (req, res) => {
  const {
    q = '', country = '', min_price = '', max_price = '',
    min_quantity = '', limit = 50, offset = 0,
  } = req.query;

  const conds = [];
  const args = [];
  if (q.trim()) {
    conds.push('(code LIKE ? OR name LIKE ?)');
    args.push(`%${q.trim()}%`, `%${q.trim()}%`);
  }
  if (country.trim()) {
    conds.push('country = ?');
    args.push(country.trim());
  }
  if (min_price !== '' && !isNaN(Number(min_price))) {
    conds.push('price >= ?'); args.push(Number(min_price));
  }
  if (max_price !== '' && !isNaN(Number(max_price))) {
    conds.push('price <= ?'); args.push(Number(max_price));
  }
  if (min_quantity !== '' && !isNaN(Number(min_quantity))) {
    conds.push('quantity >= ?'); args.push(Number(min_quantity));
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM dropxl_products ${where}`).get(...args).c;
  const rows = db.prepare(`
    SELECT code, dropxl_id, name, category_path, quantity, price, currency, country, dropxl_updated_at, synced_at
    FROM dropxl_products
    ${where}
    ORDER BY name ASC
    LIMIT ? OFFSET ?
  `).all(...args, Number(limit), Number(offset));

  const lastSync = db.prepare('SELECT MAX(synced_at) AS t FROM dropxl_products').get().t;

  res.json({ rows, total, last_synced_at: lastSync });
});

// 单个商品按 code 查询 - 给批量采购匹配用
router.get('/by-code/:code', (req, res) => {
  const row = db.prepare('SELECT * FROM dropxl_products WHERE code = ?').get(req.params.code);
  if (!row) return res.status(404).json({ error: '未找到商品' });
  res.json(row);
});

// ============ 国家加价规则 ============
router.get('/country-markup', (req, res) => {
  const rows = db.prepare('SELECT country, markup_pct, updated_at FROM country_markup ORDER BY country').all();
  res.json(rows);
});

router.put('/country-markup/:country', ownerRequired, (req, res) => {
  const { markup_pct } = req.body || {};
  const v = Number(markup_pct);
  if (!isFinite(v) || v < 0) return res.status(400).json({ error: '加价百分比必须是非负数' });
  const country = req.params.country;
  const cur = db.prepare('SELECT markup_pct FROM country_markup WHERE country = ?').get(country);
  if (cur) {
    db.prepare(`
      UPDATE country_markup SET markup_pct = ?, updated_at = CURRENT_TIMESTAMP WHERE country = ?
    `).run(v, country);
    setAudit(res, { target_name: country, summary: `${country} 加价: ${cur.markup_pct}% → ${v}%` });
  } else {
    db.prepare(`
      INSERT INTO country_markup (country, markup_pct) VALUES (?, ?)
    `).run(country, v);
    setAudit(res, { target_name: country, summary: `新增 ${country} 加价规则: ${v}%` });
  }
  res.json({ ok: true });
});

module.exports = router;
