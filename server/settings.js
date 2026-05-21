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

module.exports = { getSetting, getNumberSetting, setSetting, getExchangeRate };
