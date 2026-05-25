const express = require('express');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
const MASTER_DIR = path.join(__dirname, '..', '..', 'data', 'master');
const EXPORT_TMP_DIR = path.join(__dirname, '..', '..', 'data', 'exports-tmp');
if (!fs.existsSync(EXPORT_TMP_DIR)) fs.mkdirSync(EXPORT_TMP_DIR, { recursive: true });

const COUNTRY_TO_CODE = { 美国: 'US', 英国: 'GB', 德国: 'DE', 法国: 'FR', 荷兰: 'NL', 意大利: 'IT', 西班牙: 'ES', 波兰: 'PL' };
const COUNTRY_CODE_TO_NAME = Object.fromEntries(Object.entries(COUNTRY_TO_CODE).map(([k, v]) => [v, k]));

function resolveCountry(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (COUNTRY_CODE_TO_NAME[s]) return COUNTRY_CODE_TO_NAME[s];
  if (COUNTRY_CODE_TO_NAME[s.toUpperCase()]) return COUNTRY_CODE_TO_NAME[s.toUpperCase()];
  return COUNTRY_TO_CODE[s] ? s : null;
}

// 总表状态（分销商可见）
router.get('/master-status', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT country, rows_count, uploaded_at FROM country_master_uploads
  `).all();
  const map = Object.fromEntries(rows.map(r => [r.country, r]));
  res.json(Object.keys(COUNTRY_TO_CODE).map(c => ({
    country: c,
    code: COUNTRY_TO_CODE[c],
    available: !!map[c],
    rows_count: map[c]?.rows_count || 0,
    uploaded_at: map[c]?.uploaded_at || null,
  })));
});

// 分销商下载总表源文件 (统一文件名: 国家 销售总表.xlsx, UTF-8 + RFC5987 编码避免中文乱码)
router.get('/master/:country', authRequired, (req, res) => {
  const country = resolveCountry(req.params.country);
  if (!country) return res.status(400).json({ error: '不支持的国家' });
  const meta = db.prepare('SELECT * FROM country_master_uploads WHERE country = ?').get(country);
  if (!meta) return res.status(404).json({ error: '该国家总表暂未上传' });
  const file = path.join(MASTER_DIR, meta.stored_filename);
  if (!fs.existsSync(file)) return res.status(410).json({ error: '源文件不存在' });
  const fileName = `${country} 销售总表.xlsx`;
  // filename*= 放前面，前端正则取到 UTF-8 版本而不是 ASCII fallback
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}; filename="${country}-master.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  fs.createReadStream(file).pipe(res);
});

router.get('/status', authRequired, (req, res) => {
  // 给分销商查询用：行数 = 该国库存 ∩ 该国总表 SKU（没上传总表则回退显示全量库存）
  const masterCountries = db.prepare('SELECT country FROM country_master_uploads').all().map(r => r.country);
  const masterSet = new Set(masterCountries);
  const uploadedAt = db.prepare('SELECT country, MAX(uploaded_at) AS uploaded_at FROM inventory_uploads GROUP BY country').all();
  const uploadedMap = Object.fromEntries(uploadedAt.map(r => [r.country, r.uploaded_at]));
  const countAll = db.prepare('SELECT COUNT(*) AS c FROM dropxl_products WHERE country = ?');
  const countStockAll = db.prepare('SELECT COUNT(*) AS c FROM dropxl_products WHERE country = ? AND stock > 0');
  const countFiltered = db.prepare('SELECT COUNT(*) AS c FROM dropxl_products p WHERE p.country = ? AND p.code IN (SELECT sku FROM country_master_skus WHERE country = ?)');
  const countStockFiltered = db.prepare('SELECT COUNT(*) AS c FROM dropxl_products p WHERE p.country = ? AND p.stock > 0 AND p.code IN (SELECT sku FROM country_master_skus WHERE country = ?)');
  res.json(Object.keys(COUNTRY_TO_CODE).map(c => {
    const at = uploadedMap[c] || null;
    if (!at) return { country: c, code: COUNTRY_TO_CODE[c], available: false, uploaded_at: null, rows_count: 0, in_stock_count: 0 };
    const filtered = masterSet.has(c);
    const rowsCount = filtered ? countFiltered.get(c, c).c : countAll.get(c).c;
    const inStock = filtered ? countStockFiltered.get(c, c).c : countStockAll.get(c).c;
    return { country: c, code: COUNTRY_TO_CODE[c], available: true, uploaded_at: at, rows_count: rowsCount, in_stock_count: inStock };
  }));
});

// 分销商下载该国家库存 - 现场从 DB 生成 xlsx，价格已加价。
// 生成放到独立子进程：德国等 24 万行的国家生成 xlsx 要 2-4 秒 CPU，放主线程会把
// 事件循环卡死、下载像"卡住没反应"。子进程把文件写到临时目录后，这里再流式回传并清理。
router.get('/:country', authRequired, (req, res) => {
  const country = resolveCountry(req.params.country);
  if (!country) return res.status(400).json({ error: '不支持的国家' });

  const has = db.prepare('SELECT COUNT(*) AS c FROM dropxl_products WHERE country = ?').get(country).c;
  if (has === 0) return res.status(404).json({ error: '该国家库存暂未上传' });

  const code = COUNTRY_TO_CODE[country];
  const ts = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const tmpFile = path.join(EXPORT_TMP_DIR, `${code}-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  const cleanup = () => { try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {} };

  let worker;
  try {
    worker = fork(path.join(__dirname, '..', 'workers', 'inventoryExport.js'));
  } catch (e) {
    return res.status(500).json({ error: '无法启动导出进程：' + e.message });
  }

  let settled = false;
  // 客户端中途取消下载时，杀掉子进程并清理临时文件
  res.on('close', () => { if (!settled) { settled = true; try { worker.kill(); } catch {} cleanup(); } });

  worker.on('message', (m) => {
    if (!m || settled) return;
    if (m.type === 'done') {
      settled = true;
      const cnName = `${country} ${ts}.xlsx`;   // 中文文件名 给浏览器显示
      const asciiName = `${code}_${ts}.xlsx`;    // ASCII 降级名 防老浏览器乱码
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(cnName)}; filename="${asciiName}"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const stream = fs.createReadStream(tmpFile);
      stream.on('error', () => { cleanup(); if (!res.headersSent) res.status(500).json({ error: '导出文件读取失败' }); else res.end(); });
      stream.on('close', cleanup);
      stream.pipe(res);
    } else if (m.type === 'error') {
      settled = true;
      cleanup();
      if (!res.headersSent) res.status(500).json({ error: '生成失败：' + m.error });
    }
  });
  worker.on('exit', (codeNum) => {
    if (!settled) {
      settled = true;
      cleanup();
      if (!res.headersSent) res.status(500).json({ error: `导出进程异常退出（code ${codeNum}）` });
    }
  });
  worker.on('error', (e) => {
    if (!settled) {
      settled = true;
      cleanup();
      if (!res.headersSent) res.status(500).json({ error: '导出进程错误：' + e.message });
    }
  });

  worker.send({ type: 'start', country, filePath: tmpFile });
});

module.exports = router;
