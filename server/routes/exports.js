const express = require('express');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const dropxl = require('../dropxl');
const { authRequired, adminRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired, adminRequired);

const EXPORT_DIR = path.join(__dirname, '..', '..', 'data', 'exports');
if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });

const jobs = new Map();
const JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function newJobId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function cleanupOldJobs() {
  const cutoff = Date.now() - JOB_RETENTION_MS;
  for (const [id, job] of jobs.entries()) {
    if (job.finishedAt && new Date(job.finishedAt).getTime() < cutoff) {
      if (job.filePath && fs.existsSync(job.filePath)) {
        try { fs.unlinkSync(job.filePath); } catch (e) {}
      }
      jobs.delete(id);
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runProductsExport(job) {
  const PAGE_SIZE = 500;
  const RATE_LIMIT_MS = 1100;
  const rows = [];
  let offset = 0;
  let total = null;

  try {
    while (true) {
      const data = await dropxl.listProducts({ limit: PAGE_SIZE, offset });
      const items = data?.data || [];
      if (data?.pagination?.total != null) total = data.pagination.total;
      for (const p of items) {
        rows.push({
          id: p.id,
          code: p.code,
          name: p.name,
          category_path: p.category_path,
          quantity: Number(p.quantity) || 0,
          price: Number(p.price) || 0,
          currency: p.currency,
          created_at: p.created_at,
          updated_at: p.updated_at,
        });
      }
      job.progress = { fetched: rows.length, total: total ?? rows.length };
      if (!items.length || items.length < PAGE_SIZE || (total != null && rows.length >= total)) break;
      offset += PAGE_SIZE;
      await sleep(RATE_LIMIT_MS);
    }

    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ['id', 'code', 'name', 'category_path', 'quantity', 'price', 'currency', 'created_at', 'updated_at'],
    });
    ws['!cols'] = [
      { wch: 8 }, { wch: 12 }, { wch: 60 }, { wch: 50 },
      { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 22 }, { wch: 22 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DropXL Products');
    XLSX.writeFile(wb, job.filePath);

    job.status = 'done';
    job.finishedAt = new Date().toISOString();
  } catch (e) {
    job.status = 'failed';
    job.error = e.message;
    job.finishedAt = new Date().toISOString();
  }
}

router.post('/products', (req, res) => {
  for (const j of jobs.values()) {
    if (j.type === 'products' && j.status === 'running') {
      return res.status(409).json({ error: '已有商品导出任务在运行中，请等待完成或刷新页面查看进度' });
    }
  }
  cleanupOldJobs();
  const jobId = newJobId();
  const fileName = `dropxl-products-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`;
  const job = {
    jobId,
    type: 'products',
    status: 'running',
    progress: { fetched: 0, total: null },
    fileName,
    filePath: path.join(EXPORT_DIR, fileName),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    startedBy: req.user.username,
  };
  jobs.set(jobId, job);
  runProductsExport(job);
  res.json({ jobId });
});

router.get('/', (req, res) => {
  const list = Array.from(jobs.values())
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 20)
    .map(j => ({ ...j, filePath: undefined }));
  res.json({ jobs: list });
});

router.get('/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: '任务不存在或已过期' });
  res.json({ ...job, filePath: undefined });
});

router.get('/:jobId/download', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: '任务不存在或已过期' });
  if (job.status !== 'done') return res.status(400).json({ error: '任务尚未完成' });
  if (!fs.existsSync(job.filePath)) return res.status(410).json({ error: '导出文件已被清理（超过 7 天）' });
  res.download(job.filePath, job.fileName);
});

module.exports = router;
