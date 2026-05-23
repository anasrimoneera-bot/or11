const db = require('./db');

const DEFAULTS = {
  exchange_rate_cny_per_usd: 6.86,
};

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return DEFAULTS[key];
  return row.value;
}

function getNumberSetting(key) {
  const v = Number(getSetting(key));
  return isFinite(v) ? v : DEFAULTS[key];
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function getExchangeRate() {
  return getNumberSetting('exchange_rate_cny_per_usd');
}

// 采购汇率系数：采购汇率 = 该国亚马逊汇率 × PURCHASE_MARKUP (店主汇差 1.2%)
const PURCHASE_RATE_FACTOR = 1.012;

// 按国家算采购汇率 = country_amazon_rate.rate × 1.012
// 该国亚马逊汇率未设置 (0) 时返回 0，调用方需处理
function purchaseRateForCountry(country) {
  const row = db.prepare('SELECT rate FROM country_amazon_rate WHERE country = ?').get(country);
  const amazonRate = Number(row?.rate) || 0;
  return amazonRate > 0 ? amazonRate * PURCHASE_RATE_FACTOR : 0;
}

module.exports = { getSetting, getNumberSetting, setSetting, getExchangeRate, purchaseRateForCountry, PURCHASE_RATE_FACTOR };
