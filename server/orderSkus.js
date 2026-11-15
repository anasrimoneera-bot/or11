// 给订单列表里「待采购」的订单附上 SKU 列表（skus），前端据此一键跳转到产品展示的商品详情页。
// 只查当前页的待采购订单，按 order_id 索引一次性取回，不做相关子查询。
const db = require('./db');

function attachPendingSkus(rows) {
  const ids = rows.filter(r => r.status === 'pending_purchase').map(r => r.id);
  if (!ids.length) return rows;
  const items = db.prepare(`SELECT order_id, sku FROM purchase_order_items WHERE order_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const map = new Map();
  for (const it of items) {
    const sku = String(it.sku || '').trim();
    if (!sku) continue;
    const list = map.get(it.order_id) || [];
    if (!list.includes(sku)) list.push(sku);
    map.set(it.order_id, list);
  }
  for (const r of rows) if (map.has(r.id)) r.skus = map.get(r.id);
  return rows;
}

module.exports = { attachPendingSkus };
