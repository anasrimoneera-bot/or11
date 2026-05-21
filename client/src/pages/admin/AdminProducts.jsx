import { useEffect, useRef, useState } from 'react';
import api from '../../api';

export default function AdminProducts() {
  const [syncJob, setSyncJob] = useState(null);
  const [syncJobs, setSyncJobs] = useState([]);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [markup, setMarkup] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ q: '', country: '', min_price: '', max_price: '', min_quantity: '' });
  const [page, setPage] = useState(0);
  const pollRef = useRef(null);
  const PAGE_SIZE = 50;

  const loadMarkup = () => api.get('/admin/products/country-markup').then(r => setMarkup(r.data));
  const loadJobs = () => api.get('/admin/products/sync').then(r => {
    setSyncJobs(r.data.jobs);
    const running = r.data.jobs.find(j => j.status === 'running');
    setSyncJob(running || null);
  });
  const loadProducts = () => {
    setLoading(true);
    const params = { ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
    Object.keys(params).forEach(k => { if (params[k] === '') delete params[k]; });
    api.get('/admin/products', { params })
      .then(r => { setRows(r.data.rows); setTotal(r.data.total); setLastSyncAt(r.data.last_synced_at); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadMarkup(); loadJobs(); }, []);
  useEffect(() => { loadProducts(); /* eslint-disable-next-line */ }, [page]);

  // 同步任务运行时轮询进度
  useEffect(() => {
    if (syncJob && syncJob.status === 'running') {
      pollRef.current = setInterval(() => {
        api.get(`/admin/products/sync/${syncJob.syncId}`).then(r => {
          setSyncJob(r.data);
          if (r.data.status !== 'running') {
            clearInterval(pollRef.current);
            loadJobs();
            loadProducts();
          }
        });
      }, 2000);
      return () => clearInterval(pollRef.current);
    }
  }, [syncJob?.syncId, syncJob?.status]);

  const startSync = async () => {
    if (!confirm('确认从 DropXL 拉取全量商品库存？流程大约需要 15-20 分钟，会自动剔除无库存商品。')) return;
    try {
      const r = await api.post('/admin/products/sync');
      loadJobs();
      setSyncJob({ syncId: r.data.syncId, status: 'running', progress: { fetched: 0, total: null } });
    } catch (e) {
      alert(e.response?.data?.error || '启动失败');
    }
  };

  const applyFilters = () => { setPage(0); loadProducts(); };
  const resetFilters = () => {
    setFilters({ q: '', country: '', min_price: '', max_price: '', min_quantity: '' });
    setPage(0);
    setTimeout(loadProducts, 0);
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">📦 商品库存价格管理</h1>
          <p className="text-gray-500 text-sm mt-1">
            从 DropXL 同步全量商品库（仅保留有库存的商品），并按国家维护加价百分比。
            {lastSyncAt && <> 上次同步：<b>{new Date(lastSyncAt).toLocaleString()}</b></>}
          </p>
        </div>
        <button onClick={startSync} disabled={syncJob?.status === 'running'} className="btn btn-success">
          {syncJob?.status === 'running' ? '同步中...' : '🔄 开始同步'}
        </button>
      </div>

      {syncJob && (
        <SyncStatusCard job={syncJob} />
      )}

      <CountryMarkupCard markup={markup} onChange={loadMarkup} />

      <div className="bg-white rounded-xl shadow border">
        <div className="border-b p-4 flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-xs text-gray-500 block">关键词（code / name）</label>
            <input className="field" value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} placeholder="搜索..." />
          </div>
          <div>
            <label className="text-xs text-gray-500 block">国家</label>
            <select className="field" value={filters.country} onChange={e => setFilters({ ...filters, country: e.target.value })}>
              <option value="">全部</option>
              {markup.map(m => <option key={m.country} value={m.country}>{m.country}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block">最低价 (USD)</label>
            <input type="number" className="field w-24" value={filters.min_price} onChange={e => setFilters({ ...filters, min_price: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block">最高价 (USD)</label>
            <input type="number" className="field w-24" value={filters.max_price} onChange={e => setFilters({ ...filters, max_price: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block">最低库存</label>
            <input type="number" className="field w-24" value={filters.min_quantity} onChange={e => setFilters({ ...filters, min_quantity: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <button onClick={applyFilters} className="btn btn-primary">筛选</button>
            <button onClick={resetFilters} className="btn btn-ghost border">重置</button>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">product_code</th>
                <th className="px-3 py-2 text-left">名称</th>
                <th className="px-3 py-2 text-left">分类</th>
                <th className="px-3 py-2 text-right">库存</th>
                <th className="px-3 py-2 text-right">单价</th>
                <th className="px-3 py-2 text-left">国家</th>
                <th className="px-3 py-2 text-left">DropXL 更新时间</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="p-6 text-center text-gray-400">加载中...</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-gray-400">
                  {total === 0 && lastSyncAt == null
                    ? '商品库为空，点击右上角"开始同步"从 DropXL 拉取数据'
                    : '当前筛选条件无匹配商品'}
                </td></tr>
              )}
              {!loading && rows.map(r => (
                <tr key={r.code} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono">{r.code}</td>
                  <td className="px-3 py-2 max-w-md truncate" title={r.name}>{r.name}</td>
                  <td className="px-3 py-2 text-xs text-gray-500 max-w-xs truncate" title={r.category_path}>{r.category_path}</td>
                  <td className="px-3 py-2 text-right">{r.quantity}</td>
                  <td className="px-3 py-2 text-right">{(r.currency || '$')} {Number(r.price).toFixed(2)}</td>
                  <td className="px-3 py-2 text-gray-400">{r.country || '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-400">{r.dropxl_updated_at || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="border-t p-3 flex items-center justify-between text-sm text-gray-500">
            <div>共 {total} 条，第 {page + 1} / {pageCount} 页</div>
            <div className="flex gap-2">
              <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))} className="btn btn-ghost border">上一页</button>
              <button disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)} className="btn btn-ghost border">下一页</button>
            </div>
          </div>
        )}
      </div>

      {syncJobs.length > 0 && (
        <div className="bg-white rounded-xl shadow border">
          <div className="border-b px-4 py-2 font-medium">最近同步记录</div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">开始时间</th>
                <th className="px-3 py-2 text-left">完成时间</th>
                <th className="px-3 py-2 text-left">发起人</th>
                <th className="px-3 py-2 text-right">入库</th>
                <th className="px-3 py-2 text-right">跳过(无库存)</th>
                <th className="px-3 py-2 text-right">删除旧记录</th>
                <th className="px-3 py-2 text-left">状态</th>
              </tr>
            </thead>
            <tbody>
              {syncJobs.map(j => (
                <tr key={j.syncId} className="border-t">
                  <td className="px-3 py-2 text-xs">{new Date(j.startedAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs">{j.finishedAt ? new Date(j.finishedAt).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2">{j.startedBy}</td>
                  <td className="px-3 py-2 text-right">{j.upserted}</td>
                  <td className="px-3 py-2 text-right text-gray-400">{j.skippedNoStock}</td>
                  <td className="px-3 py-2 text-right text-gray-400">{j.deleted || '—'}</td>
                  <td className="px-3 py-2">
                    {j.status === 'done' && <span className="badge bg-green-100 text-green-700">完成</span>}
                    {j.status === 'running' && <span className="badge bg-blue-100 text-blue-700">运行中</span>}
                    {j.status === 'failed' && <span className="badge bg-red-100 text-red-700" title={j.error}>失败</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SyncStatusCard({ job }) {
  const pct = job.progress?.total > 0 ? (job.fetched / job.progress.total * 100) : null;
  return (
    <div className={`rounded-xl border p-4 ${job.status === 'failed' ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
      <div className="flex items-center justify-between">
        <div className="font-medium">
          {job.status === 'running' && `🔄 同步进行中：已抓取 ${job.fetched}${job.progress?.total ? ` / ${job.progress.total}` : ''} 条`}
          {job.status === 'done' && `✅ 同步完成：入库 ${job.upserted} 条 / 跳过无库存 ${job.skippedNoStock} 条 / 删除旧记录 ${job.deleted} 条`}
          {job.status === 'failed' && `❌ 同步失败：${job.error}`}
        </div>
        <div className="text-xs text-gray-500">
          {pct != null && `${pct.toFixed(1)}%`}
        </div>
      </div>
      {pct != null && job.status === 'running' && (
        <div className="mt-2 h-1.5 bg-blue-100 rounded overflow-hidden">
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function CountryMarkupCard({ markup, onChange }) {
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(null);

  const save = async (country) => {
    const v = edits[country];
    if (v === undefined) return;
    setSaving(country);
    try {
      await api.put(`/admin/products/country-markup/${encodeURIComponent(country)}`, { markup_pct: Number(v) });
      setEdits(prev => { const next = { ...prev }; delete next[country]; return next; });
      onChange();
    } catch (e) {
      alert(e.response?.data?.error || '保存失败');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow border">
      <div className="border-b px-4 py-3 font-medium">
        💰 按国家加价规则
        <span className="text-xs text-gray-500 font-normal ml-2">
          分销商批量采购时，DropXL 原价 × (1 + 该国家加价%) 即为展示采购价
        </span>
      </div>
      <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        {markup.map(m => {
          const dirty = edits[m.country] !== undefined;
          return (
            <div key={m.country} className="flex items-center gap-2">
              <span className="w-14 text-sm">{m.country}</span>
              <input
                type="number"
                step="1"
                className={`field flex-1 ${dirty ? 'border-orange-400 bg-orange-50' : ''}`}
                value={dirty ? edits[m.country] : m.markup_pct}
                onChange={e => setEdits({ ...edits, [m.country]: e.target.value })}
              />
              <span className="text-sm text-gray-500">%</span>
              {dirty && (
                <button onClick={() => save(m.country)} disabled={saving === m.country} className="btn btn-primary text-xs px-2 py-1">
                  {saving === m.country ? '...' : '保存'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
