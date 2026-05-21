import { useEffect, useState } from 'react';
import api from '../../api';

const statusLabel = { running: '导出中', done: '已完成', failed: '失败' };
const statusColor = {
  running: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export default function AdminProductsExport() {
  const [jobs, setJobs] = useState([]);
  const [starting, setStarting] = useState(false);

  const load = () => api.get('/admin/exports').then(r => setJobs(r.data.jobs || []));

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const start = async () => {
    if (!confirm('全量导出 DropXL 商品需要约 19 分钟（55 万条 / 限速 1 次/秒）。\n开始后可关闭页面，跑完会保留 7 天可下载。确定开始？')) return;
    setStarting(true);
    try {
      await api.post('/admin/exports/products');
      load();
    } catch (e) {
      alert(e.response?.data?.error || '启动失败');
    } finally {
      setStarting(false);
    }
  };

  const download = async (jobId) => {
    try {
      const r = await api.get(`/admin/exports/${jobId}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const link = document.createElement('a');
      link.href = url;
      const job = jobs.find(j => j.jobId === jobId);
      link.download = job?.fileName || 'export.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('下载失败：' + (e.response?.data?.error || e.message));
    }
  };

  const running = jobs.find(j => j.status === 'running');

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">📦 DropXL 商品全量导出</h1>
        <button
          onClick={start}
          disabled={starting || !!running}
          className="btn btn-success"
        >
          {starting ? '启动中...' : running ? '已有任务运行中' : '🚀 开始导出'}
        </button>
      </div>

      <div className="bg-blue-50 border border-blue-200 text-blue-700 rounded p-3 text-sm">
        ℹ️ 全量导出会循环调用 DropXL 列表接口（每秒 1 次 / 每页 500 条，约 1112 页），<b>需要约 19 分钟</b>。<br />
        导出过程在后台运行，<b>关闭页面不影响</b>，回来刷新即可查看进度。导出完成的文件保留 7 天，过期自动清理。
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">任务 ID</th>
              <th className="px-3 py-2 text-left">发起人</th>
              <th className="px-3 py-2 text-left">开始时间</th>
              <th className="px-3 py-2 text-left">完成时间</th>
              <th className="px-3 py-2 text-left">进度</th>
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-left">文件</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map(j => {
              const pct = j.progress?.total
                ? Math.min(100, Math.round((j.progress.fetched / j.progress.total) * 100))
                : 0;
              return (
                <tr key={j.jobId} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-xs">{j.jobId}</td>
                  <td className="px-3 py-2">{j.startedBy || '-'}</td>
                  <td className="px-3 py-2 text-xs">{j.startedAt?.replace('T', ' ').slice(0, 19)}</td>
                  <td className="px-3 py-2 text-xs">{j.finishedAt?.replace('T', ' ').slice(0, 19) || '-'}</td>
                  <td className="px-3 py-2">
                    <div className="text-xs mb-1">{j.progress?.fetched || 0} / {j.progress?.total ?? '?'}</div>
                    <div className="w-32 h-2 bg-gray-200 rounded overflow-hidden">
                      <div
                        className={`h-full transition-all ${j.status === 'done' ? 'bg-green-500' : j.status === 'failed' ? 'bg-red-500' : 'bg-blue-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`badge ${statusColor[j.status]}`}>{statusLabel[j.status]}</span>
                    {j.status === 'failed' && j.error && (
                      <div className="text-xs text-red-600 mt-1 max-w-xs truncate" title={j.error}>{j.error}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{j.fileName || '-'}</td>
                  <td className="px-3 py-2 text-right">
                    {j.status === 'done' && (
                      <button onClick={() => download(j.jobId)} className="text-blue-600 hover:underline text-xs">
                        ⬇️ 下载
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {jobs.length === 0 && (
              <tr><td colSpan={8} className="p-6 text-center text-gray-400">还没有导出任务，点右上角"开始导出"</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
