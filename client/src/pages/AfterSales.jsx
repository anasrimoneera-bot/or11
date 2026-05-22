import { useEffect, useState } from 'react';
import api from '../api';

const statusLabel = { pending: '待处理', processing: '处理中', waiting_refund: '待退款', completed: '已完成', cancelled: '已取消' };
const statusColor = {
  pending: 'bg-orange-100 text-orange-700',
  processing: 'bg-cyan-100 text-cyan-700',
  waiting_refund: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-700',
};

export default function AfterSales() {
  const [stats, setStats] = useState({});
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState(null);

  const load = () => {
    api.get('/aftersales', { params: { q } }).then(r => setList(r.data.rows));
    api.get('/aftersales/stats').then(r => setStats(r.data));
  };

  useEffect(load, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">🔧 售后管理</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowCreate(true)} className="btn btn-primary">+ 发起售后</button>
          <button className="btn btn-ghost">⬇️ 导出工单</button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3">
        <StatCard label="总工单数" value={stats.total} color="bg-blue-500" />
        <StatCard label="待处理" value={stats.pending} color="bg-orange-500" />
        <StatCard label="处理中" value={stats.processing} color="bg-teal-500" />
        <StatCard label="待退款" value={stats.waiting_refund} color="bg-yellow-500" />
        <StatCard label="已完成" value={stats.completed} color="bg-green-500" />
      </div>

      <div className="bg-white rounded-xl shadow p-4">
        <div className="flex gap-2 mb-4">
          <input className="field max-w-md" placeholder="搜索订单号、标题或描述" value={q} onChange={e => setQ(e.target.value)} />
          <button className="btn btn-primary" onClick={load}>搜索</button>
        </div>
        <div className="space-y-3">
          {list.map(t => (
            <div key={t.id} className="border rounded-lg p-4 hover:shadow">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-semibold">
                    售后申请 - {t.reason || '其他原因'}
                    <span className="ml-2 badge bg-yellow-100 text-yellow-700">{t.priority || '中优先级'}</span>
                    {t.has_new_message ? <span className="ml-2 badge bg-blue-100 text-blue-700">有新消息</span> : null}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">订单号: <span className="font-mono">{t.order_no || '-'}</span> &nbsp; 国家: {t.country || '-'}</div>
                  <div className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{t.description}</div>
                  <div className="text-xs text-gray-400 mt-2">
                    创建: {t.created_at} &nbsp; 更新: {t.updated_at}
                  </div>
                </div>
                <div className="text-right">
                  <span className={`badge ${statusColor[t.status]}`}>{statusLabel[t.status]}</span>
                  <div className="mt-2"><button onClick={() => setDetailId(t.id)} className="btn btn-ghost text-xs">👁️ 查看</button></div>
                </div>
              </div>
            </div>
          ))}
          {list.length === 0 && <div className="text-center p-8 text-gray-400">暂无售后工单</div>}
        </div>
      </div>

      {showCreate && <CreateWizard onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {detailId && <DetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className={`${color} text-white rounded-xl p-4`}>
      <div className="text-3xl font-bold">{value || 0}</div>
      <div className="text-sm">{label}</div>
    </div>
  );
}

const REASONS = [
  { value: '无理由退货', desc: '无理由退货需支付运费' },
  { value: '产品丢失', desc: '' },
  { value: '产品损坏', desc: '需要提供产品损坏图' },
  { value: '配件缺失', desc: '' },
  { value: '其他原因', desc: '' },
  { value: '包裹未送达', desc: '需要提供客户聊天截图' },
  { value: '申请取消', desc: '' },
  { value: '无物流信息', desc: '' },
];

function CreateWizard({ onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [searchQ, setSearchQ] = useState('');
  const [results, setResults] = useState([]);
  const [order, setOrder] = useState(null);
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const doSearch = async () => {
    if (!searchQ.trim()) return;
    const { data } = await api.get('/aftersales/search-orders', { params: { q: searchQ } });
    setResults(data);
    if (data.length === 1) setOrder(data[0]);
  };

  const handleFiles = (fileList) => {
    const arr = Array.from(fileList || []);
    setFiles(prev => [...prev, ...arr]);
  };

  const onPaste = (e) => {
    const items = e.clipboardData?.items || [];
    const arr = [];
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) arr.push(f);
      }
    }
    if (arr.length) setFiles(prev => [...prev, ...arr]);
  };

  const onDrop = (e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('order_no', order.order_no);
      fd.append('country', order.country || '');
      fd.append('reason', reason);
      fd.append('description', description);
      fd.append('priority', '中优先级');
      for (const f of files) fd.append('files', f);
      await api.post('/aftersales', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onCreated();
    } catch (e) {
      alert(e.response?.data?.error || '提交失败');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 overflow-y-auto p-4">
      <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-2xl my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-blue-600">←</button>
            <span className="text-xl font-bold">创建售后工单</span>
          </div>
          <button onClick={onClose} className="text-gray-400 text-xl">×</button>
        </div>

        <div className="px-6 py-6">
          <Stepper step={step} />
        </div>

        <div className="px-6 pb-6">
          {step === 1 && (
            <div className="bg-white border rounded-lg p-6">
              <div className="text-lg font-bold mb-4">第一步：选择订单</div>
              <label className="text-sm">搜索并选择订单</label>
              <div className="flex gap-2 mt-1">
                <input className="field" placeholder="请输入订单号、品牌或国家来搜索..." value={searchQ} onChange={e => setSearchQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()} />
                <button onClick={doSearch} className="btn btn-warning">搜索</button>
              </div>
              <div className="text-xs text-gray-500 mt-1">请输入订单号、品牌或国家名进行搜索，找到订单后点击"选择"按钮</div>

              {!results.length && !order && (
                <div className="bg-blue-50 text-blue-700 text-sm rounded p-3 mt-4">
                  💡 使用说明：请在上方搜索框中输入订单号、品牌名或国家名来查找您要申请售后的订单。
                </div>
              )}

              {results.length > 0 && !order && (
                <div className="mt-4 space-y-2">
                  {results.map(r => (
                    <div key={r.id} className="border rounded p-3 flex justify-between items-center">
                      <div>
                        <div className="font-mono">{r.order_no}</div>
                        <div className="text-xs text-gray-500">{r.country} / {r.shop_name} / ${r.amazon_amount}</div>
                      </div>
                      <button className="btn btn-primary text-sm" onClick={() => setOrder(r)}>选择</button>
                    </div>
                  ))}
                </div>
              )}

              {order && (
                <div className="border-2 border-green-300 bg-green-50 rounded-lg mt-4 p-4">
                  <div className="font-semibold text-green-700 mb-3">✓ 已选择订单</div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <Info label="订单国家" value={order.country} />
                    <Info label="运费" value={`USD ${order.shipping_fee || 0}`} />
                    <Info label="亚马逊订单号" value={order.order_no} />
                    <Info label="实际运费" value={`USD ${order.shipping_fee || 0}`} />
                    <Info label="亚马逊订单金额" value={`USD ${order.amazon_amount || 0}`} />
                    <Info label="实际运费(人民币)" value={`¥ ${((order.shipping_fee || 0) * (order.exchange_rate || 7)).toFixed(2)}`} />
                    <Info label="进货价(人民币)" value={`¥ ${(order.purchase_amount_cny || 0).toFixed(2)}`} />
                    <Info label="汇率" value={order.exchange_rate || '-'} />
                    <Info label="SKU列表" value={'-'} />
                    <Info label="进货价总额" value={`USD ${order.purchase_amount_usd || 0}`} />
                    <Info label="订单时间" value={order.created_at} />
                    <Info label="用户名" value={order.shop_name} />
                  </div>
                  <button className="text-xs text-blue-600 mt-3" onClick={() => setOrder(null)}>重新选择</button>
                </div>
              )}

              <div className="flex justify-end mt-6">
                <button disabled={!order} onClick={() => setStep(2)} className={`btn ${order ? 'btn-warning' : 'btn-ghost opacity-50'}`}>下一步</button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="bg-white border rounded-lg p-6" onPaste={onPaste}>
              <div className="text-lg font-bold mb-4">第二步：填写售后原因</div>
              <div className="border rounded-lg px-4 py-3 mb-4 flex justify-between bg-gray-50">
                <div>订单号: <span className="font-mono">{order.order_no}</span></div>
                <div className="text-gray-500">国家: {order.country}</div>
              </div>

              <div className="mb-2 font-medium">售后问题原因 <span className="text-red-500">*</span></div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {REASONS.map(r => (
                  <label key={r.value} className={`border rounded-lg p-3 cursor-pointer flex items-center gap-2 ${reason === r.value ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'}`}>
                    <input type="radio" name="reason" checked={reason === r.value} onChange={() => setReason(r.value)} />
                    <span>{r.value}{r.desc ? <span className="text-gray-400"> ({r.desc})</span> : ''}</span>
                  </label>
                ))}
              </div>

              <div className="mb-2 font-medium">备注 <span className="text-red-500">*</span></div>
              <textarea className="field mb-4" rows="5" placeholder="请详细描述遇到的问题..." value={description} onChange={e => setDescription(e.target.value)} />

              <div className="mb-2 font-medium">客户聊天截图/退货申请截图 <span className="text-red-500">*</span></div>
              <div onDrop={onDrop} onDragOver={e => e.preventDefault()} className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center bg-gray-50">
                <div className="text-gray-500 mb-2">选择文件</div>
                <div className="text-xs text-gray-400 mb-3">必须：请上传客户聊天截图或退货申请截图</div>
                <div className="text-xs text-gray-400 mb-3">支持：拖拽上传或Ctrl+V粘贴截图，支持图片(jpg/png/gif/webp等)和PDF</div>
                <input id="file-input" type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={e => handleFiles(e.target.files)} />
                <label htmlFor="file-input" className="btn btn-ghost cursor-pointer">浏览文件</label>
              </div>
              {files.length > 0 && (
                <div className="mt-3 space-y-1">
                  {files.map((f, i) => (
                    <div key={i} className="flex justify-between items-center text-sm border rounded px-3 py-1">
                      <span>📎 {f.name} ({(f.size / 1024).toFixed(1)} KB)</span>
                      <button className="text-red-500" onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between mt-6">
                <button onClick={() => setStep(1)} className="btn btn-ghost">上一步</button>
                <button disabled={!reason || !description.trim() || files.length === 0} onClick={() => setStep(3)}
                  className={`btn ${(reason && description.trim() && files.length) ? 'btn-warning' : 'btn-ghost opacity-50'}`}>下一步</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="bg-white border rounded-lg p-6">
              <div className="text-lg font-bold mb-4">第三步：提交工单</div>
              <div className="bg-gray-50 rounded p-4 mb-4 text-sm space-y-2">
                <div><b>订单号：</b><span className="font-mono">{order.order_no}</span></div>
                <div><b>国家：</b>{order.country}</div>
                <div><b>售后原因：</b>{reason}</div>
                <div><b>备注：</b><div className="whitespace-pre-wrap mt-1 p-2 bg-white border rounded">{description}</div></div>
                <div><b>附件：</b>{files.length} 个</div>
              </div>
              <div className="bg-yellow-50 text-yellow-700 text-sm rounded p-3 mb-4">
                ⚠️ 工单提交后，我方管理人员将与供应商对接处理，请耐心等待回复。
              </div>
              <div className="flex justify-between">
                <button onClick={() => setStep(2)} className="btn btn-ghost">上一步</button>
                <button disabled={submitting} onClick={submit} className="btn btn-success">
                  {submitting ? '提交中...' : '✓ 确认提交工单'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ step }) {
  const steps = ['选择订单', '填写原因', '提交工单'];
  return (
    <div className="flex items-center justify-center gap-4">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className={`flex flex-col items-center gap-1`}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${step > i ? 'bg-green-500' : step === i + 1 ? 'bg-blue-500' : 'bg-gray-300'}`}>
              {step > i + 1 ? '✓' : i + 1}
            </div>
            <div className={`text-sm ${step === i + 1 ? 'text-blue-600 font-medium' : 'text-gray-500'}`}>{s}</div>
          </div>
          {i < steps.length - 1 && <div className={`w-16 h-0.5 ${step > i + 1 ? 'bg-green-500' : 'bg-gray-300'}`} />}
        </div>
      ))}
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm">{value || '-'}</div>
    </div>
  );
}

function DetailModal({ id, onClose }) {
  const [t, setT] = useState(null);
  const [reply, setReply] = useState('');
  useEffect(() => { api.get(`/aftersales/${id}`).then(r => setT(r.data)); }, [id]);

  const sendReply = async () => {
    if (!reply.trim()) return;
    await api.post(`/aftersales/${id}/messages`, { content: reply });
    setReply('');
    const r = await api.get(`/aftersales/${id}`);
    setT(r.data);
  };

  if (!t) return null;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto bg-white rounded-xl my-8">
        <div className="flex justify-between p-4 border-b">
          <div className="font-bold">售后工单详情 #{id}</div>
          <button onClick={onClose} className="text-gray-400 text-xl">×</button>
        </div>
        <div className="p-6 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Info label="订单号" value={t.order_no} />
            <Info label="状态" value={statusLabel[t.status]} />
            <Info label="原因" value={t.reason} />
            <Info label="优先级" value={t.priority} />
          </div>
          <div>
            <div className="text-sm font-medium">详细说明：</div>
            <div className="bg-gray-50 p-3 rounded mt-1 whitespace-pre-wrap text-sm">{t.description}</div>
          </div>
          {t.attachments?.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-2">附件：</div>
              <div className="grid grid-cols-3 gap-2">
                {t.attachments.map(a => (
                  <a key={a.id} href={`/api/aftersales/attachments/${a.id}`} target="_blank" rel="noreferrer" className="border rounded p-2 text-xs hover:bg-gray-50">
                    📎 {a.original_name}
                  </a>
                ))}
              </div>
            </div>
          )}
          {t.admin_note && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
              <div className="font-medium text-yellow-700 text-sm">管理员备注：</div>
              <div className="text-sm mt-1">{t.admin_note}</div>
            </div>
          )}
          <div>
            <div className="text-sm font-medium mb-2">沟通记录：</div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {t.messages?.map(m => (
                <div key={m.id} className={`p-2 rounded text-sm ${m.is_admin ? 'bg-blue-50 ml-8' : 'bg-gray-50 mr-8'}`}>
                  <div className="text-xs text-gray-500">{m.is_admin ? '管理员' : '用户'} {m.author} · {m.created_at}</div>
                  <div className="mt-1 whitespace-pre-wrap">{m.content}</div>
                </div>
              ))}
              {(!t.messages || t.messages.length === 0) && <div className="text-gray-400 text-sm">暂无沟通记录</div>}
            </div>
          </div>
          <div className="flex gap-2">
            <input className="field" value={reply} onChange={e => setReply(e.target.value)} placeholder="输入回复..." />
            <button className="btn btn-primary" onClick={sendReply}>发送</button>
          </div>
        </div>
      </div>
    </div>
  );
}
