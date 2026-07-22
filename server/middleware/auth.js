const jwt = require('jsonwebtoken');
const db = require('../db');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// BOSS 可分配给管理员的功能权限注册表。新增可分配功能在这里加一项即可，
// 后端校验 / 管理员页勾选 / 前端菜单都以此为准（前端有一份同步的 label 表）。
// default: true 的是基础界面：管理员默认可见，BOSS 可单独取消。
const GRANTABLE_PERMISSIONS = [
  { key: 'users', label: '用户管理', default: true },
  { key: 'orders', label: '订单管理', default: true },
  { key: 'aftersales', label: '售后管理', default: true },
  { key: 'purchase', label: '采购商品', default: true },
  { key: 'downloads', label: '下载支持', default: true },
  { key: 'products', label: '商品库存价格管理', default: true },
  { key: 'finance', label: '财务管理' },
  { key: 'aftersales_policy', label: '售后政策维护' },
  { key: 'settings', label: '系统设置' },
  { key: 'aftersales_template', label: '售后处理模板（编辑）' },
];
const GRANTABLE_KEYS = GRANTABLE_PERMISSIONS.map(p => p.key);
const DEFAULT_GRANTED_KEYS = GRANTABLE_PERMISSIONS.filter(p => p.default).map(p => p.key);
// 保存权限时写入的标记：区分「新版已显式配置过基础界面」与「旧数据从未配置」。
// 旧数据（只存过 finance/aftersales_policy）没有此标记 → 基础界面按默认全开，向后兼容。
const BASE_CONFIGURED_FLAG = '__base_configured__';

// 把 permissions 列的 JSON 解析成有效权限数组（含旧数据兼容逻辑）
function parsePermissions(json) {
  let arr;
  try { arr = JSON.parse(json || 'null'); } catch { arr = null; }
  if (!Array.isArray(arr)) return [...DEFAULT_GRANTED_KEYS];
  const list = arr.filter(k => GRANTABLE_KEYS.includes(k));
  if (!arr.includes(BASE_CONFIGURED_FLAG)) return [...new Set([...list, ...DEFAULT_GRANTED_KEYS])];
  return list;
}

// 读某用户已开通的功能权限（从 DB 实时读，改了立即生效，无需重新登录）
function getUserPermissions(id) {
  try {
    const row = db.prepare('SELECT permissions FROM users WHERE id = ?').get(id);
    return parsePermissions(row?.permissions);
  } catch {
    return [...DEFAULT_GRANTED_KEYS];
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

// 中间件工厂：允许 Authorization 头(完整会话)或 ?ticket=<jwt>(用途绑定短期票据)二选一通过。
// resourceCheck(req, ticketPayload) 返回错误字符串则拒绝(403)，用于把票据绑定到具体资源(如国家)，
// 防止同一张票据被改 URL 去下别的国家。仅票据失败时才回退到 authRequired，给出标准的 401 错误。
function authOrTicket(purpose, resourceCheck) {
  return (req, res, next) => {
    const t = req.query.ticket;
    if (t) {
      try {
        const payload = verifyTicket(String(t), purpose);
        if (resourceCheck) {
          const err = resourceCheck(req, payload);
          if (err) return res.status(403).json({ error: err });
        }
        req.user = { id: payload.uid || null, _viaTicket: true };
        return next();
      } catch { /* fall through to header auth */ }
    }
    return authRequired(req, res, next);
  };
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
  authRequired, authOrTicket, adminRequired, ownerRequired, permRequired,
  getUserPermissions, parsePermissions, GRANTABLE_PERMISSIONS, GRANTABLE_KEYS,
  DEFAULT_GRANTED_KEYS, BASE_CONFIGURED_FLAG,
};
