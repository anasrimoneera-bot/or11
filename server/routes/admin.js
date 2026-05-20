const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const dropxl = require('../dropxl');
const { authRequired, adminRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired, adminRequired);

// ============ 概览 ============
router.get('/overview', (req, res) => {
  const totalUsers = db.prepare("SELECT COUNT(*) AS c FROM users WHERE is_admin = 0").get().c;
  const pendingOrders = db.prepare("SELECT COUNT(*) AS c FROM purchase_orders WHERE status = 'pending_purchase'").get().c;
  const pendingTickets = db.prepare("SELECT COUNT(*) AS c FROM aftersales_tickets WHERE status IN ('pending','processing','waiting_refund')").get().c;
  const totalBalance = db.prepare(`
    SELECT IFNULL(SUM(b.balance), 0) AS t
    FROM user_balance b JOIN users u ON u.id = b.user_id
    WHERE u.is_admin = 0
  `).get().t;
  res.json({ totalUsers, pendingOrders, pendingTickets, totalBalance });
});

// ============ 用户管理 ============
router.get('/users', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.email, u.phone, u.company, u.role,
           u.member_level, u.member_days, u.sku_limit, u.created_at,
           IFNULL(b.balance, 0) AS balance
    FROM users u
    LEFT JOIN user_balance b ON b.user_id = u.id
    WHERE u.is_admin = 0
    ORDER BY u.created_at DESC
  `).all();
  res.json(rows);
});

router.post('/users', (req, res) => {
  const { username, password, display_name, email, member_level, sku_limit } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return res.status(400).json({ error: '用户名已存在' });
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, display_name, email, role, member_level, sku_limit)
    VALUES (?, ?, ?, ?, 'distributor', ?, ?)
  `).run(username, hash, display_name, email, member_level || '一级分销', Number(sku_limit) || 100);
  db.prepare('INSERT INTO user_balance (user_id, balance) VALUES (?, 0)').run(info.lastInsertRowid);
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/users/:id', (req, res) => {
  const { display_name, email, phone, company, member_level, sku_limit, member_days } = req.body || {};
  db.prepare(`
    UPDATE users
       SET display_name = COALESCE(?, display_name),
           email = COALESCE(?, email),
           phone = COALESCE(?, phone),
           company = COALESCE(?, company),
           member_level = COALESCE(?, member_level),
           sku_limit = COALESCE(?, sku_limit),
           member_days = COALESCE(?, member_days)
     WHERE id = ?
  `).run(display_name, email, phone, company, member_level, sku_limit, member_days, req.params.id);
  res.json({ ok: true });
});

router.post('/users/:id/reset-password', (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 6) return res.status(400).json({ error: '密码至少6位' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ ok: true });
});

