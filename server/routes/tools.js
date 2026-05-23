const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { authRequired, ownerRequired } = require('../middleware/auth');

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

// 任何登录用户可下载
router.get('/installer', authRequired, (req, res) => {
  if (!fs.existsSync(FILE)) return res.status(404).json({ error: '尚未上传安装包' });
  const meta = readMeta() || {};
  const downloadName = meta.original_name || 'lanjing-installer.exe';
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}; filename="lanjing-installer.exe"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  fs.createReadStream(FILE).pipe(res);
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
    fs.writeFileSync(META, JSON.stringify({
      original_name: req.file.originalname,
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
