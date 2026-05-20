const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '30d' });
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies?.token;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: '登录已过期' });
  }
}

function adminRequired(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: '需要管理员权限' });
  next();
}

function ownerRequired(req, res, next) {
  if (!req.user?.is_owner) return res.status(403).json({ error: '此操作仅店主可执行' });
  next();
}

module.exports = { sign, authRequired, adminRequired, ownerRequired };
