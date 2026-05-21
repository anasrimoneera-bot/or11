import { useEffect, useState } from 'react';
import api from '../api';

export default function AfterSalesPolicy() {
  const [sections, setSections] = useState([]);
  const [open, setOpen] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/aftersales-policies')
      .then(r => setSections(r.data || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">售后政策</h1>
        <p className="text-gray-500 text-sm">本页面包含 DropXL 的售后政策相关文档。</p>
      </div>
      {loading ? (
        <div className="text-gray-400 text-sm">加载中...</div>
      ) : sections.length === 0 ? (
        <div className="bg-white rounded-lg shadow border p-6 text-gray-400 text-sm">暂无售后政策内容</div>
      ) : (
        <div className="space-y-3">
          {sections.map((s, i) => (
            <div key={s.id} className="bg-white rounded-lg shadow border">
              <button className="w-full p-4 flex justify-between items-center text-left" onClick={() => setOpen(open === i ? -1 : i)}>
                <span className="font-medium">📄 {s.title}</span>
                <span className={`transform transition ${open === i ? 'rotate-180' : ''}`}>▼</span>
              </button>
              {open === i && <div className="p-4 pt-0 text-sm text-gray-700 whitespace-pre-line">{s.body}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
