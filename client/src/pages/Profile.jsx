import { useEffect, useState } from 'react';
import api from '../api';

export default function Profile({ user, setUser }) {
  const [profile, setProfile] = useState({ display_name: '', email: '', phone: '', company: '', address: '' });
  const [stats, setStats] = useState({ orders_total: 0, total_amount: 0 });
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');

  useEffect(() => {
    api.get('/auth/me').then(r => {
      setProfile({
        display_name: r.data.display_name || '',
        email: r.data.email || '',
        phone: r.data.phone || '',
        company: r.data.company || '',
        address: r.data.address || '',
      });
    });
    api.get('/dashboard').then(r => {
      const totalAmt = (r.data.trend || []).reduce((s, t) => s + (t.amount || 0), 0);
      setStats({ orders_total: r.data.orders_total, total_amount: totalAmt });
    });
  }, []);

  const save = async () => {
    try {
      await api.put('/auth/profile', profile);
      if (newPass) {
        if (newPass !== confirmPass) return alert('两次密码不一致');
        await api.post('/auth/change-password', { newPassword: newPass });
        setNewPass(''); setConfirmPass('');
      }
      const me = await api.get('/auth/me');
      setUser(me.data);
      alert('保存成功');
    } catch (e) {
      alert(e.response?.data?.error || '保存失败');
    }
  };

  const initial = (profile.display_name || user?.username || '?').slice(0, 1);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">👤 个人资料</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow p-6 text-center">
          <div className="w-24 h-24 mx-auto rounded-full bg-blue-500 text-white flex items-center justify-center text-3xl font-bold">{initial}</div>
          <div className="text-xl font-semibold mt-3">{profile.display_name || user?.username}</div>
          <div className="text-sm text-gray-500">{profile.email}</div>
          <span className="badge bg-cyan-100 text-cyan-700 mt-2 inline-block">分销商</span>
          <div className="text-sm text-gray-500 mt-3">注册时间: {user?.created_at?.slice(0, 10) || '-'}</div>
          <div className="border-t mt-4 pt-4 text-left">
            <div className="font-semibold mb-2">📊 账户统计</div>
            <div className="flex justify-between text-sm py-1"><span>订单总数</span><b>{stats.orders_total}</b></div>
            <div className="flex justify-between text-sm py-1"><span>成交金额</span><b className="text-green-600">¥{stats.total_amount.toFixed(2)}</b></div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="font-semibold mb-4">编辑个人信息</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm">用户名</label>
                <input className="field bg-gray-50" disabled value={user?.username || ''} />
              </div>
              <div>
                <label className="text-sm">邮箱地址</label>
                <input className="field" value={profile.email} onChange={e => setProfile({ ...profile, email: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm">姓名 (显示名)</label>
                <input className="field" value={profile.display_name} onChange={e => setProfile({ ...profile, display_name: e.target.value })} />
              </div>
              <div>
                <label className="text-sm">公司名称</label>
                <input className="field" value={profile.company} onChange={e => setProfile({ ...profile, company: e.target.value })} />
              </div>
              <div>
                <label className="text-sm">联系电话</label>
                <input className="field" value={profile.phone} onChange={e => setProfile({ ...profile, phone: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm">地址</label>
                <textarea className="field" rows="3" placeholder="请输入详细地址" value={profile.address} onChange={e => setProfile({ ...profile, address: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="font-semibold mb-4">🔒 修改密码</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm">新密码</label>
                <input className="field" type="password" value={newPass} onChange={e => setNewPass(e.target.value)} />
              </div>
              <div>
                <label className="text-sm">确认密码</label>
                <input className="field" type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="请再次输入新密码" />
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={save} className="btn btn-primary">💾 保存更改</button>
            <button onClick={() => location.reload()} className="btn btn-ghost">↺ 重置</button>
          </div>
        </div>
      </div>
    </div>
  );
}
