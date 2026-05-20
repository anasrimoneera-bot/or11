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
  const [showRecharge, setShowRecharge] = useState(false);

  const load = () => {
    api.get('/balance').then(r => setData(r.data));
    api.get('/auth/me').then(r => setUser(r.data));
  };
  useEffect(load, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">💼 我的余额记录</h1>
        <button onClick={() => setShowRecharge(true)} className="btn btn-primary">+ 充值/调整</button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <BigStat title="人民币余额" value={`¥${(data.balance || 0).toFixed(2)}`} icon="¥" bg="bg-red-500" />
        <BigStat title="会员等级" value={user?.member_level || '一级分销'} icon="V" bg="bg-orange-500" />
        <BigStat title="会员天数" value={`${user?.member_days || 0} 天`} icon="D" bg="bg-indigo-500" />
        <BigStat title="SKU数量限制" value={user?.sku_limit || 0} icon="S" bg="bg-pink-500" />
      </div>

      <div className="rounded-xl shadow overflow-hidden">
        <div className="bg-purple-600 text-white p-4 font-medium">📓 人民币余额变动记录</div>
        <div className="bg-white">
          <table className="w-full text-sm">
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

      {showRecharge && <RechargeModal onClose={() => setShowRecharge(false)} onDone={() => { setShowRecharge(false); load(); }} />}
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

function RechargeModal({ onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const submit = async () => {
    try {
      await api.post('/balance/recharge', { amount: Number(amount), description: desc });
      onDone();
    } catch (e) {
      alert(e.response?.data?.error || '提交失败');
    }
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 w-96">
        <div className="font-semibold text-lg mb-4">充值/余额调整</div>
        <label className="text-sm">金额 (人民币, 可为负数代表扣除)</label>
        <input type="number" className="field mb-3" value={amount} onChange={e => setAmount(e.target.value)} />
        <label className="text-sm">描述</label>
        <input className="field mb-4" value={desc} onChange={e => setDesc(e.target.value)} placeholder="例：线下转账充值" />
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={submit}>提交</button>
        </div>
      </div>
    </div>
  );
}
