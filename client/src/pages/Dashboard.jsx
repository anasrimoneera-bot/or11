import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import ReactECharts from 'echarts-for-react';

export default function Dashboard() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/dashboard').then(r => setD(r.data)); }, []);
  if (!d) return <div>加载中...</div>;

  const statusMap = { pending_purchase: '待采购', pending_shipment: '待发货', shipped: '已发货', completed: '已完成', cancelled: '已取消', refunded: '已退款', replaced: '已替换' };
  const countryCode = { 美国: 'US', 英国: 'GB', 德国: 'DE', 法国: 'FR', 荷兰: 'NL', 意大利: 'IT', 西班牙: 'ES', 波兰: 'PL' };
  const pieData = d.status_dist.map(s => ({ name: statusMap[s.status] || s.status, value: s.count }));
  const countryPieData = (d.country_dist || []).map(c => ({ name: `${countryCode[c.country] || c.country} ${c.country}`, value: c.count }));
  const trendOpt = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['订单数量', '亚马逊收入(¥)'], bottom: 0 },
    xAxis: { type: 'category', data: d.trend.map(t => t.day.slice(5)) },
    yAxis: [{ type: 'value' }, { type: 'value' }],
    series: [
      { name: '订单数量', type: 'line', smooth: true, areaStyle: { color: 'rgba(96,165,250,0.3)' }, data: d.trend.map(t => t.count), itemStyle: { color: '#3b82f6' } },
      { name: '亚马逊收入(¥)', type: 'line', yAxisIndex: 1, smooth: true, data: d.trend.map(t => Math.round(t.amount || 0)), itemStyle: { color: '#10b981' } },
    ],
  };
  const pieOpt = {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [{ type: 'pie', radius: ['40%', '70%'], data: pieData, label: { formatter: '{b}: {c}' } }],
  };
  const countryPieOpt = {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie', radius: ['40%', '70%'], data: countryPieData,
      label: { formatter: '{b}: {c}' },
      itemStyle: { color: function(p) {
        const colors = ['#3b82f6', '#10b981', '#f97316', '#a855f7', '#ec4899', '#06b6d4', '#facc15', '#ef4444'];
        return colors[p.dataIndex % colors.length];
      } },
    }],
  };
  const shopOpt = {
    tooltip: {},
    xAxis: { type: 'category', data: d.shop_dist.map(s => s.shop_name || '其他') },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: d.shop_dist.map(s => s.count), itemStyle: { color: '#f97316' } }],
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">📊 仪表板</h1>
        <span className="badge bg-cyan-100 text-cyan-700 font-medium">DISTRIBUTOR</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat title="账户余额" value={`¥${(d.balance || 0).toFixed(2)}`} bg="bg-emerald-500" icon="💼" to="/balance" />
        <Stat title="我的订单" value={d.orders_total} bg="bg-blue-500" icon="🛒" to="/orders" />
        <Stat title="待处理工单" value={d.pending_tickets} bg="bg-teal-600" icon="📄" to="/after-sales" badge={d.new_message_tickets > 0 ? d.new_message_tickets : 0} />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3 text-orange-600">📈 数据统计</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl p-4 shadow">
            <div className="font-medium mb-2">订单状态分布</div>
            {pieData.length > 0 ? <ReactECharts option={pieOpt} style={{ height: 320 }} /> : <Empty />}
          </div>
          <div className="bg-white rounded-xl p-4 shadow">
            <div className="font-medium mb-2">
              亚马逊收入趋势 <span className="text-xs text-gray-500 font-normal">（按订单锁定的亚马逊汇率换算 CNY）</span>
            </div>
            {d.trend.length > 0 ? <ReactECharts option={trendOpt} style={{ height: 320 }} /> : <Empty />}
          </div>
          <div className="bg-white rounded-xl p-4 shadow">
            <div className="font-medium mb-2">订单国家分布</div>
            {countryPieData.length > 0 ? <ReactECharts option={countryPieOpt} style={{ height: 320 }} /> : <Empty />}
          </div>
          <div className="bg-white rounded-xl p-4 shadow">
            <div className="font-medium mb-2">店铺订单分布 <span className="text-xs text-gray-500 font-normal">（最近 30 天）</span></div>
            {d.shop_dist.length > 0 ? <ReactECharts option={shopOpt} style={{ height: 320 }} /> : <Empty />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ title, value, bg, icon, to, badge }) {
  const navigate = useNavigate();
  return (
    <div
      className={`stat-card ${bg} ${to ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
      onClick={to ? () => navigate(to) : undefined}
    >
      <div>
        <div className="text-sm opacity-90 flex items-center gap-2">
          {title}
          {badge > 0 && (
            <span className="inline-flex items-center justify-center bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] px-1 animate-pulse">
              {badge}
            </span>
          )}
        </div>
        <div className="text-3xl font-bold mt-1">{value}</div>
      </div>
      <div className="text-4xl opacity-50">{icon}</div>
    </div>
  );
}

function Empty() {
  return <div className="h-40 flex items-center justify-center text-gray-400">暂无数据</div>;
}
