import { useEffect, useRef, useState } from 'react';
import api from '../../api';

const COUNTRIES = ['美国', '英国', '德国', '法国', '荷兰', '意大利', '西班牙', '波兰'];
const PAGE_SIZE = 50;

export default function AdminProducts() {
  const [status, setStatus] = useState([]);
  const [markup, setMarkup] = useState([]);
  const [activeCountry, setActiveCountry] = useState('美国');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ q: '', min_price: '', max_price: '', stock_filter: 'all' });
  const [page, setPage] = useState(0);

  const loadStatus = () => api.get('/admin/products/inventory-status').then(r => setStatus(r.data));
  const loadMarkup = () => api.get('/admin/products/country-markup').then(r => setMarkup(r.data));
  const loadProducts = () => {
    setLoading(true);
    const params = { country: activeCountry, limit: PAGE_SIZE, offset: page * PAGE_SIZE, ...filters };
    Object.keys(params).forEach(k => { if (params[k] === '') delete params[k]; });
    api.get('/admin/products', { params })
      .then(r => { setRows(r.data.rows); setTotal(r.data.total); })
      .catch(() => { setRows([]); setTotal(0); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadStatus(); loadMarkup(); }, []);
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
            按国家上传 DropXL 库存 xlsx（SKU/B2B 价/库存）。仅店主可见原价 + 加价比例；
            分销商"下载支持"页拿到的是加价后的 B2B 价。
          </p>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded p-3">
        ℹ️ <b>说明</b>：DropXL 商品 API 不支持按国家筛选（返回全球 55 万条统一目录、统一库存），
        所以不能用 API 自动按国家同步。请在各国卡片上手动上传你从 DropXL 后台下载的对应国家 inventory xlsx 文件，
        每次上传会全量覆盖该国数据。
      </div>

      <CountryUploadGrid status={status} onChange={() => { loadStatus(); loadProducts(); }} activeCountry={activeCountry} setActiveCountry={setActiveCountry} />

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
                <th className="px-3 py-2 text-left w-16">图片</th>
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
                        ? <img src={r.image_url} alt="" className="w-12 h-12 object-cover rounded bg-gray-100" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} />
                        : <div className="w-12 h-12 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-lg">📦</div>}
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

function CountryUploadGrid({ status, onChange, activeCountry, setActiveCountry }) {
  return (
    <div className="bg-white rounded-xl shadow border">
      <div className="border-b px-4 py-3 font-medium">
        🗂️ 各国库存文件
        <span className="text-xs text-gray-500 font-normal ml-2">每个国家上传一次即覆盖该国全量库存，分销商立即可下载</span>
      </div>
      <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        {COUNTRIES.map(c => {
          const s = status.find(x => x.country === c);
          return (
            <CountryUploadCard
              key={c}
              country={c}
              status={s}
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

function CountryUploadCard({ country, status, active, onClick, onUploaded }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

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
      <div className="text-xs text-gray-500 mt-1 min-h-[32px]">
        {status?.uploaded_at ? (
          <>
            <div>{status.rows_count} 行 · 有库存 {status.in_stock_count}</div>
            <div>更新 {new Date(status.uploaded_at).toLocaleDateString()}</div>
          </>
        ) : (
          <div className="text-gray-400">尚未上传</div>
        )}
      </div>
      <div className="mt-2">
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onPick} />
        <button
          type="button"
          disabled={uploading}
          onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
          className="btn btn-success text-xs justify-center py-1 w-full"
        >
          {uploading ? '上传中...' : '📤 上传 xlsx'}
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
