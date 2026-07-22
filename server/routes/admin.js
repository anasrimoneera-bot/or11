const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const dropxl = require('../dropxl');
const { authRequired, adminRequired, ownerRequired, permRequired, GRANTABLE_KEYS, parsePermissions, BASE_CONFIGURED_FLAG } = require('../middleware/auth');
const { audit, setAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authRequired, adminRequired, audit);

// 售后回复附件：与用户端共用 data/uploads 目录、同样的随机文件名规则。
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// 工具：剥离内部字段。管理员（含普通管理员）可见真实成本/加价/PayPal汇率，
// 始终剥除 raw_payload/raw_response（原始报文无需前端展示）。
// isAdmin=true：返回 real_amount_usd / markup_pct / paypal_rate。
function stripSensitive(obj, isAdmin = false) {
  if (Array.isArray(obj)) return obj.map(o => stripSensitive(o, isAdmin));
  if (!obj || typeof obj !== 'object') return obj;
  const { raw_payload, raw_response, real_amount_usd, markup_pct, paypal_rate, ...safe } = obj;
  if (isAdmin) { safe.real_amount_usd = real_amount_usd; safe.markup_pct = markup_pct; safe.paypal_rate = paypal_rate; }
  return safe;
}

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
  const isOwner = !!req.user.is_owner;
  const markupCol = isOwner ? ', u.markup_pct' : '';
  // include_admins=1：手工新增订单的归属人选择器需要能把订单挂到管理员名下
  const where = req.query.include_admins === '1' ? '' : 'WHERE u.is_admin = 0';
  const rows = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.email, u.phone, u.company, u.role,
           u.member_level, u.member_days, u.sku_limit, u.created_at, u.is_admin,
           IFNULL(b.balance, 0) AS balance${markupCol}
    FROM users u
    LEFT JOIN user_balance b ON b.user_id = u.id
    ${where}
    ORDER BY u.created_at DESC
  `).all();
  res.json(rows);
});

// ============ 操作审计日志（仅店主可见） ============
router.get('/audit-logs', ownerRequired, (req, res) => {
  const { user_id, action, target_type, start, end, q, limit = 100, offset = 0 } = req.query;
  const conds = [];
  const args = [];
  if (user_id) { conds.push('user_id = ?'); args.push(user_id); }
  if (action) { conds.push('action = ?'); args.push(action); }
  if (target_type) { conds.push('target_type = ?'); args.push(target_type); }
  if (start) { conds.push('created_at >= ?'); args.push(start); }
  if (end) { conds.push('created_at <= ?'); args.push(end); }
  if (q) {
    conds.push('(username LIKE ? OR display_name LIKE ? OR summary LIKE ? OR target_id LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...args, Number(limit), Number(offset));
  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs ${where}`).get(...args).c;
  res.json({ rows, total });
});

router.get('/audit-logs/stats', ownerRequired, (req, res) => {
  const today = db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE date(created_at) = date('now')").get().c;
  const week = db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE created_at >= date('now', '-7 day')").get().c;
  const byUser = db.prepare(`
    SELECT username, display_name, COUNT(*) AS c FROM audit_logs
    WHERE is_owner = 0 AND created_at >= date('now', '-30 day')
    GROUP BY user_id ORDER BY c DESC LIMIT 10
  `).all();
  const byAction = db.prepare(`
    SELECT action, COUNT(*) AS c FROM audit_logs
    WHERE created_at >= date('now', '-30 day')
    GROUP BY action ORDER BY c DESC LIMIT 10
  `).all();
  res.json({ today, week, byUser, byAction });
});

// 按时间范围或全部清理审计日志（仅店主可执行）
router.delete('/audit-logs', ownerRequired, (req, res) => {
  const { before, mode } = req.body || {};
  let r;
  if (mode === 'all') {
    r = db.prepare('DELETE FROM audit_logs').run();
  } else if (before) {
    r = db.prepare('DELETE FROM audit_logs WHERE created_at < ?').run(before);
  } else {
    return res.status(400).json({ error: '请指定 before 时间或 mode=all' });
  }
  try { db.prepare('VACUUM').run(); } catch (e) {}
  res.json({ ok: true, deleted: r.changes });
});

// ============ 员工管理（仅店主可见） ============
router.get('/staff', ownerRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT id, username, display_name, email, created_at, is_owner, permissions
    FROM users WHERE is_admin = 1 AND id != ?
    ORDER BY created_at DESC
  `).all(req.user.id);
  // permissions 列存 JSON 字符串，返回前解析成有效权限数组（含旧数据基础界面默认全开的兼容）
  for (const r of rows) r.permissions = parsePermissions(r.permissions);
  res.json(rows);
});

// 校验并归一化传入的权限数组（去重 + 只保留已注册的 key）
function sanitizePermissions(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter(k => GRANTABLE_KEYS.includes(k)))];
}

router.post('/staff', ownerRequired, (req, res) => {
  const { username, password, display_name, email, permissions } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return res.status(400).json({ error: '用户名已存在' });
  const hash = bcrypt.hashSync(password, 10);
  const perms = sanitizePermissions(permissions);
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, display_name, email, role, is_admin, is_owner, permissions)
    VALUES (?, ?, ?, ?, 'staff', 1, 0, ?)
  `).run(username, hash, display_name, email, JSON.stringify([BASE_CONFIGURED_FLAG, ...perms]));
  db.prepare('INSERT INTO user_balance (user_id, balance) VALUES (?, 0)').run(info.lastInsertRowid);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// 仅 BOSS：设置某管理员的功能权限（权限分配本身不可下放，防越权）
router.put('/staff/:id/permissions', ownerRequired, (req, res) => {
  const u = db.prepare('SELECT id, username, display_name, is_admin, is_owner FROM users WHERE id = ?').get(req.params.id);
  if (!u || !u.is_admin) return res.status(404).json({ error: '管理员不存在' });
  if (u.is_owner) return res.status(400).json({ error: 'BOSS 账号默认拥有全部权限，无需分配' });
  const perms = sanitizePermissions(req.body?.permissions);
  db.prepare('UPDATE users SET permissions = ? WHERE id = ?').run(JSON.stringify([BASE_CONFIGURED_FLAG, ...perms]), u.id);
  setAudit(res, { target_name: u.display_name || u.username, summary: `设置管理员 ${u.username} 功能权限: [${perms.join(', ') || '无'}]` });
  res.json({ ok: true, permissions: perms });
});

router.delete('/staff/:id', ownerRequired, (req, res) => {
  const u = db.prepare('SELECT is_owner FROM users WHERE id = ?').get(req.params.id);
  if (u?.is_owner) return res.status(400).json({ error: '不能删除店主账号' });
  db.prepare('DELETE FROM users WHERE id = ? AND is_admin = 1 AND is_owner = 0').run(req.params.id);
  res.json({ ok: true });
});

