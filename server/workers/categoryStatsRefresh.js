// 分类计数快照刷新子进程：对每个国家重算 product_category_stats（几十万行 GROUP BY，不放主进程）。
// 由 index.js 在分类计数格式升级后（settings.category_stats_version 变化）启动时 fork 一次。
//   收到 { type:'start', version } → 逐国刷新 → 写入新版本号 → 退出
const db = require('../db');
const { refreshCategoryStats } = require('../categoryStats');

process.on('message', (msg) => {
  if (!msg || msg.type !== 'start') return;
  try {
    const countries = db.prepare('SELECT DISTINCT country FROM dropxl_products').all().map(r => r.country);
    for (const c of countries) refreshCategoryStats(db, c);
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('category_stats_version', String(msg.version));
    console.log(`[category-stats] 已刷新 ${countries.length} 个国家的分类计数`);
    process.exit(0);
  } catch (e) {
    console.error('[category-stats] 刷新失败', e);
    process.exit(1);
  }
});
