const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../db');
const dropxl = require('../dropxl');
const { authRequired } = require('../middleware/auth');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DROPXL_RATE_LIMIT_MS = 1100; // DropXL 限速 1 请求/秒，加 100ms 缓冲

// 把 address 截到 30 字符以内，溢出部分挪到 addr2 前面（DropXL 规则）
function splitAddress(addr1, addr2) {
  const a1 = String(addr1 || '').trim();
  const a2 = String(addr2 || '').trim();
  if (a1.length <= 30) return { address: a1, address2: a2 };
  return {
    address: a1.slice(0, 30).trim(),
    address2: (a1.slice(30).trim() + (a2 ? ' ' + a2 : '')).slice(0, 100),
  };
}

// 把本地订单组拼成 DropXL Create Order 请求体
function buildDropxlPayload(orderNo, shipping, items) {
  const { address, address2 } = splitAddress(shipping.address1, shipping.address2);
  const productAddrbook = {
    address,
    address2,
    city: shipping.city || '',
    province: shipping.state || '',
    postal_code: shipping.postal || '',
    country: (shipping.country || '').toUpperCase(),
    email: shipping.buyer_email || '',
    name: shipping.name || '',
    phone: shipping.phone || '',
    comments: '',
  };
  return {
    customer_order_reference: String(orderNo),
    addressbook: { country: productAddrbook.country },
    order_products: items.map(it => ({
      product_code: String(it.sku),
      quantity: Number(it.quantity) || 1,
      addressbook: productAddrbook,
    })),
  };
}

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// 亚马逊订单模板 → DropXL 采购模板字段映射
const AMAZON_COLS = {
  order_id: 'order-id',
  order_item_id: 'order-item-id',
  sku: 'sku',
  quantity: 'quantity-purchased',
  recipient_name: 'recipient-name',
  ship_address1: 'ship-address-1',
  ship_address2: 'ship-address-2',
  ship_city: 'ship-city',
  ship_state: 'ship-state',
  ship_postal: 'ship-postal-code',
  ship_country: 'ship-country',
  ship_phone: 'ship-phone-number',
  buyer_email: 'buyer-email',
  shop_name: 'shop-name',
  product_name: 'product-name',
  item_price: 'item-price',
  item_tax: 'item-tax',
  shipping_price: 'shipping-price',
  shipping_tax: 'shipping-tax',
};

function parseAmazonTemplate(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows.map((r, idx) => {
    const get = (col) => {
      const v = r[col];
      return v === undefined || v === null ? '' : String(v).trim();
    };
    return {
      row_no: idx + 2, // 表头是第 1 行
      amazon_order_id: get(AMAZON_COLS.order_id),
      amazon_order_item_id: get(AMAZON_COLS.order_item_id),
      sku: get(AMAZON_COLS.sku),
      quantity: Number(get(AMAZON_COLS.quantity)) || 0,
      recipient_name: get(AMAZON_COLS.recipient_name),
      ship_address1: get(AMAZON_COLS.ship_address1),
      ship_address2: get(AMAZON_COLS.ship_address2),
      ship_city: get(AMAZON_COLS.ship_city),
      ship_state: get(AMAZON_COLS.ship_state),
      ship_postal: get(AMAZON_COLS.ship_postal),
      ship_country: get(AMAZON_COLS.ship_country),
      ship_phone: get(AMAZON_COLS.ship_phone),
      buyer_email: get(AMAZON_COLS.buyer_email),
      shop_name: get(AMAZON_COLS.shop_name),
      product_name: get(AMAZON_COLS.product_name),
      item_price: Number(get(AMAZON_COLS.item_price)) || 0,
      item_tax: Number(get(AMAZON_COLS.item_tax)) || 0,
      shipping_price: Number(get(AMAZON_COLS.shipping_price)) || 0,
      shipping_tax: Number(get(AMAZON_COLS.shipping_tax)) || 0,
    };
  }).filter(r => r.amazon_order_id || r.sku);
}

