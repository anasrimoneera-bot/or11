const axios = require('axios');
const db = require('./db');

const DEFAULT_BASE = process.env.DROPXL_API_BASE || 'https://b2b.dropxl.com/api_customer';

// 按国家取凭据：优先 DB（dropxl_accounts 表），无配置则回落 .env（美国遗留）
function getAccount(country) {
  if (country) {
    const row = db.prepare(
      'SELECT email, token, base_url FROM dropxl_accounts WHERE country = ? AND enabled = 1'
    ).get(country);
    if (row?.email && row?.token) {
      return { email: row.email, token: row.token, base: row.base_url || DEFAULT_BASE, country };
    }
  }
  return {
    email: process.env.DROPXL_API_EMAIL || '',
    token: process.env.DROPXL_API_TOKEN || '',
    base: DEFAULT_BASE,
    country: country || null,
  };
}

function createClient(country) {
  const acc = getAccount(country);
  const client = axios.create({
    baseURL: acc.base,
    timeout: 30000,
    auth: { username: acc.email, password: acc.token },
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
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
  return client;
}

// 默认 client（不指定国家时使用 .env 凭据，向后兼容旧调用）
const defaultClient = createClient(null);

async function listOrders(params = {}, country = null) {
  const client = country ? createClient(country) : defaultClient;
  const { data } = await client.get('/orders', { params });
  return data;
}

async function getOrder(id, country = null) {
  const client = country ? createClient(country) : defaultClient;
  const { data } = await client.get(`/orders/${id}`);
  return data;
}

async function createOrder(payload, country = null) {
  const client = country ? createClient(country) : defaultClient;
  const { data } = await client.post('/orders', payload);
  return data;
}

async function listProducts(params = {}, country = null) {
  const client = country ? createClient(country) : defaultClient;
  const { data } = await client.get('/products', { params });
  return data;
}

async function getAccountInfo(country = null) {
  const client = country ? createClient(country) : defaultClient;
  try {
    const { data } = await client.get('/account');
    return data;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// 测试凭据有效性：调一次 limit=1 的 listProducts，能返回数据就算通过
async function testCredentials(country) {
  try {
    const data = await listProducts({ limit: 1, offset: 0 }, country);
    const items = Array.isArray(data) ? data : (data?.data || []);
    return { ok: true, sample_count: items.length };
  } catch (e) {
    return { ok: false, error: e.message, status: e.status };
  }
}

function extractRealAmountUSD(resp) {
  if (!resp || typeof resp !== 'object') return 0;
  const candidates = [
    resp.totals?.total, resp.totals?.products, resp.totals?.amount,
    resp.total_amount, resp.total, resp.amount, resp.price,
    resp.order?.totals?.total, resp.order?.total,
    resp.data?.totals?.total, resp.data?.total,
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
  testCredentials,
  createClient,
  getAccount,
  extractRealAmountUSD,
  client: defaultClient,
};
