// 总表删行子进程：从已保存的总表 xlsx 里删掉指定 SKU 的行（流式读写，几十万行不进主进程），
// 写完替换原文件、更新总表行数并刷新分类计数。
//
// 由 routes/adminProducts.js 通过 child_process.fork 启动，IPC 通信：
//   收到 { type:'prune', country, filePath, skus }
//   回发 { type:'progress', rows } / { type:'done', rows, removed } / { type:'error', error }
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const ExcelJS = require('exceljs');
const { refreshCategoryStats } = require('../categoryStats');
const { normalizeHeader, cellText, matchSku } = require('./masterImport');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'erp.db');

async function run({ country, filePath, skus }) {
  const send = (m) => { if (process.send) process.send(m); };
  const drop = new Set(skus.map(s => String(s).trim()));
  const tmpPath = `${filePath}.prune-${Date.now()}.xlsx`;
  let db;
  try {
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
      sharedStrings: 'cache', styles: 'ignore', hyperlinks: 'ignore', worksheets: 'emit',
    });
    const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: tmpPath, useStyles: false, useSharedStrings: false });
    let skuCol = -1, kept = 0, removed = 0, scanned = 0;
    for await (const ws of reader) {
      const out = writer.addWorksheet(ws.name || 'Sheet1');
      for await (const row of ws) {
        // 表头行之前（含表头）原样保留；表头行之后按 SKU 列过滤
        if (skuCol < 0) {
          scanned++;
          row.eachCell({ includeEmpty: false }, (cell, c) => { if (skuCol < 0 && matchSku(normalizeHeader(cell.value))) skuCol = c; });
          out.addRow(row.values).commit();
          if (skuCol < 0 && scanned >= 25) throw new Error('未找到 SKU 列，总表文件未修改');
          continue;
        }
        const sku = cellText(row.getCell(skuCol).value).trim();
        if (sku && drop.has(sku)) { removed++; continue; }
        out.addRow(row.values).commit();
        if (sku) kept++;
        if (kept % 20000 === 0) send({ type: 'progress', rows: kept });
      }
      await out.commit();
      break; // 总表只读第一个工作表（与导入一致）
    }
    await writer.commit();
    fs.renameSync(tmpPath, filePath);

    db = new Database(DB_PATH);
    db.pragma('busy_timeout = 30000');
    db.prepare('UPDATE country_master_uploads SET rows_count = ? WHERE country = ?').run(kept, country);
    refreshCategoryStats(db, country);
    db.close();
    send({ type: 'done', rows: kept, removed });
    process.exit(0);
  } catch (e) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    send({ type: 'error', error: String(e.message || e) });
    process.exit(1);
  }
}

process.on('message', (msg) => { if (msg && msg.type === 'prune') run(msg); });
