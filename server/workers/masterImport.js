// 总表导入子进程：用 exceljs 流式解析 xlsx + 写入 country_master_skus。
// 独立进程运行，与主服务隔离——解析再大/再重(甚至 OOM 崩溃)也只影响本进程，
// 主服务事件循环不被阻塞，网站照常响应。
//
// 由 routes/adminProducts.js 通过 child_process.fork 启动，靠 IPC 通信：
//   收到 { type:'start', country, filePath, storedFilename, originalFilename, username }
//   回发 { type:'progress', rows } / { type:'done', rows } / { type:'error', error }
const path = require('path');
const Database = require('better-sqlite3');
const ExcelJS = require('exceljs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'erp.db');

function normalizeHeader(v) {
  return String(v == null ? '' : v)
    .replace(/[﻿​‌‍ ]/g, ' ')
    .trim()
    .toLowerCase();
}
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text || '').join('');
    if (v.text != null) return String(v.text);
    if (v.hyperlink != null) return String(v.hyperlink);
    if (v.result != null) return String(v.result);
    return '';
  }
  return String(v);
}
const SKU_RE = /(^|[^a-z])sku([^a-z]|$)/;
const IMG_RE = /(^|[^a-z])image([^a-z]|$)/;
const matchSku = (n) => n === 'sku' || SKU_RE.test(n);
const matchImg = (n) => n === 'image 1' || n === 'image' || n === 'image_url' || n === 'image1' || IMG_RE.test(n);

async function* iterMasterRows(filePath) {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    sharedStrings: 'cache', styles: 'ignore', hyperlinks: 'ignore', worksheets: 'emit',
  });
  let sheetDone = false;
  for await (const ws of wb) {
    if (sheetDone) break;
    sheetDone = true;
    let skuCol = -1, imgCol = -1, headerFound = false, scanned = 0, diag = [];
    for await (const row of ws) {
      if (!headerFound) {
        scanned++;
        const cells = [];
        row.eachCell({ includeEmpty: false }, (cell, c) => {
          const raw = cellText(cell.value).trim();
          if (raw) cells.push({ c, raw, norm: normalizeHeader(cell.value) });
        });
        for (const x of cells) {
          if (skuCol < 0 && matchSku(x.norm)) skuCol = x.c;
          if (imgCol < 0 && matchImg(x.norm)) imgCol = x.c;
        }
        if (cells.length && diag.length === 0) diag = cells.map(x => x.raw);
        if (skuCol >= 0) { headerFound = true; continue; }
        if (scanned >= 25) {
          const found = diag.length ? `检测到的表头：${diag.slice(0, 30).join(' | ')}` : '前 25 行均为空';
          throw new Error(`未找到 SKU 列（${found}）。请确认总表含名为 "SKU" 的列`);
        }
        continue;
      }
      const sku = cellText(row.getCell(skuCol).value).trim();
      if (!sku) continue;
      let img = null;
      if (imgCol >= 0) {
        const u = cellText(row.getCell(imgCol).value).trim();
        if (/^https?:\/\//i.test(u)) img = u;
      }
      yield { sku, image_url: img };
    }
    if (!headerFound) {
      const found = diag.length ? `检测到的表头：${diag.slice(0, 30).join(' | ')}` : '工作表为空';
      throw new Error(`未找到 SKU 列（${found}）。请确认总表含名为 "SKU" 的列`);
    }
  }
}

async function run(msg) {
  const { country, filePath, storedFilename, originalFilename, username } = msg;
  let db;
  try {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 30000'); // 等主进程的读锁，最多 30s
    const now = new Date().toISOString();

    db.prepare('DELETE FROM country_master_skus WHERE country = ?').run(country);
    const ins = db.prepare(
      'INSERT OR REPLACE INTO country_master_skus (country, sku, image_url, uploaded_at) VALUES (?, ?, ?, ?)'
    );
    const flush = db.transaction((arr) => { for (const r of arr) ins.run(country, r.sku, r.image_url, now); });

    const BATCH = 5000;
    let batch = [];
    let total = 0;
    for await (const row of iterMasterRows(filePath)) {
      batch.push(row);
      if (batch.length >= BATCH) {
        flush(batch);
        total += batch.length;
        batch = [];
        if (process.send) process.send({ type: 'progress', rows: total });
      }
    }
    if (batch.length) { flush(batch); total += batch.length; }

    if (total === 0) throw new Error('找到了 SKU 列但没有任何有效数据行（SKU 单元格均为空）');

    db.prepare(`
      INSERT OR REPLACE INTO country_master_uploads
        (country, original_filename, stored_filename, rows_count, uploaded_by, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(country, originalFilename, storedFilename, total, username, now);

    if (process.send) process.send({ type: 'done', rows: total });
    db.close();
    process.exit(0);
  } catch (e) {
    try { if (db) db.close(); } catch {}
    if (process.send) process.send({ type: 'error', error: String(e.message || e) });
    process.exit(1);
  }
}

process.on('message', (msg) => {
  if (msg && msg.type === 'start') run(msg);
});