const COUNTRY_CODE_TO_NAME = {
  US: '美国', GB: '英国', UK: '英国', DE: '德国', FR: '法国',
  IT: '意大利', NL: '荷兰', ES: '西班牙', PL: '波兰',
};

function inferCountryName(rawCountry) {
  const c = String(rawCountry || '').trim().toUpperCase();
  return COUNTRY_CODE_TO_NAME[c] || null;
}

function enrichRow(row) {
  const errors = [];
  if (!row.amazon_order_id) errors.push('缺少 order-id');
  if (!row.sku) errors.push('缺少 sku');
  if (row.quantity <= 0) errors.push('数量必须大于 0');

  const sku = String(row.sku).trim();
  const country = inferCountryName(row.ship_country);

  // 商品按 (国家, SKU) 复合查询 - PR-B 调整后的库存表结构
  const product = (sku && country)
    ? db.prepare('SELECT country, code, b2b_price, stock, image_url FROM dropxl_products WHERE country = ? AND code = ?').get(country, sku)
    : null;

  let markupPct = null;
  if (country) {
    const m = db.prepare('SELECT markup_pct FROM country_markup WHERE country = ?').get(country);
    markupPct = m ? Number(m.markup_pct) : null;
  }

  let unitPriceUsd = null;
  if (product && markupPct != null) {
    unitPriceUsd = Number(product.b2b_price) * (1 + markupPct / 100);
  }

  // 注意：响应中绝对不含 raw b2b_price 和 markup_pct，分销商/员工只看加价后单价
  return {
    ...row,
    country_name: country,
    matched: !!product,
    dropxl_product: product ? { code: product.code, stock: product.stock, image_url: product.image_url } : null,
    unit_price_usd: unitPriceUsd,
    errors: errors.concat(
      !country && row.ship_country ? [`国家代码 ${row.ship_country} 无法识别`] : [],
      country && !product && sku ? [`${country} 库存中未找到 SKU=${sku}（请确认对应国家库存文件已上传）`] : [],
      markupPct == null && country ? [`未配置 ${country} 的加价规则`] : [],
    ),
    warnings: product && product.stock <= 0 ? [`${country} 当前无库存（仍可下单，DropXL 端补货后发货）`] : [],
  };
}

