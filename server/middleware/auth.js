const jwt = require('jsonwebtoken');
const db = require('../db');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// BOSS 可分配给管理员的功能权限注册表。新增可分配功能在这里加一项即可，
// 后端校验 / 管理员页勾选 / 前端菜单都以此为准（前端有一份同步的 label 表）。
const GRANTABLE_PERMISSIONS = [
  { key: 'finance', label: '财务管理' },
  { key: 'aftersales_policy', label: '售后政策维护' },
];
const GRANTABLE_KEYS = GRANTABLE_PERMISSIONS.map(p => p.key);

// 读某用户已开通的功能权限（从 DB 实时读，改了立即生效，无需重新登录）
function getUserPermissions(id) {
  try {
    const row = db.prepare('SELECT permissions FROM users WHERE id = ?').get(id);
    const arr = JSON.parse(row?.permissions || '[]');
    return Array.isArray(arr) ? arr.filter(k => GRANTABLE_KEYS.includes(k)) : [];
  } catch {
    return [];
  }
}

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '30d' });
}

// 签发用途绑定的短期下载票据（用于让浏览器原生下载器直连大文件接口）。
// 票据只携带用途+用户 id，无会话级权限，泄漏影响面有限。
function signTicket(purpose, payload = {}, ttl = '60s') {
  return jwt.sign({ ...payload, purpose }, SECRET, { expiresIn: ttl });
}
function verifyTicket(token, expectedPurpose) {
  const p = jwt.verify(token, SECRET);
  if (p.purpose !== expectedPurpose) throw new Error('purpose mismatch');
  return p;
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

// 功能权限网关：BOSS 始终放行；普通管理员需被分配了该功能 key 才放行。
function permRequired(key) {
  return (req, res, next) => {
    if (!req.user?.is_admin) return res.status(403).json({ error: '需要管理员权限' });
    if (req.user.is_owner) return next();
    if (getUserPermissions(req.user.id).includes(key)) return next();
    return res.status(403).json({ error: '无此功能权限，请联系 BOSS 开通' });
  };
}

module.exports = {
  sign, signTicket, verifyTicket,
  authRequired, adminRequired, ownerRequired, permRequired,
  getUserPermissions, GRANTABLE_PERMISSIONS, GRANTABLE_KEYS,
};
