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
const { refreshCategoryStats } = require('../categoryStats');
const { brandText } = require('../brand');

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

// 总表里的描述 / 属性常带 HTML：转成纯文本（段落、换行保留，列表项加 •），页面按纯文本显示，不渲染 HTML
function htmlToText(s) {
  if (!s) return null;
  const t = String(s)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\s*\/\s*(p|div|li|ul|ol|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n\s*\n(?=• )/g, '\n')
    .trim();
  return t || null;
}

// 详情列（表头名不区分大小写）：Title / Properties / Description / Category / Image 1 ~ Image 9
const DETAIL_COLS = ['title', 'properties', 'description', 'category'];

async function* iterMasterRows(filePath) {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    sharedStrings: 'cache', styles: 'ignore', hyperlinks: 'ignore', worksheets: 'emit',
  });
  let sheetDone = false;
  for await (const ws of wb) {
    if (sheetDone) break;
    sheetDone = true;
    let skuCol = -1, imgCol = -1, headerFound = false, scanned = 0, diag = [];
    const detailCol = {};      // title/properties/description/category → 列号
    const imageCols = [];      // Image 1..9 → 列号（按序号）
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
          if (DETAIL_COLS.includes(x.norm) && !detailCol[x.norm]) detailCol[x.norm] = x.c;
          const m = x.norm.match(/^image\s*([1-9])$/);
          if (m && !imageCols[m[1] - 1]) imageCols[m[1] - 1] = x.c;
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
      const url = (c) => {
        const u = c ? cellText(row.getCell(c).value).trim() : '';
        return /^https?:\/\//i.test(u) ? u : null;
      };
      const images = imageCols.map(url).filter(Boolean);
      const img = images[0] || (imgCol >= 0 ? url(imgCol) : null);
      const text = (k) => (detailCol[k] ? cellText(row.getCell(detailCol[k]).value).trim() || null : null);
      // 分类路径分隔符可能是 / 或 >，统一成 " > "，第一级作为分类筛选
      const catParts = (brandText(text('category')) || '').split(/\s*[>\/|]\s*/).filter(Boolean);
      yield {
        sku,
        image_url: img,
        title: brandText(text('title')),
        properties: brandText(htmlToText(text('properties'))),
        description: brandText(htmlToText(text('description'))),
        category_path: catParts.length ? catParts.join(' > ') : null,
        category: catParts[0] || null,
        images: images.length ? JSON.stringify(images) : null,
      };
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
    const ins = db.prepare(`
      INSERT OR REPLACE INTO country_master_skus
        (country, sku, image_url, title, properties, description, category_path, category, images, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const flush = db.transaction((arr) => {
      for (const r of arr) ins.run(country, r.sku, r.image_url, r.title, r.properties, r.description, r.category_path, r.category, r.images, now);
    });

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
    // 总表白名单变了，分类计数随之刷新
    refreshCategoryStats(db, country);

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
