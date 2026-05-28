// 拼 DropXL Create Order 请求体的共享逻辑（批量提交与订单管理「重试推送」共用，保证一致）

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

// 把本地订单组/订单拼成 DropXL Create Order 请求体
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

module.exports = { splitAddress, buildDropxlPayload };
