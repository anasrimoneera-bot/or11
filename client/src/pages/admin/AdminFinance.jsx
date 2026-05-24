import { useEffect, useState } from 'react';
import api from '../../api';

const PAGE_SIZE = 50;

const roleSuffix = (u) => (u?.is_owner ? '（BOSS）' : u?.is_admin ? '（管理员）' : '');

export default function AdminFinance() {
  const [data, setData] = useState({ rows: [], total: 0, users: [] });
  const [userId, setUserId] = useState('');
  const [page, setPage] = useState(0);

  const load = () => {
    const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
    if (userId) params.user_id = userId;
    api.get('/admin/finance/records', { params }).then(r => setData(r.data));
  };
  useEffect(load, [userId, page]);
  useEffect(() => { setPage(0); }, [userId]);

  const rows = data.rows || [];
  const fmt = (s) => (s ? String(s).replace('T', ' ').slice(0, 19) : '-');
  const uname = (r) => `${r.display_name || r.username || '用户#' + r.user_id}${roleSuffix(r)}`;
  const pageCount = Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE));

  // 本页合计
  const t = rows.reduce((a, r) => {
    const amt = Number(r.amount) || 0;
    if (amt >= 0) a.inc += amt; else a.dec += amt;
    a.net += amt;
    return a;
  }, { inc: 0, dec: 0, net: 0 });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">💰 财务管理</h1>
          <p className="text-gray-500 text-sm mt-1">所有用户的余额增减变动明细，可按用户筛选。</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">按用户筛选</label>
          <select className="field" value={userId} onChange={e => setUserId(e.target.value)}>
            <option value="">全部用户</option>
            {(data.users || []).map(u => (
              <option key={u.id} value={u.id}>{(u.display_name || u.username)}{roleSuffix(u)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">时间</th>
              <th className="px-3 py-2 text-left">用户</th>
              <th className="px-3 py-2 text-left">类型</th>
              <th className="px-3 py-2 text-right">金额</th>
              <th className="px-3 py-2 text-right">变动后余额</th>
              <th className="px-3 py-2 text-left">说明</th>
              <th className="px-3 py-2 text-left">关联订单</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const amt = Number(r.amount) || 0;
              return (
                <tr key={r.id} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap">{fmt(r.created_at)}</td>
                  <td className="px-3 py-2">{uname(r)}</td>
                  <td className="px-3 py-2">{r.type}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${amt >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {amt >= 0 ? '+' : ''}¥{amt.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right">¥{(Number(r.balance_after) || 0).toFixed(2)}</td>
                  <td className="px-3 py-2">{r.description || '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.related_order || '-'}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan="7" className="p-8 text-center text-gray-400">暂无财务记录</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-gray-50 border-t-2 font-semibold">
              <tr>
                <td className="px-3 py-2.5 text-gray-700" colSpan={3}>📊 本页合计 ({rows.length} 条)</td>
                <td className={`px-3 py-2.5 text-right ${t.net >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {t.net >= 0 ? '+' : ''}¥{t.net.toFixed(2)}
                </td>
                <td className="px-3 py-2.5" colSpan={3}>
                  <span className="text-xs text-gray-500">
                    本页增加 <b className="text-green-700">+¥{t.inc.toFixed(2)}</b>
                    {'　'}本页减少 <b className="text-red-600">¥{t.dec.toFixed(2)}</b>
                  </span>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <div>共 {data.total || 0} 条记录</div>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost border disabled:opacity-40" disabled={page <= 0} onClick={() => setPage(p => Math.max(0, p - 1))}>上一页</button>
          <span>{page + 1} / {pageCount}</span>
          <button className="btn btn-ghost border disabled:opacity-40" disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)}>下一页</button>
        </div>
      </div>
    </div>
  );
}
