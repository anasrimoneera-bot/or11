import { useEffect, useState } from 'react';
import api from '../../api';

// 可分配的功能权限（与后端 GRANTABLE_PERMISSIONS 保持一致）
const FEATURES = [
  { key: 'finance', label: '财务管理' },
  { key: 'aftersales_policy', label: '售后政策维护' },
];
const FEATURE_LABEL = Object.fromEntries(FEATURES.map(f => [f.key, f.label]));

export default function AdminStaff() {
  const [list, setList] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [resetUser, setResetUser] = useState(null);
  const [permUser, setPermUser] = useState(null);

  const load = () => { api.get('/admin/staff').then(r => setList(r.data)); };
  useEffect(load, []);

  const del = async (s) => {
    if (!confirm(`确认删除管理员账号 ${s.username}？此操作不可恢复。`)) return;
    await api.delete(`/admin/staff/${s.id}`);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">🛡️ 管理员</h1>
          <p className="text-sm text-gray-500 mt-1">管理员可登录后台日常操作，但<b className="text-red-600">看不到加价百分比、真实采购价、利润等敏感数据</b></p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary">+ 创建管理员账号</button>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm">
        💡 <b>权限说明：</b>
        <ul className="list-disc list-inside mt-1 space-y-0.5 text-gray-700">
          <li>管理员可以：管理用户、确认订单（不知真实成本）、处理售后、给用户充值/退款</li>
          <li>管理员<b className="text-red-600">看不到</b>：每个用户的加价百分比、订单的真实供应商采购价、利润金额、供应商接口测试页</li>
          <li>仅店主可以：修改加价百分比、查看真实成本、调用供应商测试接口、系统设置、管理员管理</li>
          <li>📌 <b>按需开通</b>：点每行「权限」可单独给该管理员开通 <b>财务管理 / 售后政策维护</b>（开通后对方刷新页面即生效）</li>
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
              <th className="px-3 py-2 text-left">已开通功能</th>
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
                <td className="px-3 py-2">
                  {(s.permissions || []).length === 0
                    ? <span className="text-gray-400 text-xs">基础功能</span>
                    : <span className="flex flex-wrap gap-1">
                        {s.permissions.map(k => (
                          <span key={k} className="badge bg-blue-100 text-blue-700 text-xs">{FEATURE_LABEL[k] || k}</span>
                        ))}
                      </span>}
                </td>
                <td className="px-3 py-2 text-xs">{s.created_at}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => setPermUser(s)} className="text-emerald-600 text-xs mr-3 hover:underline">权限</button>
                  <button onClick={() => setResetUser(s)} className="text-blue-600 text-xs mr-3 hover:underline">重置密码</button>
                  <button onClick={() => del(s)} className="text-red-500 text-xs hover:underline">删除</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="7" className="p-8 text-center text-gray-400">暂无管理员账号，点击右上角创建</td></tr>}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load(); }} />}
      {resetUser && <ResetModal user={resetUser} onClose={() => setResetUser(null)} onDone={() => setResetUser(null)} />}
      {permUser && <PermModal user={permUser} onClose={() => setPermUser(null)} onDone={() => { setPermUser(null); load(); }} />}
    </div>
  );
}

function PermModal({ user, onClose, onDone }) {
  const [sel, setSel] = useState(() => new Set(user.permissions || []));
  const [saving, setSaving] = useState(false);
  const toggle = (k) => setSel(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const submit = async () => {
    setSaving(true);
    try { await api.put(`/admin/staff/${user.id}/permissions`, { permissions: [...sel] }); onDone(); }
    catch (e) { alert(e.response?.data?.error || '保存失败'); }
    finally { setSaving(false); }
  };
  return (
    <Modal title={`功能权限 - ${user.display_name || user.username}`} onClose={onClose}>
      <p className="text-xs text-gray-500 mb-3">
        勾选后该管理员左侧菜单会出现对应功能（对方刷新页面即生效）。用户/订单/售后/采购/下载/商品库存等基础功能所有管理员默认可见，无需开通。
      </p>
      <div className="space-y-1 mb-2">
        {FEATURES.map(f => (
          <label key={f.key} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-50 cursor-pointer">
            <input type="checkbox" checked={sel.has(f.key)} onChange={() => toggle(f.key)} />
            <span>{f.label}</span>
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
      </div>
    </Modal>
  );
}

function CreateModal({ onClose, onDone }) {
  const [f, setF] = useState({ username: '', password: '', display_name: '', email: '' });
  const [sel, setSel] = useState(() => new Set());
  const toggle = (k) => setSel(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const submit = async () => {
    try { await api.post('/admin/staff', { ...f, permissions: [...sel] }); onDone(); }
    catch (e) { alert(e.response?.data?.error || '创建失败'); }
  };
  return (
    <Modal title="创建管理员账号" onClose={onClose}>
      <input className="field mb-2" placeholder="用户名" value={f.username} onChange={e => setF({ ...f, username: e.target.value })} />
      <input className="field mb-2" type="password" placeholder="密码 (至少6位)" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
      <input className="field mb-2" placeholder="姓名" value={f.display_name} onChange={e => setF({ ...f, display_name: e.target.value })} />
      <input className="field mb-3" placeholder="邮箱" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
      <div className="border rounded p-2 mb-4">
        <div className="text-xs text-gray-500 mb-1">额外功能权限（可选，之后也能在「权限」里改）</div>
        {FEATURES.map(ft => (
          <label key={ft.key} className="flex items-center gap-2 py-1 cursor-pointer text-sm">
            <input type="checkbox" checked={sel.has(ft.key)} onChange={() => toggle(ft.key)} />
            <span>{ft.label}</span>
          </label>
        ))}
      </div>
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
    <Modal title={`重置管理员密码 - ${user.username}`} onClose={onClose}>
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
