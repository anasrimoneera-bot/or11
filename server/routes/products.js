const express = require('express');
const dropxl = require('../dropxl');
const { authRequired, adminRequired } = require('../middleware/auth');

const router = express.Router();

// DropXL 商品列表直通。响应里的 price 是供应商真实 B2B 成本（= dropxl_products.b2b_price，
// 订单 real_amount_usd 的来源），所以必须挡在 adminRequired 后面 —— 分销商前端并不调用此接口，
// 但只要带上自己的 token 直接请求就能拿到全量真实成本。
router.get('/', authRequired, adminRequired, async (req, res) => {
  try {
    const data = await dropxl.listProducts(req.query);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
