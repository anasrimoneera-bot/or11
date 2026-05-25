const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'erp.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  phone TEXT,
  company TEXT,
  address TEXT,
  role TEXT DEFAULT 'distributor',
  is_admin INTEGER DEFAULT 0,
  is_owner INTEGER DEFAULT 0,
  parent_id INTEGER,
  member_level TEXT DEFAULT '一级分销',
  member_days INTEGER DEFAULT 0,
  sku_limit INTEGER DEFAULT 100,
  markup_pct REAL DEFAULT 30,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS balance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  balance_after REAL NOT NULL,
  description TEXT,
  related_order TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_balance (
  user_id INTEGER PRIMARY KEY,
  balance REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_no TEXT UNIQUE NOT NULL,
  customer_ref TEXT,
  shop_name TEXT,
  country TEXT,
  amazon_amount REAL DEFAULT 0,
  amazon_tax_amount REAL DEFAULT 0,
  shipping_fee REAL DEFAULT 0,
  real_amount_usd REAL DEFAULT 0,
  purchase_amount_usd REAL DEFAULT 0,
  purchase_amount_cny REAL DEFAULT 0,
  exchange_rate REAL DEFAULT 6.86,
  markup_pct REAL DEFAULT 30,
  distributor_refund REAL DEFAULT 0,
  tracking_no TEXT,
  status TEXT DEFAULT 'pending_purchase',
  dropxl_order_id TEXT,
  raw_payload TEXT,
  raw_response TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS aftersales_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_id INTEGER,
  order_no TEXT,
  country TEXT,
  title TEXT,
  reason TEXT,
  description TEXT,
  priority TEXT DEFAULT '中优先级',
  status TEXT DEFAULT 'pending',
  has_new_message INTEGER DEFAULT 0,
  refund_amount REAL DEFAULT 0,
  admin_note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS aftersales_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT,
  mimetype TEXT,
  size INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS aftersales_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  author TEXT,
  is_admin INTEGER DEFAULT 0,
  content TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  country TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  display_name TEXT,
  is_owner INTEGER DEFAULT 0,
  method TEXT,
  path TEXT,
  action TEXT,
  target_type TEXT,
  target_id TEXT,
  target_name TEXT,
  summary TEXT,
  changes TEXT,
  payload TEXT,
  ip TEXT,
  status INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_order_shipping (
  order_id INTEGER PRIMARY KEY,
  name TEXT,
  address1 TEXT,
  address2 TEXT,
  city TEXT,
  state TEXT,
  postal TEXT,
  country TEXT,
  phone TEXT,
  buyer_email TEXT
);

CREATE TABLE IF NOT EXISTS dropxl_products (
  country TEXT NOT NULL,
  code TEXT NOT NULL,
  b2b_price REAL DEFAULT 0,
  stock INTEGER DEFAULT 0,
  image_url TEXT,
  uploaded_at TEXT,
  PRIMARY KEY (country, code)
);
CREATE INDEX IF NOT EXISTS idx_dropxl_products_country ON dropxl_products(country);
CREATE INDEX IF NOT EXISTS idx_dropxl_products_code ON dropxl_products(code);
-- 商品列表按 (country, 数值化的 code) 排序分页。没有这个表达式索引时，
-- ORDER BY CAST(code AS INTEGER) 会对全国 55 万行做临时 B-tree 全排序(~350ms/次)，
-- 同步期间被反复触发会把主线程事件循环卡死。有了它走索引区间扫描，<1ms。
CREATE INDEX IF NOT EXISTS idx_dropxl_products_sort ON dropxl_products(country, CAST(code AS INTEGER), code);

CREATE TABLE IF NOT EXISTS inventory_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country TEXT NOT NULL,
  original_filename TEXT,
  stored_filename TEXT,
  rows_count INTEGER DEFAULT 0,
  in_stock_count INTEGER DEFAULT 0,
  uploaded_by TEXT,
  uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inventory_uploads_country ON inventory_uploads(country, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS country_markup (
  country TEXT PRIMARY KEY,
  markup_pct REAL DEFAULT 30,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dropxl_accounts (
  country TEXT PRIMARY KEY,
  email TEXT,
  token TEXT,
  base_url TEXT,
  enabled INTEGER DEFAULT 1,
  last_test_at TEXT,
  last_test_ok INTEGER DEFAULT 0,
  last_test_error TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 各国销售白名单 + 主图链接（店主上传的"总表"）
-- 商品库存价格管理 / 批量采购 只显示该表里有的 SKU
-- A 列 Image 1 -> image_url；B 列 SKU -> sku
CREATE TABLE IF NOT EXISTS country_master_skus (
  country TEXT NOT NULL,
  sku TEXT NOT NULL,
  image_url TEXT,
  uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (country, sku)
);
CREATE INDEX IF NOT EXISTS idx_master_country ON country_master_skus(country);

-- 各国总表上传记录（含原始文件名给店主下载源文件）
CREATE TABLE IF NOT EXISTS country_master_uploads (
  country TEXT PRIMARY KEY,
  original_filename TEXT,
  stored_filename TEXT,
  rows_count INTEGER DEFAULT 0,
  uploaded_by TEXT,
  uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 亚马逊各国汇率（与采购汇率独立维护；采购汇率含店主汇差，不能拿来算亚马逊收入）
-- 店主在订单管理页保存 amazon_amount 时把当前 rate 锁到 purchase_orders.amazon_rate_locked
CREATE TABLE IF NOT EXISTS country_amazon_rate (
  country TEXT PRIMARY KEY,
  rate REAL NOT NULL DEFAULT 0,
  currency TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 各币种采购汇率（外币 → CNY，独立于亚马逊汇率，含店主自定汇差）
-- USD/EUR/GBP/PLN 四个币种，订单创建时按订单国家映射到对应币种再查这里
CREATE TABLE IF NOT EXISTS currency_purchase_rate (
  currency TEXT PRIMARY KEY,
  rate REAL NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS aftersales_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  published_title TEXT,
  published_body TEXT,
  sort_order INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);
`);

// 迁移：PR-B 早期版本曾使用 code 作为单一 PK + 多个 API 同步相关字段。
// 现在改为 (country, code) 复合 PK，schema 不兼容，检测后重建。
(function migrateDropxlProducts() {
  const info = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='dropxl_products'").get();
  if (!info?.sql) return;
  if (info.sql.includes('PRIMARY KEY (country, code)')) return;
  db.exec('DROP TABLE dropxl_products');
  db.exec(`
    CREATE TABLE dropxl_products (
      country TEXT NOT NULL,
      code TEXT NOT NULL,
      b2b_price REAL DEFAULT 0,
      stock INTEGER DEFAULT 0,
      uploaded_at TEXT,
      PRIMARY KEY (country, code)
    );
    CREATE INDEX IF NOT EXISTS idx_dropxl_products_country ON dropxl_products(country);
    CREATE INDEX IF NOT EXISTS idx_dropxl_products_code ON dropxl_products(code);
  `);
})();

// 给 inventory_uploads 加 source 列：'upload' = 店主上传 xlsx；'api' = DropXL API 同步
(function ensureUploadSourceColumn() {
  const cols = db.prepare("PRAGMA table_info(inventory_uploads)").all();
  if (!cols.some(c => c.name === 'source')) {
    db.exec("ALTER TABLE inventory_uploads ADD COLUMN source TEXT DEFAULT 'upload'");
  }
})();

// 给 dropxl_products 加 image_url 列（API 同步可能返回；XLSX 上传无该字段）
(function ensureProductImageColumn() {
  const cols = db.prepare("PRAGMA table_info(dropxl_products)").all();
  if (!cols.some(c => c.name === 'image_url')) {
    db.exec("ALTER TABLE dropxl_products ADD COLUMN image_url TEXT");
  }
})();

// 首次启动：把 .env 的 DROPXL_API_EMAIL / DROPXL_API_TOKEN 作为美国账户种子数据
// （DropXL 每个国家独立账户独立 token，初版只配置了美国）
(function seedUsDropxlAccount() {
  const email = process.env.DROPXL_API_EMAIL;
  const token = process.env.DROPXL_API_TOKEN;
  if (!email || !token) return;
  const existing = db.prepare('SELECT country FROM dropxl_accounts WHERE country = ?').get('美国');
  if (existing) return;
  db.prepare(`
    INSERT INTO dropxl_accounts (country, email, token, base_url, enabled)
    VALUES (?, ?, ?, ?, 1)
  `).run('美国', email, token, process.env.DROPXL_API_BASE || 'https://b2b.dropxl.com/api_customer');
})();

// 给 purchase_orders 加 DropXL API 推送状态字段
(function ensureDropxlPushColumns() {
  const cols = db.prepare("PRAGMA table_info(purchase_orders)").all();
  const names = new Set(cols.map(c => c.name));
  const add = (col, def) => { if (!names.has(col)) db.exec(`ALTER TABLE purchase_orders ADD COLUMN ${col} ${def}`); };
  add('dropxl_push_status', 'TEXT');     // null / 'success' / 'failed'
  add('dropxl_push_error', 'TEXT');
  add('dropxl_pushed_at', 'TEXT');
  // 亚马逊金额锁定的汇率快照（与订单采购汇率分离）
  add('amazon_rate_locked', 'REAL');
  // PayPal 支付汇率（店主向 DropXL 用 PayPal 付款时 PayPal 显示的汇率, 1 CNY = ? USD）
  // 用于按真实 USD 算真实人民币成本, 再和用户采购价算店主+合伙人的差价利润
  add('paypal_rate', 'REAL');
})();

// 首次初始化亚马逊各国汇率（rate=0 表示未设置，店主需在系统设置页维护）
(function seedAmazonRates() {
  const CURRENCY_BY_COUNTRY = {
    美国: 'USD', 英国: 'GBP',
    德国: 'EUR', 法国: 'EUR', 荷兰: 'EUR', 意大利: 'EUR', 西班牙: 'EUR',
    波兰: 'PLN',
  };
  const ins = db.prepare('INSERT OR IGNORE INTO country_amazon_rate (country, rate, currency) VALUES (?, 0, ?)');
  for (const [c, cur] of Object.entries(CURRENCY_BY_COUNTRY)) ins.run(c, cur);
})();

// 采购汇率初始化：USD 沿用原全局 exchange_rate_cny_per_usd 的值，其他币种默认 0 等店主填
(function seedCurrencyPurchaseRate() {
  const usdRow = db.prepare("SELECT value FROM settings WHERE key = 'exchange_rate_cny_per_usd'").get();
  const usdRate = Number(usdRow?.value) || 6.86;
  const seeds = { USD: usdRate, EUR: 0, GBP: 0, PLN: 0 };
  const ins = db.prepare('INSERT OR IGNORE INTO currency_purchase_rate (currency, rate) VALUES (?, ?)');
  for (const [cur, r] of Object.entries(seeds)) ins.run(cur, r);
})();

// 把已有店主账号的显示名从 '店主' 改成 'BOSS账号'（仅当还是默认 '店主' 时，不覆盖用户自定义的）
(function renameOwnerToBoss() {
  try {
    db.prepare("UPDATE users SET display_name = 'BOSS账号' WHERE is_owner = 1 AND display_name = '店主'").run();
  } catch {}
})();

function ensureDefaultUser() {
  // 创建管理员账号
  const adminName = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  if (!db.prepare('SELECT id FROM users WHERE username = ?').get(adminName)) {
    const hash = bcrypt.hashSync(adminPass, 10);
    const info = db.prepare(`
      INSERT INTO users (username, password_hash, display_name, role, is_admin, is_owner)
      VALUES (?, ?, 'BOSS账号', 'owner', 1, 1)
    `).run(adminName, hash);
    db.prepare('INSERT INTO user_balance (user_id, balance) VALUES (?, 0)').run(info.lastInsertRowid);
  }

  // 创建演示分销商账号
  if (!db.prepare('SELECT id FROM users WHERE username = ?').get('demo')) {
    const hash = bcrypt.hashSync('demo123', 10);
    const info = db.prepare(`
      INSERT INTO users (username, password_hash, display_name, email, role, member_level, member_days, sku_limit)
      VALUES (?, ?, '张瑞文', '594931721@qq.com', 'distributor', '一级分销', 0, 123)
    `).run('demo', hash);
    db.prepare('INSERT INTO user_balance (user_id, balance) VALUES (?, 0)').run(info.lastInsertRowid);
    db.prepare('INSERT INTO shops (user_id, name, country) VALUES (?, ?, ?)').run(info.lastInsertRowid, 'EV', '美国');
    db.prepare('INSERT INTO shops (user_id, name, country) VALUES (?, ?, ?)').run(info.lastInsertRowid, 'FF', '美国');
  }
}

function ensureColumn(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
  }
}

// 历史库添加 PR-C 新列
ensureColumn('purchase_orders', 'dropxl_exported_at', 'TEXT');

// 管理员功能权限：BOSS 可给每个管理员单独开通的功能 key（JSON 数组）。
// 空/NULL = 只有基础管理员功能；BOSS(is_owner) 隐式拥有全部，不依赖此列。
ensureColumn('users', 'permissions', 'TEXT');

ensureDefaultUser();

function ensureDefaultPolicies() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM aftersales_policies').get().c;
  if (count > 0) return;
  const seed = [
    {
      slug: 'general',
      title: '售后政策',
      body: `1. 客户收到商品后 30 天内可申请售后。
2. 售后申请需提供订单号、商品照片或视频证据。
3. 因物流损坏需要保留原始包装。
4. 退款将原路返回至账户余额。`,
    },
    {
      slug: 'us',
      title: '美国售后政策指南',
      body: `美国订单售后处理时效为 3-5 个工作日。
退货地址由 DropXL 平台分配，需提供有效的 tracking number。
亚马逊 A-to-Z 申诉单需在 24 小时内同步告知。`,
    },
    {
      slug: 'de',
      title: '德国售后政策指南',
      body: `德国订单按欧盟消费者保护法处理。
14 天无理由退货，运费可由分销商承担。
请保留与买家的所有沟通记录。`,
    },
    {
      slug: 'it_nl_fr',
      title: '意大利、荷兰、法国售后政策指南',
      body: `按欧盟通用消费者权益保护处理。
请通过 DropXL 平台的工单系统沟通。
退款金额以欧元结算并按当日汇率折算人民币。`,
    },
  ];
  const now = new Date().toISOString();
  const ins = db.prepare(`
    INSERT INTO aftersales_policies (slug, title, body, published_title, published_body, sort_order, updated_at, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  seed.forEach((s, i) => ins.run(s.slug, s.title, s.body, s.title, s.body, i, now, now));
}

ensureDefaultPolicies();

function ensureDefaultSettings() {
  const defaults = [
    { key: 'exchange_rate_cny_per_usd', value: '6.86' },
  ];
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const d of defaults) ins.run(d.key, d.value);
}

ensureDefaultSettings();

function ensureDefaultCountryMarkup() {
  const defaults = ['美国', '英国', '德国', '法国', '意大利', '荷兰', '西班牙', '波兰'];
  const ins = db.prepare('INSERT OR IGNORE INTO country_markup (country, markup_pct) VALUES (?, 30)');
  for (const c of defaults) ins.run(c);
}

ensureDefaultCountryMarkup();

module.exports = db;
