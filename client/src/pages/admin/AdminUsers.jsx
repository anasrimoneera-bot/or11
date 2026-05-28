import { useEffect, useState, lazy, Suspense } from 'react';
import api from '../../api';

const OwnerMarkupField = lazy(() => import('./OwnerMarkupField.jsx'));
const OwnerCols = lazy(() => import('./OwnerColumns.jsx').then(m => ({
  default: ({ kind, ...p }) => kind === 'h' ? <m.UserMarkupHeader /> : <m.UserMarkupCell {...p} />
})));
// 字段名通过运行时解码避免主 bundle 出现字面量
const SECRET_KEY = atob('bWFya3VwX3BjdA==');

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [me, setMe] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [balanceUser, setBalanceUser] = useState(null);
  const [editUser, setEditUser] = useState(null);

  const load = () => api.get('/admin/users').then(r => setUsers(r.data));
  useEffect(() => { load(); api.get('/auth/me').then(r => setMe(r.data)); }, []);
  const isOwner = !!me?.is_owner;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
        <h1 className="text-2xl font-bold">👥 用户管理</h1>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary">+ 创建分销商账户</button>
      </div>

      {/* 手机端：卡片视图 */}
      <div className="md:hidden space-y-2">
        {users.map(u => (
          <div key={u.id} className="bg-white rounded-lg shadow p-3 text-sm">
            <div className="flex justify-between items-start gap-2 mb-1">
              <div className="min-w-0">
                <div className="font-mono text-xs">{u.username}</div>
                <div className="font-semibold truncate">{u.display_name || '-'}</div>
                <div className="text-xs text-gray-500 truncate">{u.email || '-'}</div>
              </div>
              <div className={`font-semibold whitespace-nowrap ${u.balance < 0 ? 'text-red-600' : 'text-green-600'}`}>¥{(u.balance || 0).toFixed(2)}</div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600 mb-2">
              <span>等级：{u.member_level}</span>
              <span>SKU：{u.sku_limit}</span>
              <span className="text-gray-400">{(u.created_at || '').slice(0, 10)}</span>
            </div>
            <div className="flex gap-3 text-xs">
              <button onClick={() => setBalanceUser(u)} className="text-blue-600 hover:underline">充值/扣款</button>
              <button onClick={() => setEditUser(u)} className="text-gray-700 hover:underline">编辑</button>
              {isOwner && (
                <button onClick={async () => {
                  if (!confirm(`确认删除分销商 ${u.display_name || ''}(${u.username})？`)) return;
                  try { await api.delete(`/admin/users/${u.id}`); load(); } catch (e) { alert(e.response?.data?.error || '删除失败'); }
                }} className="text-red-500 hover:underline">🗑️ 删除</button>
              )}
            </div>
          </div>
        ))}
        {users.length === 0 && <div className="text-center text-gray-400 p-6 bg-white rounded-lg shadow">暂无用户</div>}
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">用户名</th>
              <th className="px-3 py-2 text-left">姓名</th>
              <th className="px-3 py-2 text-left">邮箱</th>
              <th className="px-3 py-2 text-left">会员等级</th>
              <th className="px-3 py-2 text-right">SKU限制</th>
              {isOwner && <Suspense fallback={<th />}><OwnerCols kind="h" /></Suspense>}
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
                {isOwner && <Suspense fallback={<td />}><OwnerCols kind="c" value={u[SECRET_KEY]} /></Suspense>}
                <td className={`px-3 py-2 text-right font-semibold ${u.balance < 0 ? 'text-red-600' : 'text-green-600'}`}>¥{(u.balance || 0).toFixed(2)}</td>
                <td className="px-3 py-2 text-xs">{u.created_at}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => setBalanceUser(u)} className="text-blue-600 text-xs mr-2 hover:underline">充值/扣款</button>
                  <button onClick={() => setEditUser(u)} className="text-gray-600 text-xs mr-2 hover:underline">编辑</button>
                  {isOwner && (
                    <button
                      onClick={async () => {
                        if (!confirm(`确认删除分销商 ${u.display_name || ''}(${u.username})？\n该操作不可恢复，且要求该用户名下无订单/工单。`)) return;
                        try {
                          await api.delete(`/admin/users/${u.id}`);
                          load();
                        } catch (e) {
                          alert(e.response?.data?.error || '删除失败');
                        }
                      }}
                      className="text-red-500 text-xs hover:underline"
                    >🗑️ 删除</button>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={isOwner ? 10 : 9} className="p-6 text-center text-gray-400">暂无用户</td></tr>}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load(); }} />}
      {balanceUser && <BalanceModal user={balanceUser} onClose={() => setBalanceUser(null)} onDone={() => { setBalanceUser(null); load(); }} />}
      {editUser && <EditModal user={editUser} isOwner={isOwner} onClose={() => setEditUser(null)} onDone={() => { setEditUser(null); load(); }} />}
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

function EditModal({ user, isOwner, onClose, onDone }) {
  const baseFields = {
    display_name: user.display_name || '', email: user.email || '', phone: user.phone || '',
    company: user.company || '', member_level: user.member_level, sku_limit: user.sku_limit, member_days: user.member_days,
  };
  // 仅店主版的状态字段动态合入，员工版的主 bundle 不会出现该字段名
  const [f, setF] = useState(isOwner ? { ...baseFields, [SECRET_KEY]: user[SECRET_KEY] ?? 30 } : baseFields);
  const [newPass, setNewPass] = useState('');
  const submit = async () => {
    const payload = { ...f };
    await api.put(`/admin/users/${user.id}`, payload);
    if (newPass) await api.post(`/admin/users/${user.id}/reset-password`, { password: newPass });
    onDone();
  };
  return (
    <Modal title={`编辑用户 - ${user.username}`} onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
        {isOwner && (
          <Suspense fallback={null}>
            <OwnerMarkupField value={f[SECRET_KEY]} onChange={v => setF({ ...f, [SECRET_KEY]: v })} />
          </Suspense>
        )}
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
      <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="font-semibold text-lg mb-4 flex justify-between">
          {title}
          <button onClick={onClose} className="text-gray-400">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
