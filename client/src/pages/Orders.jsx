import { useEffect, useState } from 'react';
import api from '../api';
import EditableAmount from '../components/EditableAmount.jsx';

const countryCode = { 美国: 'US', 英国: 'GB', 德国: 'DE', 法国: 'FR', 荷兰: 'NL', 意大利: 'IT', 西班牙: 'ES', 波兰: 'PL' };

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
  const [detailId, setDetailId] = useState(null);

  const load = () => {
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v && v !== 'all') params[k] = v; });
    api.get('/orders', { params }).then(r => { setOrders(r.data.rows); setTotal(r.data.total); });
    api.get('/orders/stats').then(r => setStats(r.data));
  };

  useEffect(() => { load(); api.get('/orders/shop-names').then(r => setShops(r.data)); }, []);
  useEffect(load, [filters.status]);

  const reset = () => setFilters({ status: 'all', country: '', shop: '', q: '', start: '', end: '' });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">🛒 订单管理</h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
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
              {shops.map(name => <option key={name} value={name}>{name}</option>)}
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
        {/* 手机端：卡片式列表 */}
        <div className="md:hidden divide-y">
          {orders.map(o => {
            const sales = Number(o.amazon_amount) || 0;
            const purchase = Number(o.purchase_amount_usd) || 0;
            const purchaseCny = Number(o.purchase_amount_cny) || 0;
            const amazonRate = Number(o.amazon_rate_locked) || 0;
            const profit = sales > 0 ? sales - purchase : 0;
            const profitCny = (sales > 0 && amazonRate > 0) ? sales * amazonRate - purchaseCny : 0;
            return (
              <div key={o.id} className="p-3 hover:bg-gray-50 active:bg-gray-100" onClick={() => setDetailId(o.id)}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="font-mono text-xs truncate flex-1">{o.order_no}</div>
                  <span className={`badge ${statusColor[o.status] || 'bg-gray-100'}`}>{statusLabel[o.status] || o.status}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-600 mb-1">
                  <span className="px-1.5 py-0.5 rounded bg-gray-100 font-mono">{countryCode[o.country] || o.country || '-'}</span>
                  <span className="truncate">{o.shop_name || '-'}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                  <div>亚马逊：<b>${sales.toFixed(2)}</b></div>
                  <div>采购：${purchase.toFixed(2)}</div>
                  <div className="text-red-600">采购¥：¥{purchaseCny.toFixed(2)}</div>
                  <div className={profit >= 0 ? 'text-green-700' : 'text-red-600'}>
                    利润：{sales === 0 ? '—' : `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`}
                  </div>
                  {profitCny !== 0 && (
                    <div className={`col-span-2 ${profitCny >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      ¥利润：{profitCny >= 0 ? '+' : ''}¥{profitCny.toFixed(2)}
                    </div>
                  )}
                </div>
                <div className="text-[11px] text-gray-400 mt-1 flex justify-between">
                  <span>{(o.created_at || '').replace('T', ' ').slice(0, 16)}</span>
                  {o.tracking_no && <span className="font-mono truncate ml-2 max-w-[12rem]">📮{o.tracking_no}</span>}
                </div>
              </div>
            );
          })}
          {orders.length === 0 && <div className="p-8 text-center text-gray-400">暂无订单数据</div>}
        </div>

        {/* 桌面端：完整表格 */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left">订单号</th>
                <th className="px-3 py-2 text-left">国家</th>
                <th className="px-3 py-2 text-left">店铺</th>
                <th className="px-3 py-2 text-right" title="亚马逊扣除佣金及税后的实际到账金额">亚马逊金额 (USD)</th>
                <th className="px-3 py-2 text-right">采购(USD)</th>
                <th className="px-3 py-2 text-right">采购(¥)</th>
                <th className="px-3 py-2 text-right">利润 (USD)</th>
                <th className="px-3 py-2 text-right" title="人民币利润 = 亚马逊金额 × 锁定汇率 − 采购(¥)">利润 (¥)</th>
                <th className="px-3 py-2 text-right" title="成本利润率 = 人民币利润 / 人民币采购价">成本利润率</th>
                <th className="px-3 py-2 text-left">物流跟踪号</th>
                <th className="px-3 py-2 text-left">状态</th>
                <th className="px-3 py-2 text-left">创建时间</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => {
                const sales = Number(o.amazon_amount) || 0;
                const purchase = Number(o.purchase_amount_usd) || 0;
                const purchaseCny = Number(o.purchase_amount_cny) || 0;
                const amazonRate = Number(o.amazon_rate_locked) || 0;
                const profit = sales > 0 ? sales - purchase : 0;
                const canComputeCny = sales > 0 && amazonRate > 0;
                const profitCny = canComputeCny ? sales * amazonRate - purchaseCny : 0;
                const canComputeRate = canComputeCny && purchaseCny > 0;
                const profitRate = canComputeRate ? profitCny / purchaseCny : 0;
                return (
                <tr key={o.id} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono">{o.order_no}</td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-mono" title={o.country}>
                      {countryCode[o.country] || o.country || '-'}
                    </span>
                  </td>
                  <td className="px-3 py-2">{o.shop_name || '-'}</td>
                  <td className="px-3 py-2 text-right">
                    <EditableAmount value={o.amazon_amount || 0} onSave={async (v) => { await api.put(`/orders/${o.id}`, { amazon_amount: v }); load(); }} />
                  </td>
                  <td className="px-3 py-2 text-right">${(o.purchase_amount_usd || 0).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right text-red-600">¥{(o.purchase_amount_cny || 0).toFixed(2)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${sales === 0 ? 'text-gray-400' : profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {sales === 0 ? '—' : `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${!canComputeCny ? 'text-gray-400' : profitCny >= 0 ? 'text-green-700' : 'text-red-600'}`}
                      title={canComputeCny ? `按订单锁定亚马逊汇率 ${amazonRate} 计算` : (sales === 0 ? '未填亚马逊金额' : '该国未设亚马逊汇率')}>
                    {!canComputeCny ? '—' : `${profitCny >= 0 ? '+' : ''}¥${profitCny.toFixed(2)}`}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${!canComputeRate ? 'text-gray-400' : profitRate >= 0 ? 'text-green-700' : 'text-red-600'}`}
                      title={canComputeRate ? `按订单锁定亚马逊汇率 ${amazonRate} 计算` : (sales === 0 ? '未填亚马逊金额' : '该国未设亚马逊汇率')}>
                    {!canComputeRate ? '—' : `${profitRate >= 0 ? '+' : ''}${(profitRate * 100).toFixed(2)}%`}
                  </td>
                  <td className="px-3 py-2">{o.tracking_no || '-'}</td>
                  <td className="px-3 py-2">
                    <span className={`badge ${statusColor[o.status] || 'bg-gray-100'}`}>{statusLabel[o.status] || o.status}</span>
                  </td>
                  <td className="px-3 py-2">{(o.created_at || '').replace('T', ' ').slice(0, 19)}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setDetailId(o.id)} className="text-blue-600 hover:underline text-xs mr-2">查看</button>
                  </td>
                </tr>
              );})}
              {orders.length === 0 && <tr><td colSpan="13" className="p-8 text-center text-gray-400">暂无订单数据</td></tr>}
            </tbody>
            {orders.length > 0 && (() => {
              const t = orders.reduce((a, o) => {
                const sales = Number(o.amazon_amount) || 0;
                const purchase = Number(o.purchase_amount_usd) || 0;
                const purchaseCny = Number(o.purchase_amount_cny) || 0;
                const amazonRate = Number(o.amazon_rate_locked) || 0;
                const profit = sales > 0 ? sales - purchase : 0;
                const profitCny = (sales > 0 && amazonRate > 0) ? sales * amazonRate - purchaseCny : 0;
                return {
                  sales: a.sales + sales,
                  purchase: a.purchase + purchase,
                  purchaseCny: a.purchaseCny + purchaseCny,
                  profit: a.profit + profit,
                  profitCny: a.profitCny + profitCny,
                };
              }, { sales: 0, purchase: 0, purchaseCny: 0, profit: 0, profitCny: 0 });
              return (
                <tfoot className="bg-gray-50 border-t-2 font-semibold">
                  <tr>
                    <td className="px-3 py-2.5 text-gray-700" colSpan={3}>📊 本页合计 ({orders.length} 单)</td>
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
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              );
            })()}
          </table>
        </div>
      </div>

      {detailId && <OrderDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

const CURRENCY_BY_COUNTRY = { 美国: 'USD', 英国: 'GBP', 德国: 'EUR', 法国: 'EUR', 荷兰: 'EUR', 意大利: 'EUR', 西班牙: 'EUR', 波兰: 'PLN' };
const CURRENCY_SYMBOL = { USD: '$', EUR: '€', GBP: '£', PLN: 'zł' };

function OrderDetailModal({ id, onClose }) {
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get(`/orders/${id}`)
      .then(r => setOrder(r.data))
      .catch(e => setErr(e.response?.data?.error || '加载失败'));
  }, [id]);

  const currency = order ? (CURRENCY_BY_COUNTRY[order.country] || 'USD') : 'USD';
  const symbol = CURRENCY_SYMBOL[currency];
  const rate = Number(order?.exchange_rate) || 0;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-4 flex flex-col" style={{ maxHeight: 'calc(100vh - 32px)' }}>
        <div className="flex justify-between items-center p-4 border-b">
          <div className="font-bold text-lg">📦 订单详情</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {err && <div className="p-6 text-red-600">{err}</div>}
        {!order && !err && <div className="p-12 text-center text-gray-400">加载中...</div>}

        {order && (
          <div className="overflow-y-auto p-5 space-y-4 text-sm">
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="font-semibold">订单号: <span className="font-mono">{order.order_no}</span></div>
                <div className="text-xs text-gray-500">商品数量: {order.items?.length || 0}</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-gray-700 mb-3">
                <div>国家: <b>{order.country || '-'}</b></div>
                <div>店铺: <b>{order.shop_name || '-'}</b></div>
                <div>币别: <b>{currency} ({symbol})</b></div>
                <div>采购汇率: {rate > 0 ? `1 ${currency} = ${rate.toFixed(4)} CNY` : '-'}</div>
              </div>

              {order.shipping && (
                <>
                  <div className="font-medium mb-2">收货信息：</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-gray-700 mb-3">
                    <div>客户名称: <b>{order.shipping.name || '-'}</b></div>
                    <div>客户电话: {order.shipping.phone || '-'}</div>
                    <div className="col-span-2">地址1: {order.shipping.address1 || '-'}{order.shipping.address2 ? <><br/>地址2: {order.shipping.address2}</> : null}</div>
                    <div>城市: {order.shipping.city || '-'}</div>
                    <div>州/省: {order.shipping.state || '-'}</div>
                    <div>邮编: {order.shipping.postal || '-'}</div>
                  </div>
                </>
              )}

              <div className="font-medium mb-2">商品列表：</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-gray-500 bg-gray-50">
                    <tr>
                      <th className="px-2 py-1.5 text-left">SKU</th>
                      <th className="px-2 py-1.5 text-right">数量</th>
                      <th className="px-2 py-1.5 text-right">采购单价</th>
                      <th className="px-2 py-1.5 text-right">小计</th>
                      <th className="px-2 py-1.5 text-right">小计(CNY)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(order.items || []).map(it => {
                      const qty = Number(it.quantity) || 0;
                      const unit = Number(it.unit_price) || 0;
                      const sub = unit * qty;
                      const subCny = sub * rate;
                      return (
                        <tr key={it.id} className="border-t align-top">
                          <td className="px-2 py-1 font-mono">{it.sku}</td>
                          <td className="px-2 py-1 text-right">{qty}</td>
                          <td className="px-2 py-1 text-right">{symbol}{unit.toFixed(2)}</td>
                          <td className="px-2 py-1 text-right">{symbol}{sub.toFixed(2)}</td>
                          <td className="px-2 py-1 text-right text-red-600">¥{subCny.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-gray-50">
                      <td colSpan="3" className="px-2 py-2 text-right text-gray-600">订单总金额:</td>
                      <td className="px-2 py-2 text-right font-bold">{symbol}{(Number(order.purchase_amount_usd) || 0).toFixed(2)}</td>
                      <td className="px-2 py-2 text-right font-bold text-red-600">¥{(Number(order.purchase_amount_cny) || 0).toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-gray-600">
              <div>状态：<span className="font-medium text-gray-800">{order.status}</span></div>
              <div>创建时间：{(order.created_at || '').replace('T', ' ').slice(0, 19)}</div>
              {order.tracking_no && <div className="col-span-2">物流跟踪号：<span className="font-mono">{order.tracking_no}</span></div>}
            </div>
          </div>
        )}

        <div className="border-t p-3 flex justify-end">
          <button onClick={onClose} className="btn btn-ghost border">关闭</button>
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
