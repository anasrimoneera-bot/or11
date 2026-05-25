import { useEffect, useState, lazy, Suspense } from 'react';
import api from '../../api';
import EditableAmount from '../../components/EditableAmount.jsx';

// 店主版确认弹窗 - 通过动态 import 隔离，员工不会下载此 chunk
const OwnerConfirmModal = lazy(() => import('./OwnerConfirmModal.jsx'));
const OwnerCols = lazy(() => import('./OwnerColumns.jsx').then(m => ({
  default: ({ kind, order, onChanged, isOwner }) => kind === 'h' ? <m.OrderRealHeader /> : <m.OrderRealCells order={order} onChanged={onChanged} isOwner={isOwner} />
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
  const [assignOrder, setAssignOrder] = useState(null);
  const isOwner = !!me?.is_owner;
  const canSeeCost = !!me?.is_admin; // 店主+管理员都能看成本相关列（页面本身仅管理员可进）

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
    if (!confirm('从供应商同步最近 90 天订单的发货状态与跟踪号？\n（按 1 秒/请求限速，订单多时可能耗时几分钟，期间页面可切换）')) return;
    try {
      const { data } = await api.post('/admin/orders/sync');
      alert(`同步完成：共拉取 ${data.total} 单 (since ${data.since})\n  ✓ 命中更新 ${data.updated} 单\n  · 本地不存在跳过 ${data.not_found} 单`);
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

  // 仅 BOSS：按当前系统汇率重算单个订单的采购¥（补全历史导入单缺失的¥）
  const recomputeCny = async (o) => {
    if (!confirm(`按"当前系统采购汇率"重算订单 ${o.order_no} 的采购¥？\n采购¥ = 采购USD × 当前采购汇率，并把该订单汇率更新为当前汇率。`)) return;
    try {
      await api.post(`/admin/orders/${o.id}/recompute-cny`);
      load();
    } catch (e) { alert(e.response?.data?.error || '重算失败'); }
  };

  // 仅 BOSS：一键补算所有"采购¥为 0 / 未计算"的订单（不动已正常的订单）
  const recomputeAllMissing = async () => {
    if (!confirm('把所有"采购¥为 0 / 未计算"的订单按当前系统汇率补算采购¥？\n（只补缺，不影响采购¥已正常的订单）')) return;
    try {
      const { data } = await api.post('/admin/orders/recompute-cny-missing');
      alert(`扫描 ${data.scanned} 单，实际补算 ${data.updated} 单`);
      load();
    } catch (e) { alert(e.response?.data?.error || '补算失败'); }
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
          {isOwner && <button onClick={recomputeAllMissing} className="btn btn-ghost border" title='把所有"采购¥为0/未计算"的订单按当前汇率补算'>🔄 补算采购¥(零值单)</button>}
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
              <th className="px-3 py-2 text-right" title="按订单锁定汇率（无锁定则用当前系统汇率）换算">利润 (¥)</th>
              <th className="px-3 py-2 text-right" title="成本利润率 = 人民币利润 / 人民币采购价">成本利润率</th>
              {canSeeCost && <Suspense fallback={<><th /><th /><th /><th /><th /></>}><OwnerCols kind="h" /></Suspense>}
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
              const purchaseCny = Number(o.purchase_amount_cny) || 0;
              const profit = sales > 0 ? sales - purchase : 0;
              // 亚马逊金额 -> 人民币：用 amazon_rate_locked（店主保存 amazon_amount 时锁定的亚马逊汇率）
              // 不存在锁定汇率则不计算人民币利润，避免用错误的采购汇率换算
              const amazonRate = Number(o.amazon_rate_locked) || 0;
              const canComputeCny = sales > 0 && amazonRate > 0;
              const profitCny = canComputeCny ? sales * amazonRate - purchaseCny : 0;
              return (
              <tr key={o.id} className="border-t hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs">{o.order_no}</td>
                <td className="px-3 py-2">
                  <div>{o.display_name || o.username}</div>
                  <button
                    onClick={() => setAssignOrder(o)}
                    className="text-xs text-blue-600 hover:underline mt-0.5"
                    title="把订单归属改到另一个分销商账号"
                  >👤 分配</button>
                </td>
                <td className="px-3 py-2">{o.country} / {o.shop_name || '-'}</td>
                <td className="px-3 py-2 text-right">
                  <EditableAmount
                    value={o.amazon_amount || 0}
                    onSave={async (v) => { await api.put(`/admin/orders/${o.id}`, { amazon_amount: v }); load(); }}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  {isOwner ? (
                    <EditableAmount
                      value={o.purchase_amount_usd || 0}
                      onSave={async (v) => { await api.put(`/admin/orders/${o.id}/purchase-price`, { purchase_amount_usd: v }); load(); }}
                    />
                  ) : (
                    <>${(o.purchase_amount_usd || 0).toFixed(2)}</>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-red-600 whitespace-nowrap">
                  ¥{(o.purchase_amount_cny || 0).toFixed(2)}
                  {isOwner && (
                    <button
                      onClick={() => recomputeCny(o)}
                      title="按当前系统汇率重算采购¥"
                      className="ml-1 text-blue-500 hover:text-blue-700 align-middle"
                    >🔄</button>
                  )}
                </td>
                <td className={`px-3 py-2 text-right font-semibold ${sales === 0 ? 'text-gray-400' : profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {sales === 0 ? '—' : `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`}
                </td>
                <td className={`px-3 py-2 text-right font-semibold ${!canComputeCny ? 'text-gray-400' : profitCny >= 0 ? 'text-green-700' : 'text-red-600'}`}
                    title={canComputeCny ? `按锁定汇率 ${amazonRate} 换算` : (sales === 0 ? '未填写亚马逊金额' : '该国未设置亚马逊汇率')}>
                  {!canComputeCny ? '—' : `${profitCny >= 0 ? '+' : ''}¥${profitCny.toFixed(2)}`}
                </td>
                <td className={`px-3 py-2 text-right font-semibold ${(!canComputeCny || purchaseCny <= 0) ? 'text-gray-400' : (profitCny / purchaseCny) >= 0 ? 'text-green-700' : 'text-red-600'}`}
                    title="成本利润率 = 人民币利润 / 人民币采购价">
                  {(!canComputeCny || purchaseCny <= 0) ? '—' : `${(profitCny / purchaseCny) >= 0 ? '+' : ''}${((profitCny / purchaseCny) * 100).toFixed(2)}%`}
                </td>
                {canSeeCost && <Suspense fallback={<><td /><td /><td /><td /><td /></>}><OwnerCols kind="c" order={o} onChanged={load} isOwner={isOwner} /></Suspense>}
                <td className="px-3 py-2 text-xs font-mono">{o.dropxl_order_id || '-'}</td>
                <td className="px-3 py-2 text-xs">{
                  o.tracking_no
                    ? o.tracking_no.split(',').map((t, i) => <div key={i} className="whitespace-nowrap">{t.trim()}</div>)
                    : '-'
                }</td>
                <td className="px-3 py-2"><span className={`badge ${statusColor[o.status] || 'bg-gray-100'}`}>{statusLabel[o.status]}</span></td>
                <td className="px-3 py-2 text-xs whitespace-nowrap" title={o.created_at}>
                  {o.created_at ? new Date(o.created_at).toLocaleString('zh-CN', { hour12: false }) : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {o.status === 'pending_purchase' && (
                    <button onClick={() => setConfirmOrder(o)} className="text-green-600 hover:underline text-xs">确认采购</button>
                  )}
                </td>
              </tr>
            );})}
            {rows.length === 0 && <tr><td colSpan={canSeeCost ? 19 : 14} className="p-6 text-center text-gray-400">
              {filters.status === 'all' && !filters.q ? '请先在上方选择具体状态查看订单' : '暂无订单'}
            </td></tr>}
          </tbody>
          {rows.length > 0 && (() => {
            const t = rows.reduce((a, o) => {
              const sales = Number(o.amazon_amount) || 0;
              const purchase = Number(o.purchase_amount_usd) || 0;
              const purchaseCny = Number(o.purchase_amount_cny) || 0;
              const profit = sales > 0 ? sales - purchase : 0;
              const amazonRate = Number(o.amazon_rate_locked) || 0;
              const profitCny = (sales > 0 && amazonRate > 0) ? sales * amazonRate - purchaseCny : 0;
              // 店主成本列合计：真实(USD) / 真实采购价(¥) / 差价利润(¥)
              const realUsd = Number(o.real_amount_usd) || 0;
              const paypalRate = Number(o.paypal_rate) || 0;
              const realCny = paypalRate > 0 ? realUsd / paypalRate : 0; // 未填 PayPal 汇率的不计入
              const profitDiff = paypalRate > 0 ? purchaseCny - realCny : 0;
              return {
                sales: a.sales + sales,
                purchase: a.purchase + purchase,
                purchaseCny: a.purchaseCny + purchaseCny,
                profit: a.profit + profit,
                profitCny: a.profitCny + profitCny,
                realUsd: a.realUsd + realUsd,
                realCny: a.realCny + realCny,
                profitDiff: a.profitDiff + profitDiff,
              };
            }, { sales: 0, purchase: 0, purchaseCny: 0, profit: 0, profitCny: 0, realUsd: 0, realCny: 0, profitDiff: 0 });
            return (
              <tfoot className="bg-gray-50 border-t-2 font-semibold">
                <tr>
                  <td className="px-3 py-2.5 text-gray-700" colSpan={3}>📊 本页合计 ({rows.length} 单)</td>
                  <td className="px-3 py-2.5 text-right">${t.sales.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right">${t.purchase.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right text-red-600">¥{t.purchaseCny.toFixed(2)}</td>
                  <td className={`px-3 py-2.5 text-right ${t.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}
                  </td>
                  <td className={`px-3 py-2.5 text-right ${t.profitCny >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {t.profitCny >= 0 ? '+' : ''}¥{t.profitCny.toFixed(2)}
                  </td>
                  <td className={`px-3 py-2.5 text-right ${(t.purchaseCny > 0 && t.profitCny >= 0) ? 'text-green-700' : t.purchaseCny > 0 ? 'text-red-600' : 'text-gray-400'}`}
                      title="本页合计：总人民币利润 / 总人民币采购价">
                    {t.purchaseCny <= 0 ? '—' : `${(t.profitCny / t.purchaseCny) >= 0 ? '+' : ''}${((t.profitCny / t.purchaseCny) * 100).toFixed(2)}%`}
                  </td>
                  {canSeeCost && <>
                    <td className="px-3 py-2.5 text-right text-red-600">${t.realUsd.toFixed(2)}</td>
                    <td />
                    <td />
                    <td className="px-3 py-2.5 text-right text-red-600">¥{t.realCny.toFixed(2)}</td>
                    <td className={`px-3 py-2.5 text-right ${t.profitDiff >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {t.profitDiff >= 0 ? '+' : ''}¥{t.profitDiff.toFixed(2)}
                    </td>
                  </>}
                  <td colSpan={5} />
                </tr>
              </tfoot>
            );
          })()}
        </table>
      </div>

      {confirmOrder && (
        isOwner
          ? <Suspense fallback={null}><OwnerConfirmModal order={confirmOrder} onClose={() => setConfirmOrder(null)} onDone={() => { setConfirmOrder(null); load(); }} /></Suspense>
          : <StaffConfirmModal order={confirmOrder} onClose={() => setConfirmOrder(null)} onDone={() => { setConfirmOrder(null); load(); }} />
      )}

      {assignOrder && (
        <AssignOrderModal
          order={assignOrder}
          onClose={() => setAssignOrder(null)}
          onDone={() => { setAssignOrder(null); load(); }}
        />
      )}
    </div>
  );
}

function AssignOrderModal({ order, onClose, onDone }) {
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(order.user_id || null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/admin/users').then(r => setUsers(r.data || []));
  }, []);

  const filtered = users.filter(u => {
    if (!q.trim()) return true;
    const k = q.trim().toLowerCase();
    return (u.username || '').toLowerCase().includes(k)
        || (u.display_name || '').toLowerCase().includes(k)
        || (u.email || '').toLowerCase().includes(k);
  });

  const save = async () => {
    if (!selected) return alert('请先选一个分销商');
    if (selected === order.user_id) return alert('该订单当前已经属于这个用户，无需改动');
    if (!confirm(`确认把订单 ${order.order_no} 的归属改为该用户？\n改完后会出现在该用户的订单管理列表里。`)) return;
    setSaving(true);
    try {
      await api.put(`/admin/orders/${order.id}/assign`, { user_id: selected });
      onDone();
    } catch (e) {
      alert(e.response?.data?.error || '分配失败');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex justify-between items-center p-4 border-b">
          <div>
            <div className="font-bold">👤 分配订单归属用户</div>
            <div className="text-xs text-gray-500 mt-1">
              订单号 <span className="font-mono">{order.order_no}</span> · 当前归属：
              <b>{order.display_name || order.username || `#${order.user_id}`}</b>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="p-4 border-b">
          <input
            className="field w-full"
            placeholder="搜索用户名 / 显示名 / 邮箱"
            value={q}
            onChange={e => setQ(e.target.value)}
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">没有匹配的用户</div>}
          {filtered.map(u => (
            <label
              key={u.id}
              className={`flex items-center gap-3 px-3 py-2 rounded cursor-pointer hover:bg-blue-50 ${selected === u.id ? 'bg-blue-100' : ''}`}
            >
              <input
                type="radio"
                name="assign-user"
                checked={selected === u.id}
                onChange={() => setSelected(u.id)}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm">
                  <b>{u.display_name || u.username}</b>
                  <span className="text-gray-400 ml-2 text-xs font-mono">@{u.username}</span>
                  {u.id === order.user_id && <span className="ml-2 text-xs text-blue-600">(当前归属)</span>}
                </div>
                {(u.email || u.company) && (
                  <div className="text-xs text-gray-500 truncate">{u.email}{u.company ? ' · ' + u.company : ''}</div>
                )}
              </div>
            </label>
          ))}
        </div>

        <div className="border-t p-3 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost border">取消</button>
          <button onClick={save} disabled={saving || !selected} className="btn btn-primary">
            {saving ? '保存中...' : '✓ 确认分配'}
          </button>
        </div>
      </div>
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
