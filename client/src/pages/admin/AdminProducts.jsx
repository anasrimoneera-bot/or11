import { useEffect, useRef, useState } from 'react';
import api from '../../api';
import { bgUpload } from '../../lib/bgUpload.js';

const COUNTRIES = ['美国', '英国', '德国', '法国', '荷兰', '意大利', '西班牙', '波兰'];
const PAGE_SIZE = 50;

export default function AdminProducts() {
  const [status, setStatus] = useState([]);
  const [markup, setMarkup] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [activeCountry, setActiveCountry] = useState('美国');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ q: '', min_price: '', max_price: '', stock_filter: 'all' });
  const [page, setPage] = useState(0);

  const [masterStatus, setMasterStatus] = useState([]);
  const loadStatus = () => api.get('/admin/products/inventory-status').then(r => setStatus(r.data));
  const loadMarkup = () => api.get('/admin/products/country-markup').then(r => setMarkup(r.data));
  const loadAccounts = () => api.get('/admin/products/dropxl-accounts').then(r => setAccounts(r.data));
  const loadMasterStatus = () => api.get('/admin/products/master-status').then(r => setMasterStatus(r.data));
  const loadProducts = () => {
    setLoading(true);
    const params = { country: activeCountry, limit: PAGE_SIZE, offset: page * PAGE_SIZE, ...filters };
    Object.keys(params).forEach(k => { if (params[k] === '') delete params[k]; });
    api.get('/admin/products', { params })
      .then(r => { setRows(r.data.rows); setTotal(r.data.total); })
      .catch(() => { setRows([]); setTotal(0); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadStatus(); loadMarkup(); loadAccounts(); loadMasterStatus(); }, []);
  // 任一国家正在 API 同步或总表导入时，每 3 秒刷新一次状态卡片
  const anySyncing = status.some(s => s.api_sync_status === 'running' || s.api_sync_status === 'pending');
  const anyImporting = masterStatus.some(s => s.import_status === 'parsing' || s.import_status === 'writing');
  useEffect(() => {
    if (!anySyncing && !anyImporting) return;
    const t = setInterval(() => {
      if (anySyncing) loadStatus();
      if (anyImporting) loadMasterStatus();
    }, 3000);
    return () => clearInterval(t);
  }, [anySyncing, anyImporting]);
  useEffect(() => { setPage(0); /* eslint-disable-next-line */ }, [activeCountry]);
  useEffect(() => { loadProducts(); /* eslint-disable-next-line */ }, [activeCountry, page]);

  const applyFilters = () => { setPage(0); loadProducts(); };
  const resetFilters = () => {
    setFilters({ q: '', min_price: '', max_price: '', stock_filter: 'all' });
    setPage(0);
    setTimeout(loadProducts, 0);
  };
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeStatus = status.find(s => s.country === activeCountry);
  const activeMarkup = markup.find(m => m.country === activeCountry);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">📦 商品库存价格管理</h1>
          <p className="text-gray-500 text-sm mt-1">
            按国家上传供应商库存 xlsx（SKU/B2B 价/库存）。仅店主可见原价 + 加价比例；
            分销商"下载支持"页拿到的是加价后的 B2B 价。
          </p>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded p-3">
        ℹ️ 每个国家供应商独立账户独立 API token，已配置凭据的国家可点 "🔄 API 同步" 自动拉取；
        未配置或想全量替换的国家可手动上传 xlsx。在 <b>系统设置 → 供应商多国账户</b> 维护各国凭据。
      </div>

      <MasterUploadGrid masterStatus={masterStatus} onChange={() => { loadMasterStatus(); loadProducts(); }} />

      <CountryUploadGrid
        status={status}
        accounts={accounts}
        masterStatus={masterStatus}
        onChange={() => { loadStatus(); loadProducts(); }}
        activeCountry={activeCountry}
        setActiveCountry={setActiveCountry}
      />

      <CountryMarkupCard markup={markup} onChange={loadMarkup} />

      <div className="bg-white rounded-xl shadow border">
        <div className="border-b p-4 flex items-end gap-3 flex-wrap">
          <div className="text-sm">
            <div className="text-xs text-gray-500">当前国家</div>
            <div className="font-semibold text-lg">{activeCountry}</div>
            {activeStatus?.uploaded_at && (
              <div className="text-xs text-gray-500">
                共 {activeStatus.db_total} 行，有库存 {activeStatus.db_in_stock}
                ，最近更新 {new Date(activeStatus.uploaded_at).toLocaleString()}
                {activeMarkup && <> · 加价 <b>{activeMarkup.markup_pct}%</b></>}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs text-gray-500 block">SKU 搜索</label>
            <input className="field" value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} placeholder="如 110075" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block">最低价 USD</label>
            <input type="number" className="field w-24" value={filters.min_price} onChange={e => setFilters({ ...filters, min_price: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block">最高价 USD</label>
            <input type="number" className="field w-24" value={filters.max_price} onChange={e => setFilters({ ...filters, max_price: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block">库存状态</label>
            <select className="field" value={filters.stock_filter} onChange={e => setFilters({ ...filters, stock_filter: e.target.value })}>
              <option value="all">全部</option>
              <option value="in_stock">有库存</option>
              <option value="out_of_stock">无库存</option>
            </select>
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
                <th className="px-3 py-2 text-left w-20">图片</th>
                <th className="px-3 py-2 text-left">SKU (product_code)</th>
                <th className="px-3 py-2 text-right">B2B 价 (USD)</th>
                <th className="px-3 py-2 text-right">加价后 (USD)</th>
                <th className="px-3 py-2 text-right">库存</th>
                <th className="px-3 py-2 text-left">上传时间</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="p-6 text-center text-gray-400">加载中...</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-gray-400">
                  {activeStatus?.uploaded_at == null
                    ? `${activeCountry} 还未同步/上传库存，请在上方点击"API 同步"或"上传 xlsx"`
                    : '当前筛选条件无匹配商品'}
                </td></tr>
              )}
              {!loading && rows.map(r => {
                const markupPct = activeMarkup?.markup_pct ?? 0;
                const display = r.b2b_price * (1 + markupPct / 100);
                return (
                  <tr key={r.code} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2">
                      {r.image_url
                        ? <img src={r.image_url} alt="" className="w-14 h-14 object-cover rounded bg-gray-100 border" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} />
                        : <div className="w-14 h-14 rounded bg-gray-100 border flex items-center justify-center text-gray-300 text-xl">📦</div>}
                    </td>
                    <td className="px-3 py-2 font-mono">{r.code}</td>
                    <td className="px-3 py-2 text-right">${r.b2b_price.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-green-700">${display.toFixed(2)}</td>
                    <td className={`px-3 py-2 text-right ${r.stock === 0 ? 'text-gray-400' : ''}`}>{r.stock}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{r.uploaded_at ? new Date(r.uploaded_at).toLocaleString() : '—'}</td>
                  </tr>
                );
              })}
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
    </div>
  );
}

function MasterUploadGrid({ masterStatus, onChange }) {
  return (
    <div className="bg-white rounded-xl shadow border">
      <div className="border-b px-4 py-3 font-medium">
        📑 各国销售总表（SKU 白名单 + 主图）
        <span className="text-xs text-gray-500 font-normal ml-2">
          上传后：商品库存管理只显示总表里的 SKU；总表 A 列 Image 1 作为主图源
        </span>
      </div>
      <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        {COUNTRIES.map(c => {
          const s = masterStatus.find(x => x.country === c);
          return <MasterCard key={c} country={c} status={s} onChange={onChange} />;
        })}
      </div>
    </div>
  );
}

function MasterCard({ country, status, onChange }) {
  const fileRef = useRef(null);
  const [, force] = useState(0);
  // 跨页订阅 bgUpload，让 nav 切换不影响"上传中"指示
  useEffect(() => bgUpload.subscribe(() => force(n => n + 1)), []);
  const xhrUploading = bgUpload.isActive(`master:${country}`);
  // 服务端导入进度（即使前端刷新也能读到）
  const importStatus = status?.import_status;
  const importing = importStatus === 'parsing' || importStatus === 'writing';
  const failed = importStatus === 'failed';
  const busy = xhrUploading || importing;

  const onPick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    if (!confirm(`确认用 "${file.name}" (${sizeMB}MB) 替换 ${country} 总表？\n原有总表会被全量覆盖；不在新总表里的 SKU 将不再显示。\n上传后会在后台导入，切换页面不会中断；刷新浏览器会中断 body 上传阶段。`)) {
      e.target.value = ''; return;
    }
    const fd = new FormData();
    fd.append('file', file);
    // fire-and-forget；bgUpload 跟踪 XHR；handler 完成后异步导入由 /master-status 轮询展示
    const promise = api.post(`/admin/products/master-upload/${encodeURIComponent(country)}`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 0,   // 大文件不设超时
    }).then(() => {
      // 上传 body 完成；后端进入异步导入，触发一次 status 刷新接住进度
      onChange();
    }).catch(err => {
      alert(`${country} 总表上传失败：${err.response?.data?.error || err.message}`);
    });
    bgUpload.start(`master:${country}`, promise, `${country} 总表 (${sizeMB}MB)`);
    if (fileRef.current) fileRef.current.value = '';
  };
  const download = async () => {
    try {
      const r = await api.get(`/admin/products/master-file/${encodeURIComponent(country)}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = status?.original_filename || `${country}-master.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.error || '下载失败');
    }
  };
  return (
    <div className={`rounded-lg border p-3 ${status?.available ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-200'}`}>
      <div className="flex justify-between items-center">
        <div className="font-medium text-sm">📑 {country}</div>
        {status?.available && (
          <span onClick={download} className="text-xs text-blue-600 hover:underline cursor-pointer" title="下载源文件">⬇️</span>
        )}
      </div>
      <div className="text-xs text-gray-500 mt-1 min-h-[28px]">
        {status?.available ? (
          <>
            <div>{status.rows_count} 条 SKU</div>
            <div>更新 {new Date(status.uploaded_at).toLocaleDateString()}</div>
          </>
        ) : (
          <div className="text-gray-400">尚未上传</div>
        )}
        {xhrUploading && <div className="text-blue-600 mt-0.5">⬆️ 上传中（可切换页面）</div>}
        {importStatus === 'parsing' && <div className="text-blue-600 mt-0.5">⏳ 解析中…</div>}
        {importStatus === 'writing' && <div className="text-blue-600 mt-0.5">⏳ 已写入 {status.import_rows || 0}</div>}
        {failed && <div className="text-red-600 mt-0.5" title={status.import_error}>✗ 导入失败</div>}
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onPick} />
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="btn btn-primary text-xs justify-center py-1 w-full mt-2 disabled:opacity-50"
      >
        {xhrUploading ? '上传中…' : importing ? '导入中…' : status?.available ? '🔄 替换总表' : '📤 上传总表'}
      </button>
    </div>
  );
}

function CountryUploadGrid({ status, accounts, masterStatus, onChange, activeCountry, setActiveCountry }) {
  return (
    <div className="bg-white rounded-xl shadow border">
      <div className="border-b px-4 py-3 font-medium">
        🗂️ 各国库存文件
        <span className="text-xs text-gray-500 font-normal ml-2">每个国家上传一次即覆盖该国全量库存，分销商立即可下载</span>
      </div>
      <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        {COUNTRIES.map(c => {
          const s = status.find(x => x.country === c);
          const acc = accounts.find(x => x.country === c);
          return (
            <CountryUploadCard
              key={c}
              country={c}
              status={s}
              account={acc}
              active={c === activeCountry}
              onClick={() => setActiveCountry(c)}
              onUploaded={onChange}
            />
          );
        })}
      </div>
    </div>
  );
}

function CountryUploadCard({ country, status, account, active, onClick, onUploaded }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const hasCreds = !!(account?.has_token && account?.enabled);
  const syncing = status?.api_sync_status === 'running' || status?.api_sync_status === 'pending';
  const syncProgress = status?.api_sync_progress;

  const apiSync = async (e) => {
    e.stopPropagation();
    if (!confirm(`确认从供应商接口同步 ${country} 全量商品？\n会用 ${country} 账户的 API token 拉取，覆盖该国现有库存数据。\n按供应商限速 1 秒/请求，55 万条约耗时 15-20 分钟。`)) return;
    try {
      await api.post(`/admin/products/sync-country/${encodeURIComponent(country)}`);
      onUploaded();
    } catch (err) {
      alert(err.response?.data?.error || '启动失败');
    }
  };

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm(`确认用 "${file.name}" 替换 ${country} 的库存数据？\n注意：原有该国库存会被全量覆盖。`)) {
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post(`/admin/products/inventory-upload/${encodeURIComponent(country)}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      alert(`${country} 库存已更新：共 ${r.data.rows} 行（有库存 ${r.data.in_stock}）`);
      onUploaded();
    } catch (err) {
      alert(err.response?.data?.error || '上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const downloadSource = async (e) => {
    e.stopPropagation();
    try {
      const r = await api.get(`/admin/products/inventory-file/${encodeURIComponent(country)}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = status?.original_filename || `${country}-inventory.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      let msg = '下载失败';
      if (err.response?.data instanceof Blob) {
        try { msg = JSON.parse(await err.response.data.text()).error || msg; } catch {}
      }
      alert(msg);
    }
  };

  return (
    <div
      onClick={onClick}
      className={`rounded-lg border p-3 cursor-pointer transition ${
        active ? 'border-orange-400 bg-orange-50' : 'border-gray-200 hover:border-blue-300'
      }`}
    >
      <div className="flex justify-between items-center">
        <div className="font-medium">🌐 {country}</div>
        {status?.source === 'upload' && status?.uploaded_at && (
          <span
            onClick={downloadSource}
            className="text-xs text-blue-600 hover:underline"
            title="下载上次上传的源文件"
          >⬇️ 源文件</span>
        )}
      </div>
      <div className="text-xs text-gray-500 mt-1 min-h-[40px]">
        {status?.uploaded_at ? (
          <>
            <div>{status.rows_count} 行 · 有库存 {status.in_stock_count}</div>
            <div>更新 {new Date(status.uploaded_at).toLocaleDateString()}</div>
          </>
        ) : (
          <div className="text-gray-400">{hasCreds ? '尚未同步' : '尚未配置 API 凭据'}</div>
        )}
        {syncing && (
          <div className="text-blue-600 mt-0.5">⏳ 已抓取 {syncProgress?.fetched || 0}{syncProgress?.total ? ` / ${syncProgress.total}` : ''}</div>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1">
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onPick} />
        <button
          type="button"
          disabled={uploading || syncing || !hasCreds}
          onClick={apiSync}
          className="btn btn-success text-xs justify-center py-1 disabled:opacity-40"
          title={hasCreds ? `用 ${country} 账户拉取商品库存` : `请在「系统设置 → 供应商多国账户」配置 ${country} 凭据`}
        >
          {syncing ? '⏳ 同步中' : '🔄 API同步'}
        </button>
        <button
          type="button"
          disabled={uploading || syncing}
          onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
          className="btn btn-ghost border text-xs justify-center py-1"
        >
          {uploading ? '上传中' : '📤 xlsx'}
        </button>
      </div>
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
          分销商批量采购时：B2B 原价 × (1 + 该国家加价%) 即为展示采购价
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
