// 各国增值税（仅 BOSS 可见可设）。B2B 原价含税 = 原价 × vatFactor(国家)，
// 订单真实成本 real_amount_usd 也按含税价记录；分销商/管理员侧永不返回税率本身。
const db = require('./db');

const Q_VAT = db.prepare('SELECT vat_pct FROM country_vat WHERE country = ?');

function vatFactor(country) {
  return 1 + (Number(Q_VAT.get(country)?.vat_pct) || 0) / 100;
}

module.exports = { vatFactor };
