import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [me, setMe] = useState(null);
  useEffect(() => {
    api.get('/admin/overview').then(r => setD(r.data));
    api.get('/auth/me').then(r => setMe(r.data));
  }, []);
  if (!d) return <div>加载中...</div>;
  const isOwner = !!me?.is_owner;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">👨‍💼 管理控制台</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <Stat title="分销商总数" value={d.totalUsers} bg="bg-blue-500" icon="👥" onClick={() => navigate('/admin/users')} />
        <Stat title="待确认订单" value={d.pendingOrders} bg="bg-orange-500" icon="📋" onClick={() => navigate('/admin/orders')} />
        <Stat title="待处理工单" value={d.pendingTickets} bg="bg-pink-500" icon="🔧" onClick={() => navigate('/admin/aftersales')} />
        <Stat title="用户余额总计" value={`¥${(d.totalBalance || 0).toFixed(2)}`} bg="bg-green-500" icon="💰" />
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="font-semibold mb-3">📝 快速指引</h2>
        {isOwner ? (
          <ul className="list-disc list-inside text-sm space-y-2 text-gray-700">
            <li>用户提交采购订单后会立即调用供应商接口创建订单，结果显示在「订单审核」</li>
            <li>管理员在「订单审核」填写采购价格 + 汇率，确认后系统从用户余额扣除对应金额</li>
            <li>用户提交售后工单后由管理员在「售后管理」与供应商对接，处理完毕后可一键退款到用户余额</li>
            <li>「供应商接口测试」页面可发送测试请求查看接口实际响应</li>
          </ul>
        ) : (
          <ul className="list-disc list-inside text-sm space-y-2 text-gray-700">
            <li>用户提交采购订单后会自动同步到「订单审核」，需要您审核确认</li>
            <li>在「订单审核」填写汇率、确认订单，系统会自动扣除用户余额</li>
            <li>「售后管理」处理用户提交的工单，与供应商对接</li>
            <li>「用户管理」可以查看用户信息、充值或退款余额</li>
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ title, value, bg, icon, onClick }) {
  return (
    <div
      onClick={onClick}
      className={`${bg} text-white rounded-xl p-5 flex items-center justify-between ${onClick ? 'cursor-pointer hover:opacity-90 transition' : ''}`}
    >
      <div>
        <div className="text-sm opacity-80">{title}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
      </div>
      <div className="text-4xl opacity-50">{icon}</div>
    </div>
  );
}
