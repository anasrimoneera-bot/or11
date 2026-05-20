const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/sub', authRequired, (req, res) => {
  const rows = db.prepare('SELECT id, username, display_name, email, role, created_at FROM users WHERE parent_id = ?').all(req.user.id);
  res.json(rows);
});

router.post('/sub', authRequired, (req, res) => {
  const { username, password, display_name, email, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(400).json({ error: '用户名已存在' });
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, display_name, email, role, parent_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(username, hash, display_name, email, role || 'sub', req.user.id);
  db.prepare('INSERT INTO user_balance (user_id, balance) VALUES (?, 0)').run(info.lastInsertRowid);
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.delete('/sub/:id', authRequired, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ? AND parent_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.get('/shops', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM shops WHERE user_id = ? ORDER BY name').all(req.user.id);
  res.json(rows);
});

router.post('/shops', authRequired, (req, res) => {
  const { name, country } = req.body || {};
  if (!name) return res.status(400).json({ error: '请填写店铺名' });
  const info = db.prepare('INSERT INTO shops (user_id, name, country) VALUES (?, ?, ?)').run(req.user.id, name, country);
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.delete('/shops/:id', authRequired, (req, res) => {
  db.prepare('DELETE FROM shops WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
