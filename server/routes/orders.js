const express = require('express');
const path = require('path');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { ensurePushed, withUserLock } = require('../supplierPush');

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
           created_at, updated_at, confirmed_at
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
           created_at, updated_at, confirmed_at
    FROM purchase_orders WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  // 商品单价不直接返回库里存的 unit_price：部分来源（如「导入历史订单」）存的是供应商真实单价。
  // 按各行金额占比把订单「采购(原币)」总额分摊到各行，保证分销商看到的单价合计 = 其采购价，不暴露真实成本。
  const rawItems = db.prepare('SELECT id, sku, product_name, quantity, unit_price FROM purchase_order_items WHERE order_id = ?').all(row.id);
  const lineTotal = (it) => (Number(it.unit_price) || 0) * (Number(it.quantity) || 0);
  const rawSum = rawItems.reduce((t, it) => t + lineTotal(it), 0);
  const totalQty = rawItems.reduce((t, it) => t + (Number(it.quantity) || 0), 0);
  const display = Number(row.purchase_amount_usd) || 0;
  const items = rawItems.map(it => {
    const qty = Number(it.quantity) || 0;
    const share = rawSum > 0 ? lineTotal(it) / rawSum : (totalQty > 0 ? qty / totalQty : 0);
    return { id: it.id, sku: it.sku, product_name: it.product_name, quantity: it.quantity, unit_price: qty > 0 ? display * share / qty : 0 };
  });
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

  // 提交时只在本地入库（待采购），不推送供应商；点击「确认采购」时才推送。
  // 价格按 (国家, SKU) 从本地供应商商品库取（与批量导入一致），SKU 不在库时按 0 入库，由管理员核定。
  const qProduct = db.prepare('SELECT b2b_price FROM dropxl_products WHERE country = ? AND code = ?');
  let realUsd = 0;
  for (const i of items) {
    const p = qProduct.get(country, String(i.sku || '').trim());
    realUsd += (Number(p?.b2b_price) || 0) * (Number(i.quantity) || 1);
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
       status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_purchase')
    `).run(req.user.id, order_no, customer_ref, shop_name, country, amazon_amount, amazon_tax_amount, shipping_fee,
      realUsd, displayUsd, displayCny, exchange_rate, markupPct);

    const orderId = info.lastInsertRowid;
    const insItem = db.prepare('INSERT INTO purchase_order_items (order_id, sku, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)');
    for (const it of items) insItem.run(orderId, it.sku, it.product_name || '', it.quantity || 1, it.unit_price || 0);
    // 收货地址存入 purchase_order_shipping，确认采购推送供应商时据此拼请求体
    const a = shipping_address || {};
    db.prepare(`
      INSERT INTO purchase_order_shipping (order_id, name, address1, address2, city, state, postal, country, phone, buyer_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderId, a.name || null, a.street || null, null, a.city || null, a.state || null, a.zip || null, a.country || null, a.phone || null, a.email || null);
    return orderId;
  });

  const id = tx();
  res.json({ ok: true, id, message: '订单已提交（待采购），点击「确认采购」后才会推送到供应商' });
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
  // 填写了跟踪号的待发货订单自动转为已发货
  if (track) db.prepare("UPDATE purchase_orders SET status = 'shipped' WHERE id = ? AND status = 'pending_shipment' AND COALESCE(tracking_no, '') <> ''").run(req.params.id);
  res.json({ ok: true });
});

