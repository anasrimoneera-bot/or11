const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authRequired, authOrTicket, signTicket } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

router.get('/', authRequired, (req, res) => {
  const { q, status, limit = 20, offset = 0 } = req.query;
  const conds = ['user_id = ?'];
  const args = [req.user.id];
  if (status && status !== 'all') { conds.push('status = ?'); args.push(status); }
  if (q) {
    conds.push('(order_no LIKE ? OR title LIKE ? OR description LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = 'WHERE ' + conds.join(' AND ');
  const rows = db.prepare(`SELECT * FROM aftersales_tickets ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...args, Number(limit), Number(offset));
  const total = db.prepare(`SELECT COUNT(*) AS c FROM aftersales_tickets ${where}`).get(...args).c;
  res.json({ rows, total });
});

router.get('/stats', authRequired, (req, res) => {
  const userId = req.user.id;
  const counts = {
    total: db.prepare('SELECT COUNT(*) AS c FROM aftersales_tickets WHERE user_id = ?').get(userId).c,
    pending: db.prepare("SELECT COUNT(*) AS c FROM aftersales_tickets WHERE user_id = ? AND status = 'pending'").get(userId).c,
    processing: db.prepare("SELECT COUNT(*) AS c FROM aftersales_tickets WHERE user_id = ? AND status = 'processing'").get(userId).c,
    waiting_refund: db.prepare("SELECT COUNT(*) AS c FROM aftersales_tickets WHERE user_id = ? AND status = 'waiting_refund'").get(userId).c,
    completed: db.prepare("SELECT COUNT(*) AS c FROM aftersales_tickets WHERE user_id = ? AND status = 'completed'").get(userId).c,
  };
  res.json(counts);
});

// 用户根据订单号/品牌/国家搜索自己的订单（用于售后选择）
router.get('/search-orders', authRequired, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  // 列白名单：与 /api/orders 一致，绝不返回 real_amount_usd / markup_pct / paypal_rate /
  // raw_payload / raw_response —— 否则分销商能在售后页的接口响应里看到真实成本/加价/利润。
  const rows = db.prepare(`
    SELECT id, user_id, order_no, customer_ref, shop_name, country,
           amazon_amount, amazon_tax_amount, shipping_fee, amazon_rate_locked,
           purchase_amount_usd, purchase_amount_cny, exchange_rate,
           distributor_refund, tracking_no, shipping_carrier, status,
           created_at, updated_at
    FROM purchase_orders
    WHERE user_id = ? AND (order_no LIKE ? OR shop_name LIKE ? OR country LIKE ?)
    ORDER BY created_at DESC LIMIT 10
  `).all(req.user.id, `%${q}%`, `%${q}%`, `%${q}%`);
  res.json(rows);
});

router.get('/:id', authRequired, (req, res) => {
  const t = db.prepare('SELECT * FROM aftersales_tickets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!t) return res.status(404).json({ error: '工单不存在' });
  const messages = db.prepare('SELECT * FROM aftersales_messages WHERE ticket_id = ? ORDER BY created_at ASC').all(t.id);
  const attachments = db.prepare('SELECT id, message_id, original_name, mimetype, size, created_at FROM aftersales_attachments WHERE ticket_id = ?').all(t.id);
  res.json({ ...t, messages, attachments });
});

// 签发短期下载票据：浏览器 <a>/新标签页直连附件接口时无法带 Authorization 头，
// 故先用已登录会话换一张绑定到该附件 id 的票据（权限在此处校验，下载接口凭票放行）。
router.post('/attachments/:id/ticket', authRequired, (req, res) => {
  const att = db.prepare(`
    SELECT a.id, t.user_id FROM aftersales_attachments a
    JOIN aftersales_tickets t ON t.id = a.ticket_id
    WHERE a.id = ?
  `).get(req.params.id);
  if (!att) return res.status(404).json({ error: '附件不存在' });
  if (!req.user.is_admin && att.user_id !== req.user.id) return res.status(403).json({ error: '无权访问' });
  res.json({ ticket: signTicket('aftersales-att', { aid: att.id }, '60s') });
});

router.get('/attachments/:id', authOrTicket('aftersales-att', (req, p) => (
  String(p.aid) === String(req.params.id) ? null : '票据与请求附件不符'
)), (req, res) => {
  const att = db.prepare(`
    SELECT a.*, t.user_id FROM aftersales_attachments a
    JOIN aftersales_tickets t ON t.id = a.ticket_id
    WHERE a.id = ?
  `).get(req.params.id);
  if (!att) return res.status(404).end();
  // 凭票访问时权限已在签发环节校验，无需再比对所有者（票据用户无 is_admin 字段）。
  if (!req.user._viaTicket && !req.user.is_admin && att.user_id !== req.user.id) return res.status(403).end();
  res.setHeader('Content-Type', att.mimetype || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.original_name || att.filename)}"`);
  res.sendFile(path.join(UPLOAD_DIR, att.filename));
});

router.post('/', authRequired, upload.array('files', 10), (req, res) => {
  const { order_no, country, reason, description, priority } = req.body || {};
  if (!order_no) return res.status(400).json({ error: '请选择订单' });
  if (!reason) return res.status(400).json({ error: '请选择售后原因' });
  if (!description || !description.trim()) return res.status(400).json({ error: '请填写备注说明' });

  const order = db.prepare('SELECT id FROM purchase_orders WHERE order_no = ? AND user_id = ?').get(order_no, req.user.id);

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO aftersales_tickets (user_id, order_id, order_no, country, title, reason, description, priority, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(req.user.id, order?.id || null, order_no, country, `售后申请 - ${reason}`, reason, description, priority || '中优先级');

    const ticketId = info.lastInsertRowid;
    const insAtt = db.prepare('INSERT INTO aftersales_attachments (ticket_id, filename, original_name, mimetype, size) VALUES (?, ?, ?, ?, ?)');
    for (const f of req.files || []) {
      insAtt.run(ticketId, f.filename, Buffer.from(f.originalname, 'latin1').toString('utf8'), f.mimetype, f.size);
    }
    return ticketId;
  });

  res.json({ ok: true, id: tx() });
});

router.post('/:id/messages', authRequired, (req, res) => {
  const { content } = req.body || {};
  const t = db.prepare('SELECT * FROM aftersales_tickets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!t) return res.status(404).json({ error: '工单不存在' });
  db.prepare('INSERT INTO aftersales_messages (ticket_id, author, is_admin, content) VALUES (?, ?, 0, ?)').run(t.id, req.user.username, content);
  db.prepare('UPDATE aftersales_tickets SET updated_at = CURRENT_TIMESTAMP, has_new_message = 1 WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

module.exports = router;
