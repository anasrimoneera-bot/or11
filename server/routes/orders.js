const express = require('express');
const path = require('path');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const dropxl = require('../dropxl');

const router = express.Router();

// 下载亚马逊订单批量采购模板（任何登录用户都可下载）
router.get('/template', authRequired, (req, res) => {
  const file = path.join(__dirname, '..', 'templates', 'amazon-order-template.xlsx');
  res.download(file, 'amazon-order-template.xlsx');
});

// 当前用户所有订单里出现过的 shop_name (去重，按字母排序)
router.get('/shop-names', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT shop_name FROM purchase_orders
    WHERE user_id = ? AND shop_name IS NOT NULL AND shop_name != ''
    ORDER BY shop_name ASC
  `).all(req.user.id);
  res.json(rows.map(r => r.shop_name));
});

router.get('/', authRequired, (req, res) => {
  const { status, country, shop, q, start, end, limit = 50, offset = 0 } = req.query;
  const conds = ['user_id = ?'];
  const args = [req.user.id];
  if (status && status !== 'all') { conds.push('status = ?'); args.push(status); }
  if (country) { conds.push('country = ?'); args.push(country); }
  if (shop) { conds.push('shop_name = ?'); args.push(shop); }
  if (q) {
    conds.push('(order_no LIKE ? OR customer_ref LIKE ? OR shop_name LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (start) { conds.push('created_at >= ?'); args.push(start); }
  if (end) { conds.push('created_at <= ?'); args.push(end); }
  const where = 'WHERE ' + conds.join(' AND ');
  // 注意：不返回 real_amount_usd / raw_payload / raw_response，避免暴露真实采购价
  const rows = db.prepare(`
    SELECT id, user_id, order_no, customer_ref, shop_name, country,
           amazon_amount, amazon_tax_amount, shipping_fee,
           purchase_amount_usd, purchase_amount_cny, exchange_rate,
           distributor_refund, tracking_no, status,
           created_at, updated_at
    FROM purchase_orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...args, Number(limit), Number(offset));
  const total = db.prepare(`SELECT COUNT(*) AS c FROM purchase_orders ${where}`).get(...args).c;
  res.json({ rows, total });
});

router.get('/stats', authRequired, (req, res) => {
  const userId = req.user.id;
  const counts = {
    all: db.prepare('SELECT COUNT(*) AS c FROM purchase_orders WHERE user_id = ?').get(userId).c,
    pending_purchase: db.prepare("SELECT COUNT(*) AS c FROM purchase_orders WHERE user_id = ? AND status = 'pending_purchase'").get(userId).c,
    pending_shipment: db.prepare("SELECT COUNT(*) AS c FROM purchase_orders WHERE user_id = ? AND status = 'pending_shipment'").get(userId).c,
    shipped: db.prepare("SELECT COUNT(*) AS c FROM purchase_orders WHERE user_id = ? AND status = 'shipped'").get(userId).c,
    completed: db.prepare("SELECT COUNT(*) AS c FROM purchase_orders WHERE user_id = ? AND status = 'completed'").get(userId).c,
    cancelled: db.prepare("SELECT COUNT(*) AS c FROM purchase_orders WHERE user_id = ? AND status = 'cancelled'").get(userId).c,
    refunded: db.prepare("SELECT COUNT(*) AS c FROM purchase_orders WHERE user_id = ? AND status = 'refunded'").get(userId).c,
    replaced: db.prepare("SELECT COUNT(*) AS c FROM purchase_orders WHERE user_id = ? AND status = 'replaced'").get(userId).c,
  };
  res.json(counts);
});

