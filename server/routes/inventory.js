const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const INVENTORY_DIR = path.join(__dirname, '..', '..', 'data', 'inventory');

const COUNTRY_TO_CODE = { 美国: 'US', 英国: 'GB', 德国: 'DE', 法国: 'FR', 荷兰: 'NL', 意大利: 'IT', 西班牙: 'ES', 波兰: 'PL' };
const COUNTRY_CODE_TO_NAME = Object.fromEntries(Object.entries(COUNTRY_TO_CODE).map(([k, v]) => [v, k]));

function resolveCountry(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (COUNTRY_CODE_TO_NAME[s]) return COUNTRY_CODE_TO_NAME[s];
  if (COUNTRY_CODE_TO_NAME[s.toUpperCase()]) return COUNTRY_CODE_TO_NAME[s.toUpperCase()];
  return COUNTRY_TO_CODE[s] ? s : null;
}

// 状态摘要 - 给分销商前端显示按钮是否可用、最近更新时间
router.get('/status', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT country, MAX(uploaded_at) AS uploaded_at,
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

router.get('/:country', authRequired, (req, res) => {
  const country = resolveCountry(req.params.country);
  if (!country) return res.status(400).json({ error: '不支持的国家' });
  const code = COUNTRY_TO_CODE[country];
  const file = path.join(INVENTORY_DIR, `${code}.xlsx`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: '该国家库存暂未上传' });
  const latest = db.prepare(`
    SELECT original_filename, uploaded_at FROM inventory_uploads
    WHERE country = ? ORDER BY uploaded_at DESC LIMIT 1
  `).get(country);
  const dl = latest?.original_filename || `${code}-inventory.xlsx`;
  res.download(file, dl);
});

module.exports = router;
