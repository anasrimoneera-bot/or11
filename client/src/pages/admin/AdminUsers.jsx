import { useEffect, useState } from 'react';
import api from '../../api';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [balanceUser, setBalanceUser] = useState(null);
  const [editUser, setEditUser] = useState(null);

  const load = () => api.get('/admin/users').then(r => setUsers(r.data));
  useEffect(load, []);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">👥 用户管理</h1>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary">+ 创建分销商账户</button>
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">用户名</th>
              <th className="px-3 py-2 text-left">姓名</th>
              <th className="px-3 py-2 text-left">邮箱</th>
              <th className="px-3 py-2 text-left">会员等级</th>
              <th className="px-3 py-2 text-right">SKU限制</th>
              <th className="px-3 py-2 text-right">余额</th>
              <th className="px-3 py-2 text-left">注册时间</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-t hover:bg-gray-50">
                <td className="px-3 py-2">{u.id}</td>
                <td className="px-3 py-2 font-mono">{u.username}</td>
                <td className="px-3 py-2">{u.display_name || '-'}</td>
                <td className="px-3 py-2">{u.email || '-'}</td>
                <td className="px-3 py-2">{u.member_level}</td>
                <td className="px-3 py-2 text-right">{u.sku_limit}</td>
                <td className={`px-3 py-2 text-right font-semibold ${u.balance < 0 ? 'text-red-600' : 'text-green-600'}`}>¥{(u.balance || 0).toFixed(2)}</td>
                <td className="px-3 py-2 text-xs">{u.created_at}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setBalanceUser(u)} className="text-blue-600 text-xs mr-2 hover:underline">充值/扣款</button>
                  <button onClick={() => setEditUser(u)} className="text-gray-600 text-xs hover:underline">编辑</button>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan="9" className="p-6 text-center text-gray-400">暂无用户</td></tr>}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load(); }} />}
      {balanceUser && <BalanceModal user={balanceUser} onClose={() => setBalanceUser(null)} onDone={() => { setBalanceUser(null); load(); }} />}
      {editUser && <EditModal user={editUser} onClose={() => setEditUser(null)} onDone={() => { setEditUser(null); load(); }} />}
    </div>
  );
}

function CreateModal({ onClose, onDone }) {
  const [f, setF] = useState({ username: '', password: '', display_name: '', email: '', member_level: '一级分销', sku_limit: 100 });
  const submit = async () => {
    try { await api.post('/admin/users', f); onDone(); }
    catch (e) { alert(e.response?.data?.error || '创建失败'); }
  };
  return (
    <Modal title="创建分销商账户" onClose={onClose}>
      <input className="field mb-2" placeholder="用户名" value={f.username} onChange={e => setF({ ...f, username: e.target.value })} />
      <input className="field mb-2" type="password" placeholder="密码" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
      <input className="field mb-2" placeholder="姓名" value={f.display_name} onChange={e => setF({ ...f, display_name: e.target.value })} />
      <input className="field mb-2" placeholder="邮箱" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
      <select className="field mb-2" value={f.member_level} onChange={e => setF({ ...f, member_level: e.target.value })}>
        <option>一级分销</option><option>二级分销</option><option>三级分销</option><option>VIP分销</option>
      </select>
      <input className="field mb-4" type="number" placeholder="SKU限制" value={f.sku_limit} onChange={e => setF({ ...f, sku_limit: e.target.value })} />
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" onClick={submit}>创建</button>
      </div>
    </Modal>
  );
}

function BalanceModal({ user, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [type, setType] = useState('充值');
  const [desc, setDesc] = useState('');
  const submit = async () => {
    try {
      const sign = type === '扣除' ? -1 : 1;
      await api.post(`/admin/users/${user.id}/balance`, {
        amount: Math.abs(Number(amount)) * sign,
        type,
        description: desc,
      });
      onDone();
    } catch (e) { alert(e.response?.data?.error || '操作失败'); }
  };
  return (
    <Modal title={`余额操作 - ${user.username}`} onClose={onClose}>
      <div className="bg-blue-50 rounded p-3 mb-3 text-sm">
        当前余额: <b className="text-blue-600 text-lg">¥{user.balance.toFixed(2)}</b>
      </div>
      <label className="text-sm">操作类型</label>
      <select className="field mb-2" value={type} onChange={e => setType(e.target.value)}>
        <option value="充值">充值（增加余额）</option>
        <option value="扣除">扣除（减少余额）</option>
        <option value="退款">售后退款（增加余额）</option>
        <option value="余额调整">余额调整</option>
      </select>
      <label className="text-sm">金额 (¥)</label>
      <input className="field mb-2" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
      <label className="text-sm">描述</label>
      <input className="field mb-4" value={desc} onChange={e => setDesc(e.target.value)} placeholder="例：线下转账充值" />
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" onClick={submit}>提交</button>
      </div>
    </Modal>
  );
}

function EditModal({ user, onClose, onDone }) {
  const [f, setF] = useState({
    display_name: user.display_name || '', email: user.email || '', phone: user.phone || '',
    company: user.company || '', member_level: user.member_level, sku_limit: user.sku_limit, member_days: user.member_days,
  });
  const [newPass, setNewPass] = useState('');
  const submit = async () => {
    await api.put(`/admin/users/${user.id}`, f);
    if (newPass) await api.post(`/admin/users/${user.id}/reset-password`, { password: newPass });
    onDone();
  };
  return (
    <Modal title={`编辑用户 - ${user.username}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <input className="field" placeholder="姓名" value={f.display_name} onChange={e => setF({ ...f, display_name: e.target.value })} />
        <input className="field" placeholder="邮箱" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
        <input className="field" placeholder="电话" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
        <input className="field" placeholder="公司" value={f.company} onChange={e => setF({ ...f, company: e.target.value })} />
        <select className="field" value={f.member_level} onChange={e => setF({ ...f, member_level: e.target.value })}>
          <option>一级分销</option><option>二级分销</option><option>三级分销</option><option>VIP分销</option>
        </select>
        <input className="field" type="number" placeholder="SKU限制" value={f.sku_limit} onChange={e => setF({ ...f, sku_limit: e.target.value })} />
        <input className="field" type="number" placeholder="会员天数" value={f.member_days} onChange={e => setF({ ...f, member_days: e.target.value })} />
        <input className="field" type="password" placeholder="重置密码(留空不改)" value={newPass} onChange={e => setNewPass(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" onClick={submit}>保存</button>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-6 w-[480px] max-h-[90vh] overflow-y-auto">
        <div className="font-semibold text-lg mb-4 flex justify-between">
          {title}
          <button onClick={onClose} className="text-gray-400">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
