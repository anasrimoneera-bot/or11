const express = require('express');
const { authRequired } = require('../middleware/auth');
const { getExchangeRate, PURCHASE_RATE_FACTOR } = require('../settings');
const db = require('../db');

const router = express.Router();

const COUNTRY_CURRENCY = { 美国: 'USD', 英国: 'GBP', 德国: 'EUR', 法国: 'EUR', 荷兰: 'EUR', 意大利: 'EUR', 西班牙: 'EUR', 波兰: 'PLN' };

router.get('/', authRequired, (req, res) => {
  // 采购汇率 = 各国亚马逊汇率 × 1.012，按国家给前端
  const amazonRates = Object.fromEntries(
    db.prepare('SELECT country, rate FROM country_amazon_rate').all().map(r => [r.country, Number(r.rate) || 0])
  );
  const purchaseRateByCountry = {};
  for (const c of Object.keys(COUNTRY_CURRENCY)) {
    const ar = amazonRates[c] || 0;
    purchaseRateByCountry[c] = ar > 0 ? Number((ar * PURCHASE_RATE_FACTOR).toFixed(6)) : 0;
  }
  res.json({
    exchange_rate_cny_per_usd: getExchangeRate(), // 兼容老前端
    purchase_rate_by_country: purchaseRateByCountry,
    purchase_rate_factor: PURCHASE_RATE_FACTOR,
  });
});

module.exports = router;
