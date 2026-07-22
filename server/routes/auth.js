const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { sign, authRequired, getUserPermissions, GRANTABLE_KEYS } = require('../middleware/auth');
const { isSmtpConfigured, sendMail } = require('../mailer');

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

// ============ BOSS 账号自助找回（防止 BOSS 密码丢失被锁死） ============
// 仅对 is_owner=1 的账号开放：向其预留邮箱发 6 位验证码，验证通过后重置密码。
// SMTP 参数仅店主可配置（防止管理员改指到自己服务器截获验证码）。
// 为避免暴露账号是否存在，用户名/邮箱不匹配时也返回同样的成功文案。
const RESET_CODE_TTL_MS = 10 * 60 * 1000;   // 验证码 10 分钟有效
const RESET_SEND_INTERVAL_MS = 60 * 1000;   // 同一账号 60 秒内只发一次
const RESET_MAX_ATTEMPTS = 5;               // 验证码最多试错 5 次，超过作废

function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${name.slice(0, 2)}***@${domain}`;
}

router.post('/boss-reset/send-code', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  if (!username) return res.status(400).json({ error: '请输入用户名' });
  if (!isSmtpConfigured()) return res.status(400).json({ error: '系统未配置 SMTP 邮件服务，请联系服务器管理员在 系统设置 中配置' });

  const genericOk = { ok: true, message: '若该 BOSS 账号存在且已绑定邮箱，验证码已发送，请查收（10 分钟内有效）' };
  const user = db.prepare('SELECT id, email FROM users WHERE username = ? AND is_owner = 1').get(username);
  if (!user || !String(user.email || '').includes('@')) return res.json(genericOk);

  const now = Date.now();
  const prev = db.prepare('SELECT last_sent_at FROM password_reset_codes WHERE user_id = ?').get(user.id);
  if (prev && now - prev.last_sent_at < RESET_SEND_INTERVAL_MS) {
    return res.status(429).json({ error: '发送太频繁，请 1 分钟后再试' });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  db.prepare(`
    INSERT INTO password_reset_codes (user_id, code_hash, expires_at, attempts, last_sent_at)
    VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
      attempts = 0, last_sent_at = excluded.last_sent_at
  `).run(user.id, bcrypt.hashSync(code, 10), now + RESET_CODE_TTL_MS, now);

  try {
    await sendMail({
      to: user.email,
      subject: '【蓝鲸跨境海外仓】BOSS 账号密码重置验证码',
      text: `您正在重置 BOSS 账号（${username}）的登录密码。\n\n验证码：${code}\n\n10 分钟内有效。如非本人操作请忽略本邮件并尽快检查账号安全。`,
    });
  } catch (e) {
    db.prepare('DELETE FROM password_reset_codes WHERE user_id = ?').run(user.id);
    return res.status(502).json({ error: '邮件发送失败：' + e.message });
  }
  res.json({ ...genericOk, email_hint: maskEmail(user.email) });
});

router.post('/boss-reset/confirm', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const code = String(req.body?.code || '').trim();
  const newPassword = String(req.body?.new_password || '');
  if (!username || !code) return res.status(400).json({ error: '请输入用户名和验证码' });
  if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少6位' });

  const user = db.prepare('SELECT id FROM users WHERE username = ? AND is_owner = 1').get(username);
  const row = user && db.prepare('SELECT * FROM password_reset_codes WHERE user_id = ?').get(user.id);
  if (!row) return res.status(400).json({ error: '验证码无效，请重新获取' });
  if (Date.now() > row.expires_at) {
    db.prepare('DELETE FROM password_reset_codes WHERE user_id = ?').run(user.id);
    return res.status(400).json({ error: '验证码已过期，请重新获取' });
  }
  if (row.attempts >= RESET_MAX_ATTEMPTS) {
    db.prepare('DELETE FROM password_reset_codes WHERE user_id = ?').run(user.id);
    return res.status(400).json({ error: '验证码错误次数过多已作废，请重新获取' });
  }
  if (!bcrypt.compareSync(code, row.code_hash)) {
    db.prepare('UPDATE password_reset_codes SET attempts = attempts + 1 WHERE user_id = ?').run(user.id);
    return res.status(400).json({ error: '验证码错误' });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), user.id);
  db.prepare('DELETE FROM password_reset_codes WHERE user_id = ?').run(user.id);
  res.json({ ok: true, message: '密码已重置，请用新密码登录' });
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
