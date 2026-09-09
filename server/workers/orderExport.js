// 订单列表导出子进程：从 DB 流式读订单 + exceljs 流式写 xlsx。
// 独立进程运行，与主服务隔离——purchase_orders 可达数十万行，"导出全部订单"要做
// 一次全表排序再生成几十 MB 的 xlsx，放主线程会把整个事件循环(同进程还托管前端和
// 全部 API)卡死很久，整站表现为"点了没反应"。
//
// 由 routes/admin.js 通过 child_process.fork 启动，靠 IPC 通信：
//   收到 { type:'start', filters, isAdmin, filePath }
//   回发 { type:'done', rows } / { type:'error', error }
const path = require('path');
const Database = require('better-sqlite3');
const ExcelJS = require('exceljs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'erp.db');

const STATUS_LABEL = {
  pending_purchase: '待采购', pending_shipment: '待发货', shipped: '已发货',
  completed: '已完成', cancelled: '已取消', refunded: '已退款', replaced: '已换货',
};

// 与订单管理列表 (GET /admin/orders) 同一套筛选条件；filters 为空即导出全部订单
function buildWhere(filters = {}) {
  const conds = [];
  const args = [];
  if (filters.status) { conds.push('o.status = ?'); args.push(filters.status); }
  if (filters.user_id) { conds.push('o.user_id = ?'); args.push(filters.user_id); }
  if (filters.country) { conds.push('o.country = ?'); args.push(filters.country); }
  if (filters.q) {
    conds.push('(o.order_no LIKE ? OR u.username LIKE ? OR u.display_name LIKE ? OR o.shop_name LIKE ?)');
    const like = `%${filters.q}%`;
    args.push(like, like, like, like);
  }
  if (filters.start) { conds.push('o.created_at >= ?'); args.push(filters.start); }
  if (filters.end) { conds.push('o.created_at <= ?'); args.push(filters.end); }
  return { where: conds.length ? 'WHERE ' + conds.join(' AND ') : '', args };
}

function columns(isAdmin) {
  const cols = [
    { header: '订单号', key: 'order_no', width: 22 },
    { header: '用户', key: 'user', width: 16 },
    { header: '国家', key: 'country', width: 8 },
    { header: '店铺', key: 'shop_name', width: 18 },
    { header: '亚马逊金额', key: 'sales', width: 12 },
    { header: '采购(USD)', key: 'purchase_usd', width: 12 },
    { header: '采购(¥)', key: 'purchase_cny', width: 12 },
    { header: '利润(本币)', key: 'profit', width: 12 },
    { header: '利润(¥)', key: 'profit_cny', width: 12 },
    { header: '成本利润率(%)', key: 'margin_pct', width: 14 },
  ];
  if (isAdmin) {
    cols.push(
      { header: '真实(USD)', key: 'real_usd', width: 12 },
      { header: '加价%', key: 'markup_pct', width: 8 },
      { header: 'PayPal汇率', key: 'paypal_rate', width: 12 },
      { header: '真实采购价(¥)', key: 'real_cny', width: 14 },
      { header: '差价利润(¥)', key: 'spread_cny', width: 12 },
    );
  }
  cols.push(
    { header: '供应商ID', key: 'dropxl_order_id', width: 16 },
    { header: '跟踪号', key: 'tracking_no', width: 22 },
    { header: '状态', key: 'status', width: 10 },
    { header: '创建时间', key: 'created_at', width: 20 },
  );
  return cols;
}

function toRow(o, isAdmin) {
  const sales = Number(o.amazon_amount) || 0;
  const purchase = Number(o.purchase_amount_usd) || 0;
  const purchaseCny = Number(o.purchase_amount_cny) || 0;
  const amazonRate = Number(o.amazon_rate_locked) || 0;
  const canCny = sales > 0 && amazonRate > 0;
  const marginPct = (canCny && purchaseCny > 0) ? ((sales * amazonRate - purchaseCny) / purchaseCny * 100) : '';
  const row = {
    order_no: o.order_no,
    user: o.display_name || o.username,
    country: o.country || '',
    shop_name: o.shop_name || '',
    sales,
    purchase_usd: purchase,
    purchase_cny: purchaseCny,
    profit: sales > 0 ? sales - purchase : '',
    profit_cny: canCny ? sales * amazonRate - purchaseCny : '',
    margin_pct: marginPct === '' ? '' : Number(marginPct.toFixed(2)),
    dropxl_order_id: o.dropxl_order_id || '',
    tracking_no: o.tracking_no || '',
    status: STATUS_LABEL[o.status] || o.status,
    created_at: o.created_at || '',
  };
  if (isAdmin) {
    const realUsd = Number(o.real_amount_usd) || 0;
    const paypalRate = Number(o.paypal_rate) || 0;
    const realCny = paypalRate > 0 ? realUsd / paypalRate : '';
    row.real_usd = realUsd;
    row.markup_pct = Number(o.markup_pct) || 0;
    row.paypal_rate = paypalRate || '';
    row.real_cny = realCny === '' ? '' : Number(realCny.toFixed(2));
    row.spread_cny = realCny === '' ? '' : Number((purchaseCny - realCny).toFixed(2));
  }
  return row;
}

async function run(msg) {
  const { filters, isAdmin, filePath } = msg;
  const send = (m) => { if (process.send) process.send(m); };
  let db;
  try {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma('busy_timeout = 30000');

    const { where, args } = buildWhere(filters);
    // 列白名单：绝不 SELECT *，raw_payload/raw_response 是整份报文，几十万行会吃光内存
    const stmt = db.prepare(`
      SELECT o.order_no, o.shop_name, o.country, o.amazon_amount, o.amazon_rate_locked,
             o.purchase_amount_usd, o.purchase_amount_cny, o.real_amount_usd, o.markup_pct,
             o.paypal_rate, o.dropxl_order_id, o.tracking_no, o.status, o.created_at,
             u.username, u.display_name
      FROM purchase_orders o JOIN users u ON u.id = o.user_id
      ${where}
      ORDER BY o.created_at DESC
    `);

    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: false, useSharedStrings: false });
    const ws = wb.addWorksheet('订单');
    ws.columns = columns(isAdmin);
    let n = 0;
    for (const o of stmt.iterate(...args)) {
      ws.addRow(toRow(o, isAdmin)).commit();
      n++;
    }
    await ws.commit();
    await wb.commit();

    db.close();
    send({ type: 'done', rows: n });
    process.exit(0);
  } catch (e) {
    try { if (db) db.close(); } catch {}
    send({ type: 'error', error: String(e.message || e) });
    process.exit(1);
  }
}

process.on('message', (msg) => { if (msg && msg.type === 'start') run(msg); });
