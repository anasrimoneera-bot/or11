import { useEffect, useState } from 'react';
import api from '../../api';

export default function AdminStaff() {
  const [list, setList] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [resetUser, setResetUser] = useState(null);

  const load = () => api.get('/admin/staff').then(r => setList(r.data));
  useEffect(load, []);

  const del = async (s) => {
    if (!confirm(`确认删除员工账号 ${s.username}？此操作不可恢复。`)) return;
    await api.delete(`/admin/staff/${s.id}`);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">🛡️ 员工管理</h1>
          <p className="text-sm text-gray-500 mt-1">员工可登录后台日常操作，但<b className="text-red-600">看不到加价百分比、真实采购价、利润等敏感数据</b></p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary">+ 创建员工账号</button>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm">
        💡 <b>权限说明：</b>
        <ul className="list-disc list-inside mt-1 space-y-0.5 text-gray-700">
          <li>员工可以：管理用户、确认订单（不知真实成本）、处理售后、给用户充值/退款</li>
          <li>员工<b className="text-red-600">看不到</b>：每个用户的加价百分比、订单的真实 DropXL 采购价、利润金额、DropXL API 测试页</li>
          <li>仅店主可以：修改加价百分比、查看真实成本、调用 DropXL 测试 API</li>
        </ul>
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">用户名</th>
              <th className="px-3 py-2 text-left">姓名</th>
              <th className="px-3 py-2 text-left">邮箱</th>
              <th className="px-3 py-2 text-left">创建时间</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {list.map(s => (
              <tr key={s.id} className="border-t hover:bg-gray-50">
                <td className="px-3 py-2">{s.id}</td>
                <td className="px-3 py-2 font-mono">{s.username}</td>
                <td className="px-3 py-2">{s.display_name || '-'}</td>
                <td className="px-3 py-2">{s.email || '-'}</td>
                <td className="px-3 py-2 text-xs">{s.created_at}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setResetUser(s)} className="text-blue-600 text-xs mr-3 hover:underline">重置密码</button>
                  <button onClick={() => del(s)} className="text-red-500 text-xs hover:underline">删除</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="6" className="p-8 text-center text-gray-400">暂无员工账号，点击右上角创建</td></tr>}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load(); }} />}
      {resetUser && <ResetModal user={resetUser} onClose={() => setResetUser(null)} onDone={() => setResetUser(null)} />}
    </div>
  );
}

function CreateModal({ onClose, onDone }) {
  const [f, setF] = useState({ username: '', password: '', display_name: '', email: '' });
  const submit = async () => {
    try { await api.post('/admin/staff', f); onDone(); }
    catch (e) { alert(e.response?.data?.error || '创建失败'); }
  };
  return (
    <Modal title="创建员工账号" onClose={onClose}>
      <input className="field mb-2" placeholder="用户名" value={f.username} onChange={e => setF({ ...f, username: e.target.value })} />
      <input className="field mb-2" type="password" placeholder="密码 (至少6位)" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
      <input className="field mb-2" placeholder="姓名" value={f.display_name} onChange={e => setF({ ...f, display_name: e.target.value })} />
      <input className="field mb-4" placeholder="邮箱" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" onClick={submit}>创建</button>
      </div>
    </Modal>
  );
}

function ResetModal({ user, onClose, onDone }) {
  const [pwd, setPwd] = useState('');
  const submit = async () => {
    try { await api.post(`/admin/staff/${user.id}/reset-password`, { password: pwd }); alert('密码已重置'); onDone(); }
    catch (e) { alert(e.response?.data?.error || '操作失败'); }
  };
  return (
    <Modal title={`重置员工密码 - ${user.username}`} onClose={onClose}>
      <input className="field mb-4" type="password" placeholder="新密码 (至少6位)" value={pwd} onChange={e => setPwd(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" onClick={submit}>重置</button>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-6 w-[420px]">
        <div className="font-semibold text-lg mb-4 flex justify-between">
          {title}
          <button onClick={onClose} className="text-gray-400">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
