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

module.exports = router;
