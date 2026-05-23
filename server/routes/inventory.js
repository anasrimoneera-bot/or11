const express = require('express');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
const MASTER_DIR = path.join(__dirname, '..', '..', 'data', 'master');

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

// 分销商下载该国家库存 - 现场从 DB 生成 xlsx，价格已加价
router.get('/:country', authRequired, (req, res) => {
  const country = resolveCountry(req.params.country);
  if (!country) return res.status(400).json({ error: '不支持的国家' });

  const has = db.prepare('SELECT COUNT(*) AS c FROM dropxl_products WHERE country = ?').get(country).c;
  if (has === 0) return res.status(404).json({ error: '该国家库存暂未上传' });

  const markupRow = db.prepare('SELECT markup_pct FROM country_markup WHERE country = ?').get(country);
  const factor = 1 + (Number(markupRow?.markup_pct) || 0) / 100;

  const rows = db.prepare(`
    SELECT p.code, p.b2b_price, p.stock
    FROM dropxl_products p
    WHERE p.country = ?
      AND (
        NOT EXISTS (SELECT 1 FROM country_master_uploads WHERE country = p.country)
        OR p.code IN (SELECT sku FROM country_master_skus WHERE country = p.country)
      )
    ORDER BY CAST(p.code AS INTEGER) ASC, p.code ASC
  `).all(country);

  // 输出和 DropXL 原始模板一致的 3 列；价格替换为加价后的
  // 分销商/员工看到的 B2B_price 就是他们的成本（不暴露原价 + 加价比例）
  const data = rows.map(r => ({
    SKU: r.code,
    B2B_price: Number((r.b2b_price * factor).toFixed(4)),
    Stock: r.stock,
  }));

  const ws = XLSX.utils.json_to_sheet(data, { header: ['SKU', 'B2B_price', 'Stock'] });
  ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const code = COUNTRY_TO_CODE[country];
  const ts = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const cnName = `${country} ${ts}.xlsx`;            // 中文文件名 给浏览器显示
  const asciiName = `${code}_${ts}.xlsx`;             // ASCII 降级名 防老浏览器乱码
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(cnName)}; filename="${asciiName}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

module.exports = router;
