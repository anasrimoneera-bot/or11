// 订单状态/跟踪号同步子进程：调 DropXL listOrders 分页拉取 + 更新 purchase_orders。
// 独立进程运行，与主服务隔离 —— DropXL 慢/超时再久也只占本子进程，主服务不被阻塞。
//
// 由 routes/admin.js 通过 child_process.fork 启动，IPC 通信：
//   收到 { type:'start', sinceDays, country }
//   回发 { type:'done', result:{total,updated,not_found,since} } / { type:'error', error }
const db = require('../db');
const dropxl = require('../dropxl');

function mapStatus(s) {
  if (!s) return 'pending_shipment';
  const v = String(s).toLowerCase();
  if (v.includes('ship') || v.includes('sent')) return 'shipped';
  if (v.includes('cancel')) return 'cancelled';
  if (v.includes('refund')) return 'refunded';
  if (v.includes('complete') || v.includes('delivered')) return 'completed';
  if (v.includes('temporary') || v.includes('draft')) return 'pending_purchase';
  return 'pending_shipment';
}

// DropXL 列表返回的订单 id 形如 "B2BDS15810358"(带前缀)，而本地 dropxl_order_id
// 可能存的是纯数字 "15810358"(下单接口返回的) 或带前缀(历史导入的)。所以按两种形式都匹配，
// 否则前缀对不上 → 永远命不中 → 跟踪号/状态同步不进来(踩过的坑)。
const byId = db.prepare(`
  UPDATE purchase_orders
  SET status = ?,
      tracking_no = CASE WHEN ? <> '' THEN ? ELSE tracking_no END,
      shipping_carrier = CASE WHEN ? <> '' THEN ? ELSE shipping_carrier END,
      updated_at = CURRENT_TIMESTAMP
  WHERE dropxl_order_id = ? OR dropxl_order_id = ?
`);
const byRef = db.prepare(`
  UPDATE purchase_orders
  SET status = ?,
      tracking_no = CASE WHEN ? <> '' THEN ? ELSE tracking_no END,
      shipping_carrier = CASE WHEN ? <> '' THEN ? ELSE shipping_carrier END,
      dropxl_order_id = ?, updated_at = CURRENT_TIMESTAMP
  WHERE order_no = ? AND COALESCE(dropxl_order_id, '') = ''
`);

async function run(msg) {
  const { sinceDays = 90, country = null } = msg;
  const send = (m) => { if (process.send) process.send(m); };
  try {
    const since = new Date(Date.now() - sinceDays * 86400 * 1000).toISOString().slice(0, 10);
    const PAGE = 500;
    const RATE_MS = 1100;
    let offset = 0, totalFetched = 0, updated = 0, notFound = 0;
    while (true) {
      const data = await dropxl.listOrders({ submitted_at_gteq: since, limit: PAGE, offset }, country);
      const wraps = Array.isArray(data) ? data : (data?.orders || data?.items || []);
      if (wraps.length === 0) break;
      let loggedSample = offset > 0; // 只在第一页第一条打印一次
      for (const wrap of wraps) {
        const o = wrap?.order || wrap;
        if (!loggedSample) {
          // 帮助诊断承运商字段名：打印第一条订单的所有 key
          console.log('[orderSync] sample order keys:', Object.keys(o).join(', '));
          loggedSample = true;
        }
        const rawId = String(o.id || o.order_id || '').trim();
        if (!rawId) continue;
        // 末尾数字段：去掉 "B2BDS" 前缀拿到纯数字核心(注意不能用 \D 全删，"B2BDS" 里的 2 会混进来)
        const numId = (rawId.match(/\d+$/) || [''])[0] || rawId;
        const ref = String(o.customer_order_reference || '').trim();
        const tracking = o.shipping_tracking || o.tracking_number || o.tracking || '';
        const carrier = o.shipping_carrier || o.carrier_name || o.carrier
          || o.courier || o.courier_name || o.shipping_company || o.logistics_company || '';
        const status = mapStatus(o.status_order_name || o.status);
        let r = byId.run(status, tracking, tracking, carrier, carrier, rawId, numId);
        if (r.changes === 0 && ref) r = byRef.run(status, tracking, tracking, carrier, carrier, rawId, ref);
        if (r.changes > 0) updated++; else notFound++;
      }
      totalFetched += wraps.length;
      if (wraps.length < PAGE) break;
      offset += PAGE;
      await new Promise(r => setTimeout(r, RATE_MS));
    }
    send({ type: 'done', result: { total: totalFetched, updated, not_found: notFound, since } });
    process.exit(0);
  } catch (e) {
    send({ type: 'error', error: String(e.message || e) });
    process.exit(1);
  }
}

process.on('message', (msg) => { if (msg && msg.type === 'start') run(msg); });
