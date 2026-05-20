const db = require('../db');

const ACTIONS = [
  // 用户管理
  { re: /^POST \/users$/, action: '创建分销商', target: 'user' },
  { re: /^PUT \/users\/(\d+)$/, action: '编辑分销商资料', target: 'user' },
  { re: /^POST \/users\/(\d+)\/reset-password$/, action: '重置分销商密码', target: 'user' },
  { re: /^POST \/users\/(\d+)\/balance$/, action: '调整分销商余额', target: 'user' },
  { re: /^PUT \/users\/(\d+)\/markup$/, action: '修改加价百分比', target: 'user' },
  // 订单
  { re: /^POST \/orders\/(\d+)\/confirm$/, action: '确认采购订单（扣款）', target: 'order' },
  { re: /^POST \/orders\/(\d+)\/reject$/, action: '驳回订单', target: 'order' },
  { re: /^PUT \/orders\/(\d+)$/, action: '编辑订单', target: 'order' },
  { re: /^POST \/orders\/sync$/, action: '从DropXL同步订单状态' },
  // 售后
  { re: /^PUT \/aftersales\/(\d+)$/, action: '更新售后工单', target: 'ticket' },
  { re: /^POST \/aftersales\/(\d+)\/reply$/, action: '回复售后工单', target: 'ticket' },
  { re: /^POST \/aftersales\/(\d+)\/refund$/, action: '售后退款给用户', target: 'ticket' },
  // 员工
  { re: /^POST \/staff$/, action: '创建员工账号', target: 'staff' },
  { re: /^DELETE \/staff\/(\d+)$/, action: '删除员工账号', target: 'staff' },
  { re: /^POST \/staff\/(\d+)\/reset-password$/, action: '重置员工密码', target: 'staff' },
  // 测试
  { re: /^POST \/test-dropxl$/, action: 'DropXL API 测试' },
];

function describe(method, path) {
  const key = `${method} ${path}`;
  for (const a of ACTIONS) {
    const m = key.match(a.re);
    if (m) return { action: a.action, target_type: a.target || null, target_id: m[1] || null };
  }
  return null;
}

function safePayload(body) {
  if (!body || typeof body !== 'object') return null;
  const { password, password_hash, ...rest } = body;
  try { return JSON.stringify(rest); } catch { return null; }
}

// 字段中文映射
const FIELD_NAMES = {
  sku_limit: 'SKU限制',
  member_level: '会员等级',
  member_days: '会员天数',
  markup_pct: '加价百分比(%)',
  display_name: '姓名',
  email: '邮箱',
  phone: '电话',
  company: '公司',
  balance: '余额',
  status: '状态',
  tracking_no: '跟踪号',
  refund_amount: '退款金额',
  admin_note: '管理员备注',
  priority: '优先级',
  real_amount_usd: '真实采购价(USD)',
  exchange_rate: '汇率',
  distributor_refund: '分销补款',
};

function fmtVal(v) {
  if (v === null || v === undefined || v === '') return '空';
  if (typeof v === 'number') return v.toString();
  return String(v);
}

function buildChanges(before, after) {
  if (!before || !after) return null;
  const items = [];
  for (const key of Object.keys(after)) {
    if (key in before && before[key] !== after[key]) {
      const name = FIELD_NAMES[key] || key;
      const oldV = fmtVal(before[key]);
      const newV = fmtVal(after[key]);
      let delta = '';
      if (typeof before[key] === 'number' && typeof after[key] === 'number') {
        const d = after[key] - before[key];
        delta = d > 0 ? ` (+${d})` : ` (${d})`;
      }
      items.push(`${name}: ${oldV} → ${newV}${delta}`);
    }
  }
  return items.length ? items.join('；') : null;
}

function buildSummary(action, body, extra) {
  if (extra?.summary) return extra.summary;
  const parts = [action];
  if (extra?.target_name) parts.push(`针对 "${extra.target_name}"`);
  if (extra?.changes) parts.push(extra.changes);
  else if (body && typeof body === 'object') {
    if (body.amount !== undefined) parts.push(`金额=${body.amount}`);
    if (body.type) parts.push(`类型=${body.type}`);
    if (body.status) parts.push(`状态=${body.status}`);
  }
  return parts.join(' - ');
}

function audit(req, res, next) {
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return next();

  res.on('finish', () => {
    if (!req.user) return;
    const url = (req.originalUrl || '').replace(/^.*\/admin/, '').split('?')[0];
    const desc = describe(req.method, url);
    if (!desc) return;
    if (res.statusCode >= 400) return; // 失败的操作不记录

    const extra = res.locals.audit || {};
    const changes = buildChanges(extra.before, extra.after);
    const summary = buildSummary(desc.action, req.body, { ...extra, changes });

    try {
      db.prepare(`
        INSERT INTO audit_logs (user_id, username, display_name, is_owner, method, path, action,
                                target_type, target_id, target_name, summary, changes, payload, ip, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.user.id, req.user.username, req.user.display_name || null, req.user.is_owner ? 1 : 0,
        req.method, url, desc.action, desc.target_type, extra.target_id || desc.target_id,
        extra.target_name || null, summary, changes, safePayload(req.body), req.ip, res.statusCode,
      );
    } catch (e) {
      console.error('audit log error:', e.message);
    }
  });
  next();
}

// 路由 handler 通过此函数附加详细变更信息
function setAudit(res, payload) {
  res.locals.audit = { ...(res.locals.audit || {}), ...payload };
}

module.exports = { audit, setAudit };