router.post('/staff/:id/reset-password', ownerRequired, (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 6) return res.status(400).json({ error: '密码至少6位' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND is_owner = 0').run(hash, req.params.id);
  res.json({ ok: true });
});

// 仅店主：设置某用户的加价百分比
router.put('/users/:id/markup', ownerRequired, (req, res) => {
  const { markup_pct } = req.body || {};
  const v = Number(markup_pct);
  if (!isFinite(v) || v < 0) return res.status(400).json({ error: '请输入有效的加价百分比' });
  const u = db.prepare('SELECT username, display_name, markup_pct FROM users WHERE id = ?').get(req.params.id);
  db.prepare('UPDATE users SET markup_pct = ? WHERE id = ?').run(v, req.params.id);
  setAudit(res, {
    target_id: req.params.id,
    target_name: u ? `${u.display_name || ''}（${u.username}）` : null,
    before: { markup_pct: u?.markup_pct }, after: { markup_pct: v },
  });
  res.json({ ok: true });
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
  setAudit(res, { target_id: info.lastInsertRowid, target_name: `${display_name || username}（${username}）`,
    summary: `创建分销商: ${username} - 会员等级=${member_level || '一级分销'}, SKU限制=${sku_limit || 100}` });
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/users/:id', (req, res) => {
  const { display_name, email, phone, company, member_level, sku_limit, member_days, markup_pct } = req.body || {};
  const before = db.prepare('SELECT username, display_name, email, phone, company, member_level, sku_limit, member_days, markup_pct FROM users WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: '用户不存在' });

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
  if (markup_pct !== undefined && req.user.is_owner) {
    const v = Number(markup_pct);
    if (isFinite(v) && v >= 0) db.prepare('UPDATE users SET markup_pct = ? WHERE id = ?').run(v, req.params.id);
  }

  const after = db.prepare('SELECT username, display_name, email, phone, company, member_level, sku_limit, member_days, markup_pct FROM users WHERE id = ?').get(req.params.id);
  // 员工无权编辑加价，所以审计日志里不暴露 markup_pct 变化
  if (!req.user.is_owner) { delete before.markup_pct; delete after.markup_pct; }
  setAudit(res, {
    target_id: req.params.id,
    target_name: `${after.display_name || ''}（${after.username}）`,
    before, after,
  });
  res.json({ ok: true });
});

// 店主删除分销商账号（连带清掉相关订单等级联记录会触发外键约束错误时拦下，让店主先处理）
router.delete('/users/:id', ownerRequired, (req, res) => {
  const u = db.prepare('SELECT id, username, display_name, is_admin FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  if (u.is_admin) return res.status(400).json({ error: '该用户是管理员账号，请到 管理员 页面删除' });
  // 检查关联订单 - 有订单不允许直接删，避免历史数据丢主键
  const orderCount = db.prepare('SELECT COUNT(*) AS c FROM purchase_orders WHERE user_id = ?').get(u.id).c;
  if (orderCount > 0) {
    return res.status(400).json({
      error: `该用户名下还有 ${orderCount} 个订单。请先把订单分配给其他分销商再删除（订单管理页 → 👤 分配）。`,
    });
  }
  // 检查关联售后工单
  const ticketCount = db.prepare('SELECT COUNT(*) AS c FROM aftersales_tickets WHERE user_id = ?').get(u.id).c;
  if (ticketCount > 0) {
    return res.status(400).json({ error: `该用户名下还有 ${ticketCount} 个售后工单，删除前请先处理或清理。` });
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_balance WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM balance_records WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  });
  try {
    tx();
  } catch (e) {
    return res.status(500).json({ error: '删除失败：' + e.message });
  }
  setAudit(res, {
    target_id: String(u.id),
    target_name: `${u.display_name || ''}(${u.username})`,
    summary: `删除分销商 ${u.display_name || ''}(${u.username})`,
  });
  res.json({ ok: true });
});

router.post('/users/:id/reset-password', (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 6) return res.status(400).json({ error: '密码至少6位' });
  const hash = bcrypt.hashSync(password, 10);
  const u = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(req.params.id);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  setAudit(res, { target_id: req.params.id, target_name: u ? `${u.display_name || ''}（${u.username}）` : null });
  res.json({ ok: true });
});

// ============ 用户余额管理 ============
router.post('/users/:id/balance', (req, res) => {
  const { amount, type, description } = req.body || {};
  const amt = Number(amount);
  if (!amt || !isFinite(amt)) return res.status(400).json({ error: '请输入有效金额' });
  const userId = Number(req.params.id);
  const u = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(userId);
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
    return { newBal, cur };
  });
  const { newBal, cur } = tx();
  setAudit(res, {
    target_id: userId,
    target_name: u ? `${u.display_name || ''}（${u.username}）` : null,
    summary: `${t}: ${amt > 0 ? '+' : ''}¥${amt.toFixed(2)}  余额: ¥${cur.toFixed(2)} → ¥${newBal.toFixed(2)}${description ? ' - ' + description : ''}`,
  });
  res.json({ ok: true, balance: newBal });
});

router.get('/users/:id/balance-records', (req, res) => {
  const rows = db.prepare('SELECT * FROM balance_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 200').all(req.params.id);
  res.json(rows);
});

// ============ 财务管理（仅店主）：全用户余额变动明细 + 按用户筛选 + 分页 ============
router.get('/finance/records', permRequired('finance'), (req, res) => {
  const { user_id, limit = 50, offset = 0 } = req.query;
  const conds = [];
  const args = [];
  if (user_id) { conds.push('r.user_id = ?'); args.push(Number(user_id)); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const lim = Math.min(Number(limit) || 50, 200);
  const off = Number(offset) || 0;
  const rows = db.prepare(`
    SELECT r.id, r.user_id, u.username, u.display_name, u.is_admin, u.is_owner,
           r.type, r.amount, r.balance_after, r.description, r.related_order, r.created_at
    FROM balance_records r
    LEFT JOIN users u ON u.id = r.user_id
    ${where}
    ORDER BY r.id DESC
    LIMIT ? OFFSET ?
  `).all(...args, lim, off);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM balance_records r ${where}`).get(...args).c;
  // 下拉筛选用：有财务记录的用户（含管理员/BOSS）
  const users = db.prepare(`
    SELECT DISTINCT u.id, u.username, u.display_name, u.is_admin, u.is_owner
    FROM balance_records r JOIN users u ON u.id = r.user_id
    ORDER BY u.is_owner DESC, u.is_admin DESC, u.display_name, u.username
  `).all();
  res.json({ rows, total, users });
});

// ============ 订单审核 ============
router.get('/orders', (req, res) => {
  const { status, q, user_id, start, end, limit = 50, offset = 0 } = req.query;
  const conds = [];
  const args = [];
  if (status && status !== 'all') { conds.push('o.status = ?'); args.push(status); }
  if (user_id) { conds.push('o.user_id = ?'); args.push(user_id); }
  if (q) {
    // 用户列展示的是 display_name，故一并按 display_name 搜索（含管理员/BOSS 账号的显示名）
    conds.push('(o.order_no LIKE ? OR u.username LIKE ? OR u.display_name LIKE ? OR o.shop_name LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (start) { conds.push('o.created_at >= ?'); args.push(start); }
  if (end) { conds.push('o.created_at <= ?'); args.push(end); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT o.*, u.username, u.display_name
    FROM purchase_orders o JOIN users u ON u.id = o.user_id
    ${where}
    ORDER BY o.created_at DESC LIMIT ? OFFSET ?
  `).all(...args, Number(limit), Number(offset));
  const total = db.prepare(`SELECT COUNT(*) AS c FROM purchase_orders o JOIN users u ON u.id = o.user_id ${where}`).get(...args).c;
  res.json({ rows: stripSensitive(rows, !!req.user.is_admin), total });
});

