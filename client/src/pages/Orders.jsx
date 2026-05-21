import { useEffect, useState } from 'react';
import api from '../api';
import EditableAmount from '../components/EditableAmount.jsx';

const statusColor = {
  pending_purchase: 'bg-orange-100 text-orange-700',
  pending_shipment: 'bg-blue-100 text-blue-700',
  shipped: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  refunded: 'bg-yellow-100 text-yellow-700',
  replaced: 'bg-indigo-100 text-indigo-700',
};
const statusLabel = {
  pending_purchase: '待采购',
  pending_shipment: '待发货',
  shipped: '已发货',
  completed: '已完成',
  cancelled: '已取消',
  refunded: '已退款',
  replaced: '已替换',
};

export default function Orders() {
  const [stats, setStats] = useState({});
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ status: 'all', country: '', shop: '', q: '', start: '', end: '' });
  const [shops, setShops] = useState([]);

  const load = () => {
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v && v !== 'all') params[k] = v; });
    api.get('/orders', { params }).then(r => { setOrders(r.data.rows); setTotal(r.data.total); });
    api.get('/orders/stats').then(r => setStats(r.data));
  };

  useEffect(() => { load(); api.get('/accounts/shops').then(r => setShops(r.data)); }, []);
  useEffect(load, [filters.status]);

  const sync = async () => {
    try {
      const { data } = await api.post('/orders/sync');
      alert(`同步完成，共 ${data.total} 单，更新 ${data.updated} 单`);
      load();
    } catch (e) {
      alert('同步失败：' + (e.response?.data?.error || e.message));
    }
  };

  const reset = () => setFilters({ status: 'all', country: '', shop: '', q: '', start: '', end: '' });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">🛒 订单管理</h1>
        <div className="flex gap-2">
          <button onClick={sync} className="btn btn-primary">🔄 从DropXL同步</button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="全部订单" value={stats.all} color="bg-slate-700" active={filters.status === 'all'} onClick={() => setFilters({ ...filters, status: 'all' })} />
        <StatCard label="待采购" value={stats.pending_purchase} color="bg-orange-500" active={filters.status === 'pending_purchase'} onClick={() => setFilters({ ...filters, status: 'pending_purchase' })} />
        <StatCard label="待发货" value={stats.pending_shipment} color="bg-blue-500" active={filters.status === 'pending_shipment'} onClick={() => setFilters({ ...filters, status: 'pending_shipment' })} />
        <StatCard label="已发货" value={stats.shipped} color="bg-purple-500" active={filters.status === 'shipped'} onClick={() => setFilters({ ...filters, status: 'shipped' })} />
        <StatCard label="已完成" value={stats.completed} color="bg-green-500" active={filters.status === 'completed'} onClick={() => setFilters({ ...filters, status: 'completed' })} />
        <StatCard label="已取消" value={stats.cancelled} color="bg-red-500" active={filters.status === 'cancelled'} onClick={() => setFilters({ ...filters, status: 'cancelled' })} />
        <StatCard label="已退款" value={stats.refunded} color="bg-yellow-500" active={filters.status === 'refunded'} onClick={() => setFilters({ ...filters, status: 'refunded' })} />
        <StatCard label="已替换" value={stats.replaced} color="bg-indigo-500" active={filters.status === 'replaced'} onClick={() => setFilters({ ...filters, status: 'replaced' })} />
      </div>

      <div className="bg-white rounded-xl p-4 shadow">
        <div className="grid grid-cols-3 gap-4 mb-3">
          <div>
            <label className="text-sm">国家</label>
            <select className="field" value={filters.country} onChange={e => setFilters({ ...filters, country: e.target.value })}>
              <option value="">全部国家</option>
              <option>美国</option><option>英国</option><option>德国</option><option>法国</option>
              <option>意大利</option><option>荷兰</option><option>西班牙</option><option>波兰</option>
            </select>
          </div>
          <div>
            <label className="text-sm">店铺</label>
            <select className="field" value={filters.shop} onChange={e => setFilters({ ...filters, shop: e.target.value })}>
              <option value="">全部店铺</option>
              {shops.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm">搜索订单</label>
            <input className="field" placeholder="搜索订单号、客户参考号、店铺" value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} />
          </div>
          <div>
            <label className="text-sm">开始日期</label>
            <input type="date" className="field" value={filters.start} onChange={e => setFilters({ ...filters, start: e.target.value })} />
          </div>
          <div>
            <label className="text-sm">结束日期</label>
            <input type="date" className="field" value={filters.end} onChange={e => setFilters({ ...filters, end: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={reset}>↺ 重置</button>
          <button className="btn btn-warning" onClick={load}>🔍 搜索</button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-medium">📦 订单列表 ({total} 条)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left">订单号</th>
                <th className="px-3 py-2 text-left">店铺</th>
                <th className="px-3 py-2 text-right">订单金额</th>
                <th className="px-3 py-2 text-right">税后金额</th>
                <th className="px-3 py-2 text-right">采购(USD)</th>
                <th className="px-3 py-2 text-right">采购(¥)</th>
                <th className="px-3 py-2 text-right">利润 (USD)</th>
                <th className="px-3 py-2 text-left">物流跟踪号</th>
                <th className="px-3 py-2 text-left">状态</th>
                <th className="px-3 py-2 text-left">创建时间</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => {
                const tax = Number(o.amazon_tax_amount) || 0;
                const purchase = Number(o.purchase_amount_usd) || 0;
                const ship = Number(o.shipping_fee) || 0;
                const profit = tax > 0 ? tax - purchase - ship : 0;
                return (
                <tr key={o.id} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono">{o.order_no}</td>
                  <td className="px-3 py-2">{o.shop_name || '-'}</td>
                  <td className="px-3 py-2 text-right">
                    <EditableAmount value={o.amazon_amount || 0} onSave={async (v) => { await api.put(`/orders/${o.id}`, { amazon_amount: v }); load(); }} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <EditableAmount value={o.amazon_tax_amount || 0} onSave={async (v) => { await api.put(`/orders/${o.id}`, { amazon_tax_amount: v }); load(); }} />
                  </td>
                  <td className="px-3 py-2 text-right">${(o.purchase_amount_usd || 0).toFixed(4)}</td>
                  <td className="px-3 py-2 text-right text-red-600">¥{(o.purchase_amount_cny || 0).toFixed(2)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${tax === 0 ? 'text-gray-400' : profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {tax === 0 ? '—' : `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`}
                  </td>
                  <td className="px-3 py-2">{o.tracking_no || '-'}</td>
                  <td className="px-3 py-2">
                    <span className={`badge ${statusColor[o.status] || 'bg-gray-100'}`}>{statusLabel[o.status] || o.status}</span>
                  </td>
                  <td className="px-3 py-2">{(o.created_at || '').replace('T', ' ').slice(0, 19)}</td>
                  <td className="px-3 py-2 text-right">
                    <button className="text-blue-600 hover:underline text-xs mr-2">查看</button>
                  </td>
                </tr>
              );})}
              {orders.length === 0 && <tr><td colSpan="11" className="p-8 text-center text-gray-400">暂无订单数据</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, active, onClick }) {
  return (
    <button onClick={onClick} className={`${color} text-white rounded-xl p-4 text-left ${active ? 'ring-4 ring-offset-2 ring-orange-300' : 'opacity-90 hover:opacity-100'}`}>
      <div className="text-3xl font-bold">{value || 0}</div>
      <div className="text-sm">{label}</div>
    </button>
  );
}
