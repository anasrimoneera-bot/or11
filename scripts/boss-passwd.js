#!/usr/bin/env node
// BOSS(店主/owner)账号密码工具：探测已知候选密码 / 重置密码。
//
// bcrypt 是单向哈希，库里存的 password_hash 无法反解出明文。
// 本脚本只能：① 拿候选密码逐个和哈希比对（命中即知道原密码）；② 重置成新密码。
//
// 用法（在对应实例的项目根目录里跑，这样能定位到它自己的 data/erp.db 和 .env）：
//   node scripts/boss-passwd.js                      # 列出 owner 账号 + 探测候选密码
//   node scripts/boss-passwd.js --pass '你的猜测'     # 额外把这个也加进候选一起试
//   node scripts/boss-passwd.js --reset '新密码'      # 把 owner 密码重置成新密码
//   node scripts/boss-passwd.js --user admin --reset '新密码'   # 指定用户名
//   node scripts/boss-passwd.js --db /opt/lanjing-erp/data/erp.db   # 指定库文件
//
// DB 路径优先级：--db 参数 > 环境变量 DB_PATH（含 .env） > 默认 ./data/erp.db
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dbPath = arg('--db') || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'erp.db');
const targetUser = arg('--user');
const resetTo = arg('--reset');
const extraGuess = arg('--pass');

if (!fs.existsSync(dbPath)) {
  console.error(`✗ 找不到数据库文件: ${dbPath}`);
  console.error('  用 --db 指定正确路径，或到对应实例的项目根目录里跑。');
  process.exit(1);
}
console.log(`数据库: ${dbPath}\n`);

const db = new Database(dbPath);

// 找 owner 账号（可能不止一个，也可能用户名不是 admin）
let owners = db.prepare('SELECT id, username, display_name, password_hash FROM users WHERE is_owner = 1').all();
if (targetUser) {
  owners = db.prepare('SELECT id, username, display_name, password_hash FROM users WHERE username = ?').all(targetUser);
}
if (owners.length === 0) {
  console.error('✗ 该库里没有 owner(is_owner=1) 账号' + (targetUser ? `，也没有用户名为 ${targetUser} 的账号` : ''));
  console.error('  看看这个库里都有哪些账号：');
  for (const u of db.prepare('SELECT username, is_owner, is_admin FROM users').all()) {
    console.error(`    - ${u.username}  (owner=${u.is_owner}, admin=${u.is_admin})`);
  }
  process.exit(1);
}

console.log('找到 owner 账号：');
for (const o of owners) console.log(`  - id=${o.id}  用户名=${o.username}  显示名=${o.display_name}`);
console.log('');

if (resetTo) {
  if (resetTo.length < 6) {
    console.error('✗ 新密码至少 6 位');
    process.exit(1);
  }
  const hash = bcrypt.hashSync(resetTo, 10);
  const upd = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
  for (const o of owners) {
    upd.run(hash, o.id);
    console.log(`✓ 已重置 ${o.username} 的密码为: ${resetTo}`);
  }
  console.log('\n现在可以用上面的用户名 + 新密码登录了。');
  process.exit(0);
}

// 探测模式：拿候选密码逐个比对
const candidates = [
  process.env.ADMIN_PASSWORD,          // 该实例 .env 里配的（首次建库时用它播种）
  'admin123',                          // 代码里的默认值（.env 没配 ADMIN_PASSWORD 时用它）
  'demo123',
  'admin', 'password', '123456', '12345678', 'admin888', 'admin@123',
  extraGuess,                          // 用户额外传入的猜测
].filter(Boolean);
// 去重
const seen = new Set();
const uniq = candidates.filter(c => (seen.has(c) ? false : (seen.add(c), true)));

console.log(`用 ${uniq.length} 个候选密码探测（bcrypt 无法反解，只能试）...\n`);
let anyHit = false;
for (const o of owners) {
  let hit = null;
  for (const c of uniq) {
    if (bcrypt.compareSync(c, o.password_hash)) { hit = c; break; }
  }
  if (hit) {
    anyHit = true;
    console.log(`✓ ${o.username} 的密码就是: ${hit}`);
  } else {
    console.log(`✗ ${o.username}: 候选里没有命中（密码被改过，且不在常见候选里）`);
  }
}

if (!anyHit) {
  console.log('\n没探测出来 = 密码不是常见默认值。');
  console.log('直接重置最省事：');
  console.log(`  node scripts/boss-passwd.js${targetUser ? ` --user ${targetUser}` : ''} --reset '你要设的新密码'`);
}
