const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { vatFactor } = require('../vat');
const { brandText } = require('../brand');

// 产品展示（分销商可用）：商品名称 / 分类 / 主图 / 库存 + 采购价。
// 价格只返回加价后的采购价（原价 × (1+增值税%) × (1+加价%)），绝不返回 B2B 原价、加价%、增值税率。
const router = express.Router();
router.use(authRequired);

const COUNTRY_TO_CODE = { 美国: 'US', 英国: 'GB', 德国: 'DE', 法国: 'FR', 荷兰: 'NL', 意大利: 'IT', 西班牙: 'ES', 波兰: 'PL' };
const COUNTRY_CODE_TO_NAME = Object.fromEntries(Object.entries(COUNTRY_TO_CODE).map(([k, v]) => [v, k]));
function resolveCountry(input) {
  const s = String(input || '').trim();
  if (COUNTRY_TO_CODE[s]) return s;
  return COUNTRY_CODE_TO_NAME[s.toUpperCase()] || null;
}

const Q_MARKUP = db.prepare('SELECT markup_pct FROM country_markup WHERE country = ?');
const Q_HAS_MASTER = db.prepare('SELECT 1 FROM country_master_uploads WHERE country = ? LIMIT 1');
const Q_STATS = db.prepare('SELECT category, total, in_stock FROM product_category_stats WHERE country = ? ORDER BY total DESC');

// 分类侧栏（读快照表，不扫商品表）
router.get('/categories', (req, res) => {
  const country = resolveCountry(req.query.country);
  if (!country) return res.status(400).json({ error: '请选择国家' });
  const rows = Q_STATS.all(country);
  res.json({
    total: rows.reduce((s, r) => s + r.total, 0),
    in_stock: rows.reduce((s, r) => s + r.in_stock, 0),
    categories: rows.map(r => ({ name: r.category, label: brandText(r.category), total: r.total, in_stock: r.in_stock })),
  });
});

router.get('/', (req, res) => {
  const country = resolveCountry(req.query.country);
  if (!country) return res.status(400).json({ error: '请选择国家' });
  const q = String(req.query.q || '').trim();
  const category = req.query.category === undefined ? null : String(req.query.category);
  const inStock = req.query.in_stock === '1';
  const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 60);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const hasMaster = Q_HAS_MASTER.get(country);
  const conds = ['p.country = ?'];
  const args = [country];
  if (hasMaster) conds.push('m.sku IS NOT NULL');
  // 分类用 p.category = ? 才能走 idx_dropxl_products_cat_sort；'' 表示未分类
  if (category === '') conds.push("(p.category IS NULL OR p.category = '')");
  else if (category !== null) { conds.push('p.category = ?'); args.push(category); }
  if (inStock) conds.push('p.stock > 0');
  if (q) { conds.push('(p.code LIKE ? OR p.name LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const from = `FROM dropxl_products p LEFT JOIN country_master_skus m ON m.country = p.country AND m.sku = p.code WHERE ${conds.join(' AND ')}`;

  const rows = db.prepare(`
    SELECT p.code, p.name, p.category_path, p.stock, p.b2b_price, COALESCE(m.image_url, p.image_url) AS image_url
    ${from}
    ORDER BY CAST(p.code AS INTEGER) ASC, p.code ASC
    LIMIT ? OFFSET ?
  `).all(...args, limit, offset);

  // 总数：无关键词搜索时读分类计数快照；快照尚未生成（首次同步前）或有关键词时才实时计数
  let total = null;
  if (!q) {
    const stats = Q_STATS.all(country);
    if (stats.length) {
      const pick = category === null ? stats : stats.filter(s => s.category === category);
      total = pick.reduce((s, r) => s + (inStock ? r.in_stock : r.total), 0);
    }
  }
  if (total === null) total = db.prepare(`SELECT COUNT(*) AS c ${from}`).get(...args).c;

  const factor = vatFactor(country) * (1 + (Number(Q_MARKUP.get(country)?.markup_pct) || 0) / 100);
  res.json({
    country,
    total,
    rows: rows.map(({ b2b_price, ...r }) => ({
      ...r, name: brandText(r.name), category_path: brandText(r.category_path),
      price: Math.round(b2b_price * factor * 100) / 100,
    })),
  });
});

module.exports = router;
