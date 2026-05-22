// 自动同步调度器
// 每 6 小时跑一次：
//   1. 所有已配置 token 的国家做商品库存 API 同步（serial，避免限速冲突）
//   2. 用每个国家凭据同步该国订单的发货状态/跟踪号
//
// 状态写到内存 lastRun，供 GET /admin/auto-sync-status 查询给店主看
//
// 单例锁 busy 防止 6 小时窗口内人手动触发同步后又自动跑撞车

const db = require('./db');

const INTERVAL_MS = 6 * 3600 * 1000;
const INITIAL_DELAY_MS = 60 * 1000;   // 启动 1 分钟后跑第一次

let busy = false;
let lastRun = null;     // { started_at, finished_at, ok, products: [...], orders: [...] }

function getStatus() {
  return {
    busy,
    interval_hours: INTERVAL_MS / 3600000,
    next_run_at: lastRun?.finished_at
      ? new Date(new Date(lastRun.finished_at).getTime() + INTERVAL_MS).toISOString()
      : null,
    last_run: lastRun,
  };
}

async function runOnce(reason = 'scheduled') {
  if (busy) {
    console.log(`[scheduler] skip (${reason}): previous run still in progress`);
    return null;
  }
  busy = true;
  const startedAt = new Date().toISOString();
  console.log(`[scheduler] ===== auto-sync started (${reason}) at ${startedAt} =====`);
  const result = { started_at: startedAt, reason, ok: true, products: [], orders: [] };

  // 延迟 require 避免循环依赖（adminProducts 在 server 启动末尾才 require 完）
  const adminProducts = require('./routes/adminProducts');
  const adminRoute = require('./routes/admin');
  const { runCountryApiSync, apiSyncJobs } = adminProducts;
  const { syncOrdersFromDropxl } = adminRoute;

  try {
    // 1) 商品库存 API 同步（按 country 串行，每国 ~10 分钟）
    const accounts = db.prepare(`
      SELECT country FROM dropxl_accounts
      WHERE enabled = 1 AND token IS NOT NULL AND length(token) > 0
      ORDER BY country
    `).all();
    console.log(`[scheduler] sync products for ${accounts.length} countries:`, accounts.map(a => a.country).join(','));
    for (const { country } of accounts) {
      // 该国如有手动同步任务在跑，则跳过（让手动任务完成）
      const existing = apiSyncJobs.get(country);
      if (existing?.status === 'running' || existing?.status === 'pending') {
        result.products.push({ country, skipped: true, reason: 'manual job in progress' });
        console.log(`[scheduler] skip ${country} products: manual sync in progress`);
        continue;
      }
      const job = {
        status: 'running', country, startedBy: 'scheduler',
        startedAt: new Date().toISOString(),
        fetched: 0, upserted: 0, progress: null,
      };
      apiSyncJobs.set(country, job);
      try {
        await runCountryApiSync(country, job);
        result.products.push({ country, ok: true, in_stock: job.in_stock, fetched: job.fetched });
      } catch (e) {
        result.products.push({ country, ok: false, error: String(e.message || e) });
        console.error(`[scheduler] ${country} products sync failed:`, e.message);
      }
    }

    // 2) 订单状态同步（按 country 串行）
    for (const { country } of accounts) {
      try {
        const r = await syncOrdersFromDropxl({ sinceDays: 90, country });
        result.orders.push({ country, ok: true, ...r });
      } catch (e) {
        result.orders.push({ country, ok: false, error: String(e.message || e) });
        console.error(`[scheduler] ${country} orders sync failed:`, e.message);
      }
    }
  } catch (e) {
    result.ok = false;
    result.fatal = String(e.message || e);
    console.error('[scheduler] fatal:', e);
  } finally {
    result.finished_at = new Date().toISOString();
    lastRun = result;
    busy = false;
    const dur = (new Date(result.finished_at) - new Date(result.started_at)) / 1000;
    console.log(`[scheduler] ===== auto-sync finished in ${dur.toFixed(0)}s, ok=${result.ok} =====`);
  }
  return result;
}

function start() {
  console.log(`[scheduler] auto-sync scheduler started; interval = ${INTERVAL_MS / 3600000}h`);
  setTimeout(() => { runOnce('initial-startup'); }, INITIAL_DELAY_MS);
  setInterval(() => { runOnce('scheduled'); }, INTERVAL_MS);
}

module.exports = { start, runOnce, getStatus };
