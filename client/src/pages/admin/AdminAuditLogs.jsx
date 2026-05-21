import { useEffect, useState } from 'react';
import api from '../../api';

export default function AdminAuditLogs() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ today: 0, week: 0, byUser: [], byAction: [] });
  const [filters, setFilters] = useState({ q: '', action: '', target_type: '', start: '', end: '' });
  const [expanded, setExpanded] = useState({});

  const load = () => {
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.get('/admin/audit-logs', { params }).then(r => { setRows(r.data.rows); setTotal(r.data.total); });
  };
  const reloadStats = () => api.get('/admin/audit-logs/stats').then(r => setStats(r.data));
  useEffect(() => { load(); reloadStats(); }, []);

  const cleanup = async () => {
    const choice = prompt(
      '清理审计日志：\n' +
      '  1 = 删除 30 天前的记录（推荐）\n' +
      '  2 = 删除 90 天前的记录\n' +
      '  3 = 删除 180 天前的记录\n' +
      '  all = 清空全部日志\n' +
      '请输入 1 / 2 / 3 / all：',
      '1'
    );
    if (!choice) return;
    let body;
    if (choice === 'all') {
      if (!confirm('⚠️ 确认清空全部审计日志？此操作不可恢复！')) return;
      body = { mode: 'all' };
    } else {
      const days = { '1': 30, '2': 90, '3': 180 }[choice];
      if (!days) return alert('输入有误');
      const d = new Date(Date.now() - days * 86400000);
      body = { before: d.toISOString().slice(0, 10) };
      if (!confirm(`确认删除 ${days} 天前的审计日志？`)) return;
    }
    try {
      const { data } = await api.delete('/admin/audit-logs', { data: body });
      alert(`✓ 已删除 ${data.deleted} 条记录`);
      load();
      reloadStats();
    } catch (e) {
      alert(e.response?.data?.error || '清理失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">📜 操作审计日志</h1>
          <p className="text-sm text-gray-500 mt-1">所有员工/店主在管理后台的写操作（增删改）都会记录在此</p>
        </div>
        <button onClick={cleanup} className="btn btn-warning">🗑️ 清理旧日志</button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="今日操作" value={stats.today} color="bg-blue-500" />
        <Stat label="最近7天" value={stats.week} color="bg-purple-500" />
        <Stat label="员工活跃数 (30天)" value={stats.byUser.length} color="bg-teal-500" />
        <Stat label="总记录数" value={total} color="bg-orange-500" />
      </div>

      {stats.byUser?.length > 0 && (
        <div className="bg-white rounded-xl shadow p-4">
          <div className="font-medium mb-2">📊 员工活跃度（最近30天）</div>
          <div className="space-y-1">
            {stats.byUser.map(u => (
              <div key={u.username} className="flex items-center gap-3">
                <span className="text-sm w-32">{u.display_name || u.username}</span>
                <div className="flex-1 bg-gray-100 rounded h-5">
                  <div className="bg-blue-500 h-5 rounded text-white text-xs px-2 flex items-center" style={{ width: `${Math.min(100, u.c * 3)}%` }}>{u.c}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow p-4 flex gap-2 flex-wrap items-end">
        <div>
          <label className="text-sm">关键词</label>
          <input className="field" placeholder="员工/用户/订单号..." value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} />
        </div>
        <div>
          <label className="text-sm">操作类型</label>
          <select className="field" value={filters.action} onChange={e => setFilters({ ...filters, action: e.target.value })}>
            <option value="">全部</option>
            {stats.byAction?.map(a => <option key={a.action}>{a.action}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm">开始日期</label>
          <input type="date" className="field" value={filters.start} onChange={e => setFilters({ ...filters, start: e.target.value })} />
        </div>
        <div>
          <label className="text-sm">结束日期</label>
          <input type="date" className="field" value={filters.end} onChange={e => setFilters({ ...filters, end: e.target.value })} />
        </div>
        <button onClick={load} className="btn btn-primary">🔍 搜索</button>
        <button onClick={() => { setFilters({ q: '', action: '', target_type: '', start: '', end: '' }); setTimeout(load, 0); }} className="btn btn-ghost">重置</button>
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">时间</th>
              <th className="px-3 py-2 text-left">操作人</th>
              <th className="px-3 py-2 text-left">操作类型</th>
              <th className="px-3 py-2 text-left">影响对象</th>
              <th className="px-3 py-2 text-left">变更详情</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <>
                <tr key={r.id} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{r.created_at}</td>
                  <td className="px-3 py-2">
                    {r.is_owner
                      ? <span className="badge bg-red-100 text-red-700">👑 {r.display_name || r.username}</span>
                      : <span className="badge bg-purple-100 text-purple-700">{r.display_name || r.username}</span>}
                  </td>
                  <td className="px-3 py-2"><span className="badge bg-blue-100 text-blue-700">{r.action}</span></td>
                  <td className="px-3 py-2">
                    {r.target_name ? <span className="font-medium">{r.target_name}</span> : (r.target_id ? `${r.target_type}#${r.target_id}` : '-')}
                  </td>
                  <td className="px-3 py-2">
                    {r.changes ? (
                      <span className="text-orange-600">{r.changes}</span>
                    ) : (
                      <span className="text-gray-500">{r.summary}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setExpanded({ ...expanded, [r.id]: !expanded[r.id] })} className="text-xs text-blue-600">
                      {expanded[r.id] ? '收起' : '详情'}
                    </button>
                  </td>
                </tr>
                {expanded[r.id] && (
                  <tr key={`${r.id}-detail`} className="bg-gray-50">
                    <td colSpan="6" className="px-6 py-3 text-xs">
                      <div><b>路径：</b><span className="font-mono">{r.method} {r.path}</span></div>
                      <div><b>状态码：</b>{r.status}</div>
                      <div><b>IP：</b>{r.ip || '-'}</div>
                      <div><b>完整摘要：</b>{r.summary}</div>
                      {r.payload && <div><b>请求载荷：</b><pre className="bg-white p-2 rounded mt-1 overflow-x-auto">{r.payload}</pre></div>}
                    </td>
                  </tr>
                )}
              </>
            ))}
            {rows.length === 0 && <tr><td colSpan="6" className="p-8 text-center text-gray-400">暂无审计记录</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className={`${color} text-white rounded-xl p-4`}>
      <div className="text-sm opacity-80">{label}</div>
      <div className="text-3xl font-bold mt-1">{value || 0}</div>
    </div>
  );
}
