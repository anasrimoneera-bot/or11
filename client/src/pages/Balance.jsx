import { useEffect, useState } from 'react';
import api from '../api';

const typeColor = {
  '充值': 'bg-green-100 text-green-700',
  '余额调整': 'bg-green-100 text-green-700',
  '扣除': 'bg-red-100 text-red-700',
  '退款': 'bg-blue-100 text-blue-700',
  'purchase_undo': 'bg-purple-100 text-purple-700',
};

export default function Balance() {
  const [data, setData] = useState({ rows: [], balance: 0 });
  const [user, setUser] = useState(null);

  const load = () => {
    api.get('/balance').then(r => setData(r.data));
    api.get('/auth/me').then(r => setUser(r.data));
  };
  useEffect(load, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">💼 我的余额记录</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <BigStat title="人民币余额" value={`¥${(data.balance || 0).toFixed(2)}`} icon="¥" bg="bg-red-500" />
        <BigStat title="会员等级" value={user?.member_level || '一级分销'} icon="V" bg="bg-orange-500" />
        <BigStat title="会员天数" value={`${user?.member_days || 0} 天`} icon="D" bg="bg-indigo-500" />
      </div>

      <div className="rounded-xl shadow overflow-hidden">
        <div className="bg-purple-600 text-white p-4 font-medium">📓 人民币余额变动记录</div>
        <div className="bg-white">
          {/* 手机端：卡片视图 */}
          <div className="md:hidden divide-y">
            {data.rows.map(r => (
              <div key={r.id} className="p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className={`badge ${typeColor[r.type] || 'bg-gray-100'}`}>{r.type}</span>
                  <span className={`font-semibold ${r.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {r.amount >= 0 ? '+' : ''}¥{Math.abs(r.amount).toFixed(2)}
                  </span>
                </div>
                <div className="text-xs text-gray-700 mb-0.5">{r.description}</div>
                <div className="text-[11px] text-gray-400 flex justify-between gap-2">
                  <span>{r.created_at}</span>
                  <span>余额：¥{r.balance_after.toFixed(2)}</span>
                </div>
                {r.related_order && <div className="text-[11px] text-blue-600 font-mono mt-0.5">关联：{r.related_order}</div>}
              </div>
            ))}
            {data.rows.length === 0 && <div className="p-8 text-center text-gray-400">暂无变动记录</div>}
          </div>
          {/* 桌面端：表格 */}
          <table className="w-full text-sm hidden md:table">
            <thead className="text-gray-500 bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">时间</th>
                <th className="px-3 py-2 text-left">用户</th>
                <th className="px-3 py-2 text-left">类型</th>
                <th className="px-3 py-2 text-right">金额</th>
                <th className="px-3 py-2 text-right">当前余额</th>
                <th className="px-3 py-2 text-left">描述</th>
                <th className="px-3 py-2 text-left">关联订单</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => (
                <tr key={r.id} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2">{r.created_at}</td>
                  <td className="px-3 py-2">{user?.display_name || user?.username}</td>
                  <td className="px-3 py-2"><span className={`badge ${typeColor[r.type] || 'bg-gray-100'}`}>{r.type}</span></td>
                  <td className={`px-3 py-2 text-right font-semibold ${r.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {r.amount >= 0 ? '+' : ''}¥{Math.abs(r.amount).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right">¥{r.balance_after.toFixed(2)}</td>
                  <td className="px-3 py-2">{r.description}</td>
                  <td className="px-3 py-2 font-mono">
                    {r.related_order ? <button className="text-blue-600 hover:underline">{r.related_order}</button> : '-'}
                  </td>
                </tr>
              ))}
              {data.rows.length === 0 && <tr><td colSpan="7" className="p-8 text-center text-gray-400">暂无变动记录</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

function BigStat({ title, value, icon, bg }) {
  return (
    <div className={`${bg} text-white rounded-xl p-5 flex items-center gap-4`}>
      <div className="w-12 h-12 rounded-full bg-white/30 flex items-center justify-center text-2xl font-bold">{icon}</div>
      <div>
        <div className="text-sm opacity-90">{title}</div>
        <div className="text-2xl font-bold">{value}</div>
      </div>
    </div>
  );
}
