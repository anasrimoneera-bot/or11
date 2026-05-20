import { useEffect, useState } from 'react';
import api from '../api';

export default function Accounts() {
  const [subs, setSubs] = useState([]);
  const [shops, setShops] = useState([]);
  const [showSub, setShowSub] = useState(false);
  const [showShop, setShowShop] = useState(false);

  const load = () => {
    api.get('/accounts/sub').then(r => setSubs(r.data));
    api.get('/accounts/shops').then(r => setShops(r.data));
  };
  useEffect(load, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">账户管理</h1>
          <p className="text-sm text-gray-500">管理子账户和权限设置</p>
        </div>
        <button onClick={() => setShowSub(true)} className="btn btn-primary">+ 创建子账户</button>
      </div>

      <div className="bg-white rounded-xl shadow p-5">
        <div className="font-medium text-blue-600 mb-4">👥 子账户列表</div>
        {subs.length === 0 ? (
          <div className="py-10 text-center text-gray-400">
            <div className="text-5xl mb-2">👤</div>
            <div>暂无子账户</div>
            <button onClick={() => setShowSub(true)} className="btn btn-primary mt-4">+ 创建子账户</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-gray-500 bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">用户名</th>
                <th className="px-3 py-2 text-left">姓名</th>
                <th className="px-3 py-2 text-left">邮箱</th>
                <th className="px-3 py-2 text-left">角色</th>
                <th className="px-3 py-2 text-left">创建时间</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {subs.map(s => (
                <tr key={s.id} className="border-t">
                  <td className="px-3 py-2 font-mono">{s.username}</td>
                  <td className="px-3 py-2">{s.display_name}</td>
                  <td className="px-3 py-2">{s.email}</td>
                  <td className="px-3 py-2">{s.role}</td>
                  <td className="px-3 py-2">{s.created_at}</td>
                  <td className="px-3 py-2 text-right">
                    <button className="text-red-500 hover:underline text-xs" onClick={async () => {
                      if (confirm(`确认删除 ${s.username}?`)) { await api.delete(`/accounts/sub/${s.id}`); load(); }
                    }}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white rounded-xl shadow p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="font-medium text-orange-600">🏪 店铺管理</div>
          <button onClick={() => setShowShop(true)} className="btn btn-warning text-sm">+ 添加店铺</button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {shops.map(s => (
            <div key={s.id} className="border rounded p-3 flex justify-between items-center">
              <div>
                <div className="font-semibold">{s.name}</div>
                <div className="text-xs text-gray-500">{s.country || '-'}</div>
              </div>
              <button className="text-red-500 text-xs" onClick={async () => { await api.delete(`/accounts/shops/${s.id}`); load(); }}>删除</button>
            </div>
          ))}
          {shops.length === 0 && <div className="col-span-4 text-center text-gray-400 py-4">暂无店铺</div>}
        </div>
      </div>

      {showSub && <SubModal onClose={() => setShowSub(false)} onDone={() => { setShowSub(false); load(); }} />}
      {showShop && <ShopModal onClose={() => setShowShop(false)} onDone={() => { setShowShop(false); load(); }} />}
    </div>
  );
}

function SubModal({ onClose, onDone }) {
  const [f, setF] = useState({ username: '', password: '', display_name: '', email: '', role: 'sub' });
  const submit = async () => {
    try { await api.post('/accounts/sub', f); onDone(); }
    catch (e) { alert(e.response?.data?.error || '提交失败'); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 w-96">
        <div className="font-semibold text-lg mb-4">创建子账户</div>
        <input className="field mb-2" placeholder="用户名" value={f.username} onChange={e => setF({ ...f, username: e.target.value })} />
        <input className="field mb-2" type="password" placeholder="密码" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
        <input className="field mb-2" placeholder="姓名" value={f.display_name} onChange={e => setF({ ...f, display_name: e.target.value })} />
        <input className="field mb-2" placeholder="邮箱" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
        <select className="field mb-4" value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>
          <option value="sub">子账户</option>
          <option value="finance">财务</option>
          <option value="operator">操作员</option>
        </select>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={submit}>创建</button>
        </div>
      </div>
    </div>
  );
}

function ShopModal({ onClose, onDone }) {
  const [f, setF] = useState({ name: '', country: '美国' });
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 w-80">
        <div className="font-semibold text-lg mb-4">添加店铺</div>
        <input className="field mb-2" placeholder="店铺名" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        <select className="field mb-4" value={f.country} onChange={e => setF({ ...f, country: e.target.value })}>
          <option>美国</option><option>英国</option><option>德国</option><option>法国</option>
          <option>意大利</option><option>荷兰</option><option>西班牙</option><option>波兰</option>
        </select>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={async () => { await api.post('/accounts/shops', f); onDone(); }}>添加</button>
        </div>
      </div>
    </div>
  );
}