// 分销商编辑自己「待采购」订单的收货地址与亚马逊金额（确认采购时按新地址推送供应商）
router.put('/:id/shipping', authRequired, (req, res) => {
  const o = db.prepare('SELECT id, status FROM purchase_orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!o) return res.status(404).json({ error: '订单不存在或不属于你' });
  if (o.status !== 'pending_purchase') return res.status(400).json({ error: '只有「待采购」订单可以修改收货信息' });
  const b = req.body || {};
  const s = (v) => (v == null ? null : String(v).trim().slice(0, 200));
  const amt = b.amazon_amount === undefined || b.amazon_amount === '' ? null : Number(b.amazon_amount);
  if (amt != null && (!isFinite(amt) || amt < 0)) return res.status(400).json({ error: '亚马逊金额无效' });
  db.transaction(() => {
    db.prepare(`
      INSERT INTO purchase_order_shipping (order_id, name, address1, address2, city, state, postal, phone, buyer_email)
      VALUES (@order_id, @name, @address1, @address2, @city, @state, @postal, @phone, @buyer_email)
      ON CONFLICT(order_id) DO UPDATE SET
        name=@name, address1=@address1, address2=@address2, city=@city, state=@state,
        postal=@postal, phone=@phone, buyer_email=@buyer_email
    `).run({
      order_id: o.id, name: s(b.name), address1: s(b.address1), address2: s(b.address2),
      city: s(b.city), state: s(b.state), postal: s(b.postal), phone: s(b.phone), buyer_email: s(b.buyer_email),
    });
    if (amt != null) db.prepare('UPDATE purchase_orders SET amazon_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(amt, o.id);
  })();
  res.json({ ok: true });
});

// 分销商自己确认采购：按订单已记录的「采购(¥)」金额（列表所见金额）从自己余额扣款，
// 余额不足则拦截（需 BOSS 先手动充值）。分销商不能改汇率/价格，也不返回真实采购价。
// 余额检查通过后先推送供应商（未推送过的订单），推送成功才扣款；推送失败不扣款、订单保持待采购。
router.post('/:id/confirm', authRequired, async (req, res) => {
  const o = db.prepare(`
    SELECT id, order_no, status, purchase_amount_cny
    FROM purchase_orders WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user.id);
  if (!o) return res.status(404).json({ error: '订单不存在或不属于你' });
  if (o.status !== 'pending_purchase') return res.status(400).json({ error: '只有「待采购」订单可以确认采购' });

  const cny = Number(o.purchase_amount_cny) || 0;
  if (!(cny > 0)) return res.status(400).json({ error: '该订单采购(¥)金额尚未计算，请联系管理员核对后再确认' });

  let bal;
  // 管理员/BOSS 账号自己名下的订单允许透支（同管理员端确认采购）
  const checkBalance = () => {
    bal = db.prepare('SELECT balance FROM user_balance WHERE user_id = ?').get(req.user.id);
    if (!req.user.is_admin && (bal?.balance || 0) < cny) {
      throw Object.assign(new Error(`余额不足，需要 ¥${cny.toFixed(2)}，当前 ¥${(bal?.balance || 0).toFixed(2)}，请联系 BOSS 充值`), { status: 400 });
    }
  };
  const tx = db.transaction(() => {
    const st = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(o.id);
    if (st?.status !== 'pending_purchase') throw Object.assign(new Error('订单状态已变化，请刷新后重试'), { status: 409 });
    if (!bal) db.prepare('INSERT OR IGNORE INTO user_balance (user_id, balance) VALUES (?, 0)').run(req.user.id);
    const newBal = (bal?.balance || 0) - cny;
    db.prepare('UPDATE user_balance SET balance = ? WHERE user_id = ?').run(newBal, req.user.id);
    db.prepare(`
      INSERT INTO balance_records (user_id, type, amount, balance_after, description, related_order)
      VALUES (?, '扣除', ?, ?, ?, ?)
    `).run(req.user.id, -cny, newBal, `订单采购 - ${o.order_no}（用户自行确认）`, o.order_no);
    db.prepare(`
      UPDATE purchase_orders SET status = 'pending_shipment', confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(o.id);
  });
  try {
    await withUserLock(req.user.id, async () => {
      const fresh = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(o.id);
      if (fresh?.status !== 'pending_purchase') throw Object.assign(new Error('订单状态已变化，请刷新后重试'), { status: 409 });
      checkBalance();
      await ensurePushed(fresh);
      checkBalance();
      tx();
    });
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message });
  }
  res.json({ ok: true, deducted: cny });
});

// 注意：DropXL 同步功能已下放到管理后台 (POST /api/admin/orders/sync)，
// 分销商端不再开放（避免占用 DropXL 限速配额、避免分销商触发上游 API）

module.exports = router;
