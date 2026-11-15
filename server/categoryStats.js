// 各国商品分类计数快照：分类侧栏和列表总数直接读 product_category_stats，
// 不在被频繁调用的接口里对几十万行做 GROUP BY / COUNT。
// 由商品同步、总表导入子进程在写完数据后调用（传入各自的 db 连接，不在主进程里跑）。
// 上传了总表的国家只统计总表白名单里的 SKU、分类取总表的 Category，与产品展示列表的规则一致。
function refreshCategoryStats(db, country) {
  const hasMaster = db.prepare('SELECT 1 FROM country_master_uploads WHERE country = ? LIMIT 1').get(country);
  const rows = db.prepare(`
    SELECT COALESCE(${hasMaster ? 'm' : 'p'}.category, '') AS category, COUNT(*) AS total, SUM(p.stock > 0) AS in_stock
    FROM dropxl_products p
    ${hasMaster ? 'JOIN country_master_skus m ON m.country = p.country AND m.sku = p.code' : ''}
    WHERE p.country = ?
    GROUP BY 1
  `).all(country);
  const del = db.prepare('DELETE FROM product_category_stats WHERE country = ?');
  const ins = db.prepare('INSERT INTO product_category_stats (country, category, total, in_stock) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    del.run(country);
    for (const r of rows) ins.run(country, r.category, r.total, r.in_stock || 0);
  })();
}

module.exports = { refreshCategoryStats };
