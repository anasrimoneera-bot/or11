// 聚合数据实时汇率自动拉取
// 文档：https://op.juhe.cn/onebox/exchange/currency?key=KEY&from=USD&to=CNY&version=2
// 返回 result[] 含正反两个方向，取 currencyF=from & currencyT=to 那条的 exchange = 1 from = ? CNY
//
// 把 4 个币种 (USD/GBP/EUR/PLN) 的「外币→人民币」汇率写入 country_amazon_rate，
// 同币种的多个国家一起更新 (EUR -> 德/法/荷/意/西)。
// 采购汇率由 settings.purchaseRateForCountry 在此基础上 ×1.012 自动推导，无需单独拉取。

const axios = require('axios');
const db = require('./db');
const { getSetting, setSetting } = require('./settings');

const API_URL = 'https://op.juhe.cn/onebox/exchange/currency';
const TARGET = 'CNY';

// 内存里记最近一次结果，给状态接口看
let lastRun = null;

function getApiKey() {
  return (getSetting('juhe_fx_api_key') || process.env.JUHE_FX_API_KEY || '').trim();
}

// 拉单个币种 from -> CNY，返回数字汇率；失败抛错
async function fetchRate(from, key) {
  const { data } = await axios.get(API_URL, {
    params: { key, from, to: TARGET, version: 2 },
    timeout: 15000,
  });
  if (!data || data.error_code !== 0) {
    throw new Error(`${from}->${TARGET}: ${data?.reason || '未知错误'} (error_code=${data?.error_code})`);
  }
  const list = Array.isArray(data.result) ? data.result : [];
  const hit = list.find(r => r.currencyF === from && r.currencyT === TARGET) || list[0];
  const rate = Number(hit?.exchange);
  if (!isFinite(rate) || rate <= 0) throw new Error(`${from}->${TARGET}: 返回汇率无效 (${hit?.exchange})`);
  return Number(rate.toFixed(4));
}

// 刷新所有亚马逊国家汇率。返回 { ok, updated:[{currency, rate, countries}], errors:[] }
async function refreshAmazonRates(reason = 'manual') {
  const startedAt = new Date().toISOString();
  const key = getApiKey();
  if (!key) {
    const result = { ok: false, started_at: startedAt, finished_at: new Date().toISOString(), reason, error: '未配置汇率 API Key', updated: [], errors: [] };
    lastRun = result;
    return result;
  }

  // 表里有哪些币种就拉哪些（去重）
  const currencies = db.prepare('SELECT DISTINCT currency FROM country_amazon_rate WHERE currency IS NOT NULL').all()
    .map(r => r.currency);

  const updated = [];
  const errors = [];
  const updateStmt = db.prepare('UPDATE country_amazon_rate SET rate = ?, updated_at = CURRENT_TIMESTAMP WHERE currency = ?');

  for (const cur of currencies) {
    try {
      let rate;
      if (cur === TARGET) {
        rate = 1; // 理论上不会有 CNY 国家，保险处理
      } else {
        rate = await fetchRate(cur, key);
      }
      const info = updateStmt.run(rate, cur);
      const countries = db.prepare('SELECT country FROM country_amazon_rate WHERE currency = ?').all(cur).map(r => r.country);
      updated.push({ currency: cur, rate, countries });
      console.log(`[fx] ${cur}->CNY = ${rate}，更新 ${info.changes} 个国家 (${countries.join('/')})`);
    } catch (e) {
      errors.push({ currency: cur, error: String(e.message || e) });
      console.error(`[fx] ${cur} 拉取失败:`, e.message);
    }
  }

  const ok = errors.length === 0 && updated.length > 0;
  const finishedAt = new Date().toISOString();
  if (updated.length > 0) setSetting('fx_last_updated_at', finishedAt);
  const result = { ok, started_at: startedAt, finished_at: finishedAt, reason, updated, errors };
  lastRun = result;
  return result;
}

function getStatus() {
  return {
    configured: !!getApiKey(),
    last_updated_at: getSetting('fx_last_updated_at') || null,
    last_run: lastRun,
  };
}

module.exports = { refreshAmazonRates, getStatus, getApiKey };
