const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { vatFactor } = require('../vat');
const { brandText } = require('../brand');

// 产品展示（分销商可用）：商品资料优先取销售总表（标题 / 属性 / 描述 / 分类 / 图片1-9），
// 未上传总表的国家回落到 API 同步的名称 / 分类；库存取库存文件（dropxl_products）。
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
const priceFactor = (country) => vatFactor(country) * (1 + (Number(Q_MARKUP.get(country)?.markup_pct) || 0) / 100);
const toPrice = (b2b, factor) => Math.round((Number(b2b) || 0) * factor * 100) / 100;

// 第一级分类（含未分类 ''）的行加起来就是全部商品数；更深层级的行是它们的子集
const isTopLevel = (path) => !path.includes(' > ');

// 分类树（读快照表，不扫商品表）：返回每一级路径前缀及其计数，前端拼成树
router.get('/categories', (req, res) => {
  const country = resolveCountry(req.query.country);
  if (!country) return res.status(400).json({ error: '请选择国家' });
  const rows = Q_STATS.all(country);
  const top = rows.filter(r => isTopLevel(r.category));
  res.json({
    total: top.reduce((s, r) => s + r.total, 0),
    in_stock: top.reduce((s, r) => s + r.in_stock, 0),
    categories: rows.map(r => ({ name: r.category, label: brandText(r.category), total: r.total, in_stock: r.in_stock })),
  });
});

// 商品详情
router.get('/item', (req, res) => {
  const country = resolveCountry(req.query.country);
  const code = String(req.query.code || '').trim();
  if (!country || !code) return res.status(400).json({ error: '参数错误' });
  const r = db.prepare(`
    SELECT p.code, p.stock, p.b2b_price, p.name, p.category_path AS api_category, p.image_url AS api_image,
           m.sku AS master_sku, m.title, m.category_path, m.properties, m.description, m.images, m.image_url
    FROM dropxl_products p
    LEFT JOIN country_master_skus m ON m.country = p.country AND m.sku = p.code
    WHERE p.country = ? AND p.code = ?
  `).get(country, code);
  // 上传了总表的国家只开放总表里的 SKU（与列表一致）
  if (!r || (Q_HAS_MASTER.get(country) && !r.master_sku)) return res.status(404).json({ error: '商品不存在' });
  let images = [];
  try { images = r.images ? JSON.parse(r.images) : []; } catch { images = []; }
  if (!images.length) images = [r.image_url || r.api_image].filter(Boolean);
  res.json({
    country,
    code: r.code,
    name: brandText(r.title || r.name),
    category_path: brandText(r.category_path || (r.api_category ? r.api_category.split('/').join(' > ') : null)),
    properties: brandText(r.properties),
    description: brandText(r.description),
    images,
    stock: r.stock,
    price: toPrice(r.b2b_price, priceFactor(country)),
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

  // 有总表：以总表为主表（白名单 + 资料 + 分类），JOIN 库存表取库存/价格；
  // 没总表：直接查库存表（API 同步的名称/分类）。分类条件写成 x.category = ? 才能走对应排序索引。
  const hasMaster = !!Q_HAS_MASTER.get(country);
  const t = hasMaster ? 'm' : 'p';
  const key = hasMaster ? 'm.sku' : 'p.code';
  const conds = [`${t}.country = ?`];
  const args = [country];
  if (category === '') conds.push(`(${t}.category IS NULL OR ${t}.category = '')`);
  else if (category !== null) {
    // 任意一级分类：第一级用 x.category = ? 走排序索引，更深层级再按分类路径前缀过滤
    const parts = category.split(' > ');
    conds.push(`${t}.category = ?`); args.push(parts[0]);
    if (parts.length > 1) {
      const pathExpr = hasMaster ? 'm.category_path' : "REPLACE(p.category_path, '/', ' > ')";
      conds.push(`(${pathExpr} = ? OR substr(${pathExpr}, 1, ?) = ?)`);
      args.push(category, category.length + 3, `${category} > `);
    }
  }
  if (inStock) conds.push('p.stock > 0');
  if (q) {
    conds.push(hasMaster ? '(m.sku LIKE ? OR m.title LIKE ?)' : '(p.code LIKE ? OR p.name LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  const from = hasMaster
    ? `FROM country_master_skus m JOIN dropxl_products p ON p.country = m.country AND p.code = m.sku WHERE ${conds.join(' AND ')}`
    : `FROM dropxl_products p WHERE ${conds.join(' AND ')}`;

  const rows = db.prepare(`
    SELECT ${key} AS code, ${hasMaster ? 'COALESCE(m.title, p.name)' : 'p.name'} AS name,
           ${hasMaster ? 'm.category_path' : 'p.category_path'} AS category_path,
           p.stock, p.b2b_price, ${hasMaster ? 'COALESCE(m.image_url, p.image_url)' : 'p.image_url'} AS image_url
    ${from}
    ORDER BY CAST(${key} AS INTEGER) ASC, ${key} ASC
    LIMIT ? OFFSET ?
  `).all(...args, limit, offset);

  // 总数：无关键词搜索时读分类计数快照；快照尚未生成或有关键词时才实时计数
  let total = null;
  if (!q) {
    const stats = Q_STATS.all(country);
    if (stats.length) {
      const pick = category === null ? stats.filter(s => isTopLevel(s.category)) : stats.filter(s => s.category === category);
      total = pick.reduce((s, r) => s + (inStock ? r.in_stock : r.total), 0);
    }
  }
  if (total === null) total = db.prepare(`SELECT COUNT(*) AS c ${from}`).get(...args).c;

  const factor = priceFactor(country);
  res.json({
    country,
    total,
    rows: rows.map(({ b2b_price, ...r }) => ({
      ...r, name: brandText(r.name), category_path: brandText(r.category_path),
      price: toPrice(b2b_price, factor),
    })),
  });
});

module.exports = router;
