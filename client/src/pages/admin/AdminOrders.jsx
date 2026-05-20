import { useEffect, useState } from 'react';
import api from '../../api';

const statusLabel = { pending_purchase: '待采购', pending_shipment: '待发货', shipped: '已发货', completed: '已完成', cancelled: '已取消', refunded: '已退款' };
const statusColor = {
  pending_purchase: 'bg-orange-100 text-orange-700',
  pending_shipment: 'bg-blue-100 text-blue-700',
  shipped: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  refunded: 'bg-yellow-100 text-yellow-700',
};

export default function AdminOrders() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ status: 'pending_purchase', q: '' });
  const [confirmOrder, setConfirmOrder] = useState(null);

  const load = () => {
    const params = {};
    if (filters.status !== 'all') params.status = filters.status;
    if (filters.q) params.q = filters.q;
    api.get('/admin/orders', { params }).then(r => setRows(r.data.rows));
  };
  useEffect(load, [filters.status]);

  const sync = async () => {
    try {
      const { data } = await api.post('/admin/orders/sync');
      alert(`同步完成：共 ${data.total} 单，更新 ${data.updated} 单的跟踪号/状态`);
      load();
    } catch (e) { alert(e.response?.data?.error || '同步失败'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">📋 订单审核与发货</h1>
        <button onClick={sync} className="btn btn-primary">🔄 从DropXL同步跟踪号/状态</button>
      </div>

      <div className="flex gap-2">
        {['all', 'pending_purchase', 'pending_shipment', 'shipped', 'completed', 'cancelled', 'refunded'].map(s => (
          <button key={s} onClick={() => setFilters({ ...filters, status: s })}
            className={`px-3 py-1 rounded text-sm ${filters.status === s ? 'bg-orange-500 text-white' : 'bg-white border'}`}>
            {s === 'all' ? '全部' : statusLabel[s]}
          </button>
        ))}
        <input className="field max-w-xs ml-auto" placeholder="搜索订单号/用户/店铺" value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} />
        <button onClick={load} className="btn btn-warning">搜索</button>
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">订单号</th>
              <th className="px-3 py-2 text-left">用户</th>
              <th className="px-3 py-2 text-left">国家/店铺</th>
              <th className="px-3 py-2 text-right">亚马逊金额</th>
              <th className="px-3 py-2 text-right">采购(USD)</th>
              <th className="px-3 py-2 text-right">采购(¥)</th>
              <th className="px-3 py-2 text-left">DropXL ID</th>
              <th className="px-3 py-2 text-left">跟踪号</th>
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-left">创建时间</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(o => (
              <tr key={o.id} className="border-t hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs">{o.order_no}</td>
                <td className="px-3 py-2">{o.display_name || o.username}</td>
                <td className="px-3 py-2">{o.country} / {o.shop_name || '-'}</td>
                <td className="px-3 py-2 text-right">${(o.amazon_amount || 0).toFixed(2)}</td>
                <td className="px-3 py-2 text-right">${(o.purchase_amount_usd || 0).toFixed(2)}</td>
                <td className="px-3 py-2 text-right text-red-600">¥{(o.purchase_amount_cny || 0).toFixed(2)}</td>
                <td className="px-3 py-2 text-xs font-mono">{o.dropxl_order_id || '-'}</td>
                <td className="px-3 py-2 text-xs">{o.tracking_no || '-'}</td>
                <td className="px-3 py-2"><span className={`badge ${statusColor[o.status] || 'bg-gray-100'}`}>{statusLabel[o.status]}</span></td>
                <td className="px-3 py-2 text-xs">{o.created_at}</td>
                <td className="px-3 py-2 text-right">
                  {o.status === 'pending_purchase' && (
                    <button onClick={() => setConfirmOrder(o)} className="text-green-600 hover:underline text-xs">确认采购</button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan="11" className="p-6 text-center text-gray-400">暂无订单</td></tr>}
          </tbody>
        </table>
      </div>

      {confirmOrder && <ConfirmModal order={confirmOrder} onClose={() => setConfirmOrder(null)} onDone={() => { setConfirmOrder(null); load(); }} />}
    </div>
  );
}

function ConfirmModal({ order, onClose, onDone }) {
  const [realUsd, setRealUsd] = useState(order.real_amount_usd || '');
  const [markup, setMarkup] = useState(order.markup_pct ?? 30);
  const [rate, setRate] = useState(order.exchange_rate || 7.2);
  const [refund, setRefund] = useState(0);
  const [note, setNote] = useState('');

  const realCny = (Number(realUsd) || 0) * (Number(rate) || 0);
  const displayUsd = (Number(realUsd) || 0) * (1 + (Number(markup) || 0) / 100);
  const displayCny = displayUsd * (Number(rate) || 0);
  const deduct = displayCny - (Number(refund) || 0);
  const profit = deduct - realCny;

  const submit = async () => {
    try {
      await api.post(`/admin/orders/${order.id}/confirm`, {
        real_amount_usd: Number(realUsd),
        markup_pct: Number(markup),
        exchange_rate: Number(rate),
        distributor_refund: Number(refund),
        note,
      });
      onDone();
    } catch (e) { alert(e.response?.data?.error || '操作失败'); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-6 w-[560px]">
        <div className="font-semibold text-lg mb-4">确认采购订单</div>
        <div className="bg-gray-50 rounded p-3 mb-4 text-sm space-y-1">
          <div>订单号：<span className="font-mono">{order.order_no}</span></div>
          <div>用户：{order.display_name || order.username}</div>
          <div>国家/店铺：{order.country} / {order.shop_name}</div>
          <div>亚马逊订单金额：${(order.amazon_amount || 0).toFixed(2)}</div>
          <div>DropXL Order ID：<span className="font-mono">{order.dropxl_order_id || '(未创建)'}</span></div>
          {order.real_amount_usd > 0 && <div className="text-blue-600">DropXL返回真实价：${order.real_amount_usd.toFixed(2)} (可调整)</div>}
        </div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <div>
            <label className="text-sm">真实采购价 (USD) *</label>
            <input className="field" type="number" step="0.01" value={realUsd} onChange={e => setRealUsd(e.target.value)} placeholder="DropXL实际价" />
          </div>
          <div>
            <label className="text-sm">加价 % *</label>
            <input className="field" type="number" step="0.1" value={markup} onChange={e => setMarkup(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">汇率 *</label>
            <input className="field" type="number" step="0.01" value={rate} onChange={e => setRate(e.target.value)} />
          </div>
        </div>
        <label className="text-sm">分销补款 (¥) - 可选</label>
        <input className="field mb-2" type="number" step="0.01" value={refund} onChange={e => setRefund(e.target.value)} placeholder="给用户额外的折扣/补贴" />
        <label className="text-sm">备注</label>
        <input className="field mb-3" value={note} onChange={e => setNote(e.target.value)} />

        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4 text-sm space-y-1">
          <div className="flex justify-between"><span>真实价 (USD → ¥)：</span><span>${(Number(realUsd) || 0).toFixed(2)} → ¥{realCny.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>加价 {markup}% 后向用户显示：</span><b>${displayUsd.toFixed(2)} / ¥{displayCny.toFixed(2)}</b></div>
          <div className="flex justify-between"><span>分销补款 (¥)：</span><span>-¥{(Number(refund) || 0).toFixed(2)}</span></div>
          <div className="flex justify-between border-t pt-1 mt-1"><span>从用户余额扣除：</span><b className="text-red-600">¥{deduct.toFixed(2)}</b></div>
          <div className="flex justify-between"><span>预计利润 (¥)：</span><b className="text-green-600">+¥{profit.toFixed(2)}</b></div>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-success" onClick={submit}>✓ 确认扣款</button>
        </div>
      </div>
    </div>
  );
}
