const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT id, slug, published_title AS title, published_body AS body, published_at
    FROM aftersales_policies
    WHERE published_body IS NOT NULL AND published_body != ''
    ORDER BY sort_order ASC, id ASC
  `).all();
  res.json(rows);
});

module.exports = router;
