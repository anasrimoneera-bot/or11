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

CREATE TABLE IF NOT EXISTS dropxl_products (
  country TEXT NOT NULL,
  code TEXT NOT NULL,
  b2b_price REAL DEFAULT 0,
  stock INTEGER DEFAULT 0,
  uploaded_at TEXT,
  PRIMARY KEY (country, code)
);
CREATE INDEX IF NOT EXISTS idx_dropxl_products_country ON dropxl_products(country);
CREATE INDEX IF NOT EXISTS idx_dropxl_products_code ON dropxl_products(code);

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

function ensureDefaultUser() {
  // 创建管理员账号
  const adminName = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  if (!db.prepare('SELECT id FROM users WHERE username = ?').get(adminName)) {
    const hash = bcrypt.hashSync(adminPass, 10);
    const info = db.prepare(`
      INSERT INTO users (username, password_hash, display_name, role, is_admin, is_owner)
      VALUES (?, ?, '店主', 'owner', 1, 1)
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
