import { useEffect, useState } from 'react';
import api from '../api';

// 问题论坛：分销商与管理员共用。所有人可提问、评论；管理员解答置顶；管理员可删除。
const ACCEPT = 'image/*,.xls,.xlsx,.csv,.pdf,.doc,.docx,.txt';
const PAGE_SIZE = 20;

export default function Forum({ isAdmin = false }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState(null);

  const load = (keyword = q) => {
    const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
    if (keyword.trim()) params.q = keyword.trim();
    api.get('/forum', { params }).then(r => { setRows(r.data.rows || []); setTotal(r.data.total || 0); });
  };
  useEffect(() => { load(); }, [page]);
  // 打开论坛即标记已看过，控制台的新问题提示随之消失
  useEffect(() => { api.post('/forum/seen').catch(() => {}); }, []);
  const doSearch = () => { if (page !== 0) setPage(0); else load(); };
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h1 className="text-2xl font-bold">💬 问题论坛</h1>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary">+ 我要提问</button>
      </div>

      <div className="bg-white rounded-lg shadow border p-3 flex gap-2">
        <input className="field flex-1" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()}
          placeholder="搜索问题标题、内容或解答，例如：退款、物流、包裹丢失" />
        <button onClick={doSearch} className="btn btn-primary shrink-0">🔍 搜索</button>
        {q && <button onClick={() => { setQ(''); if (page !== 0) setPage(0); else load(''); }} className="btn btn-ghost border shrink-0">清除</button>}
      </div>

      <div className="space-y-2">
        {rows.map(t => (
          <button key={t.id} type="button" onClick={() => setDetailId(t.id)}
            className="w-full text-left bg-white rounded-lg shadow p-4 hover:bg-gray-50 border-l-4 border-blue-400">
            <div className="font-semibold flex flex-wrap items-center gap-2">
              <span className="break-all">{t.title}</span>
              {t.admin_replied
                ? <span className="badge bg-green-100 text-green-700">✓ 管理员已解答</span>
                : <span className="badge bg-gray-100 text-gray-600">待解答</span>}
            </div>
            {t.content && <div className="text-sm text-gray-600 mt-1 line-clamp-2 whitespace-pre-wrap">{t.content}</div>}
            <div className="text-xs text-gray-400 mt-1">
              {t.author_is_admin ? '👨‍💼' : '👤'} {t.author} · 提问于 {t.created_at} · 💬 {t.comment_count} 条评论
            </div>
          </button>
        ))}
        {rows.length === 0 && <div className="text-center text-gray-400 py-8 bg-white rounded-xl">{q ? '没有找到相关问题，试试换个关键词，或直接提问' : '还没有问题，来提第一个吧'}</div>}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-gray-500">共 {total} 个问题</span>
          <button className="btn btn-ghost border py-1" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button>
          <span>{page + 1} / {pageCount}</span>
          <button className="btn btn-ghost border py-1" disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>下一页</button>
        </div>
      )}

      {showCreate && <CreateTopic onClose={() => setShowCreate(false)} onCreated={(id) => { setShowCreate(false); load(); setDetailId(id); }} />}
      {detailId && <TopicDetail id={detailId} isAdmin={isAdmin} onClose={() => { setDetailId(null); load(); }} />}
    </div>
  );
}

