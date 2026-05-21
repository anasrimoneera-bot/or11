import { useEffect, useState } from 'react';
import api from '../../api';

const statusLabel = { pending: '待处理', processing: '处理中', waiting_refund: '待退款', completed: '已完成', cancelled: '已取消' };

export default function AdminAfterSales() {
  const [rows, setRows] = useState([]);
  const [shops, setShops] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [shopFilter, setShopFilter] = useState('');
  const [orderNoFilter, setOrderNoFilter] = useState('');
  const [q, setQ] = useState('');
  const [detailId, setDetailId] = useState(null);

  const load = () => {
    const params = {};
    if (statusFilter !== 'all') params.status = statusFilter;
    if (shopFilter) params.shop_name = shopFilter;
    if (orderNoFilter.trim()) params.order_no = orderNoFilter.trim();
    if (q.trim()) params.q = q.trim();
    api.get('/admin/aftersales', { params }).then(r => {
      setRows(r.data.rows);
      setShops(r.data.shops || []);
    });
  };
  useEffect(load, [statusFilter, shopFilter]);
  const onSearch = () => load();
  const onReset = () => { setShopFilter(''); setOrderNoFilter(''); setQ(''); setStatusFilter('all'); };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">🔧 售后工单管理</h1>

      <div className="flex gap-2 flex-wrap">
        {['all', 'pending', 'processing', 'waiting_refund', 'completed', 'cancelled'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1 rounded text-sm ${statusFilter === s ? 'bg-orange-500 text-white' : 'bg-white border'}`}>
            {s === 'all' ? '全部' : statusLabel[s]}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow border p-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[160px]">
          <label className="text-xs text-gray-500 block">店铺</label>
          <select className="field" value={shopFilter} onChange={e => setShopFilter(e.target.value)}>
            <option value="">全部店铺</option>
            {shops.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="text-xs text-gray-500 block">订单编号</label>
          <input className="field" value={orderNoFilter} onChange={e => setOrderNoFilter(e.target.value)} placeholder="模糊匹配，如 114-7871" onKeyDown={e => e.key === 'Enter' && onSearch()} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-gray-500 block">关键词</label>
          <input className="field" value={q} onChange={e => setQ(e.target.value)} placeholder="标题/用户名/订单号/店铺" onKeyDown={e => e.key === 'Enter' && onSearch()} />
        </div>
        <div className="flex gap-2">
          <button onClick={onSearch} className="btn btn-primary">🔍 搜索</button>
          <button onClick={onReset} className="btn btn-ghost border">重置</button>
        </div>
      </div>

      <div className="space-y-3">
        {rows.map(t => (
          <div key={t.id} className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-400">
            <div className="flex justify-between">
              <div className="flex-1">
                <div className="font-semibold">
                  #{t.id} {t.title}
                  <span className="ml-2 badge bg-yellow-100 text-yellow-700">{t.priority}</span>
                  <span className="ml-2 badge bg-gray-100">{statusLabel[t.status]}</span>
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  用户: <b>{t.display_name || t.username}</b> &nbsp;
                  店铺: <b>{t.shop_name || '-'}</b> &nbsp;
                  订单: <span className="font-mono">{t.order_no}</span> &nbsp;
                  国家: {t.country || '-'}
                </div>
                <div className="text-sm text-gray-700 mt-1 line-clamp-2">{t.description}</div>
                <div className="text-xs text-gray-400 mt-1">{t.created_at}</div>
              </div>
              <button onClick={() => setDetailId(t.id)} className="btn btn-primary text-sm self-start">处理工单</button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="text-center text-gray-400 py-8 bg-white rounded-xl">暂无工单</div>}
      </div>

      {detailId && <Detail id={detailId} onClose={() => setDetailId(null)} onChanged={load} />}
    </div>
  );
}

function Detail({ id, onClose, onChanged }) {
  const [t, setT] = useState(null);
  const [reply, setReply] = useState('');
  const [status, setStatus] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [refundAmount, setRefundAmount] = useState('');

  const load = () => api.get(`/admin/aftersales/${id}`).then(r => {
    setT(r.data); setStatus(r.data.status); setAdminNote(r.data.admin_note || '');
  });
  useEffect(load, [id]);

  if (!t) return null;

  const updateStatus = async () => {
    await api.put(`/admin/aftersales/${id}`, { status, admin_note: adminNote });
    onChanged(); load();
  };
  const sendReply = async () => {
    if (!reply.trim()) return;
    await api.post(`/admin/aftersales/${id}/reply`, { content: reply });
    setReply(''); load();
  };
  const doRefund = async () => {
    const amt = Number(refundAmount);
    if (!amt || amt <= 0) return alert('请输入退款金额');
    if (!confirm(`确认给用户 ${t.username} 退款 ¥${amt.toFixed(2)}?`)) return;
    await api.post(`/admin/aftersales/${id}/refund`, { amount: amt, description: `售后退款 - 工单#${id}` });
    onChanged(); load();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 overflow-y-auto p-4">
      <div className="max-w-4xl mx-auto bg-white rounded-xl my-4">
        <div className="flex justify-between p-4 border-b">
          <div className="font-bold">售后工单 #{id}</div>
          <button onClick={onClose} className="text-gray-400 text-xl">×</button>
        </div>
        <div className="p-6 grid grid-cols-3 gap-6">
          <div className="col-span-2 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="订单号" value={t.order_no} />
              <Field label="国家" value={t.country} />
              <Field label="原因" value={t.reason} />
              <Field label="用户" value={`${t.display_name || ''} (${t.username})`} />
            </div>
            <div>
              <div className="text-sm font-medium">详细说明</div>
              <div className="bg-gray-50 p-3 rounded mt-1 whitespace-pre-wrap text-sm">{t.description}</div>
            </div>
            {t.attachments?.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">附件 ({t.attachments.length})</div>
                <div className="grid grid-cols-3 gap-2">
                  {t.attachments.map(a => (
                    <a key={a.id} href={`/api/aftersales/attachments/${a.id}`} target="_blank" rel="noreferrer" className="border rounded p-2 text-xs hover:bg-gray-50 truncate">
                      📎 {a.original_name}
                    </a>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="text-sm font-medium mb-2">沟通记录</div>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {t.messages?.map(m => (
                  <div key={m.id} className={`p-2 rounded text-sm ${m.is_admin ? 'bg-blue-50 ml-8' : 'bg-gray-50 mr-8'}`}>
                    <div className="text-xs text-gray-500">{m.is_admin ? '👨‍💼 管理员' : '👤 用户'} {m.author} · {m.created_at}</div>
                    <div className="mt-1 whitespace-pre-wrap">{m.content}</div>
                  </div>
                ))}
                {(!t.messages || t.messages.length === 0) && <div className="text-gray-400 text-sm">暂无沟通记录</div>}
              </div>
              <div className="flex gap-2 mt-2">
                <input className="field" value={reply} onChange={e => setReply(e.target.value)} placeholder="回复用户..." />
                <button className="btn btn-primary" onClick={sendReply}>发送</button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="bg-blue-50 rounded p-4 space-y-3">
              <div className="font-medium">⚙️ 工单处理</div>
              <div>
                <label className="text-sm">状态</label>
                <select className="field" value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="pending">待处理</option>
                  <option value="processing">处理中</option>
                  <option value="waiting_refund">待退款</option>
                  <option value="completed">已完成</option>
                  <option value="cancelled">已取消</option>
                </select>
              </div>
              <div>
                <label className="text-sm">管理员备注</label>
                <textarea className="field" rows="3" value={adminNote} onChange={e => setAdminNote(e.target.value)} placeholder="与DropXL沟通进度..." />
              </div>
              <button className="btn btn-primary w-full" onClick={updateStatus}>更新状态</button>
            </div>

            <div className="bg-orange-50 rounded p-4 space-y-3">
              <div className="font-medium text-orange-700">💰 退款给用户</div>
              <input className="field" type="number" step="0.01" placeholder="退款金额(¥)" value={refundAmount} onChange={e => setRefundAmount(e.target.value)} />
              <button className="btn btn-warning w-full" onClick={doRefund}>退款到用户余额</button>
              {t.refund_amount > 0 && <div className="text-xs text-green-700">已退款: ¥{t.refund_amount.toFixed(2)}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return <div><div className="text-xs text-gray-500">{label}</div><div>{value || '-'}</div></div>;
}
