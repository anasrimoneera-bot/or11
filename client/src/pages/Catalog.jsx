import { useEffect, useState } from 'react';
import api from '../api';

// 产品展示：按国家浏览可售商品（名称 / 分类 / 主图 / 库存 / 采购价）。
// 价格为后端算好的采购价（已含加价），页面不涉及 B2B 原价。
const countries = [
  { name: '美国', code: 'US' }, { name: '英国', code: 'GB' }, { name: '德国', code: 'DE' }, { name: '法国', code: 'FR' },
  { name: '意大利', code: 'IT' }, { name: '荷兰', code: 'NL' }, { name: '西班牙', code: 'ES' }, { name: '波兰', code: 'PL' },
];
const currencySymbol = { 美国: '$', 英国: '£', 德国: '€', 法国: '€', 意大利: '€', 荷兰: '€', 西班牙: '€', 波兰: 'zł' };
const PAGE_SIZE = 24;

export default function Catalog() {
  const [country, setCountry] = useState('美国');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState(''); // 已提交的搜索词
  const [category, setCategory] = useState(null); // null = 全部
  const [inStock, setInStock] = useState(false);
  const [page, setPage] = useState(0);
  const [cats, setCats] = useState({ total: 0, categories: [] });
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/catalog/categories', { params: { country } }).then(r => setCats(r.data)).catch(() => setCats({ total: 0, categories: [] }));
  }, [country]);

  useEffect(() => {
    setLoading(true);
    const params = { country, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
    if (query) params.q = query;
    if (category !== null) params.category = category;
    if (inStock) params.in_stock = '1';
    api.get('/catalog', { params })
      .then(r => setData(r.data))
      .catch(() => setData({ rows: [], total: 0 }))
      .finally(() => setLoading(false));
  }, [country, query, category, inStock, page]);

  const sym = currencySymbol[country] || '$';
  const code = countries.find(c => c.name === country)?.code;
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const pickCountry = (c) => { setCountry(c); setCategory(null); setPage(0); };
  const pickCategory = (c) => { setCategory(c); setPage(0); };
  const search = () => { setQuery(q.trim()); setPage(0); };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">🛍️ 产品展示</h1>

      <div className="bg-white rounded-xl shadow border p-3 flex flex-col sm:flex-row gap-2">
        <input className="field flex-1" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="搜索 SKU 或产品名称…" />
        <select className="field sm:w-36" value={country} onChange={e => pickCountry(e.target.value)}>
          {countries.map(c => <option key={c.code} value={c.name}>{c.code} {c.name}</option>)}
        </select>
        <button onClick={search} className="btn btn-primary">搜索</button>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-start">
        {/* 分类：电脑端侧栏，手机端下拉 */}
        <div className="md:hidden w-full">
          <select className="field w-full" value={category ?? '__all'} onChange={e => pickCategory(e.target.value === '__all' ? null : e.target.value)}>
            <option value="__all">全部产品 ({cats.total})</option>
            {cats.categories.map(c => <option key={c.name} value={c.name}>{c.label || '其他'} ({c.total})</option>)}
          </select>
        </div>
        <aside className="hidden md:block w-60 shrink-0 bg-white rounded-xl shadow border">
          <div className="px-4 py-3 border-b font-medium">☰ 产品类目</div>
          <div className="p-2 space-y-0.5 max-h-[70vh] overflow-auto">
            <CatItem label="全部产品" count={cats.total} active={category === null} onClick={() => pickCategory(null)} />
            {cats.categories.map(c => (
              <CatItem key={c.name} label={c.label || '其他'} count={c.total} active={category === c.name} onClick={() => pickCategory(c.name)} />
            ))}
          </div>
        </aside>

        <div className="flex-1 min-w-0 space-y-3 w-full">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>共 <b>{data.total}</b> 个产品</span>
            <label className="inline-flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={inStock} onChange={e => { setInStock(e.target.checked); setPage(0); }} /> 只看有库存
            </label>
          </div>

          {loading && <div className="p-6 text-center text-gray-400">加载中...</div>}
          {!loading && data.rows.length === 0 && <div className="p-6 text-center text-gray-400 bg-white rounded-xl border">暂无匹配产品</div>}
          {!loading && data.rows.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {data.rows.map(p => (
                <div key={p.code} className="bg-white rounded-xl shadow border overflow-hidden flex flex-col">
                  <div className="relative aspect-square bg-gray-50">
                    {p.image_url
                      ? <img src={p.image_url} alt="" loading="lazy" className="w-full h-full object-contain" onError={e => { e.currentTarget.style.display = 'none'; }} />
                      : <div className="w-full h-full flex items-center justify-center text-4xl text-gray-300">📦</div>}
                    <span className="absolute top-2 left-2 text-xs font-medium bg-white/90 rounded px-1.5">{code}</span>
                    <span className={`absolute top-2 right-2 text-xs rounded px-1.5 text-white ${p.stock > 0 ? 'bg-red-500' : 'bg-gray-400'}`}>
                      {p.stock > 0 ? `库存 ${p.stock}` : '缺货'}
                    </span>
                  </div>
                  <div className="p-3 flex flex-col gap-1 flex-1">
                    <div className="text-xs text-blue-600 font-mono">SKU: {p.code}</div>
                    <div className="text-sm text-gray-800 line-clamp-2 min-h-[2.5rem]" title={p.name || ''}>{p.name || '—'}</div>
                    <div className="mt-auto text-lg font-semibold text-blue-700">{sym}{p.price.toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {pages > 1 && (
            <div className="flex items-center justify-center gap-2 text-sm">
              <button className="btn btn-ghost border py-1" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</button>
              <span>{page + 1} / {pages}</span>
              <button className="btn btn-ghost border py-1" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>下一页</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CatItem({ label, count, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left ${active ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-gray-50 text-gray-700'}`}>
      <span className="truncate">{label}</span>
      <span className="text-xs bg-gray-100 rounded-full px-2 shrink-0">{count}</span>
    </button>
  );
}