// ============ 1. 上传 + 预览 ============
router.post('/preview', authRequired, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择文件' });
  let rows;
  try {
    rows = parseAmazonTemplate(req.file.buffer);
  } catch (e) {
    return res.status(400).json({ error: '文件解析失败: ' + e.message });
  }
  if (rows.length === 0) return res.status(400).json({ error: '文件中未找到有效数据行' });

  const enriched = rows.map(enrichRow);
  const exchangeRate = require('../settings').getExchangeRate();

  // 按 amazon_order_id 分组为 order_group（同一亚马逊订单的多个 SKU 合并）
  const groupsMap = new Map();
  for (const r of enriched) {
    if (!r.amazon_order_id) continue;
    if (!groupsMap.has(r.amazon_order_id)) {
      const cc = (r.ship_country || '').toLowerCase();
      groupsMap.set(r.amazon_order_id, {
        order_id: `${cc || 'xx'}-${r.amazon_order_id}`,
        amazon_order_id: r.amazon_order_id,
        country_code: cc,
        country_name: r.country_name,
        shop_name: r.shop_name,
        shipping: {
          name: r.recipient_name,
          phone: r.ship_phone,
          email: r.buyer_email,
          address1: r.ship_address1,
          address2: r.ship_address2,
          city: r.ship_city,
          state: r.ship_state,
          postal: r.ship_postal,
        },
        items: [],
        total_usd: 0,
        total_cny: 0,
        all_matched: true,
        errors: [],
      });
    }
    const g = groupsMap.get(r.amazon_order_id);
    const subtotalUsd = (r.unit_price_usd || 0) * (Number(r.quantity) || 0);
    const subtotalCny = subtotalUsd * exchangeRate;
    g.items.push({
      row_no: r.row_no,
      sku: r.sku,
      product_name: r.product_name,
      image_url: r.dropxl_product?.image_url || null,
      quantity: Number(r.quantity) || 0,
      unit_price_usd: r.unit_price_usd,
      item_price: r.item_price,
      item_tax: r.item_tax,
      after_tax_amount: Math.max(0, Number(r.item_price) - Number(r.item_tax)),
      subtotal_usd: subtotalUsd,
      subtotal_cny: subtotalCny,
      stock: r.dropxl_product?.stock,
      matched: r.matched,
      errors: r.errors,
      warnings: r.warnings,
    });
    g.total_usd += subtotalUsd;
    g.total_cny += subtotalCny;
    if (!r.matched || r.errors.length > 0) g.all_matched = false;
    for (const e of r.errors) if (!g.errors.includes(e)) g.errors.push(e);
  }
  const groups = Array.from(groupsMap.values());
  const grandTotalUsd = groups.filter(g => g.all_matched).reduce((s, g) => s + g.total_usd, 0);
  const grandTotalCny = grandTotalUsd * exchangeRate;

  res.json({
    rows: enriched,
    groups,
    summary: {
      total_items: enriched.length,
      total_groups: groups.length,
      ready_to_submit_groups: groups.filter(g => g.all_matched).length,
      total_usd: grandTotalUsd,
      total_cny: grandTotalCny,
    },
    exchange_rate: exchangeRate,
  });
});

