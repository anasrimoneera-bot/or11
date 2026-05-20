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
`);

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

module.exports = db;