router.get('/orders/:id', (req, res) => {
  const row = db.prepare(`
    SELECT o.*, u.username, u.display_name
    FROM purchase_orders o JOIN users u ON u.id = o.user_id
    WHERE o.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  const items = db.prepare('SELECT * FROM purchase_order_items WHERE order_id = ?').all(row.id);
  const shipping = db.prepare('SELECT name, address1, address2, city, state, postal, country, phone, buyer_email FROM purchase_order_shipping WHERE order_id = ?').get(row.id) || null;
  res.json({ ...stripSensitive(row, !!req.user.is_admin), items, shipping });
});

// 管理员确认订单：店主可调整真实价/加价，员工仅能按系统已算好的金额扣款
router.post('/orders/:id/confirm', (req, res) => {
  const isOwner = !!req.user.is_owner;
  const { exchange_rate, distributor_refund = 0, note } = req.body || {};
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.status !== 'pending_purchase') return res.status(400).json({ error: '订单状态不允许确认' });

  // 汇率取值优先级：请求体覆盖（仅店主可改） > 订单已锁定的汇率 > 当前系统设置
  const rate = Number(exchange_rate) || order.exchange_rate || getExchangeRate();
  const refund = Number(distributor_refund) || 0;
  if (!rate || rate <= 0) return res.status(400).json({ error: '请填写汇率' });

  let realUsd, markup, displayUsd, displayCny;
  if (isOwner) {
    realUsd = Number(req.body.real_amount_usd);
    markup = Number(req.body.markup_pct);
    if (!realUsd || realUsd <= 0) return res.status(400).json({ error: '请填写真实采购金额(USD)' });
    if (isNaN(markup)) return res.status(400).json({ error: '请填写加价百分比' });
    displayUsd = realUsd * (1 + markup / 100);
    displayCny = displayUsd * rate;
  } else {
    // 员工：使用系统已记录的真实价 + 用户的加价百分比，无需也无权填写
    realUsd = order.real_amount_usd || 0;
    markup = order.markup_pct || 0;
    displayUsd = order.purchase_amount_usd || (realUsd * (1 + markup / 100));
    displayCny = displayUsd * rate;
    if (displayCny <= 0) {
      return res.status(400).json({ error: '订单显示金额为0，请联系店主调整后再确认' });
    }
  }

  const deduct = displayCny - refund;

  const bal = db.prepare('SELECT balance FROM user_balance WHERE user_id = ?').get(order.user_id);

  const tx = db.transaction(() => {
    if (!bal) db.prepare('INSERT OR IGNORE INTO user_balance (user_id, balance) VALUES (?, 0)').run(order.user_id);
    // 确认采购时自动把采购¥充值到下单用户余额，免去 BOSS/管理员为该单手动充值后再扣款
    const afterRecharge = (bal?.balance || 0) + displayCny;
    db.prepare('UPDATE user_balance SET balance = ? WHERE user_id = ?').run(afterRecharge, order.user_id);
    db.prepare(`
      INSERT INTO balance_records (user_id, type, amount, balance_after, description, related_order)
      VALUES (?, '充值', ?, ?, ?, ?)
    `).run(order.user_id, displayCny, afterRecharge, `订单采购自动充值 - ${order.order_no}`, order.order_no);

    // 再按采购金额扣款（扣除额可含分销商退回额）
    const newBal = afterRecharge - deduct;
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
  const u = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(order.user_id);
  // 员工的审计记录里也不暴露真实价/加价
  setAudit(res, {
    target_id: order.id,
    target_name: `${order.order_no} - ${u ? u.display_name || u.username : ''}`,
    summary: isOwner
      ? `确认订单 ${order.order_no}：真实价 $${realUsd.toFixed(2)} × (1+${markup}%) × ${rate} = ¥${displayCny.toFixed(2)}，扣款 ¥${deduct.toFixed(2)}`
      : `确认订单 ${order.order_no}：扣款 ¥${deduct.toFixed(2)}`,
  });
  if (isOwner) {
    res.json({ ok: true, real_usd: realUsd, display_usd: displayUsd, deducted: deduct, profit_cny: deduct - (realUsd * rate) });
  } else {
    res.json({ ok: true, deducted: deduct });
  }
});

// 测试 DropXL API 连接 - 用于初版调试响应格式（仅店主可见，避免员工窥探真实价格）
router.post('/test-dropxl', ownerRequired, async (req, res) => {
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

// 分配订单归属用户（解决历史订单挂在错的账户上的问题）
router.put('/orders/:id/assign', (req, res) => {
  const { user_id } = req.body || {};
  const targetId = Number(user_id);
  if (!targetId) return res.status(400).json({ error: '请选择用户' });
  const target = db.prepare('SELECT id, username, display_name, is_admin FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: '目标用户不存在' });
  if (target.is_admin) return res.status(400).json({ error: '不能把订单分配给管理员账号，请选分销商' });
  const order = db.prepare('SELECT id, order_no, user_id FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const oldUser = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(order.user_id);
  db.prepare('UPDATE purchase_orders SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(targetId, order.id);
  const oldLabel = oldUser ? `${oldUser.display_name || ''}(${oldUser.username})` : `#${order.user_id}`;
  const newLabel = `${target.display_name || ''}(${target.username})`;
  setAudit(res, {
    target_id: String(order.id),
    target_name: order.order_no,
    summary: `订单 ${order.order_no} 归属 ${oldLabel} → ${newLabel}`,
  });
  res.json({ ok: true });
});

// 设置订单的 PayPal 支付汇率（仅 BOSS 可改）。1 CNY = ? USD
// 仅记录, 真实人民币成本/差价利润由前端按 real_amount_usd / paypal_rate 实时算
router.put('/orders/:id/paypal-rate', ownerRequired, (req, res) => {
  const { paypal_rate } = req.body || {};
  const v = paypal_rate === '' || paypal_rate == null ? null : Number(paypal_rate);
  if (v != null && (!isFinite(v) || v <= 0)) return res.status(400).json({ error: 'PayPal 汇率必须是正数' });
  const order = db.prepare('SELECT id, order_no FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  db.prepare('UPDATE purchase_orders SET paypal_rate = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(v, order.id);
  setAudit(res, { target_id: String(order.id), target_name: order.order_no, summary: `订单 ${order.order_no} PayPal 汇率设为 ${v ?? '(清空)'}` });
  res.json({ ok: true });
});

// 店主手动改用户采购价（覆盖系统按 real * (1+markup) 自动算出的值）
// 同步按订单 exchange_rate 重算 purchase_amount_cny。real_amount_usd 不动
router.put('/orders/:id/purchase-price', ownerRequired, (req, res) => {
  const { purchase_amount_usd } = req.body || {};
  const v = Number(purchase_amount_usd);
  if (!isFinite(v) || v < 0) return res.status(400).json({ error: '请输入非负数' });
  const order = db.prepare('SELECT id, order_no, purchase_amount_usd, exchange_rate FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const rate = Number(order.exchange_rate) || 0;
  const newCny = v * rate;
  db.prepare(`
    UPDATE purchase_orders
    SET purchase_amount_usd = ?, purchase_amount_cny = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(v, newCny, order.id);
  setAudit(res, {
    target_id: String(order.id),
    target_name: order.order_no,
    summary: `订单 ${order.order_no} 用户采购价 ${Number(order.purchase_amount_usd).toFixed(2)} → ${v.toFixed(2)}`,
  });
  res.json({ ok: true, purchase_amount_cny: newCny });
});

// 仅 BOSS：任意订单状态下修改加价%，按 真实USD ×(1+加价%) 重算用户采购价(USD)与采购¥。
// 与 purchase-price 一致：只订正记录，不再二次结算分销商余额。real_amount_usd 不动。
router.put('/orders/:id/markup', ownerRequired, (req, res) => {
  const { markup_pct } = req.body || {};
  const v = Number(markup_pct);
  if (!isFinite(v) || v < 0) return res.status(400).json({ error: '请输入非负数' });
  const order = db.prepare('SELECT id, order_no, real_amount_usd, purchase_amount_usd, markup_pct, exchange_rate FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const realUsd = Number(order.real_amount_usd) || 0;
  const rate = Number(order.exchange_rate) || 0;
  const displayUsd = realUsd * (1 + v / 100);
  const newCny = displayUsd * rate;
  db.prepare(`
    UPDATE purchase_orders
    SET markup_pct = ?, purchase_amount_usd = ?, purchase_amount_cny = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(v, displayUsd, newCny, order.id);
  setAudit(res, {
    target_id: String(order.id),
    target_name: order.order_no,
    summary: `订单 ${order.order_no} 加价% ${Number(order.markup_pct) || 0} → ${v}（采购价 $${Number(order.purchase_amount_usd || 0).toFixed(2)} → $${displayUsd.toFixed(2)}）`,
  });
  res.json({ ok: true, purchase_amount_usd: displayUsd, purchase_amount_cny: newCny });
});

// 仅 BOSS：按"当前系统采购汇率"重算单个订单的采购¥ = 采购USD × 当前汇率，
// 并把该订单的 exchange_rate 更新为当前汇率（用于补全历史导入单缺失的采购¥）。
router.post('/orders/:id/recompute-cny', ownerRequired, (req, res) => {
  const { purchaseRateForCountry, getExchangeRate } = require('../settings');
  const order = db.prepare('SELECT id, order_no, country, purchase_amount_usd, purchase_amount_cny, exchange_rate FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const rate = purchaseRateForCountry(order.country) || getExchangeRate();
  if (!(rate > 0)) return res.status(400).json({ error: `无法取得 ${order.country || '该国'} 的当前采购汇率，请先在系统设置维护该国亚马逊汇率` });
  const newCny = (Number(order.purchase_amount_usd) || 0) * rate;
  db.prepare('UPDATE purchase_orders SET purchase_amount_cny = ?, exchange_rate = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newCny, rate, order.id);
  setAudit(res, {
    target_id: String(order.id), target_name: order.order_no,
    summary: `订单 ${order.order_no} 按当前汇率重算采购¥: ${Number(order.purchase_amount_cny || 0).toFixed(2)} → ${newCny.toFixed(2)} (汇率 ${rate.toFixed(4)})`,
  });
  res.json({ ok: true, purchase_amount_cny: newCny, exchange_rate: rate });
});

// 仅 BOSS：一键补算所有"采购¥为 0 / 未计算"的订单（只补缺，不动已正常的订单）。
router.post('/orders/recompute-cny-missing', ownerRequired, (req, res) => {
  const { purchaseRateForCountry, getExchangeRate } = require('../settings');
  const fallback = getExchangeRate();
  const targets = db.prepare(`
    SELECT id, country, purchase_amount_usd FROM purchase_orders
    WHERE purchase_amount_cny IS NULL OR purchase_amount_cny = 0
  `).all();
  const rateCache = new Map();
  const rateOf = (c) => {
    if (!rateCache.has(c)) rateCache.set(c, purchaseRateForCountry(c) || fallback);
    return rateCache.get(c);
  };
  const upd = db.prepare('UPDATE purchase_orders SET purchase_amount_cny = ?, exchange_rate = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  let updated = 0;
  const tx = db.transaction(() => {
    for (const o of targets) {
      const rate = rateOf(o.country);
      if (!(rate > 0)) continue;
      const usd = Number(o.purchase_amount_usd) || 0;
      if (usd <= 0) continue; // 采购USD 也为 0 的没意义，跳过
      upd.run(usd * rate, rate, o.id);
      updated++;
    }
  });
  tx();
  setAudit(res, { summary: `一键补算采购¥(零值单): 命中 ${targets.length} 单, 实际补算 ${updated} 单` });
  res.json({ ok: true, scanned: targets.length, updated });
});

// 手动新增订单（欧洲等未对接 API 的国家：货在别的系统采购，这里只录入落库，不推 DropXL）。
// 价格用 真实成本 + 加价% 模型；按采购¥从分销商余额扣款（同确认采购，admin/BOSS 订单允许透支）。
// 真实成本/加价%/PayPal汇率 仅存库，分销商 /api/orders 是列白名单，天然看不到。
router.post('/orders/manual', (req, res) => {
  const {
    user_id, order_no, country, shop_name,
    amazon_amount = 0, real_amount_usd, markup_pct,
    exchange_rate, paypal_rate, tracking_no,
    status = 'pending_shipment', distributor_refund = 0, items = [],
  } = req.body || {};

  const uid = Number(user_id);
  if (!uid) return res.status(400).json({ error: '请选择分销商' });
  const target = db.prepare('SELECT id, is_admin, is_owner FROM users WHERE id = ?').get(uid);
  if (!target) return res.status(404).json({ error: '分销商不存在' });
  const orderNo = String(order_no || '').trim();
  if (!orderNo) return res.status(400).json({ error: '请填写订单号' });
  if (!country) return res.status(400).json({ error: '请选择国家' });
  const realUsd = Number(real_amount_usd);
  const markup = Number(markup_pct);
  if (!isFinite(realUsd) || realUsd < 0) return res.status(400).json({ error: '请填写真实采购成本(USD)' });
  if (!isFinite(markup) || markup < 0) return res.status(400).json({ error: '请填写加价%' });
  if (db.prepare('SELECT id FROM purchase_orders WHERE order_no = ?').get(orderNo)) {
    return res.status(400).json({ error: '该订单号已存在' });
  }

  const { purchaseRateForCountry } = require('../settings');
  const rate = Number(exchange_rate) || purchaseRateForCountry(country) || getExchangeRate();
  if (!(rate > 0)) return res.status(400).json({ error: '无法确定采购汇率，请手动填写汇率' });

  const displayUsd = realUsd * (1 + markup / 100);
  const displayCny = displayUsd * rate;
  const refund = Number(distributor_refund) || 0;
  const deduct = displayCny - refund;
  const ppRate = (paypal_rate === '' || paypal_rate == null) ? null : Number(paypal_rate);
  if (ppRate != null && (!isFinite(ppRate) || ppRate <= 0)) return res.status(400).json({ error: 'PayPal 汇率必须是正数' });

  const amzAmt = Number(amazon_amount) || 0;
  let amazonRateLocked = null;
  if (amzAmt > 0) {
    const r = db.prepare('SELECT rate FROM country_amazon_rate WHERE country = ?').get(country);
    amazonRateLocked = (r && Number(r.rate) > 0) ? Number(r.rate) : null;
  }

  const VALID = ['pending_purchase', 'pending_shipment', 'shipped', 'completed', 'cancelled', 'refunded'];
  const st = VALID.includes(status) ? status : 'pending_shipment';

  const bal = db.prepare('SELECT balance FROM user_balance WHERE user_id = ?').get(uid);
  const allowOverdraft = !!(target.is_admin || target.is_owner);
  if (!allowOverdraft && (bal?.balance || 0) < deduct) {
    return res.status(400).json({ error: `用户余额不足，需要 ¥${deduct.toFixed(2)}，当前 ¥${(bal?.balance || 0).toFixed(2)}` });
  }

  let newId;
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO purchase_orders
        (user_id, order_no, customer_ref, shop_name, country,
         amazon_amount, amazon_rate_locked,
         real_amount_usd, purchase_amount_usd, purchase_amount_cny, exchange_rate, markup_pct, paypal_rate,
         distributor_refund, tracking_no, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uid, orderNo, orderNo, shop_name || null, country,
      amzAmt, amazonRateLocked,
      realUsd, displayUsd, displayCny, rate, markup, ppRate,
      refund, tracking_no || null, st);
    newId = info.lastInsertRowid;

    const insItem = db.prepare('INSERT INTO purchase_order_items (order_id, sku, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)');
    for (const it of (Array.isArray(items) ? items : [])) {
      if (!it || !String(it.sku || '').trim()) continue;
      insItem.run(newId, String(it.sku).trim(), it.product_name || '', Math.round(Number(it.quantity) || 1), Number(it.unit_price) || 0);
    }

    if (!bal) db.prepare('INSERT OR IGNORE INTO user_balance (user_id, balance) VALUES (?, 0)').run(uid);
    const newBal = (bal?.balance || 0) - deduct;
    db.prepare('UPDATE user_balance SET balance = ? WHERE user_id = ?').run(newBal, uid);
    db.prepare(`
      INSERT INTO balance_records (user_id, type, amount, balance_after, description, related_order)
      VALUES (?, '扣除', ?, ?, ?, ?)
    `).run(uid, -deduct, newBal, `手工录入订单采购 - ${orderNo}`, orderNo);
  });
  tx();

  setAudit(res, {
    target_id: String(newId), target_name: orderNo,
    summary: `手工新增订单 ${orderNo}：真实 $${realUsd.toFixed(2)} ×(1+${markup}%)×${rate.toFixed(4)} = ¥${displayCny.toFixed(2)}，扣款 ¥${deduct.toFixed(2)}`,
  });
  res.json({ ok: true, id: newId });
});

router.put('/orders/:id', (req, res) => {
  const { status, tracking_no, amazon_amount, amazon_tax_amount, shipping_fee } = req.body || {};
  const amazonAmt = amazon_amount === undefined ? null : Number(amazon_amount);
  const amazonTax = amazon_tax_amount === undefined ? null : Number(amazon_tax_amount);
  const shipFee = shipping_fee === undefined ? null : Number(shipping_fee);

  // 若本次更新涉及 amazon_amount > 0，按订单国家查当前亚马逊汇率并一同锁定
  // amazon_amount 清空（=0）则同步把锁定汇率清掉
  let rateLocked = null;        // null = 不更新该字段
  let updateRateFlag = false;
  if (amazonAmt != null) {
    updateRateFlag = true;
    if (amazonAmt > 0) {
      const order = db.prepare('SELECT country FROM purchase_orders WHERE id = ?').get(req.params.id);
      if (order?.country) {
        const r = db.prepare('SELECT rate FROM country_amazon_rate WHERE country = ?').get(order.country);
        rateLocked = (r && Number(r.rate) > 0) ? Number(r.rate) : null;
      }
    } else {
      rateLocked = null;  // amazon_amount = 0 时清掉锁定
    }
  }

  db.prepare(`
    UPDATE purchase_orders
    SET status = COALESCE(?, status),
        tracking_no = COALESCE(?, tracking_no),
        amazon_amount = COALESCE(?, amazon_amount),
        amazon_tax_amount = COALESCE(?, amazon_tax_amount),
        shipping_fee = COALESCE(?, shipping_fee),
        amazon_rate_locked = CASE WHEN ? THEN ? ELSE amazon_rate_locked END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, tracking_no, amazonAmt, amazonTax, shipFee, updateRateFlag ? 1 : 0, rateLocked, req.params.id);
  res.json({ ok: true });
});

// 修改买家收货地址（BOSS/管理员）。分销商填错邮编/省份等时用于订正。
// 注意：仅更新本地记录，不会自动同步到供应商系统（DropXL 无修改订单接口），
// 已推送到供应商的订单如需改地址需另行联系供应商。
router.put('/orders/:id/shipping', (req, res) => {
  const order = db.prepare('SELECT id, order_no FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const b = req.body || {};
  const s = (v) => (v == null ? null : String(v).trim());
  db.prepare(`
    INSERT INTO purchase_order_shipping (order_id, name, address1, address2, city, state, postal, country, phone, buyer_email)
    VALUES (@order_id, @name, @address1, @address2, @city, @state, @postal, @country, @phone, @buyer_email)
    ON CONFLICT(order_id) DO UPDATE SET
      name=@name, address1=@address1, address2=@address2, city=@city, state=@state,
      postal=@postal, country=@country, phone=@phone, buyer_email=@buyer_email
  `).run({
    order_id: order.id,
    name: s(b.name), address1: s(b.address1), address2: s(b.address2),
    city: s(b.city), state: s(b.state), postal: s(b.postal),
    country: s(b.country), phone: s(b.phone), buyer_email: s(b.buyer_email),
  });
  setAudit(res, { target_id: String(order.id), target_name: order.order_no, summary: `修改收货地址 ${order.order_no}` });
  res.json({ ok: true });
});

// 重试推送订单到供应商(DropXL)（BOSS/管理员）。用于地址/省份订正后把订单创建到供应商。
// 仅对「未成功推送」的订单开放（无 dropxl_order_id），避免对已存在的供应商订单重复创建。
router.post('/orders/:id/push-dropxl', async (req, res) => {
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.dropxl_order_id) return res.status(400).json({ error: '该订单已成功推送到供应商，不能重复推送' });
  const shipping = db.prepare('SELECT * FROM purchase_order_shipping WHERE order_id = ?').get(order.id);
  if (!shipping) return res.status(400).json({ error: '缺少买家收货地址，无法推送' });
  const items = db.prepare('SELECT sku, quantity FROM purchase_order_items WHERE order_id = ?').all(order.id);
  if (!items.length) return res.status(400).json({ error: '订单无商品明细，无法推送' });

  const { buildDropxlPayload } = require('../dropxlPayload');
  const updatePush = db.prepare(`
    UPDATE purchase_orders
    SET dropxl_order_id = ?, dropxl_push_status = ?, dropxl_push_error = ?, dropxl_pushed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  try {
    const payload = buildDropxlPayload(order.order_no, shipping, items);
    const resp = await dropxl.createOrder(payload, order.country);
    const dropxlOrderId = resp?.order?.id || resp?.id || null;
    updatePush.run(dropxlOrderId ? String(dropxlOrderId) : null, 'success', null, order.id);
    setAudit(res, { target_id: String(order.id), target_name: order.order_no, summary: `重试推送供应商成功 ${order.order_no}` });
    res.json({ ok: true, dropxl_order_id: dropxlOrderId });
  } catch (e) {
    updatePush.run(null, 'failed', String(e.message || e).slice(0, 500), order.id);
    setAudit(res, { target_id: String(order.id), target_name: order.order_no, summary: `重试推送供应商失败 ${order.order_no}` });
    res.status(502).json({ error: '推送供应商失败：' + (e.message || e) });
  }
});

// 删除订单（BOSS/管理员）。若该订单对分销商余额有净扣款，按净额自动退回并记一笔，保证账目一致。
// 用 balance_records 的净额（扣款为负、退款为正）反向冲回，天然避免对已售后退款/已退单二次退款。
router.delete('/orders/:id', (req, res) => {
  const order = db.prepare('SELECT id, user_id, order_no FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });

  const net = db.prepare('SELECT IFNULL(SUM(amount), 0) AS s FROM balance_records WHERE related_order = ?').get(order.order_no).s;
  const refund = net < 0 ? -net : 0;

  const tx = db.transaction(() => {
    if (refund > 0) {
      const bal = db.prepare('SELECT balance FROM user_balance WHERE user_id = ?').get(order.user_id);
      if (!bal) db.prepare('INSERT OR IGNORE INTO user_balance (user_id, balance) VALUES (?, 0)').run(order.user_id);
      const newBal = (bal?.balance || 0) + refund;
      db.prepare('UPDATE user_balance SET balance = ? WHERE user_id = ?').run(newBal, order.user_id);
      db.prepare(`
        INSERT INTO balance_records (user_id, type, amount, balance_after, description, related_order)
        VALUES (?, '退款', ?, ?, ?, ?)
      `).run(order.user_id, refund, newBal, `订单删除退款 - ${order.order_no}`, order.order_no);
    }
    db.prepare('DELETE FROM purchase_order_items WHERE order_id = ?').run(order.id);
    db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(order.id);
  });
  tx();

  setAudit(res, {
    target_id: String(order.id), target_name: order.order_no,
    summary: `删除订单 ${order.order_no}${refund > 0 ? `，退回分销商余额 ¥${refund.toFixed(2)}` : '（无需退款）'}`,
  });
  res.json({ ok: true, refunded: refund });
});

// 亚马逊各国汇率（采购汇率 = 此汇率 × 1.012 自动推导；店主可写）
router.get('/country-amazon-rates', (req, res) => {
  const rows = db.prepare('SELECT country, rate, currency, updated_at FROM country_amazon_rate ORDER BY country').all();
  res.json(rows);
});

// 实时汇率（聚合数据）状态 + 手动立即拉取
router.get('/fx-status', permRequired('settings'), (req, res) => {
  res.json(require('../fx').getStatus());
});
router.post('/fx-refresh', permRequired('settings'), async (req, res) => {
  const result = await require('../fx').refreshAmazonRates('manual');
  setAudit(res, { summary: result.ok ? `手动拉取实时汇率: ${result.updated.map(u => `${u.currency}=${u.rate}`).join(', ')}` : `手动拉取实时汇率失败: ${result.error || '部分币种失败'}` });
  res.json(result);
});
router.put('/country-amazon-rates/:country', permRequired('settings'), (req, res) => {
  const country = decodeURIComponent(req.params.country);
  const v = Number(req.body?.rate);
  if (!isFinite(v) || v < 0) return res.status(400).json({ error: '请输入非负数' });
  const existing = db.prepare('SELECT rate FROM country_amazon_rate WHERE country = ?').get(country);
  if (!existing) return res.status(404).json({ error: '不支持的国家' });
  db.prepare('UPDATE country_amazon_rate SET rate = ?, updated_at = CURRENT_TIMESTAMP WHERE country = ?').run(v, country);
  setAudit(res, { target_name: country, summary: `${country} 亚马逊汇率 ${existing.rate} → ${v}` });
  res.json({ ok: true });
});

// 从DropXL同步所有订单状态
// 订单状态/跟踪号同步：fork 到独立子进程跑，主进程事件循环不被阻塞(DropXL 慢/超时
// 一次几分钟也不卡网站)。被 /orders/sync 路由和 scheduler 共用。
// country=null 时使用 .env 默认凭据；指定国家时用该国 DropXL token
// 返回 Promise，解析为 { total, updated, not_found, since }；失败 reject。
function syncOrdersFromDropxl({ sinceDays = 90, country = null } = {}) {
  return new Promise((resolve, reject) => {
    const { fork } = require('child_process');
    const path = require('path');
    let worker;
    try {
      worker = fork(path.join(__dirname, '..', 'workers', 'orderSync.js'));
    } catch (e) { return reject(e); }
    let settled = false, result = null, errMsg = null;
    worker.on('message', (m) => {
      if (!m) return;
      if (m.type === 'done') { settled = true; result = m.result; }
      else if (m.type === 'error') { settled = true; errMsg = m.error; }
    });
    worker.on('exit', (code) => {
      if (errMsg) return reject(new Error(errMsg));
      if (settled && result) return resolve(result);
      reject(new Error(`订单同步子进程异常退出 (code ${code})`));
    });
    worker.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
    worker.send({ type: 'start', sinceDays, country });
  });
}

router.post('/orders/sync', async (req, res) => {
  try {
    const sinceDays = Number(req.body?.days) || 90;
    // 先同步默认账号（.env，通常是美国），再同步所有已启用的额外国家账号
    const countries = db.prepare(
      "SELECT country FROM dropxl_accounts WHERE enabled = 1 AND country IS NOT NULL AND country != ''"
    ).all().map(r => r.country);
    const results = [];
    // 默认账号
    results.push(await syncOrdersFromDropxl({ sinceDays, country: null }));
    // 各国账号
    for (const c of countries) {
      try { results.push(await syncOrdersFromDropxl({ sinceDays, country: c })); }
      catch (e) { results.push({ country: c, error: e.message }); }
    }
    const merged = results.reduce((acc, r) => ({
      total: (acc.total || 0) + (r.total || 0),
      updated: (acc.updated || 0) + (r.updated || 0),
      not_found: (acc.not_found || 0) + (r.not_found || 0),
      since: r.since || acc.since,
    }), {});
    res.json({ ok: true, ...merged, details: results });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 自动同步调度器（每 6 小时一次商品+订单双同步）
const scheduler = require('../scheduler');
router.get('/auto-sync-status', (req, res) => {
  res.json(scheduler.getStatus());
});
router.post('/auto-sync-now', permRequired('settings'), async (req, res) => {
  // 立即触发一次（不等 6 小时）
  scheduler.runOnce('manual-trigger').catch(e => console.error('[scheduler] manual run failed:', e));
  setAudit(res, { summary: '手动触发自动同步' });
  res.json({ ok: true, started: true });
});

function mapStatus(s) {
  if (!s) return 'pending_shipment';
  const v = String(s).toLowerCase();
  if (v.includes('ship') || v.includes('sent')) return 'shipped';
  if (v.includes('cancel')) return 'cancelled';
  if (v.includes('refund')) return 'refunded';
  if (v.includes('complete') || v.includes('delivered')) return 'completed';
  if (v.includes('temporary') || v.includes('draft')) return 'pending_purchase';
  return 'pending_shipment';
}

// 从 DropXL 导入历史订单（INSERT，不更新已存在的）
router.post('/orders/import-from-dropxl', async (req, res) => {
  try {
    const adminUser = db.prepare("SELECT id FROM users WHERE is_owner = 1 ORDER BY id LIMIT 1").get();
    if (!adminUser) return res.status(500).json({ error: '未找到店主账号' });
    const ownerId = adminUser.id;

    const since = req.body?.since || '2020-01-01';
    const data = await dropxl.listOrders({ submitted_at_gteq: since });
    const items = Array.isArray(data) ? data : (data?.orders || data?.items || []);

    let imported = 0, skipped = 0, failed = 0;
    const errors = [];

    const insertOrder = db.prepare(`
      INSERT INTO purchase_orders (
        user_id, order_no, customer_ref, shop_name, country,
        amazon_amount, amazon_tax_amount, shipping_fee,
        real_amount_usd, purchase_amount_usd, purchase_amount_cny,
        exchange_rate, markup_pct, distributor_refund,
        tracking_no, status, dropxl_order_id, raw_response, created_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?, ?)
    `);
    const insertItem = db.prepare(`
      INSERT INTO purchase_order_items (order_id, sku, product_name, quantity, unit_price)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const wrap of items) {
      const o = wrap?.order || wrap;
      if (!o) continue;
      const dropxlId = String(o.id || '');
      if (!dropxlId) { failed++; continue; }

      const existing = db.prepare('SELECT id FROM purchase_orders WHERE dropxl_order_id = ?').get(dropxlId);
      if (existing) { skipped++; continue; }

      // 同一订单号(= Amazon 订单号)已在本地（多为"采购商品"下单生成、但推送时未回填供应商订单号）：
      // 视为同一单，跳过并回填供应商订单号/跟踪号，避免再插入带 -<id> 后缀的重复单
      const ref = o.customer_order_reference || '';
      if (ref) {
        const local = db.prepare('SELECT id, dropxl_order_id FROM purchase_orders WHERE order_no = ?').get(ref);
        if (local) {
          if (!local.dropxl_order_id) {
            db.prepare(`UPDATE purchase_orders
              SET dropxl_order_id = ?,
                  tracking_no = CASE WHEN IFNULL(tracking_no, '') = '' THEN ? ELSE tracking_no END,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`).run(dropxlId, o.shipping_tracking || '', local.id);
          }
          skipped++;
          continue;
        }
      }
      const orderNo = ref || `DROPXL-${dropxlId}`;

      const grossTotal = Number(o.gross_total) || Number(o.total_products_after_vat) || 0;
      const tracking = o.shipping_tracking || '';
      const status = mapStatus(o.status_order_name);
      const createdAt = o.submitted_at || new Date().toISOString();

      try {
        const r = insertOrder.run(
          ownerId, orderNo, o.customer_order_reference || null,
          o.customer_company || null, o.country || null,
          grossTotal, grossTotal,
          tracking, status, dropxlId,
          JSON.stringify(o), createdAt,
        );
        const newId = r.lastInsertRowid;
        const products = o.order_products || [];
        for (const wp of products) {
          const p = wp?.order_product || wp;
          if (!p) continue;
          insertItem.run(
            newId,
            p.product_code || String(p.product_id || ''),
            p.product_name || '',
            Math.round(Number(p.quantity) || 1),
            Number(p.price) || 0,
          );
        }
        imported++;
      } catch (e) {
        failed++;
        errors.push(`${dropxlId}: ${e.message}`);
      }
    }

    res.json({
      ok: true,
      total: items.length,
      imported,
      skipped,
      failed,
      errors: errors.slice(0, 10),
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ============ 售后管理 ============
router.get('/aftersales', (req, res) => {
  const { status, q, shop_name, order_no, limit = 50, offset = 0 } = req.query;
  const conds = [];
  const args = [];
  if (status && status !== 'all') { conds.push('t.status = ?'); args.push(status); }
  if (order_no) { conds.push('t.order_no LIKE ?'); args.push(`%${order_no.trim()}%`); }
  if (shop_name) { conds.push('po.shop_name LIKE ?'); args.push(`%${shop_name.trim()}%`); }
  if (q) {
    conds.push('(t.order_no LIKE ? OR t.title LIKE ? OR u.username LIKE ? OR po.shop_name LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const baseFrom = `
    FROM aftersales_tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN purchase_orders po ON po.order_no = t.order_no AND po.user_id = t.user_id
  `;
  const rows = db.prepare(`
    SELECT t.*, u.username, u.display_name, po.shop_name
    ${baseFrom}
    ${where}
    ORDER BY t.created_at DESC LIMIT ? OFFSET ?
  `).all(...args, Number(limit), Number(offset));
  const total = db.prepare(`SELECT COUNT(*) AS c ${baseFrom} ${where}`).get(...args).c;
  // 提供候选店铺名给前端筛选下拉
  const shops = db.prepare(`
    SELECT DISTINCT po.shop_name ${baseFrom}
    WHERE po.shop_name IS NOT NULL AND po.shop_name != ''
    ORDER BY po.shop_name
  `).all().map(r => r.shop_name);
  res.json({ rows, total, shops });
});

router.get('/aftersales/:id', (req, res) => {
  const t = db.prepare(`
    SELECT t.*, u.username, u.display_name FROM aftersales_tickets t
    JOIN users u ON u.id = t.user_id WHERE t.id = ?
  `).get(req.params.id);
  if (!t) return res.status(404).json({ error: '工单不存在' });
  const messages = db.prepare('SELECT * FROM aftersales_messages WHERE ticket_id = ? ORDER BY created_at ASC').all(t.id);
  const attachments = db.prepare('SELECT id, message_id, original_name, mimetype, size, created_at FROM aftersales_attachments WHERE ticket_id = ?').all(t.id);
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

// 店主删除售后工单（连带消息/附件物理记录一起清掉；附件文件本身不动避免误删别的）
router.delete('/aftersales/:id', ownerRequired, (req, res) => {
  const t = db.prepare('SELECT id FROM aftersales_tickets WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '工单不存在' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM aftersales_messages WHERE ticket_id = ?').run(t.id);
    db.prepare('DELETE FROM aftersales_attachments WHERE ticket_id = ?').run(t.id);
    db.prepare('DELETE FROM aftersales_tickets WHERE id = ?').run(t.id);
  });
  tx();
  res.json({ ok: true });
});

router.post('/aftersales/:id/reply', upload.array('files', 10), (req, res) => {
  const { content } = req.body || {};
  const t = db.prepare('SELECT * FROM aftersales_tickets WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '工单不存在' });
  const files = req.files || [];
  if (!(content && content.trim()) && files.length === 0) return res.status(400).json({ error: '请填写回复或添加附件' });
  const tx = db.transaction(() => {
    const info = db.prepare('INSERT INTO aftersales_messages (ticket_id, author, is_admin, content) VALUES (?, ?, 1, ?)').run(t.id, req.user.username, content || '');
    const msgId = info.lastInsertRowid;
    const insAtt = db.prepare('INSERT INTO aftersales_attachments (ticket_id, message_id, filename, original_name, mimetype, size) VALUES (?, ?, ?, ?, ?, ?)');
    for (const f of files) insAtt.run(t.id, msgId, f.filename, Buffer.from(f.originalname, 'latin1').toString('utf8'), f.mimetype, f.size);
    db.prepare('UPDATE aftersales_tickets SET has_new_message = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(t.id);
  });
  tx();
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

// ============ 导出 DropXL 采购模板 ============
const XLSX_LIB = require('xlsx');

router.post('/orders/dropxl-template-export', (req, res) => {
  const { from_date, to_date, include_exported = false, user_id } = req.body || {};
  const conds = ["po.status IN ('pending_purchase', 'pending_shipment')"];
  const args = [];
  if (!include_exported) {
    conds.push('po.dropxl_exported_at IS NULL');
  }
  if (from_date) { conds.push('date(po.created_at) >= ?'); args.push(from_date); }
  if (to_date) { conds.push('date(po.created_at) <= ?'); args.push(to_date); }
  if (user_id) { conds.push('po.user_id = ?'); args.push(Number(user_id)); }
  const where = 'WHERE ' + conds.join(' AND ');

  const orders = db.prepare(`
    SELECT po.id, po.order_no, po.customer_ref,
           pos.name, pos.address1, pos.address2, pos.city, pos.state,
           pos.postal, pos.country, pos.phone, pos.buyer_email
    FROM purchase_orders po
    LEFT JOIN purchase_order_shipping pos ON pos.order_id = po.id
    ${where}
    ORDER BY po.id ASC
  `).all(...args);

  if (orders.length === 0) {
    return res.status(404).json({ error: '没有符合条件的订单可导出' });
  }

  const itemsByOrder = new Map();
  const items = db.prepare(`
    SELECT order_id, sku, quantity FROM purchase_order_items
    WHERE order_id IN (${orders.map(() => '?').join(',')})
  `).all(...orders.map(o => o.id));
  for (const it of items) {
    if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
    itemsByOrder.get(it.order_id).push(it);
  }

  // 展开成 DropXL 12 列 (一行 = 一个 product_code)
  const dropxlRows = [];
  for (const o of orders) {
    const its = itemsByOrder.get(o.id) || [];
    for (const it of its) {
      dropxlRows.push({
        order_reference: o.order_no,
        product_code: it.sku,
        quantity: it.quantity,
        address: o.address1 || '',
        address2: o.address2 || '',
        province: o.state || '',
        city: o.city || '',
        country: o.country || '',
        postal_code: o.postal || '',
        phone: o.phone || '',
        name: o.name || '',
        email: o.buyer_email || '',
      });
    }
  }

  if (dropxlRows.length === 0) {
    return res.status(404).json({ error: '订单存在但没有任何商品行可导出' });
  }

  // 标记这些订单为已导出
  const now = new Date().toISOString();
  const mark = db.prepare('UPDATE purchase_orders SET dropxl_exported_at = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const o of orders) mark.run(now, o.id);
  });
  tx();

  const ws = XLSX_LIB.utils.json_to_sheet(dropxlRows, {
    header: ['order_reference', 'product_code', 'quantity', 'address', 'address2', 'province', 'city', 'country', 'postal_code', 'phone', 'name', 'email'],
  });
  ws['!cols'] = [
    { wch: 22 }, { wch: 14 }, { wch: 8 }, { wch: 32 }, { wch: 20 }, { wch: 8 }, { wch: 16 },
    { wch: 8 }, { wch: 14 }, { wch: 22 }, { wch: 24 }, { wch: 32 },
  ];
  const wb = XLSX_LIB.utils.book_new();
  XLSX_LIB.utils.book_append_sheet(wb, ws, 'DropXL Purchase Orders');
  const buf = XLSX_LIB.write(wb, { type: 'buffer', bookType: 'xlsx' });

  setAudit(res, { summary: `导出 DropXL 采购模板：${orders.length} 个订单 / ${dropxlRows.length} 行商品` });
  const fileName = `dropxl-purchase-orders-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ============ 导出订单列表（管理员）============
// 与订单管理列表用同一套筛选条件（状态/搜索/用户/创建时间），导出当前筛选结果为 xlsx。
// 仅管理员可达（authRequired+adminRequired），分销商无法访问；成本相关列仅在管理员可见范围内导出。
const ORDER_STATUS_LABEL = {
  pending_purchase: '待采购', pending_shipment: '待发货', shipped: '已发货',
  completed: '已完成', cancelled: '已取消', refunded: '已退款', replaced: '已换货',
};
router.post('/orders/export', (req, res) => {
  const { status, q, user_id, start, end } = req.body || {};
  const conds = [];
  const args = [];
  if (status && status !== 'all') { conds.push('o.status = ?'); args.push(status); }
  if (user_id) { conds.push('o.user_id = ?'); args.push(user_id); }
  if (q) {
    conds.push('(o.order_no LIKE ? OR u.username LIKE ? OR u.display_name LIKE ? OR o.shop_name LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (start) { conds.push('o.created_at >= ?'); args.push(start); }
  if (end) { conds.push('o.created_at <= ?'); args.push(end); }
  // 至少指定一个筛选条件，避免无约束全表导出阻塞事件循环
  if (conds.length === 0) return res.status(400).json({ error: '请先选择状态 / 搜索 / 时间范围再导出' });
  const where = 'WHERE ' + conds.join(' AND ');

  const orders = db.prepare(`
    SELECT o.*, u.username, u.display_name
    FROM purchase_orders o JOIN users u ON u.id = o.user_id
    ${where}
    ORDER BY o.created_at DESC
  `).all(...args);
  if (orders.length === 0) return res.status(404).json({ error: '没有符合条件的订单可导出' });

  const isAdmin = !!req.user.is_admin;
  const rows = orders.map(o => {
    const sales = Number(o.amazon_amount) || 0;
    const purchase = Number(o.purchase_amount_usd) || 0;
    const purchaseCny = Number(o.purchase_amount_cny) || 0;
    const amazonRate = Number(o.amazon_rate_locked) || 0;
    const canCny = sales > 0 && amazonRate > 0;
    const profit = sales > 0 ? sales - purchase : '';
    const profitCny = canCny ? sales * amazonRate - purchaseCny : '';
    const marginPct = (canCny && purchaseCny > 0) ? ((sales * amazonRate - purchaseCny) / purchaseCny * 100) : '';
    const row = {
      '订单号': o.order_no,
      '用户': o.display_name || o.username,
      '国家': o.country || '',
      '店铺': o.shop_name || '',
      '亚马逊金额': sales,
      '采购(USD)': purchase,
      '采购(¥)': purchaseCny,
      '利润(本币)': profit,
      '利润(¥)': profitCny,
      '成本利润率(%)': marginPct === '' ? '' : Number(marginPct.toFixed(2)),
    };
    if (isAdmin) {
      const realUsd = Number(o.real_amount_usd) || 0;
      const paypalRate = Number(o.paypal_rate) || 0;
      const realCny = paypalRate > 0 ? realUsd / paypalRate : '';
      row['真实(USD)'] = realUsd;
      row['加价%'] = Number(o.markup_pct) || 0;
      row['PayPal汇率'] = paypalRate || '';
      row['真实采购价(¥)'] = realCny === '' ? '' : Number(realCny.toFixed(2));
      row['差价利润(¥)'] = realCny === '' ? '' : Number((purchaseCny - realCny).toFixed(2));
    }
    row['供应商ID'] = o.dropxl_order_id || '';
    row['跟踪号'] = o.tracking_no || '';
    row['状态'] = ORDER_STATUS_LABEL[o.status] || o.status;
    row['创建时间'] = o.created_at || '';
    return row;
  });

  const ws = XLSX_LIB.utils.json_to_sheet(rows);
  const wb = XLSX_LIB.utils.book_new();
  XLSX_LIB.utils.book_append_sheet(wb, ws, '订单');
  const buf = XLSX_LIB.write(wb, { type: 'buffer', bookType: 'xlsx' });

  setAudit(res, { summary: `导出订单列表：${orders.length} 个订单` });
  const fileName = `orders-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ============ 系统设置（BOSS 或被授权 settings 权限的管理员） ============
const { getExchangeRate, setSetting, getSetting } = require('../settings');

router.get('/settings', permRequired('settings'), (req, res) => {
  const fxKey = (getSetting('juhe_fx_api_key') || '').trim();
  res.json({
    exchange_rate_cny_per_usd: getExchangeRate(),
    // 只回是否已配置 + 末 4 位，不回完整 Key
    juhe_fx_api_key_set: !!fxKey,
    juhe_fx_api_key_hint: fxKey ? `****${fxKey.slice(-4)}` : '',
  });
});

router.put('/settings', permRequired('settings'), (req, res) => {
  const { exchange_rate_cny_per_usd, juhe_fx_api_key } = req.body || {};
  if (exchange_rate_cny_per_usd !== undefined) {
    const v = Number(exchange_rate_cny_per_usd);
    if (!isFinite(v) || v <= 0) return res.status(400).json({ error: '汇率必须是正数' });
    setSetting('exchange_rate_cny_per_usd', v);
    setAudit(res, { summary: `修改人民币/美元汇率: ${v}` });
  }
  if (juhe_fx_api_key !== undefined) {
    const k = String(juhe_fx_api_key).trim();
    setSetting('juhe_fx_api_key', k);
    setAudit(res, { summary: k ? '更新汇率 API Key' : '清空汇率 API Key' });
  }
  res.json({ ok: true, exchange_rate_cny_per_usd: getExchangeRate() });
});

// ============ SMTP 邮件设置（仅店主：用于 BOSS 密码找回，管理员可改会导致验证码被截获） ============
router.get('/settings/smtp', ownerRequired, (req, res) => {
  const { getSmtpConfig } = require('../mailer');
  const c = getSmtpConfig();
  res.json({
    smtp_host: c.host, smtp_port: c.port, smtp_secure: c.secure,
    smtp_user: c.user, smtp_from: c.from,
    // 密码不回传完整值，只回是否已配置
    smtp_pass_set: !!c.pass,
  });
});

router.put('/settings/smtp', ownerRequired, (req, res) => {
  const { smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, smtp_from } = req.body || {};
  if (smtp_host !== undefined) setSetting('smtp_host', String(smtp_host).trim());
  if (smtp_port !== undefined) {
    const p = Number(smtp_port);
    if (!Number.isInteger(p) || p <= 0 || p > 65535) return res.status(400).json({ error: '端口必须是 1-65535 的整数' });
    setSetting('smtp_port', p);
  }
  if (smtp_secure !== undefined) setSetting('smtp_secure', smtp_secure ? '1' : '0');
  if (smtp_user !== undefined) setSetting('smtp_user', String(smtp_user).trim());
  if (smtp_pass !== undefined && smtp_pass !== '') setSetting('smtp_pass', String(smtp_pass));
  if (smtp_from !== undefined) setSetting('smtp_from', String(smtp_from).trim());
  setAudit(res, { summary: '更新 SMTP 邮件设置' });
  res.json({ ok: true });
});

// 发一封测试邮件到 BOSS 自己的预留邮箱，验证 SMTP 配置可用
router.post('/settings/smtp-test', ownerRequired, async (req, res) => {
  const { sendMail } = require('../mailer');
  const me = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
  const to = String(me?.email || '').trim();
  if (!to.includes('@')) return res.status(400).json({ error: '请先在 个人资料 中填写你的邮箱' });
  try {
    await sendMail({ to, subject: '【蓝鲸跨境海外仓】SMTP 测试邮件', text: '收到此邮件说明 SMTP 配置正确，管理员密码找回功能可用。' });
    res.json({ ok: true, message: `测试邮件已发送到 ${to}` });
  } catch (e) {
    res.status(502).json({ error: '发送失败：' + e.message });
  }
});

// ============ 售后政策维护（BOSS 或被分配 aftersales_policy 权限的管理员） ============
router.get('/aftersales-policies', permRequired('aftersales_policy'), (req, res) => {
  const rows = db.prepare(`
    SELECT id, slug, title, body, published_title, published_body, sort_order, updated_at, published_at,
           CASE WHEN COALESCE(body, '') = COALESCE(published_body, '')
                 AND COALESCE(title, '') = COALESCE(published_title, '')
                THEN 0 ELSE 1 END AS is_dirty
    FROM aftersales_policies
    ORDER BY sort_order ASC, id ASC
  `).all();
  res.json(rows);
});

router.post('/aftersales-policies', permRequired('aftersales_policy'), (req, res) => {
  const { slug, title, body, sort_order } = req.body || {};
  if (!slug || !title) return res.status(400).json({ error: 'slug 与 title 必填' });
  if (db.prepare('SELECT id FROM aftersales_policies WHERE slug = ?').get(slug)) {
    return res.status(400).json({ error: 'slug 已存在' });
  }
  const order = Number.isFinite(Number(sort_order)) ? Number(sort_order)
    : (db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM aftersales_policies').get().n);
  const info = db.prepare(`
    INSERT INTO aftersales_policies (slug, title, body, sort_order, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(slug, title, body || '', order);
  setAudit(res, { target_id: info.lastInsertRowid, target_name: title, summary: `新增售后政策章节: ${title} (${slug})` });
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/aftersales-policies/:id', permRequired('aftersales_policy'), (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM aftersales_policies WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: '章节不存在' });
  const { title, body, sort_order } = req.body || {};
  const nextTitle = title != null ? title : cur.title;
  const nextBody = body != null ? body : cur.body;
  const nextOrder = Number.isFinite(Number(sort_order)) ? Number(sort_order) : cur.sort_order;
  db.prepare(`
    UPDATE aftersales_policies
    SET title = ?, body = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(nextTitle, nextBody, nextOrder, id);
  setAudit(res, { target_id: id, target_name: nextTitle, summary: `编辑售后政策草稿: ${nextTitle}` });
  res.json({ ok: true });
});

router.delete('/aftersales-policies/:id', permRequired('aftersales_policy'), (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT title FROM aftersales_policies WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: '章节不存在' });
  db.prepare('DELETE FROM aftersales_policies WHERE id = ?').run(id);
  setAudit(res, { target_id: id, target_name: cur.title, summary: `删除售后政策章节: ${cur.title}` });
  res.json({ ok: true });
});

router.post('/aftersales-policies/publish-all', permRequired('aftersales_policy'), (req, res) => {
  const result = db.prepare(`
    UPDATE aftersales_policies
    SET published_title = title,
        published_body = body,
        published_at = CURRENT_TIMESTAMP
    WHERE COALESCE(body, '') != COALESCE(published_body, '')
       OR COALESCE(title, '') != COALESCE(published_title, '')
  `).run();
  setAudit(res, { summary: `一键发布售后政策（${result.changes} 个章节更新）` });
  res.json({ ok: true, updated: result.changes });
});

// ============ 售后处理模板（BOSS 或被分配 aftersales_template 权限的管理员可编辑；查看/复制走 /api/aftersales-templates） ============
router.post('/aftersales-templates', permRequired('aftersales_template'), (req, res) => {
  const { category = '', title, body = '', sort_order = 0 } = req.body || {};
  const t = String(title || '').trim();
  if (!t) return res.status(400).json({ error: '请填写模板标题' });
  const info = db.prepare(`
    INSERT INTO aftersales_templates (category, title, body, sort_order) VALUES (?, ?, ?, ?)
  `).run(String(category).trim(), t, String(body), Number(sort_order) || 0);
  setAudit(res, { target_id: String(info.lastInsertRowid), target_name: t, summary: `新增售后处理模板「${t}」` });
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/aftersales-templates/:id', permRequired('aftersales_template'), (req, res) => {
  const row = db.prepare('SELECT id FROM aftersales_templates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '模板不存在' });
  const { category = '', title, body = '', sort_order = 0 } = req.body || {};
  const t = String(title || '').trim();
  if (!t) return res.status(400).json({ error: '请填写模板标题' });
  db.prepare(`
    UPDATE aftersales_templates
    SET category = ?, title = ?, body = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(String(category).trim(), t, String(body), Number(sort_order) || 0, row.id);
  setAudit(res, { target_id: String(row.id), target_name: t, summary: `修改售后处理模板「${t}」` });
  res.json({ ok: true });
});

router.delete('/aftersales-templates/:id', permRequired('aftersales_template'), (req, res) => {
  const row = db.prepare('SELECT id, title FROM aftersales_templates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '模板不存在' });
  db.prepare('DELETE FROM aftersales_templates WHERE id = ?').run(row.id);
  setAudit(res, { target_id: String(row.id), target_name: row.title, summary: `删除售后处理模板「${row.title}」` });
  res.json({ ok: true });
});

module.exports = router;
module.exports.syncOrdersFromDropxl = syncOrdersFromDropxl;
