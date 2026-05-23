const express = require('express');
const { authRequired } = require('../middleware/auth');
const { getExchangeRate } = require('../settings');
const db = require('../db');

const router = express.Router();

router.get('/', authRequired, (req, res) => {
  // 采购各币种汇率（外币 → CNY），给采购页右侧栏用，根据订单国家选币种
  const purchaseRates = db.prepare('SELECT currency, rate FROM currency_purchase_rate').all();
  const purchaseRateByCurrency = Object.fromEntries(purchaseRates.map(r => [r.currency, r.rate]));
  res.json({
    exchange_rate_cny_per_usd: getExchangeRate(),
    purchase_rates: purchaseRateByCurrency, // { USD: 6.86, EUR: 7.8, GBP: 9.1, PLN: 1.84 }
  });
});

module.exports = router;
