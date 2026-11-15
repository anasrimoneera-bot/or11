// 各国商品分类计数快照：分类树和列表总数直接读 product_category_stats，
// 不在被频繁调用的接口里对几十万行做 GROUP BY / COUNT。
// 由商品同步、总表导入子进程在写完数据后调用（传入各自的 db 连接，不在主进程里跑）。
// category 列存的是分类路径前缀（「A」「A > B」「A > B > C」…），每一级都有计数，供分类树逐级显示；
// '' 表示未分类。上传了总表的国家只统计总表白名单里的 SKU、分类取总表，与产品展示列表一致。
function refreshCategoryStats(db, country) {
  const hasMaster = db.prepare('SELECT 1 FROM country_master_uploads WHERE country = ? LIMIT 1').get(country);
  const rows = db.prepare(`
    SELECT ${hasMaster ? 'm.category_path' : "REPLACE(p.category_path, '/', ' > ')"} AS path,
           COUNT(*) AS total, SUM(p.stock > 0) AS in_stock
    FROM dropxl_products p
    ${hasMaster ? 'JOIN country_master_skus m ON m.country = p.country AND m.sku = p.code' : ''}
    WHERE p.country = ?
    GROUP BY 1
  `).all(country);
  // 把每条完整路径的计数累加到它的每一级前缀上
  const agg = new Map();
  for (const r of rows) {
    const parts = String(r.path || '').split(' > ').map(s => s.trim()).filter(Boolean);
    const keys = parts.length ? parts.map((_, i) => parts.slice(0, i + 1).join(' > ')) : [''];
    for (const k of keys) {
      const a = agg.get(k) || { total: 0, in_stock: 0 };
      a.total += r.total;
      a.in_stock += r.in_stock || 0;
      agg.set(k, a);
    }
  }
  const del = db.prepare('DELETE FROM product_category_stats WHERE country = ?');
  const ins = db.prepare('INSERT INTO product_category_stats (country, category, total, in_stock) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    del.run(country);
    for (const [k, a] of agg) ins.run(country, k, a.total, a.in_stock);
  })();
}

module.exports = { refreshCategoryStats };
