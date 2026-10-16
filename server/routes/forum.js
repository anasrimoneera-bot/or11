const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

// 问题论坛：所有登录用户（分销商 + 管理员）可提问、评论；管理员可删除主题/评论。
// 管理员的解答在评论列表中置顶。
const router = express.Router();
router.use(authRequired);

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads', 'forum');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 附件白名单（图片 / 表格 / 文档）。按扩展名决定返回的 Content-Type，不信任客户端上报的
// mimetype，避免上传 html/svg 等在同源下被当页面执行。
const ALLOWED_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_EXT[path.extname(file.originalname).toLowerCase()]) return cb(null, true);
    cb(new Error(`不支持的附件类型：${file.originalname}（仅支持图片、Excel/CSV 表格、PDF、Word、TXT）`));
  },
});
// multer 出错（类型不符 / 超过 20MB）时返回 400 + 中文提示，而不是落到全局 500
const uploadFiles = (req, res, next) => upload.array('files', 10)(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '单个附件不能超过 20MB' });
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: '一次最多上传 10 个附件' });
  res.status(400).json({ error: err.message });
});
const removeFiles = (files) => { for (const f of files || []) fs.unlink(f.path, () => {}); };
const decodeName = (f) => Buffer.from(f.originalname, 'latin1').toString('utf8');

// 作者显示名：管理员统一显示「管理员」；分销商之间互相只看到打码后的名字，
// 自己看到「我」，管理员看到完整名字。
function authorName(row, viewer) {
  if (row.author_is_admin) return '管理员';
  if (row.user_id === viewer.id) return '我';
  const name = row.display_name || row.username || '';
  if (viewer.is_admin) return name;
  return name ? `${name.slice(0, 1)}**` : '用户';
}

// 控制台提示：自上次打开论坛后，别人新发的问题数 + 最近几条标题（走主键范围，开销很小）
router.get('/unread', (req, res) => {
  const seen = db.prepare('SELECT forum_seen_id FROM users WHERE id = ?').get(req.user.id)?.forum_seen_id || 0;
  const cond = 'WHERE id > ? AND user_id != ?';
  const count = db.prepare(`SELECT COUNT(*) AS c FROM forum_topics ${cond}`).get(seen, req.user.id).c;
  const latest = count ? db.prepare(`SELECT id, title, created_at FROM forum_topics ${cond} ORDER BY id DESC LIMIT 3`).all(seen, req.user.id) : [];
  res.json({ count, latest });
});

// 打开论坛页即视为已看过当前全部问题
router.post('/seen', (req, res) => {
  const maxId = db.prepare('SELECT MAX(id) AS m FROM forum_topics').get().m || 0;
  db.prepare('UPDATE users SET forum_seen_id = ? WHERE id = ? AND COALESCE(forum_seen_id, 0) < ?').run(maxId, req.user.id, maxId);
  res.json({ ok: true });
});

router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;
  const conds = [];
  const args = [];
  if (q) {
    // 标题 / 问题描述 / 评论内容任一命中即返回
    conds.push('(t.title LIKE ? OR t.content LIKE ? OR t.id IN (SELECT topic_id FROM forum_comments WHERE content LIKE ?))');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT t.id, t.user_id, t.title, t.content, t.comment_count, t.admin_replied, t.created_at, t.updated_at,
           u.username, u.display_name, u.is_admin AS author_is_admin
    FROM forum_topics t JOIN users u ON u.id = t.user_id
    ${where}
    ORDER BY t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?
  `).all(...args, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM forum_topics t ${where}`).get(...args).c;
  res.json({
    rows: rows.map(r => ({
      id: r.id, title: r.title, content: r.content, comment_count: r.comment_count,
      admin_replied: r.admin_replied, created_at: r.created_at, updated_at: r.updated_at,
      author: authorName(r, req.user), author_is_admin: !!r.author_is_admin,
    })),
    total,
  });
});

router.get('/:id', (req, res) => {
  const t = db.prepare(`
    SELECT t.*, u.username, u.display_name, u.is_admin AS author_is_admin
    FROM forum_topics t JOIN users u ON u.id = t.user_id WHERE t.id = ?
  `).get(req.params.id);
  if (!t) return res.status(404).json({ error: '问题不存在' });
  // 管理员解答置顶，其余按时间先后
  const comments = db.prepare(`
    SELECT c.id, c.user_id, c.is_admin, c.content, c.created_at,
           u.username, u.display_name, c.is_admin AS author_is_admin
    FROM forum_comments c JOIN users u ON u.id = c.user_id
    WHERE c.topic_id = ?
    ORDER BY c.is_admin DESC, c.created_at ASC, c.id ASC
  `).all(t.id);
  const attachments = db.prepare('SELECT id, comment_id, original_name, mimetype, size FROM forum_attachments WHERE topic_id = ?').all(t.id);
  res.json({
    id: t.id, title: t.title, content: t.content, created_at: t.created_at,
    author: authorName(t, req.user), author_is_admin: !!t.author_is_admin,
    comments: comments.map(c => ({
      id: c.id, is_admin: !!c.is_admin, content: c.content, created_at: c.created_at,
      author: authorName(c, req.user),
    })),
    attachments,
  });
});

