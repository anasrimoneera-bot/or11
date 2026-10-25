// 推送订单到供应商（DropXL）的共享逻辑：确认采购、管理员手动推送共用。
// 订单提交时只在本地入库（待采购），点击「确认采购」时才推送，避免不能采购的订单被误下到供应商。
const db = require('./db');
const dropxl = require('./dropxl');
const { buildDropxlPayload } = require('./dropxlPayload');

const updatePush = db.prepare(`
  UPDATE purchase_orders
  SET dropxl_order_id = ?, dropxl_push_status = ?, dropxl_push_error = ?, dropxl_pushed_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

// 推送单个订单；成功返回供应商订单号，失败记录错误并抛出（错误信息可直接展示给用户）
async function pushOrderToSupplier(order) {
  const shipping = db.prepare('SELECT * FROM purchase_order_shipping WHERE order_id = ?').get(order.id);
  if (!shipping) throw new Error('缺少买家收货地址，无法推送');
  const items = db.prepare('SELECT sku, quantity FROM purchase_order_items WHERE order_id = ?').all(order.id);
  if (!items.length) throw new Error('订单无商品明细，无法推送');
  try {
    const resp = await dropxl.createOrder(buildDropxlPayload(order.order_no, shipping, items), order.country);
    const id = resp?.order?.id || resp?.id || null;
    updatePush.run(id ? String(id) : null, 'success', null, order.id);
    return id;
  } catch (e) {
    updatePush.run(order.dropxl_order_id || null, 'failed', String(e.message || e).slice(0, 500), order.id);
    throw new Error('推送供应商失败：' + (e.message || e));
  }
}

// 确认采购前确保已推送：已推送成功过（有供应商单号）的历史订单不重复推送
async function ensurePushed(order) {
  if (order.dropxl_order_id) return order.dropxl_order_id;
  return pushOrderToSupplier(order);
}

// 同一用户的确认采购串行执行：推送是异步的，防止重复点击把同一订单推两次，
// 或同一用户并发确认多单时余额检查与扣款之间被插队导致超扣
const locks = new Set();
async function withUserLock(userId, fn) {
  const key = String(userId);
  if (locks.has(key)) {
    const err = new Error('该用户有订单正在确认采购中，请稍后再试');
    err.status = 409;
    throw err;
  }
  locks.add(key);
  try { return await fn(); } finally { locks.delete(key); }
}

module.exports = { pushOrderToSupplier, ensurePushed, withUserLock };
