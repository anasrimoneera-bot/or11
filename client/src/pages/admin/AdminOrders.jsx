import { useEffect, useState, lazy, Suspense } from 'react';
import api from '../../api';
import EditableAmount from '../../components/EditableAmount.jsx';

// 店主版确认弹窗 - 通过动态 import 隔离，员工不会下载此 chunk
const OwnerConfirmModal = lazy(() => import('./OwnerConfirmModal.jsx'));
const OwnerCols = lazy(() => import('./OwnerColumns.jsx').then(m => ({
  default: ({ kind, order }) => kind === 'h' ? <m.OrderRealHeader /> : <m.OrderRealCells realUsd={order?.[atob('cmVhbF9hbW91bnRfdXNk')]} markupPct={order?.[atob('bWFya3VwX3BjdA==')]} />
})));

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
  const [me, setMe] = useState(null);
  const [filters, setFilters] = useState({ status: 'pending_purchase', q: '' });
  const [confirmOrder, setConfirmOrder] = useState(null);
  const isOwner = !!me?.is_owner;

  const load = () => {
    if (filters.status === 'all' && !filters.q) {
      setRows([]);
      return;
    }
    const params = {};
    if (filters.status !== 'all') params.status = filters.status;
    if (filters.q) params.q = filters.q;
    api.get('/admin/orders', { params }).then(r => setRows(r.data.rows));
  };
  useEffect(() => { load(); api.get('/auth/me').then(r => setMe(r.data)); }, []);
  useEffect(load, [filters.status]);

  const sync = async () => {
    try {
      const { data } = await api.post('/admin/orders/sync');
      alert(`同步完成：共 ${data.total} 单，更新 ${data.updated} 单的跟踪号/状态`);
      load();
    } catch (e) { alert(e.response?.data?.error || '同步失败'); }
  };

  const importHistory = async () => {
    const since = prompt('导入从哪一天起的历史订单？格式 YYYY-MM-DD', '2020-01-01');
    if (!since) return;
    if (!confirm(`确认从供应商拉取 ${since} 之后的所有订单导入本地？已存在的不会重复导入。`)) return;
    try {
      const { data } = await api.post('/admin/orders/import-from-dropxl', { since });
      let msg = `共拉取 ${data.total} 单：\n  ✓ 新导入 ${data.imported} 单\n  · 已存在跳过 ${data.skipped} 单`;
      if (data.failed) msg += `\n  ✗ 失败 ${data.failed} 单`;
      if (data.errors?.length) msg += `\n\n错误样例：\n${data.errors.join('\n')}`;
      alert(msg);
      load();
    } catch (e) { alert(e.response?.data?.error || '导入失败'); }
  };

  const exportDropxlTemplate = async () => {
    if (!confirm('确认导出待处理订单为供应商采购模板？\n• 默认只导出未导出过的订单\n• 导出后会标记为"已导出"，下次不再重复\n• 导出后请前往供应商后台手动提交')) return;
    try {
      const r = await api.post('/admin/orders/dropxl-template-export', {}, { responseType: 'blob' });
      const blob = r.data;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `purchase-orders-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      // blob 错误响应需特殊处理
      let msg = '导出失败';
      if (e.response?.data instanceof Blob) {
        try { msg = JSON.parse(await e.response.data.text()).error || msg; } catch {}
      } else {
        msg = e.response?.data?.error || e.message;
      }
      alert(msg);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">📋 订单管理</h1>
        <div className="flex gap-2">
          <button onClick={exportDropxlTemplate} className="btn btn-success">📥 导出采购模板</button>
          <button onClick={importHistory} className="btn btn-warning">📥 导入历史订单</button>
          <button onClick={sync} className="btn btn-primary">🔄 从供应商同步跟踪号/状态</button>
        </div>
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
              <th className="px-3 py-2 text-right" title="亚马逊扣除佣金及税后的实际到账金额">亚马逊金额</th>
              <th className="px-3 py-2 text-right">采购(USD)</th>
              <th className="px-3 py-2 text-right">采购(¥)</th>
              <th className="px-3 py-2 text-right">利润 (USD)</th>
              {isOwner && <Suspense fallback={<><th /><th /></>}><OwnerCols kind="h" /></Suspense>}
              <th className="px-3 py-2 text-left">供应商 ID</th>
              <th className="px-3 py-2 text-left">跟踪号</th>
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-left">创建时间</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(o => {
              const sales = Number(o.amazon_amount) || 0;
              const purchase = Number(o.purchase_amount_usd) || 0;
              const profit = sales > 0 ? sales - purchase : 0;
              return (
              <tr key={o.id} className="border-t hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs">{o.order_no}</td>
                <td className="px-3 py-2">{o.display_name || o.username}</td>
                <td className="px-3 py-2">{o.country} / {o.shop_name || '-'}</td>
                <td className="px-3 py-2 text-right">
                  <EditableAmount
                    value={o.amazon_amount || 0}
                    onSave={async (v) => { await api.put(`/admin/orders/${o.id}`, { amazon_amount: v }); load(); }}
                  />
                </td>
                <td className="px-3 py-2 text-right">${(o.purchase_amount_usd || 0).toFixed(2)}</td>
                <td className="px-3 py-2 text-right text-red-600">¥{(o.purchase_amount_cny || 0).toFixed(2)}</td>
                <td className={`px-3 py-2 text-right font-semibold ${sales === 0 ? 'text-gray-400' : profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {sales === 0 ? '—' : `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`}
                </td>
                {isOwner && <Suspense fallback={<><td /><td /></>}><OwnerCols kind="c" order={o} /></Suspense>}
                <td className="px-3 py-2 text-xs font-mono">{o.dropxl_order_id || '-'}</td>
                <td className="px-3 py-2 text-xs">{
                  o.tracking_no
                    ? o.tracking_no.split(',').map((t, i) => <div key={i} className="whitespace-nowrap">{t.trim()}</div>)
                    : '-'
                }</td>
                <td className="px-3 py-2"><span className={`badge ${statusColor[o.status] || 'bg-gray-100'}`}>{statusLabel[o.status]}</span></td>
                <td className="px-3 py-2 text-xs">{o.created_at}</td>
                <td className="px-3 py-2 text-right">
                  {o.status === 'pending_purchase' && (
                    <button onClick={() => setConfirmOrder(o)} className="text-green-600 hover:underline text-xs">确认采购</button>
                  )}
                </td>
              </tr>
            );})}
            {rows.length === 0 && <tr><td colSpan={isOwner ? 13 : 11} className="p-6 text-center text-gray-400">
              {filters.status === 'all' && !filters.q ? '请先在上方选择具体状态查看订单' : '暂无订单'}
            </td></tr>}
          </tbody>
        </table>
      </div>

      {confirmOrder && (
        isOwner
          ? <Suspense fallback={null}><OwnerConfirmModal order={confirmOrder} onClose={() => setConfirmOrder(null)} onDone={() => { setConfirmOrder(null); load(); }} /></Suspense>
          : <StaffConfirmModal order={confirmOrder} onClose={() => setConfirmOrder(null)} onDone={() => { setConfirmOrder(null); load(); }} />
      )}
    </div>
  );
}