function FilePicker({ files, setFiles }) {
  return (
    <div>
      <label className="btn btn-ghost border cursor-pointer text-sm inline-block">📎 添加附件
        <input type="file" multiple accept={ACCEPT} className="hidden"
          onChange={e => { const picked = Array.from(e.target.files || []); setFiles(prev => [...prev, ...picked]); e.target.value = ''; }} />
      </label>
      <span className="text-xs text-gray-400 ml-2">支持图片、Excel/CSV、PDF、Word、TXT，单个不超过 20MB</span>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {files.map((f, i) => (
            <span key={i} className="text-xs border rounded px-2 py-1 flex items-center gap-1">
              📎 {f.name}
              <button type="button" className="text-red-500" onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const errMsg = (e, fallback) => e.response?.data?.error || fallback;

function CreateTopic({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) return alert('请填写问题标题');
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('title', title.trim());
      fd.append('content', content);
      for (const f of files) fd.append('files', f);
      const { data } = await api.post('/forum', fd);
      onCreated(data.id);
    } catch (e) {
      alert(errMsg(e, '提交失败'));
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl flex flex-col" style={{ maxHeight: '90vh' }}>
        <div className="flex justify-between items-center p-4 border-b">
          <div className="font-bold">+ 我要提问</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-0.5">问题标题 *</label>
            <input className="field w-full" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="一句话描述你的问题" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-0.5">问题描述</label>
            <textarea className="field w-full" rows="6" value={content} onChange={e => setContent(e.target.value)} placeholder="补充问题细节，如订单号、国家、出现的情况..." />
          </div>
          <FilePicker files={files} setFiles={setFiles} />
        </div>
        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onClose} className="btn btn-ghost border">取消</button>
          <button disabled={saving} onClick={submit} className="btn btn-primary">{saving ? '提交中...' : '✓ 发布问题'}</button>
        </div>
      </div>
    </div>
  );
}

function TopicDetail({ id, isAdmin, onClose }) {
  const [t, setT] = useState(null);
  const [reply, setReply] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);

  const load = () => api.get(`/forum/${id}`).then(r => setT(r.data)).catch(e => { alert(errMsg(e, '加载失败')); onClose(); });
  useEffect(() => { load(); }, [id]);

  const send = async () => {
    if (!reply.trim() && files.length === 0) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.append('content', reply);
      for (const f of files) fd.append('files', f);
      await api.post(`/forum/${id}/comments`, fd);
      setReply(''); setFiles([]); load();
    } catch (e) {
      alert(errMsg(e, '发送失败'));
    } finally { setSending(false); }
  };
  const delTopic = async () => {
    if (!confirm('确认删除该问题？评论与附件会一并删除，不可恢复。')) return;
    try { await api.delete(`/forum/${id}`); onClose(); } catch (e) { alert(errMsg(e, '删除失败')); }
  };
  const delComment = async (c) => {
    if (!confirm('确认删除该评论？')) return;
    try { await api.delete(`/forum/comments/${c.id}`); load(); } catch (e) { alert(errMsg(e, '删除失败')); }
  };

  if (!t) return null;
  const atts = (cid) => t.attachments.filter(a => (a.comment_id || null) === cid);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto bg-white rounded-xl my-4">
        <div className="flex justify-between items-start gap-2 p-4 border-b">
          <div className="min-w-0">
            <div className="font-bold text-lg break-all">{t.title}</div>
            <div className="text-xs text-gray-400 mt-1">{t.author_is_admin ? '👨‍💼' : '👤'} {t.author} · 提问于 {t.created_at}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isAdmin && <button onClick={delTopic} className="text-xs text-red-600 border border-red-200 rounded px-2 py-1 hover:bg-red-50">🗑️ 删除问题</button>}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
          </div>
        </div>
        <div className="p-4 space-y-4">
          {t.content && <div className="whitespace-pre-wrap text-sm bg-gray-50 rounded p-3">{t.content}</div>}
          <Attachments list={atts(null)} />

          <div>
            <div className="text-sm font-medium mb-2">💬 评论解答（{t.comments.length}）</div>
            <div className="space-y-2">
              {t.comments.map(c => (
                <div key={c.id} className={`p-3 rounded text-sm border ${c.is_admin ? 'bg-blue-50 border-blue-200' : 'bg-white'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      {c.is_admin && <span className="badge bg-blue-600 text-white">📌 管理员解答</span>}
                      <span>{c.is_admin ? '👨‍💼' : '👤'} {c.author} · {c.created_at}</span>
                    </div>
                    {isAdmin && <button onClick={() => delComment(c)} className="text-xs text-red-500 hover:underline shrink-0">删除</button>}
                  </div>
                  {c.content && <div className="mt-1 whitespace-pre-wrap">{c.content}</div>}
                  <Attachments list={atts(c.id)} />
                </div>
              ))}
              {t.comments.length === 0 && <div className="text-gray-400 text-sm">暂无评论，欢迎解答</div>}
            </div>
          </div>

          <div className="border-t pt-3 space-y-2">
            <textarea className="field w-full" rows="3" value={reply} onChange={e => setReply(e.target.value)} placeholder={isAdmin ? '发表管理员解答（将置顶显示）...' : '写下你的评论或解答...'} />
            <div className="flex flex-wrap items-start justify-between gap-2">
              <FilePicker files={files} setFiles={setFiles} />
              <button disabled={sending} onClick={send} className="btn btn-primary">{sending ? '发送中...' : '发表评论'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 附件需带 Authorization 头，故用 blob 方式拉取：图片直接显示缩略图，其他文件点击下载
function Attachments({ list }) {
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap items-start gap-2 mt-2">
      {list.map(a => (a.mimetype || '').startsWith('image/') ? <ImageAtt key={a.id} a={a} /> : <FileAtt key={a.id} a={a} />)}
    </div>
  );
}

function ImageAtt({ a }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let u = '';
    api.get(`/forum/attachments/${a.id}`, { responseType: 'blob' }).then(r => { u = URL.createObjectURL(r.data); setUrl(u); }).catch(() => {});
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [a.id]);
  if (!url) return <div className="w-24 h-24 border rounded bg-gray-50 flex items-center justify-center text-xs text-gray-400">加载中</div>;
  return (
    <a href={url} target="_blank" rel="noreferrer" title={a.original_name}>
      <img src={url} alt={a.original_name} className="w-24 h-24 object-cover border rounded hover:opacity-80" />
    </a>
  );
}

function FileAtt({ a }) {
  const download = async () => {
    try {
      const r = await api.get(`/forum/attachments/${a.id}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const link = document.createElement('a');
      link.href = url; link.download = a.original_name || 'file';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { alert('附件下载失败'); }
  };
  return (
    <button type="button" onClick={download} className="border rounded px-2 py-1 text-xs bg-white hover:bg-gray-50 max-w-[16rem] truncate">
      📎 {a.original_name}
    </button>
  );
}
