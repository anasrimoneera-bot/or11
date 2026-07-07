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

// 启动时清理上次失败/中断上传残留的临时文件（installer.exe.tmp-*）。
// 进程启动时不可能有正在进行的上传，残留的都是废文件；不清会长期堆积吃满磁盘，
// 反过来导致后续上传写盘失败(ENOSPC) → 500。
(function cleanStaleTemps() {
  try {
    for (const f of fs.readdirSync(TOOLS_DIR)) {
      if (f.startsWith('installer.exe.tmp-')) {
        try { fs.unlinkSync(path.join(TOOLS_DIR, f)); } catch {}
      }
    }
  } catch {}
})();

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
const uploadSingle = upload.single('file');
router.post('/installer/upload', authRequired, ownerRequired, (req, res) => {
  // 手动跑 multer，把它的报错翻成明确中文（超限/磁盘满），并清掉写了半截的临时文件；
  // 否则这些错误会落到全局 handler 只回 err.message，前端看不懂。
  uploadSingle(req, res, (err) => {
    if (err) {
      if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch {} }
      let msg = err.message || '上传失败';
      if (err.code === 'LIMIT_FILE_SIZE') msg = '文件超过 500MB 上限';
      else if (err.code === 'ENOSPC') msg = '服务器磁盘空间不足，无法保存安装包';
      return res.status(400).json({ error: msg });
    }
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
      const msg = e.code === 'ENOSPC' ? '服务器磁盘空间不足，无法保存安装包' : ('保存失败: ' + e.message);
      return res.status(500).json({ error: msg });
    }
    res.json({ ok: true });
  });
});

module.exports = router;
