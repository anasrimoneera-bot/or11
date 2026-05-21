const express = require('express');
const XLSX = require('xlsx');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const COUNTRY_TO_CODE = { 美国: 'US', 英国: 'GB', 德国: 'DE', 法国: 'FR', 荷兰: 'NL', 意大利: 'IT', 西班牙: 'ES', 波兰: 'PL' };
const COUNTRY_CODE_TO_NAME = Object.fromEntries(Object.entries(COUNTRY_TO_CODE).map(([k, v]) => [v, k]));

function resolveCountry(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (COUNTRY_CODE_TO_NAME[s]) return COUNTRY_CODE_TO_NAME[s];
  if (COUNTRY_CODE_TO_NAME[s.toUpperCase()]) return COUNTRY_CODE_TO_NAME[s.toUpperCase()];
  return COUNTRY_TO_CODE[s] ? s : null;
}

router.get('/status', authRequired, (req, res) => {
  // 给分销商查询用：哪些国家有数据 + 行数 + 更新时间。不暴露 source / markup / 原文件名
  const rows = db.prepare(`
    SELECT country,
           MAX(uploaded_at) AS uploaded_at,
           (SELECT rows_count FROM inventory_uploads i2 WHERE i2.country = i1.country ORDER BY uploaded_at DESC LIMIT 1) AS rows_count,
           (SELECT in_stock_count FROM inventory_uploads i2 WHERE i2.country = i1.country ORDER BY uploaded_at DESC LIMIT 1) AS in_stock_count
    FROM inventory_uploads i1
    GROUP BY country
  `).all();
  const map = Object.fromEntries(rows.map(r => [r.country, r]));
  res.json(Object.keys(COUNTRY_TO_CODE).map(c => ({
    country: c,
    code: COUNTRY_TO_CODE[c],
    available: !!map[c],
    uploaded_at: map[c]?.uploaded_at || null,
    rows_count: map[c]?.rows_count || 0,
    in_stock_count: map[c]?.in_stock_count || 0,
  })));
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
    SELECT code, b2b_price, stock
    FROM dropxl_products
    WHERE country = ?
    ORDER BY CAST(code AS INTEGER) ASC, code ASC
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
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const fileName = `${code}_inventory_${ts}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

module.exports = router;
