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
           amazon_amount, amazon_tax_amount, shipping_fee, amazon_rate_locked,
           purchase_amount_usd, purchase_amount_cny, exchange_rate,
           distributor_refund, tracking_no, shipping_carrier, status,
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
           amazon_amount, amazon_tax_amount, shipping_fee, amazon_rate_locked,
           purchase_amount_usd, purchase_amount_cny, exchange_rate,
           distributor_refund, tracking_no, shipping_carrier, status,
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

  // 采购汇率 = 该国亚马逊汇率 × 1.012，按订单国家取；未设置则回退到旧全局 USD 汇率
  const { purchaseRateForCountry, getExchangeRate } = require('../settings');
  const exchange_rate = purchaseRateForCountry(country) || getExchangeRate();

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

  // 读取订单国家的加价百分比（与批量导入一致），自动计算用户可见的"显示采购价"
  const m = db.prepare('SELECT markup_pct FROM country_markup WHERE country = ?').get(country);
  const markupPct = Number(m?.markup_pct) || 0;
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

// 用户只允许更新本地销售/费用字段与物流跟踪号，不会推回 DropXL，不影响订单状态/采购价
router.put('/:id', authRequired, (req, res) => {
  const { amazon_amount, amazon_tax_amount, shipping_fee, tracking_no } = req.body || {};
  const own = db.prepare('SELECT id FROM purchase_orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!own) return res.status(404).json({ error: '订单不存在或不属于你' });
  const amt = amazon_amount === undefined ? null : Number(amazon_amount);
  const tax = amazon_tax_amount === undefined ? null : Number(amazon_tax_amount);
  const ship = shipping_fee === undefined ? null : Number(shipping_fee);
  const track = tracking_no === undefined ? null : String(tracking_no).trim().slice(0, 100);
  db.prepare(`
    UPDATE purchase_orders
    SET amazon_amount = COALESCE(?, amazon_amount),
        amazon_tax_amount = COALESCE(?, amazon_tax_amount),
        shipping_fee = COALESCE(?, shipping_fee),
        tracking_no = COALESCE(?, tracking_no),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(amt, tax, ship, track, req.params.id, req.user.id);
  res.json({ ok: true });
});

// 分销商自己确认采购：按订单已记录的「采购(¥)」金额（列表所见金额）从自己余额扣款，
// 余额不足则拦截（需 BOSS 先手动充值）。分销商不能改汇率/价格，也不返回真实采购价。
router.post('/:id/confirm', authRequired, (req, res) => {
  const o = db.prepare(`
    SELECT id, order_no, status, purchase_amount_cny
    FROM purchase_orders WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user.id);
  if (!o) return res.status(404).json({ error: '订单不存在或不属于你' });
  if (o.status !== 'pending_purchase') return res.status(400).json({ error: '只有「待采购」订单可以确认采购' });

  const cny = Number(o.purchase_amount_cny) || 0;
  if (!(cny > 0)) return res.status(400).json({ error: '该订单采购(¥)金额尚未计算，请联系管理员核对后再确认' });

  const bal = db.prepare('SELECT balance FROM user_balance WHERE user_id = ?').get(req.user.id);
  // 管理员/BOSS 账号自己名下的订单允许透支（同管理员端确认采购）
  if (!req.user.is_admin && (bal?.balance || 0) < cny) {
    return res.status(400).json({ error: `余额不足，需要 ¥${cny.toFixed(2)}，当前 ¥${(bal?.balance || 0).toFixed(2)}，请联系 BOSS 充值` });
  }

  db.transaction(() => {
    if (!bal) db.prepare('INSERT OR IGNORE INTO user_balance (user_id, balance) VALUES (?, 0)').run(req.user.id);
    const newBal = (bal?.balance || 0) - cny;
    db.prepare('UPDATE user_balance SET balance = ? WHERE user_id = ?').run(newBal, req.user.id);
    db.prepare(`
      INSERT INTO balance_records (user_id, type, amount, balance_after, description, related_order)
      VALUES (?, '扣除', ?, ?, ?, ?)
    `).run(req.user.id, -cny, newBal, `订单采购 - ${o.order_no}（用户自行确认）`, o.order_no);
    db.prepare(`
      UPDATE purchase_orders SET status = 'pending_shipment', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(o.id);
  })();
  res.json({ ok: true, deducted: cny });
});

// 用户删除自己的订单：仅限「待采购」（尚未确认采购），避免删单绕过扣款。
// 个别「待采购」单可能已扣过款（管理员手工新增订单时扣款），删除时按净扣款退回余额（同管理员删单）。
// 只删本地记录，不会取消已推送到供应商的订单。
router.delete('/:id', authRequired, (req, res) => {
  const o = db.prepare('SELECT id, order_no, status FROM purchase_orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!o) return res.status(404).json({ error: '订单不存在或不属于你' });
  if (o.status !== 'pending_purchase') return res.status(400).json({ error: '只能删除「待采购」状态的订单' });
  const net = db.prepare('SELECT IFNULL(SUM(amount), 0) AS s FROM balance_records WHERE user_id = ? AND related_order = ?').get(req.user.id, o.order_no).s;
  const refund = net < 0 ? -net : 0;
  db.transaction(() => {
    if (refund > 0) {
      const bal = db.prepare('SELECT balance FROM user_balance WHERE user_id = ?').get(req.user.id);
      if (!bal) db.prepare('INSERT OR IGNORE INTO user_balance (user_id, balance) VALUES (?, 0)').run(req.user.id);
      const newBal = (bal?.balance || 0) + refund;
      db.prepare('UPDATE user_balance SET balance = ? WHERE user_id = ?').run(newBal, req.user.id);
      db.prepare(`
        INSERT INTO balance_records (user_id, type, amount, balance_after, description, related_order)
        VALUES (?, '退款', ?, ?, ?, ?)
      `).run(req.user.id, refund, newBal, `订单删除退款 - ${o.order_no}`, o.order_no);
    }
    db.prepare('DELETE FROM purchase_order_items WHERE order_id = ?').run(o.id);
    db.prepare('DELETE FROM purchase_order_shipping WHERE order_id = ?').run(o.id);
    db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(o.id);
  })();
  res.json({ ok: true, refunded: refund });
});

// 注意：DropXL 同步功能已下放到管理后台 (POST /api/admin/orders/sync)，
// 分销商端不再开放（避免占用 DropXL 限速配额、避免分销商触发上游 API）

module.exports = router;
