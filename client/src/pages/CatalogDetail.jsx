import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { currencySymbol } from './Catalog.jsx';

// 商品详情：图片（总表 Image 1-9）、标题、分类、采购价、库存、详情描述、属性
export default function CatalogDetail() {
  const { country, code } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    setItem(null); setError(''); setActive(0);
    api.get('/catalog/item', { params: { country, code } })
      .then(r => setItem(r.data))
      .catch(e => setError(e.response?.data?.error || '加载失败'));
  }, [country, code]);

  const back = <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:text-blue-600">‹ 返回产品列表</button>;
  if (error) return <div className="space-y-4">{back}<div className="bg-white rounded-xl border p-6 text-center text-gray-400">{error}</div></div>;
  if (!item) return <div className="p-6 text-center text-gray-400">加载中...</div>;

  const sym = currencySymbol[item.country] || '$';
  const img = item.images[active];
  return (
    <div className="space-y-4 max-w-5xl">
      {back}
      <div className="bg-white rounded-xl shadow border p-4 md:p-6 grid md:grid-cols-2 gap-6">
        <div className="space-y-3 min-w-0">
          <div className="aspect-square bg-gray-50 rounded-lg flex items-center justify-center overflow-hidden">
            {img
              ? <img src={img} alt="" className="max-w-full max-h-full object-contain" />
              : <span className="text-6xl text-gray-300">📦</span>}
          </div>
          {item.images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {item.images.map((u, i) => (
                <button key={u + i} onClick={() => setActive(i)}
                  className={`w-16 h-16 shrink-0 rounded border-2 overflow-hidden bg-gray-50 ${i === active ? 'border-blue-500' : 'border-transparent hover:border-gray-300'}`}>
                  <img src={u} alt="" loading="lazy" className="w-full h-full object-contain" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4 min-w-0">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 font-mono">SKU: {item.code}</span>
            <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700">{country} {item.country}</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold break-words">{item.name || item.code}</h1>
          {item.category_path && (
            <div className="text-sm text-gray-500">所属类目：<span className="text-blue-600">{item.category_path}</span></div>
          )}
          <div className="grid grid-cols-2 gap-3 border-t pt-4">
            <div className="rounded-lg bg-blue-50 p-3">
              <div className="text-xs text-blue-600">采购价</div>
              <div className="text-xl font-bold text-blue-700">{sym}{item.price.toFixed(2)}</div>
            </div>
            <div className="rounded-lg bg-green-50 p-3">
              <div className="text-xs text-green-600">库存</div>
              <div className={`text-xl font-bold ${item.stock > 0 ? 'text-red-600' : 'text-gray-400'}`}>{item.stock > 0 ? item.stock : '缺货'}</div>
            </div>
          </div>
        </div>
      </div>

      {item.description && <Section title="🔍 产品详情" text={item.description} />}
      {item.properties && <Section title="产品属性" text={item.properties} />}
    </div>
  );
}

function Section({ title, text }) {
  return (
    <div className="bg-white rounded-xl shadow border p-4 md:p-6">
      <h2 className="font-semibold mb-3">{title}</h2>
      <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 leading-relaxed whitespace-pre-line break-words">{text}</div>
    </div>
  );
}
