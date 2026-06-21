const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/', authRequired, (req, res) => {
  const userId = req.user.id;
  const bal = db.prepare('SELECT balance FROM user_balance WHERE user_id = ?').get(userId);
  const u = db.prepare('SELECT sku_limit, member_level FROM users WHERE id = ?').get(userId);
  const orderTotal = db.prepare('SELECT COUNT(*) AS c FROM purchase_orders WHERE user_id = ?').get(userId).c;
  const pendingTickets = db.prepare("SELECT COUNT(*) AS c FROM aftersales_tickets WHERE user_id = ? AND status IN ('pending','processing')").get(userId).c;
  const newMessageTickets = db.prepare("SELECT COUNT(*) AS c FROM aftersales_tickets WHERE user_id = ? AND has_new_message = 1").get(userId).c;

  const statusDist = db.prepare(`
    SELECT status, COUNT(*) as count FROM purchase_orders WHERE user_id = ? GROUP BY status
  `).all(userId);

  // 订单金额趋势：用亚马逊到账金额 × 该订单锁定的亚马逊汇率 = 亚马逊收入 CNY
  // 没锁定汇率的订单 (amazon_rate_locked IS NULL) 跳过金额累计，但仍计入订单数
  const trend = db.prepare(`
    SELECT DATE(created_at) AS day,
           COUNT(*) AS count,
           SUM(IFNULL(amazon_amount, 0) * IFNULL(amazon_rate_locked, 0)) AS amount
    FROM purchase_orders
    WHERE user_id = ? AND created_at >= DATE('now', '-6 day')
    GROUP BY DATE(created_at)
    ORDER BY day ASC
  `).all(userId);

  const shopDist = db.prepare(`
    SELECT shop_name, COUNT(*) AS count FROM purchase_orders
    WHERE user_id = ? AND created_at >= DATE('now', '-30 day')
    GROUP BY shop_name
  `).all(userId);

  // 国家分布（按订单数）
  const countryDist = db.prepare(`
    SELECT country, COUNT(*) AS count FROM purchase_orders
    WHERE user_id = ? AND country IS NOT NULL AND country != ''
    GROUP BY country
    ORDER BY count DESC
  `).all(userId);

  res.json({
    balance: bal?.balance || 0,
    sku_limit: u?.sku_limit || 0,
    member_level: u?.member_level || '一级分销',
    orders_total: orderTotal,
    pending_tickets: pendingTickets,
    new_message_tickets: newMessageTickets,
    status_dist: statusDist,
    trend,
    shop_dist: shopDist,
    country_dist: countryDist,
  });
});

module.exports = router;