// 员工版确认弹窗：看不到真实价/加价，仅按系统已算好的金额扣款
function StaffConfirmModal({ order, onClose, onDone }) {
  const [rate, setRate] = useState(order.exchange_rate || 7.2);
  const [refund, setRefund] = useState(0);
  const [note, setNote] = useState('');
  const cny = (Number(order.purchase_amount_usd) || 0) * (Number(rate) || 0);
  const deduct = cny - (Number(refund) || 0);

  const submit = async () => {
    try {
      await api.post(`/admin/orders/${order.id}/confirm`, {
        exchange_rate: Number(rate),
        distributor_refund: Number(refund),
        note,
      });
      onDone();
    } catch (e) { alert(e.response?.data?.error || '操作失败'); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-6 w-[480px]">
        <div className="font-semibold text-lg mb-4">确认采购订单</div>
        <div className="bg-gray-50 rounded p-3 mb-4 text-sm space-y-1">
          <div>订单号：<span className="font-mono">{order.order_no}</span></div>
          <div>用户：{order.display_name || order.username}</div>
          <div>国家/店铺：{order.country} / {order.shop_name}</div>
          <div>供应商订单 ID：<span className="font-mono">{order.dropxl_order_id || '(未创建)'}</span></div>
          <div className="text-blue-700">系统计算采购价 (USD)：<b>${(order.purchase_amount_usd || 0).toFixed(2)}</b></div>
        </div>
        <label className="text-sm">汇率 *</label>
        <input className="field mb-2" type="number" step="0.01" value={rate} onChange={e => setRate(e.target.value)} />
        <label className="text-sm">分销补款 (¥) - 可选</label>
        <input className="field mb-2" type="number" step="0.01" value={refund} onChange={e => setRefund(e.target.value)} placeholder="给用户的折扣/补贴" />
        <label className="text-sm">备注</label>
        <input className="field mb-3" value={note} onChange={e => setNote(e.target.value)} />
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4 text-sm">
          <div className="flex justify-between"><span>采购金额(¥)：</span><b>¥{cny.toFixed(2)}</b></div>
          <div className="flex justify-between"><span>分销补款(¥)：</span><b>-¥{(Number(refund) || 0).toFixed(2)}</b></div>
          <div className="flex justify-between border-t mt-1 pt-1"><span>从用户余额扣除：</span><b className="text-red-600">¥{deduct.toFixed(2)}</b></div>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-success" onClick={submit}>✓ 确认扣款</button>
        </div>
      </div>
    </div>
  );
}
