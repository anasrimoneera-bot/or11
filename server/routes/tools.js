const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { authRequired, authOrTicket, ownerRequired, signTicket } = require('../middleware/auth');

const router = express.Router();
const TOOLS_DIR = path.join(__dirname, '..', '..', 'data', 'tools');
if (!fs.existsSync(TOOLS_DIR)) fs.mkdirSync(TOOLS_DIR, { recursive: true });
const FILE = path.join(TOOLS_DIR, 'installer.exe');
const META = path.join(TOOLS_DIR, 'installer.meta.json');

function readMeta() {
  if (!fs.existsSync(META)) return null;
  try { return JSON.parse(fs.readFileSync(META, 'utf-8')); } catch { return null; }
}

// 任何登录用户可查询
router.get('/installer/status', authRequired, (req, res) => {
  if (!fs.existsSync(FILE)) return res.json({ available: false });
  const stat = fs.statSync(FILE);
  const meta = readMeta() || {};
  res.json({
    available: true,
    size: stat.size,
    uploaded_at: meta.uploaded_at || stat.mtime.toISOString(),
    uploaded_by: meta.uploaded_by || null,
    original_name: meta.original_name || 'lanjing-installer.exe',
  });
});

// 申请下载票据：让浏览器原生下载器直连下方 GET（带 Content-Length/Range，无需 axios 把 110MB 灌进 Blob）
router.post('/installer/ticket', authRequired, (req, res) => {
  if (!fs.existsSync(FILE)) return res.status(404).json({ error: '尚未上传安装包' });
  res.json({ ticket: signTicket('installer', { uid: req.user.id }, '60s') });
});

// 任何登录用户可下载；支持 Authorization 头 或 ?ticket=<jwt>（供浏览器原生下载使用）
router.get('/installer', authOrTicket('installer'), (req, res) => {
  if (!fs.existsSync(FILE)) return res.status(404).json({ error: '尚未上传安装包' });
  // 下载文件名固定为中文「蓝鲸工具安装EXE.exe」（通过 RFC 5987 filename* 携带），
  // 不再用上传时的原始文件名（busboy 老 bug 把 UTF-8 当 latin1 解，会导致乱码；
  // 即便上传侧已修复，统一文件名也避免不同上传者带来五花八门的命名）。
  const downloadName = '蓝鲸工具安装EXE.exe';
  // express 内部用 send：自动设置 Content-Length / Last-Modified，并响应 Range 请求（支持续传/分段）
  res.sendFile(FILE, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}; filename="lanjing-installer.exe"`,
      'Cache-Control': 'private, max-age=0',
    },
  });
});

// 仅店主可上传
const upload = multer({
  storage: multer.diskStorage({
    destination: TOOLS_DIR,
    filename: (req, file, cb) => cb(null, 'installer.exe.tmp-' + Date.now()),
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB 上限
});
router.post('/installer/upload', authRequired, ownerRequired, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择文件' });
  try {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
    fs.renameSync(req.file.path, FILE);
    // busboy 1.x 把 multipart filename 字节当 latin1 字符串解，导致中文名乱码；
    // 反向 latin1→utf8 还原（纯 ASCII 情况下是无损 round-trip）。
    const fixedName = Buffer.from(req.file.originalname || '', 'latin1').toString('utf8');
    fs.writeFileSync(META, JSON.stringify({
      original_name: fixedName,
      size: req.file.size,
      uploaded_by: req.user.username,
      uploaded_at: new Date().toISOString(),
    }));
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(500).json({ error: '保存失败: ' + e.message });
  }
  res.json({ ok: true });
});

module.exports = router;
