// 商品库存 API 同步子进程：调 DropXL listProducts 分页拉取 + 写入 dropxl_products。
// 独立进程运行,与主服务隔离 —— DropXL 慢/超时/重试再久(一次可达 30-45 分钟)
// 也只占用本子进程,主服务事件循环不被阻塞,网站照常响应。
//
// 由 routes/adminProducts.js 通过 child_process.fork 启动,IPC 通信:
//   收到 { type:'start', country, startedBy }
//   回发 { type:'progress', fetched, upserted, total } / { type:'done', in_stock, total } / { type:'error', error }
const db = require('../db');
const dropxl = require('../dropxl');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const PAGE_SIZE = Number(process.env.DROPXL_PAGE_SIZE) || 1000;
const RATE_LIMIT_MS = Number(process.env.DROPXL_SYNC_RATE_MS) || 800;
const MAX_RETRY = 4;

const upsert = db.prepare(`
  INSERT INTO dropxl_products (country, code, b2b_price, stock, image_url, uploaded_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(country, code) DO UPDATE SET
    b2b_price = excluded.b2b_price,
    stock = excluded.stock,
    image_url = COALESCE(excluded.image_url, dropxl_products.image_url),
    uploaded_at = excluded.uploaded_at
`);

function extractImage(p) {
  const candidates = [p.image, p.image_url, p.main_image, p.thumbnail, p.picture, p.img];
  for (const v of candidates) if (v && typeof v === 'string') return v;
  if (Array.isArray(p.images) && p.images.length > 0) {
    const first = p.images[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') return first.url || first.src || null;
  }
  return null;
}

async function run(msg) {
  const { country, startedBy } = msg;
  const send = (m) => { if (process.send) process.send(m); };
  let offset = 0, total = null, fetched = 0, upserted = 0, pages = 0;
  const now = new Date().toISOString();
  try {
    while (true) {
      let data, attempt = 0;
      while (true) {
        try { data = await dropxl.listProducts({ limit: PAGE_SIZE, offset }, country); break; }
        catch (e) {
          attempt++;
          if (attempt > MAX_RETRY) throw e;
          const wait = RATE_LIMIT_MS * Math.pow(2, attempt);
          console.warn(`[product-sync] ${country} offset=${offset} 第${attempt}次重试（${e.message}），${wait}ms 后再试`);
          send({ type: 'progress', fetched, upserted, total: total ?? fetched, retrying: `第${attempt}次重试` });
          await sleep(wait);
        }
      }
      const items = Array.isArray(data) ? data : (data?.data || []);
      const paginationTotal = Array.isArray(data)
        ? Number(items[items.length - 1]?.pagination?.total) || null
        : (data?.pagination?.total != null ? Number(data.pagination.total) : null);
      if (paginationTotal != null) total = paginationTotal;
      const tx = db.transaction((arr) => {
        for (const p of arr) {
          if (!p.code) continue;
          upsert.run(country, String(p.code), Number(p.price) || 0, Number(p.quantity) || 0, extractImage(p), now);
          upserted++;
        }
      });
      tx(items);
      fetched += items.length;
      // 每 20 页主动做一次 PASSIVE checkpoint，把 WAL 折回主库，避免一次全量同步
      // (55 万行 / 15-20 分钟) 期间 WAL 无限增长。WAL 过大时主进程的其它查询(订单等)
      // 要扫描超长 WAL 而变慢。PASSIVE 不阻塞其它连接，拿不到锁就尽力而为后立即返回。
      if (++pages % 20 === 0) { try { db.pragma('wal_checkpoint(PASSIVE)'); } catch {} }
      send({ type: 'progress', fetched, upserted, total: total ?? fetched });
      if (!items.length) break;
      if (total != null && fetched >= total) break;
      offset += items.length;
      await sleep(RATE_LIMIT_MS);
    }
    const inStock = db.prepare('SELECT COUNT(*) AS c FROM dropxl_products WHERE country = ? AND stock > 0').get(country).c;
    const totalCount = db.prepare('SELECT COUNT(*) AS c FROM dropxl_products WHERE country = ?').get(country).c;
    db.prepare(`
      INSERT INTO inventory_uploads (country, original_filename, stored_filename, rows_count, in_stock_count, uploaded_by, uploaded_at, source)
      VALUES (?, NULL, NULL, ?, ?, ?, ?, 'api')
    `).run(country, totalCount, inStock, startedBy, now);
    send({ type: 'done', in_stock: inStock, total: totalCount, fetched, upserted });
    process.exit(0);
  } catch (e) {
    send({ type: 'error', error: String(e.message || e) });
    process.exit(1);
  }
}

process.on('message', (msg) => { if (msg && msg.type === 'start') run(msg); });
