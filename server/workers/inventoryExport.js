// 库存价格更新导出子进程：从 DB 流式读取该国库存(已按国家加价) + exceljs 流式写 xlsx。
// 独立进程运行，与主服务隔离——德国等 24 万行的国家生成 xlsx 要 2-4 秒 CPU，
// 放主线程会把整个事件循环(同进程还托管前端和全部 API)卡死好几秒，下载像"卡住没反应"。
//
// 由 routes/inventory.js 通过 child_process.fork 启动，靠 IPC 通信：
//   收到 { type:'start', country, filePath }
//   回发 { type:'done', rows } / { type:'error', error }
const path = require('path');
const Database = require('better-sqlite3');
const ExcelJS = require('exceljs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'erp.db');

async function run(msg) {
  const { country, filePath } = msg;
  const send = (m) => { if (process.send) process.send(m); };
  let db;
  try {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma('busy_timeout = 30000');

    const markupRow = db.prepare('SELECT markup_pct FROM country_markup WHERE country = ?').get(country);
    const factor = 1 + (Number(markupRow?.markup_pct) || 0) / 100;

    // 是否上传了总表：决定是否按总表 SKU 白名单过滤。
    // 注意：必须用 JOIN / 字面量国家做点查，不能写成
    // p.code IN (SELECT sku FROM country_master_skus WHERE country = p.country)
    // —— 那是按行重算的相关子查询，德国 24 万行会变成 O(N²) 直接把请求挂死。
    const hasMaster = db.prepare('SELECT 1 FROM country_master_uploads WHERE country = ? LIMIT 1').get(country);
    const sql = hasMaster
      ? `SELECT p.code, p.b2b_price, p.stock
           FROM dropxl_products p
           JOIN country_master_skus m ON m.country = p.country AND m.sku = p.code
           WHERE p.country = ?
           ORDER BY CAST(p.code AS INTEGER) ASC, p.code ASC`
      : `SELECT p.code, p.b2b_price, p.stock
           FROM dropxl_products p
           WHERE p.country = ?
           ORDER BY CAST(p.code AS INTEGER) ASC, p.code ASC`;
    const stmt = db.prepare(sql);

    // 输出和 DropXL 原始模板一致的 3 列；价格替换为加价后的（不暴露原价 + 加价比例）
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: false, useSharedStrings: false });
    const ws = wb.addWorksheet('Inventory');
    ws.columns = [
      { header: 'SKU', key: 'SKU', width: 12 },
      { header: 'B2B_price', key: 'B2B_price', width: 14 },
      { header: 'Stock', key: 'Stock', width: 8 },
    ];
    let n = 0;
    for (const r of stmt.iterate(country)) {
      ws.addRow({ SKU: r.code, B2B_price: Number((r.b2b_price * factor).toFixed(4)), Stock: r.stock }).commit();
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
