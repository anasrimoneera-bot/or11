const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/', authRequired, (req, res) => {
  const { type, limit = 50, offset = 0 } = req.query;
  const conds = ['user_id = ?'];
  const args = [req.user.id];
  if (type && type !== 'all') { conds.push('type = ?'); args.push(type); }
  const where = 'WHERE ' + conds.join(' AND ');
  const rows = db.prepare(`SELECT * FROM balance_records ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...args, Number(limit), Number(offset));
  const total = db.prepare(`SELECT COUNT(*) AS c FROM balance_records ${where}`).get(...args).c;
  const bal = db.prepare('SELECT balance FROM user_balance WHERE user_id = ?').get(req.user.id);
  res.json({ rows, total, balance: bal?.balance || 0 });
});

router.post('/recharge', authRequired, (req, res) => {
  const { amount, description } = req.body || {};
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: '充值金额必须大于0' });
  const tx = db.transaction(() => {
    const bal = db.prepare('SELECT balance FROM user_balance WHERE user_id = ?').get(req.user.id);
    const newBal = (bal?.balance || 0) + amt;
    db.prepare('UPDATE user_balance SET balance = ? WHERE user_id = ?').run(newBal, req.user.id);
    db.prepare(`
      INSERT INTO balance_records (user_id, type, amount, balance_after, description)
      VALUES (?, '余额调整', ?, ?, ?)
    `).run(req.user.id, amt, newBal, description || `余额调整: +¥${amt.toFixed(2)}`);
    return newBal;
  });
  const newBal = tx();
  res.json({ ok: true, balance: newBal });
});

router.post('/adjust', authRequired, (req, res) => {
  const { amount, description, type } = req.body || {};
  const amt = Number(amount);
  if (!amt || !isFinite(amt)) return res.status(400).json({ error: '请输入有效金额' });
  const tx = db.transaction(() => {
    const bal = db.prepare('SELECT balance FROM user_balance WHERE user_id = ?').get(req.user.id);
    const newBal = (bal?.balance || 0) + amt;
    db.prepare('UPDATE user_balance SET balance = ? WHERE user_id = ?').run(newBal, req.user.id);
    db.prepare(`
      INSERT INTO balance_records (user_id, type, amount, balance_after, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.user.id, type || (amt > 0 ? '余额调整' : '扣除'), amt, newBal, description);
    return newBal;
  });
  res.json({ ok: true, balance: tx() });
});

module.exports = router;