// ============ 2. 提交（仅匹配成功的行） ============
router.post('/submit', authRequired, (req, res) => {
  const { rows = [] } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: '提交内容为空' });

  const exchangeRate = require('../settings').getExchangeRate();

  // 按 amazon_order_id 分组：同一个亚马逊订单的多行 SKU 合并为一个 purchase_order
  const groups = new Map();
  for (const r of rows) {
    if (!r.amazon_order_id || !r.sku) continue;
    if (!r.matched) continue;
    const key = r.amazon_order_id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const results = { created: [], skipped: [], failed: [] };

  const insOrder = db.prepare(`
    INSERT INTO purchase_orders
      (user_id, order_no, customer_ref, shop_name, country,
       real_amount_usd, purchase_amount_usd, purchase_amount_cny, exchange_rate, markup_pct,
       status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_purchase')
  `);
  const insItem = db.prepare(`
    INSERT INTO purchase_order_items (order_id, sku, product_name, quantity, unit_price)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insShip = db.prepare(`
    INSERT OR REPLACE INTO purchase_order_shipping
      (order_id, name, address1, address2, city, state, postal, country, phone, buyer_email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findExisting = db.prepare('SELECT id FROM purchase_orders WHERE order_no = ? AND user_id = ?');

  const tx = db.transaction(() => {
    for (const [orderId, items] of groups.entries()) {
      if (findExisting.get(orderId, req.user.id)) {
        results.skipped.push({ amazon_order_id: orderId, reason: '订单已存在' });
        continue;
      }
      const first = items[0];
      const country = first.country_name || inferCountryName(first.ship_country);
      if (!country) {
        results.failed.push({ amazon_order_id: orderId, reason: '无法识别国家' });
        continue;
      }
      // 不信任客户端传的价格，服务端按 (country, sku) 重新查 DropXL 库 + country_markup
      const markupRow = db.prepare('SELECT markup_pct FROM country_markup WHERE country = ?').get(country);
      const markupPct = Number(markupRow?.markup_pct) || 0;

      let realUsd = 0;
      const resolvedItems = [];
      let resolveError = null;
      const factor = 1 + markupPct / 100;
      for (const it of items) {
        const p = db.prepare('SELECT b2b_price FROM dropxl_products WHERE country = ? AND code = ?').get(country, String(it.sku).trim());
        if (!p) { resolveError = `${country} 库存中未找到 SKU=${it.sku}`; break; }
        const qty = Number(it.quantity) || 1;
        const rawUnit = Number(p.b2b_price) || 0;
        realUsd += rawUnit * qty;
        resolvedItems.push({
          sku: it.sku,
          product_name: it.product_name || '',
          quantity: qty,
          unit_marked_up: rawUnit * factor,
        });
      }
      if (resolveError) {
        results.failed.push({ amazon_order_id: orderId, reason: resolveError });
        continue;
      }
      const displayUsd = realUsd * factor;
      const displayCny = displayUsd * exchangeRate;

      try {
        const info = insOrder.run(
          req.user.id, orderId, orderId,
          first.shop_name || null,
          country,
          realUsd, displayUsd, displayCny, exchangeRate, markupPct,
        );
        const id = info.lastInsertRowid;
        insShip.run(
          id, first.recipient_name, first.ship_address1, first.ship_address2,
          first.ship_city, first.ship_state, first.ship_postal, first.ship_country,
          first.ship_phone, first.buyer_email,
        );
        for (const it of resolvedItems) {
          // unit_price 存加价后的单价 - 分销商查看订单详情时看到的就是他们支付的单价
          // 不暴露 raw b2b_price（避免泄露真实成本）。总成本通过 purchase_orders.real_amount_usd 记录
          insItem.run(id, it.sku, it.product_name, it.quantity, it.unit_marked_up);
        }
        results.created.push({ amazon_order_id: orderId, id, lines: resolvedItems.length });
      } catch (e) {
        results.failed.push({ amazon_order_id: orderId, reason: e.message });
      }
    }
  });
  tx();

  // 本地落库成功后，逐订单推送到 DropXL（按对应国家 token）
  // 限速 1 req/sec；推送结果存回 purchase_orders；失败的订单店主可后台重试
  const updatePush = db.prepare(`
    UPDATE purchase_orders
    SET dropxl_order_id = ?, dropxl_push_status = ?, dropxl_push_error = ?, dropxl_pushed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const dropxlPush = { success: 0, failed: 0, details: [] };
  for (const created of results.created) {
    // 重新查必要数据用于拼 payload
    const order = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(created.id);
    const shipping = db.prepare('SELECT * FROM purchase_order_shipping WHERE order_id = ?').get(created.id);
    const itemRows = db.prepare('SELECT sku, quantity FROM purchase_order_items WHERE order_id = ?').all(created.id);
    if (!order || !shipping) {
      dropxlPush.failed++;
      dropxlPush.details.push({ amazon_order_id: created.amazon_order_id, ok: false, error: '本地数据残缺' });
      continue;
    }
    try {
      const payload = buildDropxlPayload(order.order_no, shipping, itemRows);
      const resp = await dropxl.createOrder(payload, order.country);
      const dropxlOrderId = resp?.order?.id || resp?.id || null;
      updatePush.run(dropxlOrderId ? String(dropxlOrderId) : null, 'success', null, created.id);
      dropxlPush.success++;
      dropxlPush.details.push({ amazon_order_id: created.amazon_order_id, ok: true, dropxl_order_id: dropxlOrderId });
    } catch (e) {
      updatePush.run(null, 'failed', String(e.message || e).slice(0, 500), created.id);
      dropxlPush.failed++;
      dropxlPush.details.push({ amazon_order_id: created.amazon_order_id, ok: false, error: e.message });
    }
    await sleep(DROPXL_RATE_LIMIT_MS);
  }

  res.json({
    ok: true,
    ...results,
    dropxl_push: dropxlPush,
    summary: {
      created: results.created.length,
      skipped: results.skipped.length,
      failed: results.failed.length,
      dropxl_pushed: dropxlPush.success,
      dropxl_push_failed: dropxlPush.failed,
    },
  });
});

module.exports = router;
