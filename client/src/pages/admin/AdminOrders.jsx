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

// 各国亚马逊站点的结算币种与符号（与 server/db.js seedAmazonRates 保持一致）
const COUNTRY_CURRENCY = { 美国: 'USD', 英国: 'GBP', 德国: 'EUR', 法国: 'EUR', 荷兰: 'EUR', 意大利: 'EUR', 西班牙: 'EUR', 波兰: 'PLN' };
const CURRENCY_SYMBOL = { USD: '$', GBP: '£', EUR: '€', PLN: 'zł' };
const amazonSym = (country) => CURRENCY_SYMBOL[COUNTRY_CURRENCY[country]] || '$';

export default function AdminOrders() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [me, setMe] = useState(null);
  const [filters, setFilters] = useState({ status: 'pending_purchase', q: '' });
  const [confirmOrder, setConfirmOrder] = useState(null);
  const [assignOrder, setAssignOrder] = useState(null);
  const [showManual, setShowManual] = useState(false);
  const [detailOrder, setDetailOrder] = useState(null);
  const isOwner = !!me?.is_owner;
  const canSeeCost = !!me?.is_admin; // 店主+管理员都能看成本相关列（页面本身仅管理员可进）
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const load = () => {
    if (filters.status === 'all' && !filters.q) {
      setRows([]);
      setTotal(0);
      return;
    }
    const params = { limit: pageSize, offset: page * pageSize };
    if (filters.status !== 'all') params.status = filters.status;
    if (filters.q) params.q = filters.q;
    api.get('/admin/orders', { params }).then(r => { setRows(r.data.rows); setTotal(r.data.total || 0); });
  };
  useEffect(() => { api.get('/auth/me').then(r => setMe(r.data)); }, []);
  useEffect(load, [filters.status, page, pageSize]);
  // 搜索：回到第 1 页（若已在第 1 页则直接重查，因为 q 不在依赖里）
  const doSearch = () => { if (page !== 0) setPage(0); else load(); };

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

  const deleteOrder = async (o) => {
    if (!confirm(`确定删除订单 ${o.order_no}？\n若该订单已扣款，将按净扣款金额自动退回分销商余额。\n此操作不可恢复。`)) return;
    try {
      const { data } = await api.delete(`/admin/orders/${o.id}`);
      if (data?.refunded > 0) alert(`已删除，并退回分销商余额 ¥${data.refunded.toFixed(2)}`);
      load();
    } catch (e) { alert(e.response?.data?.error || '删除失败'); }
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
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
        <h1 className="text-2xl font-bold">📋 订单管理</h1>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowManual(true)} className="btn btn-primary" title="手工录入订单（如欧洲等未对接 API 的国家）">➕ 手工新增订单</button>
          {isOwner && <button onClick={recomputeAllMissing} className="btn btn-ghost border" title='把所有"采购¥为0/未计算"的订单按当前汇率补算'>🔄 补算采购¥(零值单)</button>}
          <button onClick={exportDropxlTemplate} className="btn btn-success">📥 导出采购模板</button>
          <button onClick={importHistory} className="btn btn-warning">📥 导入历史订单</button>
          <button onClick={sync} className="btn btn-primary">🔄 从供应商同步跟踪号/状态</button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['all', 'pending_purchase', 'pending_shipment', 'shipped', 'completed', 'cancelled', 'refunded'].map(s => (
          <button key={s} onClick={() => { setFilters({ ...filters, status: s }); setPage(0); }}
            className={`px-3 py-1 rounded text-sm ${filters.status === s ? 'bg-orange-500 text-white' : 'bg-white border'}`}>
            {s === 'all' ? '全部' : statusLabel[s]}
          </button>
        ))}
        <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
          <input className="field flex-1 sm:max-w-xs" placeholder="搜索订单号/用户/店铺" value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') doSearch(); }} />
          <button onClick={doSearch} className="btn btn-warning">搜索</button>
        </div>
      </div>

      {/* 手机端：卡片视图（关键字段+操作；详细数据走详情/确认弹窗） */}
      <div className="md:hidden space-y-2">
        {rows.map(o => {
          const sales = Number(o.amazon_amount) || 0;
          const purchase = Number(o.purchase_amount_usd) || 0;
          const purchaseCny = Number(o.purchase_amount_cny) || 0;
          const profit = sales > 0 ? sales - purchase : 0;
          return (
            <div key={o.id} className="bg-white rounded-lg shadow p-3 text-sm">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-mono text-xs truncate">{o.order_no}</span>
                <span className={`badge ${statusColor[o.status] || 'bg-gray-100'} text-xs`}>{statusLabel[o.status] || o.status}</span>
              </div>
              <div className="text-xs text-gray-600 mb-1 truncate">
                {o.display_name || o.username} · {o.country} / {o.shop_name || '-'}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                <div>亚马逊：<b>{amazonSym(o.country)}{sales.toFixed(2)}</b></div>
                <div>采购：{amazonSym(o.country)}{purchase.toFixed(2)}</div>
                <div className="text-red-600">采购¥：¥{purchaseCny.toFixed(2)}</div>
                <div className={profit >= 0 ? 'text-green-700' : 'text-red-600'}>
                  利润：{sales === 0 ? '—' : `${profit >= 0 ? '+' : ''}${amazonSym(o.country)}${profit.toFixed(2)}`}
                </div>
              </div>
              {(o.dropxl_order_id || o.tracking_no) && (
                <div className="text-[11px] text-gray-500 font-mono mt-1 truncate">
                  {o.dropxl_order_id && <>供应商：{o.dropxl_order_id}　</>}
                  {o.tracking_no && <>{o.shipping_carrier ? `[${o.shipping_carrier}] ` : ''}📮{o.tracking_no}</>}
                </div>
              )}
              <div className="text-[11px] text-gray-400 mt-1">{o.created_at ? new Date(o.created_at).toLocaleString('zh-CN', { hour12: false }) : ''}</div>
              <div className="flex gap-3 text-xs mt-2">
                {o.status === 'pending_purchase' && (
                  <>
                    <button onClick={() => setConfirmOrder(o)} className="text-green-600 hover:underline">确认采购</button>
                    <button onClick={() => setDetailOrder(o)} className="text-blue-600 hover:underline">详情</button>
                  </>
                )}
                <button onClick={() => setAssignOrder(o)} className="text-blue-600 hover:underline">👤 分配</button>
                <button onClick={() => deleteOrder(o)} className="text-red-600 hover:underline">删除</button>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="text-center text-gray-400 p-6 bg-white rounded-lg shadow">
            {filters.status === 'all' && !filters.q ? '请先在上方选择具体状态查看订单' : '暂无订单'}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs [&_th]:whitespace-nowrap">
            <tr>
              <th className="px-3 py-2 text-left">订单号</th>
              <th className="px-3 py-2 text-left">用户</th>
              <th className="px-3 py-2 text-left">国家/店铺</th>
              <th className="px-3 py-2 text-right" title="亚马逊扣除佣金及税后的实际到账金额">亚马逊金额</th>
              <th className="px-3 py-2 text-right">采购(原币)</th>
              <th className="px-3 py-2 text-right">采购(¥)</th>
              <th className="px-3 py-2 text-right" title="按各订单站点币种显示：亚马逊金额 − 采购(USD)">利润(本币)</th>
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
                    prefix={amazonSym(o.country)}
                    onSave={async (v) => { await api.put(`/admin/orders/${o.id}`, { amazon_amount: v }); load(); }}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  {isOwner ? (
                    <EditableAmount
                      value={o.purchase_amount_usd || 0}
                      prefix={amazonSym(o.country)}
                      onSave={async (v) => { await api.put(`/admin/orders/${o.id}/purchase-price`, { purchase_amount_usd: v }); load(); }}
                    />
                  ) : (
                    <>{amazonSym(o.country)}{(o.purchase_amount_usd || 0).toFixed(2)}</>
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
                <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${sales === 0 ? 'text-gray-400' : profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {sales === 0 ? '—' : `${profit >= 0 ? '+' : ''}${amazonSym(o.country)}${profit.toFixed(2)}`}
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
                <td className="px-3 py-2 text-xs">
                  {o.shipping_carrier && <div className="text-gray-400 text-[11px] mb-0.5">{o.shipping_carrier}</div>}
                  <TrackingCell order={o} onSave={async (v) => { await api.put(`/admin/orders/${o.id}`, { tracking_no: v }); load(); }} />
                </td>
                <td className="px-3 py-2">
                  <StatusCell order={o} onSave={async (v) => { await api.put(`/admin/orders/${o.id}`, { status: v }); load(); }} />
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap" title={o.created_at}>
                  {o.created_at ? new Date(o.created_at).toLocaleString('zh-CN', { hour12: false }) : '-'}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {o.status === 'pending_purchase' && (
                    <>
                      <button onClick={() => setConfirmOrder(o)} className="text-green-600 hover:underline text-xs">确认采购</button>
                      <button onClick={() => setDetailOrder(o)} className="text-blue-600 hover:underline text-xs ml-2">详情</button>
                    </>
                  )}
                  <button onClick={() => deleteOrder(o)} className="text-red-600 hover:underline text-xs ml-2">删除</button>
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
              // 各国币种不同，亚马逊金额无法直接相加，统一按各自锁定汇率折人民币再合计
              const salesCny = (sales > 0 && amazonRate > 0) ? sales * amazonRate : 0;
              const profitCny = (sales > 0 && amazonRate > 0) ? salesCny - purchaseCny : 0;
              // 店主成本列合计：真实(USD) / 真实采购价(¥) / 差价利润(¥)
              const realUsd = Number(o.real_amount_usd) || 0;
              const paypalRate = Number(o.paypal_rate) || 0;
              const realCny = paypalRate > 0 ? realUsd / paypalRate : 0; // 未填 PayPal 汇率的不计入
              const profitDiff = paypalRate > 0 ? purchaseCny - realCny : 0;
              return {
                salesCny: a.salesCny + salesCny,
                purchase: a.purchase + purchase,
                purchaseCny: a.purchaseCny + purchaseCny,
                profit: a.profit + profit,
                profitCny: a.profitCny + profitCny,
                realUsd: a.realUsd + realUsd,
                realCny: a.realCny + realCny,
                profitDiff: a.profitDiff + profitDiff,
              };
            }, { salesCny: 0, purchase: 0, purchaseCny: 0, profit: 0, profitCny: 0, realUsd: 0, realCny: 0, profitDiff: 0 });
            // 利润(本币)各单币种可能不同，仅当本页只有一种站点币种时才合计，否则以利润(¥)合计为准
            const profitCurs = new Set(rows.filter(o => (Number(o.amazon_amount) || 0) > 0).map(o => COUNTRY_CURRENCY[o.country] || 'USD'));
            const profitSym = profitCurs.size <= 1 ? (CURRENCY_SYMBOL[[...profitCurs][0]] || '$') : null;
            return (
              <tfoot className="bg-gray-50 border-t-2 font-semibold">
                <tr>
                  <td className="px-3 py-2.5 text-gray-700" colSpan={3}>📊 本页合计 ({rows.length} 单)</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap" title="各国币种不同，按各订单锁定汇率折算人民币后合计">¥{t.salesCny.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">${t.purchase.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right text-red-600 whitespace-nowrap">¥{t.purchaseCny.toFixed(2)}</td>
                  <td className={`px-3 py-2.5 text-right whitespace-nowrap ${!profitSym ? 'text-gray-400' : t.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}
                      title={profitSym ? '' : '本页含多种站点币种，无法直接合计，请看利润(¥)合计'}>
                    {!profitSym ? '—' : `${t.profit >= 0 ? '+' : ''}${profitSym}${t.profit.toFixed(2)}`}
                  </td>
                  <td className={`px-3 py-2.5 text-right whitespace-nowrap ${t.profitCny >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {t.profitCny >= 0 ? '+' : ''}¥{t.profitCny.toFixed(2)}
                  </td>
                  <td className={`px-3 py-2.5 text-right whitespace-nowrap ${(t.purchaseCny > 0 && t.profitCny >= 0) ? 'text-green-700' : t.purchaseCny > 0 ? 'text-red-600' : 'text-gray-400'}`}
                      title="本页合计：总人民币利润 / 总人民币采购价">
                    {t.purchaseCny <= 0 ? '—' : `${(t.profitCny / t.purchaseCny) >= 0 ? '+' : ''}${((t.profitCny / t.purchaseCny) * 100).toFixed(2)}%`}
                  </td>
                  {canSeeCost && <>
                    <td className="px-3 py-2.5 text-right text-red-600 whitespace-nowrap">${t.realUsd.toFixed(2)}</td>
                    <td />
                    <td />
                    <td className="px-3 py-2.5 text-right text-red-600 whitespace-nowrap">¥{t.realCny.toFixed(2)}</td>
                    <td className={`px-3 py-2.5 text-right whitespace-nowrap ${t.profitDiff >= 0 ? 'text-green-700' : 'text-red-600'}`}>
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

      {!(filters.status === 'all' && !filters.q) && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <div>共 {total} 单</div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1">每页
              <select className="field py-1" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }}>
                {[20, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              条
            </label>
            <button className="btn btn-ghost border disabled:opacity-40" disabled={page <= 0} onClick={() => setPage(p => Math.max(0, p - 1))}>上一页</button>
            <span>{page + 1} / {pageCount}</span>
            <button className="btn btn-ghost border disabled:opacity-40" disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)}>下一页</button>
          </div>
        </div>
      )}

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

      {showManual && (
        <ManualOrderModal
          onClose={() => setShowManual(false)}
          onDone={() => { setShowManual(false); load(); }}
        />
      )}

      {detailOrder && (
        <OrderDetailModal
          orderId={detailOrder.id}
          onClose={() => setDetailOrder(null)}
          onSaved={() => load()}
        />
      )}
    </div>
  );
}

// 订单详情（BOSS/管理员，待采购单）。可订正分销商填错的买家收货地址。
function OrderDetailModal({ orderId, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [ship, setShip] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const load = () => {
    api.get(`/admin/orders/${orderId}`).then(r => {
      setData(r.data);
      setShip(prev => prev || {
        name: '', phone: '', buyer_email: '', address1: '', address2: '',
        city: '', state: '', postal: '', country: '',
        ...(r.data.shipping || {}),
      });
    }).catch(() => setData({ error: true }));
  };
  useEffect(() => { load(); }, [orderId]);
  const setS = (k, v) => setShip(p => ({ ...p, [k]: v }));
  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/admin/orders/${orderId}/shipping`, ship);
      alert('收货地址已保存（仅更新本地记录，不会自动同步到供应商系统）');
      onSaved?.();
    } catch (e) { alert(e.response?.data?.error || '保存失败'); }
    finally { setSaving(false); }
  };
  const pushDropxl = async () => {
    if (!confirm('把该订单（按当前买家地址）推送到供应商创建？\n建议先保存订正后的省份/地址再推送。')) return;
    setPushing(true);
    try {
      const { data: r } = await api.post(`/admin/orders/${orderId}/push-dropxl`);
      alert(`推送成功${r.dropxl_order_id ? `，供应商订单号：${r.dropxl_order_id}` : ''}`);
      load();
      onSaved?.();
    } catch (e) { alert(e.response?.data?.error || '推送失败'); }
    finally { setPushing(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-4 flex flex-col" style={{ maxHeight: 'calc(100vh - 32px)' }}>
        <div className="flex justify-between items-center p-4 border-b">
          <div className="font-bold">订单详情 {data?.order_no && <span className="font-mono text-sm text-gray-500 ml-2">{data.order_no}</span>}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
        {!data ? <div className="p-8 text-center text-gray-400">加载中...</div>
          : data.error ? <div className="p-8 text-center text-red-500">加载失败</div>
          : (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-gray-700">
              <div>用户: <b>{data.display_name || data.username}</b></div>
              <div>国家/店铺: <b>{data.country} / {data.shop_name || '-'}</b></div>
              <div>采购(原币): {amazonSym(data.country)}{Number(data.purchase_amount_usd || 0).toFixed(2)}</div>
              <div>采购(¥): <span className="text-red-600">¥{Number(data.purchase_amount_cny || 0).toFixed(2)}</span></div>
            </div>

            <div>
              <div className="font-medium mb-1">商品明细</div>
              <table className="w-full text-xs border-t">
                <thead className="text-gray-500"><tr>
                  <th className="px-2 py-1 text-left">SKU</th>
                  <th className="px-2 py-1 text-left">名称</th>
                  <th className="px-2 py-1 text-right">数量</th>
                  <th className="px-2 py-1 text-right">单价</th>
                </tr></thead>
                <tbody>
                  {(data.items || []).map(it => (
                    <tr key={it.id} className="border-t">
                      <td className="px-2 py-1 font-mono">{it.sku}</td>
                      <td className="px-2 py-1">{it.product_name || '—'}</td>
                      <td className="px-2 py-1 text-right">{it.quantity}</td>
                      <td className="px-2 py-1 text-right">${Number(it.unit_price || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                  {(data.items || []).length === 0 && <tr><td colSpan={4} className="px-2 py-3 text-center text-gray-400">无商品明细</td></tr>}
                </tbody>
              </table>
            </div>

            <div>
              <div className="font-medium mb-1">📍 买家收货地址（可订正邮编/省份等）</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <MoField label="收件人"><input className="field w-full" value={ship.name || ''} onChange={e => setS('name', e.target.value)} /></MoField>
                <MoField label="电话"><input className="field w-full" value={ship.phone || ''} onChange={e => setS('phone', e.target.value)} /></MoField>
                <MoField label="邮箱"><input className="field w-full" value={ship.buyer_email || ''} onChange={e => setS('buyer_email', e.target.value)} /></MoField>
                <MoField label="国家代码"><input className="field w-full" value={ship.country || ''} onChange={e => setS('country', e.target.value)} /></MoField>
                <MoField label="地址1"><input className="field w-full" value={ship.address1 || ''} onChange={e => setS('address1', e.target.value)} /></MoField>
                <MoField label="地址2"><input className="field w-full" value={ship.address2 || ''} onChange={e => setS('address2', e.target.value)} /></MoField>
                <MoField label="城市"><input className="field w-full" value={ship.city || ''} onChange={e => setS('city', e.target.value)} /></MoField>
                <MoField label="州/省"><input className="field w-full" value={ship.state || ''} onChange={e => setS('state', e.target.value)} /></MoField>
                <MoField label="邮编"><input className="field w-full" value={ship.postal || ''} onChange={e => setS('postal', e.target.value)} /></MoField>
              </div>
              <div className="text-xs text-amber-600 mt-2">⚠️ 地址修改只更新本地记录，不会自动同步到供应商系统（DropXL 无修改订单接口）；已成功推送的订单如需改地址，请另行联系供应商。</div>
            </div>

            <div className="border-t pt-3">
              <div className="font-medium mb-1">🚚 供应商(DropXL)推送</div>
              {data.dropxl_order_id ? (
                <div className="text-green-700">已成功推送，供应商订单号：<b className="font-mono">{data.dropxl_order_id}</b></div>
              ) : (
                <>
                  <div className={data.dropxl_push_status === 'failed' ? 'text-red-600' : 'text-gray-500'}>
                    {data.dropxl_push_status === 'failed' ? '推送失败（订单尚未在供应商创建）' : '尚未推送到供应商'}
                  </div>
                  {data.dropxl_push_error && <div className="text-xs text-red-500 mt-1 break-all">错误：{data.dropxl_push_error}</div>}
                  <div className="text-xs text-gray-500 mt-1">省份需填供应商要求的简写（如 CA / NY）。订正省份并保存后，点下方「推送到供应商」即可创建订单。</div>
                  <button onClick={pushDropxl} disabled={pushing} className="btn btn-success mt-2 text-sm">{pushing ? '推送中...' : '🚚 推送到供应商'}</button>
                </>
              )}
            </div>
          </div>
        )}
        <div className="border-t p-3 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost border">关闭</button>
          {data && !data.error && <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? '保存中...' : '✓ 保存地址'}</button>}
        </div>
      </div>
    </div>
  );
}

const MO_COUNTRIES = Object.keys(COUNTRY_CURRENCY);

function MoField({ label, children }) {
  return <div><label className="text-xs text-gray-500 block mb-0.5">{label}</label>{children}</div>;
}

// 点击就地编辑跟踪号（BOSS/管理员）。留空保存即清除跟踪号。
function TrackingCell({ order, onSave }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(order.tracking_no || '');
  useEffect(() => { setV(order.tracking_no || ''); }, [order.tracking_no]);
  if (editing) {
    return (
      <input
        autoFocus
        className="border border-blue-400 rounded px-1 py-0.5 text-xs w-32 focus:outline-none"
        value={v}
        placeholder="多个用逗号分隔"
        onChange={e => setV(e.target.value)}
        onBlur={async () => { if (v !== (order.tracking_no || '')) await onSave(v); setEditing(false); }}
        onKeyDown={async e => {
          if (e.key === 'Enter') { if (v !== (order.tracking_no || '')) await onSave(v); setEditing(false); }
          else if (e.key === 'Escape') { setV(order.tracking_no || ''); setEditing(false); }
        }}
      />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} title="点击填写/修改跟踪号" className="text-left hover:bg-blue-50 rounded px-1 w-full">
      {order.tracking_no
        ? order.tracking_no.split(',').map((t, i) => <div key={i} className="whitespace-nowrap">{t.trim()}</div>)
        : <span className="text-blue-500">＋填写</span>}
    </button>
  );
}

// 点击切换为下拉，手动调整订单状态（BOSS/管理员）。
function StatusCell({ order, onSave }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <select
        autoFocus
        className="border border-blue-400 rounded px-1 py-0.5 text-xs focus:outline-none"
        value={order.status}
        onChange={async e => { if (e.target.value !== order.status) await onSave(e.target.value); setEditing(false); }}
        onBlur={() => setEditing(false)}
      >
        {Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} title="点击调整状态" className={`badge cursor-pointer ${statusColor[order.status] || 'bg-gray-100'}`}>
      {statusLabel[order.status] || order.status} ▾
    </button>
  );
}

// 手工新增订单（欧洲等未对接 API 的国家）。真实成本/加价%/PayPal汇率仅店主侧记录，
// 分销商 /api/orders 列白名单不返回这些字段，分销商绝对看不到。
function ManualOrderModal({ onClose, onDone }) {
  const [users, setUsers] = useState([]);
  const [uq, setUq] = useState('');
  const [f, setF] = useState({
    user_id: '', order_no: '', country: '德国', shop_name: '',
    amazon_amount: '', real_amount_usd: '', markup_pct: '', exchange_rate: '',
    paypal_rate: '', tracking_no: '', status: 'pending_shipment',
  });
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.get('/admin/users').then(r => setUsers(r.data || [])); }, []);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const realUsd = Number(f.real_amount_usd) || 0;
  const markup = Number(f.markup_pct) || 0;
  const displayUsd = realUsd * (1 + markup / 100);
  const filtered = users.filter(u => {
    const k = uq.trim().toLowerCase();
    if (!k) return true;
    return (u.username || '').toLowerCase().includes(k) || (u.display_name || '').toLowerCase().includes(k);
  });
  const addItem = () => setItems(p => [...p, { sku: '', product_name: '', quantity: 1, unit_price: '' }]);
  const setItem = (i, k, v) => setItems(p => p.map((it, idx) => idx === i ? { ...it, [k]: v } : it));
  const rmItem = (i) => setItems(p => p.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!f.user_id) return alert('请选择分销商');
    if (!f.order_no.trim()) return alert('请填写订单号');
    if (f.real_amount_usd === '' || !(realUsd >= 0)) return alert('请填写真实采购成本(USD)');
    if (f.markup_pct === '') return alert('请填写加价%');
    setSaving(true);
    try {
      await api.post('/admin/orders/manual', {
        user_id: Number(f.user_id),
        order_no: f.order_no.trim(),
        country: f.country,
        shop_name: f.shop_name || null,
        amazon_amount: Number(f.amazon_amount) || 0,
        real_amount_usd: realUsd,
        markup_pct: markup,
        exchange_rate: f.exchange_rate === '' ? undefined : Number(f.exchange_rate),
        paypal_rate: f.paypal_rate === '' ? null : Number(f.paypal_rate),
        tracking_no: f.tracking_no || null,
        status: f.status,
        items: items.filter(it => it.sku.trim()).map(it => ({
          sku: it.sku.trim(), product_name: it.product_name,
          quantity: Number(it.quantity) || 1, unit_price: Number(it.unit_price) || 0,
        })),
      });
      onDone();
    } catch (e) { alert(e.response?.data?.error || '新增失败'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl flex flex-col" style={{ maxHeight: '90vh' }}>
        <div className="flex justify-between items-center p-4 border-b">
          <div className="font-bold">➕ 手工新增订单<span className="text-xs text-gray-500 font-normal ml-2">用于欧洲等未对接 API、在其他系统采购的订单</span></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-0.5">归属分销商 *</label>
            <input className="field w-full mb-1" placeholder="搜索用户名 / 姓名" value={uq} onChange={e => setUq(e.target.value)} />
            <div className="border rounded max-h-32 overflow-y-auto">
              {filtered.map(u => (
                <label key={u.id} className={`flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-blue-50 ${Number(f.user_id) === u.id ? 'bg-blue-100' : ''}`}>
                  <input type="radio" name="mo-user" checked={Number(f.user_id) === u.id} onChange={() => set('user_id', String(u.id))} />
                  <span className="text-sm">{u.display_name || u.username} <span className="text-gray-400 text-xs">@{u.username}</span></span>
                </label>
              ))}
              {filtered.length === 0 && <div className="text-xs text-gray-400 p-2">无匹配用户</div>}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <MoField label="订单号(亚马逊) *"><input className="field w-full" value={f.order_no} onChange={e => set('order_no', e.target.value)} /></MoField>
            <MoField label="国家 *">
              <select className="field w-full" value={f.country} onChange={e => set('country', e.target.value)}>
                {MO_COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </MoField>
            <MoField label="店铺"><input className="field w-full" value={f.shop_name} onChange={e => set('shop_name', e.target.value)} /></MoField>
            <MoField label="状态">
              <select className="field w-full" value={f.status} onChange={e => set('status', e.target.value)}>
                {Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </MoField>
            <MoField label={`亚马逊金额(${COUNTRY_CURRENCY[f.country] || 'USD'})`}><input type="number" step="0.01" className="field w-full" value={f.amazon_amount} onChange={e => set('amazon_amount', e.target.value)} /></MoField>
            <MoField label="跟踪号"><input className="field w-full" value={f.tracking_no} onChange={e => set('tracking_no', e.target.value)} placeholder="多个用逗号分隔" /></MoField>
          </div>
          <div className="bg-red-50 border border-red-200 rounded p-3">
            <div className="text-xs text-red-600 mb-2">⚠️ 以下成本/利润信息分销商绝对看不到：</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <MoField label="真实采购成本(USD) *"><input type="number" step="0.01" className="field w-full" value={f.real_amount_usd} onChange={e => set('real_amount_usd', e.target.value)} /></MoField>
              <MoField label="加价% *"><input type="number" step="0.01" className="field w-full" value={f.markup_pct} onChange={e => set('markup_pct', e.target.value)} /></MoField>
              <MoField label="采购汇率"><input type="number" step="0.0001" className="field w-full" value={f.exchange_rate} onChange={e => set('exchange_rate', e.target.value)} placeholder="留空=当前国家汇率" /></MoField>
              <MoField label="PayPal汇率"><input type="number" step="0.00001" className="field w-full" value={f.paypal_rate} onChange={e => set('paypal_rate', e.target.value)} placeholder="可选" /></MoField>
            </div>
            <div className="text-sm mt-2 text-gray-700">
              分销商采购价(USD) = <b className="text-green-700">${displayUsd.toFixed(2)}</b>
              <span className="text-xs text-gray-500 ml-1">(= 真实 ×(1+加价%)；保存后按采购汇率折成¥并从该分销商余额扣款)</span>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-500">商品明细（可选）</label>
              <button type="button" onClick={addItem} className="text-xs text-blue-600 hover:underline">+ 添加商品行</button>
            </div>
            {items.map((it, i) => (
              <div key={i} className="flex gap-1 mt-1">
                <input className="field flex-1" placeholder="SKU" value={it.sku} onChange={e => setItem(i, 'sku', e.target.value)} />
                <input className="field flex-1" placeholder="名称" value={it.product_name} onChange={e => setItem(i, 'product_name', e.target.value)} />
                <input type="number" className="field w-16" placeholder="数量" value={it.quantity} onChange={e => setItem(i, 'quantity', e.target.value)} />
                <input type="number" className="field w-20" placeholder="单价" value={it.unit_price} onChange={e => setItem(i, 'unit_price', e.target.value)} />
                <button type="button" onClick={() => rmItem(i)} className="text-red-500 px-1">×</button>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t p-3 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost border">取消</button>
          <button onClick={submit} disabled={saving} className="btn btn-primary">{saving ? '保存中...' : '✓ 新增并扣款'}</button>
        </div>
      </div>
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
      <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="font-semibold text-lg mb-4">确认采购订单</div>
        <div className="bg-gray-50 rounded p-3 mb-4 text-sm space-y-1">
          <div>订单号：<span className="font-mono">{order.order_no}</span></div>
          <div>用户：{order.display_name || order.username}</div>
          <div>国家/店铺：{order.country} / {order.shop_name}</div>
          <div>供应商订单 ID：<span className="font-mono">{order.dropxl_order_id || '(未创建)'}</span></div>
          <div className="text-blue-700">系统计算采购价：<b>{amazonSym(order.country)}{(order.purchase_amount_usd || 0).toFixed(2)}</b></div>
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
