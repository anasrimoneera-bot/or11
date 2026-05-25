const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { sign, authRequired, getUserPermissions, GRANTABLE_KEYS } = require('../middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = sign({ id: user.id, username: user.username, role: user.role, is_admin: !!user.is_admin, is_owner: !!user.is_owner });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      email: user.email,
      role: user.role,
      is_admin: !!user.is_admin,
      is_owner: !!user.is_owner,
      member_level: user.member_level,
      // BOSS 隐式拥有全部功能；普通管理员返回已开通的功能 key
      permissions: user.is_owner ? GRANTABLE_KEYS : getUserPermissions(user.id),
    },
  });
});

router.get('/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT id, username, display_name, email, phone, company, address, role, is_admin, is_owner, member_level, member_days, sku_limit, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const bal = db.prepare('SELECT balance FROM user_balance WHERE user_id = ?').get(user.id);
  user.balance = bal?.balance || 0;
  // BOSS 隐式拥有全部功能；普通管理员返回已开通的功能 key
  user.permissions = user.is_owner ? GRANTABLE_KEYS : getUserPermissions(user.id);
  res.json(user);
});

router.post('/change-password', authRequired, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: '密码至少6位' });
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ ok: true });
});

router.put('/profile', authRequired, (req, res) => {
  const { display_name, email, phone, company, address } = req.body || {};
  db.prepare(`
    UPDATE users SET display_name = COALESCE(?, display_name),
                     email = COALESCE(?, email),
                     phone = COALESCE(?, phone),
                     company = COALESCE(?, company),
                     address = COALESCE(?, address)
    WHERE id = ?
  `).run(display_name, email, phone, company, address, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
