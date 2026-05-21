const express = require('express');
const { authRequired } = require('../middleware/auth');
const { getExchangeRate } = require('../settings');

const router = express.Router();

router.get('/', authRequired, (req, res) => {
  res.json({
    exchange_rate_cny_per_usd: getExchangeRate(),
  });
});

module.exports = router;
