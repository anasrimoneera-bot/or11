const axios = require('axios');

const BASE = process.env.DROPXL_API_BASE || 'https://b2b.dropxl.com/api';
const TOKEN = process.env.DROPXL_API_TOKEN || '';

const client = axios.create({
  baseURL: BASE,
  timeout: 30000,
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

client.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err.response?.status;
    const data = err.response?.data;
    const message = data?.message || data?.error || err.message;
    const e = new Error(`DropXL API error${status ? ' ' + status : ''}: ${message}`);
    e.status = status;
    e.data = data;
    throw e;
  }
);

async function listOrders(params = {}) {
  const { data } = await client.get('/orders', { params });
  return data;
}

async function getOrder(id) {
  const { data } = await client.get(`/orders/${id}`);
  return data;
}

async function createOrder(payload) {
  const { data } = await client.post('/orders', payload);
  return data;
}

async function listProducts(params = {}) {
  const { data } = await client.get('/products', { params });
  return data;
}

async function getAccountInfo() {
  try {
    const { data } = await client.get('/account');
    return data;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// 尝试从 DropXL 创建订单/订单详情响应中提取真实采购价 (USD)
// DropXL 实际响应格式未知，按常见字段路径多重尝试，由管理员后台可手工修正
function extractRealAmountUSD(resp) {
  if (!resp || typeof resp !== 'object') return 0;
  const candidates = [
    resp.totals?.total,
    resp.totals?.products,
    resp.totals?.amount,
    resp.total_amount,
    resp.total,
    resp.amount,
    resp.price,
    resp.order?.totals?.total,
    resp.order?.total,
    resp.data?.totals?.total,
    resp.data?.total,
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (isFinite(n) && n > 0) return n;
  }
  return 0;
}

module.exports = {
  listOrders,
  getOrder,
  createOrder,
  listProducts,
  getAccountInfo,
  extractRealAmountUSD,
  client,
};