// ============ 用户余额管理 ============
router.post('/users/:id/balance', (req, res) => {
  const { amount, type, description } = req.body || {};
  const amt = Number(amount);
  if (!amt || !isFinite(amt)) return res.status(400).json({ error: '请输入有效金额' });
  const userId = Number(req.params.id);
  const t = type || (amt > 0 ? '充值' : '扣除');
  const tx = db.transaction(() => {
    const bal = db.prepare('SELECT balance FROM user_balance WHERE user_id = ?').get(userId);
    if (!bal) db.prepare('INSERT INTO user_balance (user_id, balance) VALUES (?, 0)').run(userId);
    const cur = bal?.balance || 0;
    const newBal = cur + amt;
    db.prepare('UPDATE user_balance SET balance = ? WHERE user_id = ?').run(newBal, userId);
    db.prepare(`
      INSERT INTO balance_records (user_id, type, amount, balance_after, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, t, amt, newBal, description || `管理员${t}: ${amt > 0 ? '+' : ''}¥${amt.toFixed(2)}`);
    return newBal;
  });
  res.json({ ok: true, balance: tx() });
});

router.get('/users/:id/balance-records', (req, res) => {
  const rows = db.prepare('SELECT * FROM balance_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 200').all(req.params.id);
  res.json(rows);
});

// ============ 订单审核 ============
router.get('/orders', (req, res) => {
  const { status, q, user_id, limit = 50, offset = 0 } = req.query;
  const conds = [];
  const args = [];
  if (status && status !== 'all') { conds.push('o.status = ?'); args.push(status); }
  if (user_id) { conds.push('o.user_id = ?'); args.push(user_id); }
  if (q) {
    conds.push('(o.order_no LIKE ? OR u.username LIKE ? OR o.shop_name LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT o.*, u.username, u.display_name
    FROM purchase_orders o JOIN users u ON u.id = o.user_id
    ${where}
    ORDER BY o.created_at DESC LIMIT ? OFFSET ?
  `).all(...args, Number(limit), Number(offset));
  const total = db.prepare(`SELECT COUNT(*) AS c FROM purchase_orders o JOIN users u ON u.id = o.user_id ${where}`).get(...args).c;
  res.json({ rows, total });
});

router.get('/orders/:id', (req, res) => {
  const row = db.prepare(`
    SELECT o.*, u.username, u.display_name
    FROM purchase_orders o JOIN users u ON u.id = o.user_id
    WHERE o.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  const items = db.prepare('SELECT * FROM purchase_order_items WHERE order_id = ?').all(row.id);
  res.json({ ...row, items });
});

// 管理员确认订单：可调整真实采购价/加价百分比，按"显示金额"从用户余额扣款（不再调用DropXL）
router.post('/orders/:id/confirm', (req, res) => {
  const { real_amount_usd, markup_pct, exchange_rate, distributor_refund = 0, note } = req.body || {};
  const realUsd = Number(real_amount_usd);
  const markup = Number(markup_pct);
  const rate = Number(exchange_rate);
  const refund = Number(distributor_refund) || 0;
  if (!realUsd || realUsd <= 0) return res.status(400).json({ error: '请填写真实采购金额(USD)' });
  if (!rate || rate <= 0) return res.status(400).json({ error: '请填写汇率' });
  if (isNaN(markup)) return res.status(400).json({ error: '请填写加价百分比' });

  const order = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.status !== 'pending_purchase') return res.status(400).json({ error: '订单状态不允许确认' });

  const displayUsd = realUsd * (1 + markup / 100);
  const displayCny = displayUsd * rate;
  const deduct = displayCny - refund;

  const bal = db.prepare('SELECT balance FROM user_balance WHERE user_id = ?').get(order.user_id);
  if ((bal?.balance || 0) < deduct) {
    return res.status(400).json({ error: `用户余额不足，需要 ¥${deduct.toFixed(2)}，当前 ¥${(bal?.balance || 0).toFixed(2)}` });
  }

  const tx = db.transaction(() => {
    const newBal = (bal?.balance || 0) - deduct;
    db.prepare('UPDATE user_balance SET balance = ? WHERE user_id = ?').run(newBal, order.user_id);
    db.prepare(`
      INSERT INTO balance_records (user_id, type, amount, balance_after, description, related_order)
      VALUES (?, '扣除', ?, ?, ?, ?)
    `).run(order.user_id, -deduct, newBal, `订单采购 - ${order.order_no}${note ? ' (' + note + ')' : ''}`, order.order_no);

    db.prepare(`
      UPDATE purchase_orders
      SET real_amount_usd = ?, markup_pct = ?, purchase_amount_usd = ?, exchange_rate = ?,
          purchase_amount_cny = ?, distributor_refund = ?,
          status = 'pending_shipment', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(realUsd, markup, displayUsd, rate, displayCny, refund, order.id);
  });
  tx();
  res.json({ ok: true, real_usd: realUsd, display_usd: displayUsd, deducted: deduct, profit_cny: deduct - (realUsd * rate) });
});

// 测试 DropXL API 连接 - 用于初版调试响应格式
router.post('/test-dropxl', async (req, res) => {
  const { action = 'list_orders', params = {} } = req.body || {};
  try {
    let data;
    if (action === 'list_orders') data = await dropxl.listOrders(params);
    else if (action === 'list_products') data = await dropxl.listProducts(params);
    else if (action === 'get_order') data = await dropxl.getOrder(params.id);
    else if (action === 'account') data = await dropxl.getAccountInfo();
    else return res.status(400).json({ error: '不支持的 action' });
    res.json({ ok: true, action, response: data });
  } catch (e) {
    res.status(502).json({ ok: false, action, error: e.message, status: e.status, detail: e.data });
  }
});

router.post('/orders/:id/reject', (req, res) => {
  const { reason } = req.body || {};
  db.prepare(`UPDATE purchase_orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending_purchase'`).run(req.params.id);
  res.json({ ok: true });
});

router.put('/orders/:id', (req, res) => {
  const { status, tracking_no } = req.body || {};
  db.prepare(`
    UPDATE purchase_orders
    SET status = COALESCE(?, status), tracking_no = COALESCE(?, tracking_no), updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, tracking_no, req.params.id);
  res.json({ ok: true });
});

// 从DropXL同步所有订单状态
router.post('/orders/sync', async (req, res) => {
  try {
    const data = await dropxl.listOrders({ limit: 200 });
    const items = data?.items || data?.orders || data || [];
    let updated = 0;
    for (const o of items) {
      const id = o.id || o.order_id;
      if (!id) continue;
      const tracking = (o.tracking && (o.tracking.number || o.tracking.code)) || o.tracking_number || '';
      const status = mapStatus(o.status);
      const r = db.prepare(`
        UPDATE purchase_orders
        SET status = ?, tracking_no = ?, updated_at = CURRENT_TIMESTAMP
        WHERE dropxl_order_id = ?
      `).run(status, tracking, String(id));
      if (r.changes > 0) updated++;
    }
    res.json({ ok: true, total: items.length, updated });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

function mapStatus(s) {
  if (!s) return 'pending_shipment';
  const v = String(s).toLowerCase();
  if (v.includes('ship')) return 'shipped';
  if (v.includes('cancel')) return 'cancelled';
  if (v.includes('refund')) return 'refunded';
  if (v.includes('complete') || v.includes('delivered')) return 'completed';
  return 'pending_shipment';
}

// ============ 售后管理 ============
router.get('/aftersales', (req, res) => {
  const { status, q, limit = 50, offset = 0 } = req.query;
  const conds = [];
  const args = [];
  if (status && status !== 'all') { conds.push('t.status = ?'); args.push(status); }
  if (q) {
    conds.push('(t.order_no LIKE ? OR t.title LIKE ? OR u.username LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT t.*, u.username, u.display_name
    FROM aftersales_tickets t JOIN users u ON u.id = t.user_id
    ${where}
    ORDER BY t.created_at DESC LIMIT ? OFFSET ?
  `).all(...args, Number(limit), Number(offset));
  const total = db.prepare(`SELECT COUNT(*) AS c FROM aftersales_tickets t JOIN users u ON u.id = t.user_id ${where}`).get(...args).c;
  res.json({ rows, total });
});

router.get('/aftersales/:id', (req, res) => {
  const t = db.prepare(`
    SELECT t.*, u.username, u.display_name FROM aftersales_tickets t
    JOIN users u ON u.id = t.user_id WHERE t.id = ?
  `).get(req.params.id);
  if (!t) return res.status(404).json({ error: '工单不存在' });
  const messages = db.prepare('SELECT * FROM aftersales_messages WHERE ticket_id = ? ORDER BY created_at ASC').all(t.id);
  const attachments = db.prepare('SELECT id, original_name, mimetype, size, created_at FROM aftersales_attachments WHERE ticket_id = ?').all(t.id);
  res.json({ ...t, messages, attachments });
});

router.put('/aftersales/:id', (req, res) => {
  const { status, admin_note, refund_amount, priority } = req.body || {};
  db.prepare(`
    UPDATE aftersales_tickets
    SET status = COALESCE(?, status),
        admin_note = COALESCE(?, admin_note),
        refund_amount = COALESCE(?, refund_amount),
        priority = COALESCE(?, priority),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, admin_note, refund_amount, priority, req.params.id);
  res.json({ ok: true });
});

router.post('/aftersales/:id/reply', (req, res) => {
  const { content } = req.body || {};
  const t = db.prepare('SELECT * FROM aftersales_tickets WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '工单不存在' });
  db.prepare('INSERT INTO aftersales_messages (ticket_id, author, is_admin, content) VALUES (?, ?, 1, ?)').run(t.id, req.user.username, content);
  db.prepare('UPDATE aftersales_tickets SET has_new_message = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

// 管理员处理售后退款：直接给用户加余额并标记工单已完成
router.post('/aftersales/:id/refund', (req, res) => {
  const { amount, description } = req.body || {};
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: '请输入退款金额' });
  const t = db.prepare('SELECT * FROM aftersales_tickets WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '工单不存在' });

  const tx = db.transaction(() => {
    const bal = db.prepare('SELECT balance FROM user_balance WHERE user_id = ?').get(t.user_id);
    const newBal = (bal?.balance || 0) + amt;
    db.prepare('UPDATE user_balance SET balance = ? WHERE user_id = ?').run(newBal, t.user_id);
    db.prepare(`
      INSERT INTO balance_records (user_id, type, amount, balance_after, description, related_order)
      VALUES (?, '退款', ?, ?, ?, ?)
    `).run(t.user_id, amt, newBal, description || `订单退款: ${t.order_no}`, t.order_no);

    db.prepare(`
      UPDATE aftersales_tickets
      SET status = 'completed', refund_amount = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(amt, t.id);
  });
  tx();
  res.json({ ok: true });
});

module.exports = router;