router.post('/', uploadFiles, (req, res) => {
  const title = String(req.body?.title || '').trim();
  const content = String(req.body?.content || '').trim();
  if (!title) { removeFiles(req.files); return res.status(400).json({ error: '请填写问题标题' }); }
  if (title.length > 200) { removeFiles(req.files); return res.status(400).json({ error: '标题不能超过 200 字' }); }
  const tx = db.transaction(() => {
    const id = db.prepare('INSERT INTO forum_topics (user_id, title, content) VALUES (?, ?, ?)').run(req.user.id, title, content).lastInsertRowid;
    const ins = db.prepare('INSERT INTO forum_attachments (topic_id, filename, original_name, mimetype, size) VALUES (?, ?, ?, ?, ?)');
    for (const f of req.files || []) ins.run(id, f.filename, decodeName(f), ALLOWED_EXT[path.extname(f.filename)], f.size);
    return id;
  });
  res.json({ ok: true, id: tx() });
});

router.post('/:id/comments', uploadFiles, (req, res) => {
  const t = db.prepare('SELECT id FROM forum_topics WHERE id = ?').get(req.params.id);
  if (!t) { removeFiles(req.files); return res.status(404).json({ error: '问题不存在' }); }
  const content = String(req.body?.content || '').trim();
  const files = req.files || [];
  if (!content && files.length === 0) return res.status(400).json({ error: '请填写评论或添加附件' });
  const isAdmin = req.user.is_admin ? 1 : 0;
  const tx = db.transaction(() => {
    const cid = db.prepare('INSERT INTO forum_comments (topic_id, user_id, is_admin, content) VALUES (?, ?, ?, ?)').run(t.id, req.user.id, isAdmin, content).lastInsertRowid;
    const ins = db.prepare('INSERT INTO forum_attachments (topic_id, comment_id, filename, original_name, mimetype, size) VALUES (?, ?, ?, ?, ?, ?)');
    for (const f of files) ins.run(t.id, cid, f.filename, decodeName(f), ALLOWED_EXT[path.extname(f.filename)], f.size);
    db.prepare(`
      UPDATE forum_topics SET comment_count = comment_count + 1,
        admin_replied = MAX(admin_replied, ?), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(isAdmin, t.id);
  });
  tx();
  res.json({ ok: true });
});

router.get('/attachments/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM forum_attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).end();
  const type = ALLOWED_EXT[path.extname(a.filename)] || 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${type.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.original_name || a.filename)}`);
  res.sendFile(path.join(UPLOAD_DIR, a.filename));
});

// 删除：仅管理员（论坛内容管理）
function deleteAttachments(rows) {
  for (const a of rows) fs.unlink(path.join(UPLOAD_DIR, a.filename), () => {});
}

router.delete('/:id', (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: '需要管理员权限' });
  const t = db.prepare('SELECT id FROM forum_topics WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '问题不存在' });
  const atts = db.prepare('SELECT filename FROM forum_attachments WHERE topic_id = ?').all(t.id);
  db.transaction(() => {
    db.prepare('DELETE FROM forum_attachments WHERE topic_id = ?').run(t.id);
    db.prepare('DELETE FROM forum_comments WHERE topic_id = ?').run(t.id);
    db.prepare('DELETE FROM forum_topics WHERE id = ?').run(t.id);
  })();
  deleteAttachments(atts);
  res.json({ ok: true });
});

router.delete('/comments/:cid', (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: '需要管理员权限' });
  const c = db.prepare('SELECT id, topic_id FROM forum_comments WHERE id = ?').get(req.params.cid);
  if (!c) return res.status(404).json({ error: '评论不存在' });
  const atts = db.prepare('SELECT filename FROM forum_attachments WHERE comment_id = ?').all(c.id);
  db.transaction(() => {
    db.prepare('DELETE FROM forum_attachments WHERE comment_id = ?').run(c.id);
    db.prepare('DELETE FROM forum_comments WHERE id = ?').run(c.id);
    // 重算快照列
    db.prepare(`
      UPDATE forum_topics SET
        comment_count = (SELECT COUNT(*) FROM forum_comments WHERE topic_id = ?),
        admin_replied = EXISTS(SELECT 1 FROM forum_comments WHERE topic_id = ? AND is_admin = 1)
      WHERE id = ?
    `).run(c.topic_id, c.topic_id, c.topic_id);
  })();
  deleteAttachments(atts);
  res.json({ ok: true });
});

module.exports = router;
