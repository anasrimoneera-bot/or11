import { useState } from 'react';
import api from '../../api';

export default function AdminApiTest() {
  const [action, setAction] = useState('list_orders');
  const [params, setParams] = useState('{}');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const p = JSON.parse(params || '{}');
      const { data } = await api.post('/admin/test-dropxl', { action, params: p });
      setResult({ ok: true, data });
    } catch (e) {
      setResult({ ok: false, data: e.response?.data || { error: e.message } });
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">🧪 DropXL API 测试</h1>
      <div className="bg-blue-50 text-blue-700 text-sm rounded p-3">
        ℹ️ 此页面用于初版调试。DropXL 实际返回的字段名可能与默认假设不同，可在此页面发送测试请求查看响应结构，根据结果修改 server/dropxl.js 中的字段映射。
      </div>
      <div className="bg-white rounded-xl shadow p-5 space-y-3">
        <div>
          <label className="text-sm">选择测试动作</label>
          <select className="field" value={action} onChange={e => setAction(e.target.value)}>
            <option value="list_orders">GET /orders (列出订单)</option>
            <option value="list_products">GET /products (列出商品)</option>
            <option value="get_order">GET /orders/:id (订单详情, 需 params.id)</option>
            <option value="account">GET /account (账户信息)</option>
          </select>
        </div>
        <div>
          <label className="text-sm">参数 (JSON)</label>
          <textarea className="field font-mono text-sm" rows="3" value={params} onChange={e => setParams(e.target.value)} placeholder='{"limit": 10}' />
        </div>
        <button onClick={run} disabled={loading} className="btn btn-primary">{loading ? '请求中...' : '🚀 发送请求'}</button>
      </div>

      {result && (
        <div className={`rounded-xl shadow p-5 ${result.ok ? 'bg-green-50' : 'bg-red-50'}`}>
          <div className="font-semibold mb-2">{result.ok ? '✓ 请求成功' : '✗ 请求失败'}</div>
          <pre className="bg-white p-3 rounded text-xs overflow-x-auto max-h-[600px] overflow-y-auto">{JSON.stringify(result.data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