router.get('/:id', authRequired, (req, res) => {
  const row = db.prepare(`
    SELECT id, user_id, order_no, customer_ref, shop_name, country,
           amazon_amount, amazon_tax_amount, shipping_fee,
           purchase_amount_usd, purchase_amount_cny, exchange_rate,
           distributor_refund, tracking_no, status,
           created_at, updated_at
    FROM purchase_orders WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  const items = db.prepare('SELECT * FROM purchase_order_items WHERE order_id = ?').all(row.id);
  const shipping = db.prepare('SELECT * FROM purchase_order_shipping WHERE order_id = ?').get(row.id);
  res.json({ ...row, items, shipping: shipping || null });
});

router.post('/', authRequired, async (req, res) => {
  const {
    order_no, customer_ref, shop_name, country,
    amazon_amount = 0, amazon_tax_amount = 0, shipping_fee = 0,
    items = [],
    shipping_address,
  } = req.body || {};

  // 汇率统一由店主在系统设置中维护，分销商提交的值会被忽略
  const exchange_rate = require('../settings').getExchangeRate();

  if (!order_no) return res.status(400).json({ error: '请填写订单号' });
  if (!items.length) return res.status(400).json({ error: '请至少添加一个商品' });

  // 用户提交时立刻调用 DropXL 创建订单（不扣款）
  const payload = {
    customer_order_reference: customer_ref || order_no,
    shipping_address,
    products: items.map(i => ({ sku: i.sku, quantity: Number(i.quantity) || 1 })),
  };

  let dropxlOrderId = null;
  let rawResp = null;
  let realUsd = 0;
  try {
    const resp = await dropxl.createOrder(payload);
    rawResp = JSON.stringify(resp);
    dropxlOrderId = resp?.id || resp?.order_id || null;
    realUsd = dropxl.extractRealAmountUSD(resp);
  } catch (e) {
    return res.status(502).json({ error: 'DropXL下单失败: ' + e.message, detail: e.data });
  }

  // 读取用户加价百分比，自动计算用户可见的"显示采购价"
  const u = db.prepare('SELECT markup_pct FROM users WHERE id = ?').get(req.user.id);
  const markupPct = Number(u?.markup_pct) || 0;
  const displayUsd = realUsd * (1 + markupPct / 100);
  const displayCny = displayUsd * Number(exchange_rate);

  // 创建本地待付款记录 - 真实价隐藏，显示价用于扣款
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO purchase_orders
      (user_id, order_no, customer_ref, shop_name, country, amazon_amount, amazon_tax_amount, shipping_fee,
       real_amount_usd, purchase_amount_usd, purchase_amount_cny, exchange_rate, markup_pct,
       status, dropxl_order_id, raw_payload, raw_response)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_purchase', ?, ?, ?)
    `).run(req.user.id, order_no, customer_ref, shop_name, country, amazon_amount, amazon_tax_amount, shipping_fee,
      realUsd, displayUsd, displayCny, exchange_rate, markupPct, dropxlOrderId, JSON.stringify(payload), rawResp);

    const orderId = info.lastInsertRowid;
    const insItem = db.prepare('INSERT INTO purchase_order_items (order_id, sku, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)');
    for (const it of items) insItem.run(orderId, it.sku, it.product_name || '', it.quantity || 1, it.unit_price || 0);
    return orderId;
  });

  const id = tx();
  res.json({ ok: true, id, dropxl_order_id: dropxlOrderId, message: 'DropXL订单创建成功，等待管理员确认采购金额' });
});

// 用户只允许更新本地销售/费用字段，不会推回 DropXL，不影响订单状态/跟踪号/采购价
router.put('/:id', authRequired, (req, res) => {
  const { amazon_amount, amazon_tax_amount, shipping_fee } = req.body || {};
  const own = db.prepare('SELECT id FROM purchase_orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!own) return res.status(404).json({ error: '订单不存在或不属于你' });
  const amt = amazon_amount === undefined ? null : Number(amazon_amount);
  const tax = amazon_tax_amount === undefined ? null : Number(amazon_tax_amount);
  const ship = shipping_fee === undefined ? null : Number(shipping_fee);
  db.prepare(`
    UPDATE purchase_orders
    SET amazon_amount = COALESCE(?, amazon_amount),
        amazon_tax_amount = COALESCE(?, amazon_tax_amount),
        shipping_fee = COALESCE(?, shipping_fee),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(amt, tax, ship, req.params.id, req.user.id);
  res.json({ ok: true });
});

// 注意：DropXL 同步功能已下放到管理后台 (POST /api/admin/orders/sync)，
// 分销商端不再开放（避免占用 DropXL 限速配额、避免分销商触发上游 API）

module.exports = router;
