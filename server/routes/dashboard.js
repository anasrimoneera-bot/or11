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

  const statusDist = db.prepare(`
    SELECT status, COUNT(*) as count FROM purchase_orders WHERE user_id = ? GROUP BY status
  `).all(userId);

  const trend = db.prepare(`
    SELECT DATE(created_at) AS day, COUNT(*) AS count, SUM(purchase_amount_cny) AS amount
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

  res.json({
    balance: bal?.balance || 0,
    sku_limit: u?.sku_limit || 0,
    member_level: u?.member_level || '一级分销',
    orders_total: orderTotal,
    pending_tickets: pendingTickets,
    status_dist: statusDist,
    trend,
    shop_dist: shopDist,
  });
});

module.exports = router;
