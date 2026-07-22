const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// 售后处理模板：所有登录用户（分销商 + 管理员）可查看并一键复制。
// 编辑仅 BOSS 或被授权 aftersales_template 权限的管理员（见 /api/admin/aftersales-templates*）。
router.get('/', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT id, category, title, body, sort_order, updated_at
    FROM aftersales_templates
    ORDER BY category ASC, sort_order ASC, id ASC
  `).all();
  res.json(rows);
});

module.exports = router;
