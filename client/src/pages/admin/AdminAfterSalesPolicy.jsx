import { useEffect, useState } from 'react';
import api from '../../api';

export default function AdminAfterSalesPolicy() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/admin/aftersales-policies')
      .then(r => setRows(r.data || []))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const dirtyCount = rows.filter(r => r.is_dirty).length;
  const neverPublished = rows.filter(r => !r.published_at).length;

  const publishAll = async () => {
    if (dirtyCount === 0) return;
    if (!confirm(`确认要把 ${dirtyCount} 个章节的当前草稿发布到所有分销商？`)) return;
    setBusy(true);
    try {
      const r = await api.post('/admin/aftersales-policies/publish-all');
      alert(`已发布 ${r.data.updated} 个章节`);
      load();
    } catch (e) {
      alert(e.response?.data?.error || '发布失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">📄 售后政策维护</h1>
          <p className="text-gray-500 text-sm mt-1">
            在此编辑售后政策。每个章节单独保存后，点击右上角"一键发布"才会推送到所有分销商端。
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowCreate(true)} className="btn btn-ghost border">+ 新增章节</button>
          <button
            onClick={publishAll}
            disabled={busy || dirtyCount === 0}
            className={`btn ${dirtyCount > 0 ? 'btn-primary' : 'btn-ghost border'}`}
          >
            {busy ? '发布中...' : dirtyCount > 0 ? `🚀 一键发布 (${dirtyCount} 项待发布)` : '✅ 已全部发布'}
          </button>
        </div>
      </div>

      {neverPublished > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm rounded p-3">
          有 {neverPublished} 个章节从未发布过，分销商端目前看不到这些章节。
        </div>
      )}

      {loading ? (
        <div className="text-gray-400 text-sm">加载中...</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-lg shadow border p-8 text-center text-gray-400">
          暂无章节，点击右上角"新增章节"开始
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(r => (
            <PolicyCard key={r.id} row={r} onChange={load} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load(); }} />
      )}
    </div>
  );
}

function PolicyCard({ row, onChange }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(row.title);
  const [body, setBody] = useState(row.body || '');
  const [sortOrder, setSortOrder] = useState(row.sort_order);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle(row.title);
    setBody(row.body || '');
    setSortOrder(row.sort_order);
    setEditing(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/admin/aftersales-policies/${row.id}`, { title, body, sort_order: Number(sortOrder) });
      setEditing(false);
      onChange();
    } catch (e) {
      alert(e.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!confirm(`确认删除章节"${row.title}"？此操作不可撤销。`)) return;
    try {
      await api.delete(`/admin/aftersales-policies/${row.id}`);
      onChange();
    } catch (e) {
      alert(e.response?.data?.error || '删除失败');
    }
  };

  return (
    <div className="bg-white rounded-lg shadow border">
      <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-medium truncate">📄 {row.title}</span>
          <span className="text-xs text-gray-400">#{row.slug}</span>
          {row.is_dirty
            ? <span className="badge bg-orange-100 text-orange-700 shrink-0">草稿待发布</span>
            : <span className="badge bg-green-100 text-green-700 shrink-0">已发布</span>}
          {!row.published_at && <span className="badge bg-gray-100 text-gray-600 shrink-0">从未发布</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!editing && <button onClick={() => setEditing(true)} className="btn btn-ghost border text-sm">编辑</button>}
          {!editing && <button onClick={del} className="btn btn-ghost border text-sm text-red-600">删除</button>}
        </div>
      </div>

      {editing ? (
        <div className="p-4 space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500">标题</label>
              <input className="field" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="w-32">
              <label className="text-xs text-gray-500">排序</label>
              <input type="number" className="field" value={sortOrder} onChange={e => setSortOrder(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500">内容（保持换行格式）</label>
            <textarea
              className="field font-mono text-sm"
              rows={10}
              value={body}
              onChange={e => setBody(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={reset} className="btn btn-ghost border">取消</button>
            <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? '保存中...' : '保存草稿'}</button>
          </div>
          <div className="text-xs text-gray-400">提示：保存后点击页面顶部"一键发布"才会推送到分销商端。</div>
        </div>
      ) : (
        <div className="p-4 text-sm text-gray-700 whitespace-pre-line">
          {row.body || <span className="text-gray-400">（暂无内容）</span>}
        </div>
      )}
    </div>
  );
}

function CreateModal({ onClose, onDone }) {
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!slug.trim() || !title.trim()) return alert('slug 和标题必填');
    setSaving(true);
    try {
      await api.post('/admin/aftersales-policies', { slug: slug.trim(), title: title.trim(), body });
      onDone();
    } catch (e) {
      alert(e.response?.data?.error || '创建失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 w-[640px] max-w-[90vw]">
        <div className="font-semibold text-lg mb-4">新增售后政策章节</div>
        <label className="text-sm">英文 slug（章节唯一标识，如 us / de / es）</label>
        <input className="field mb-3" value={slug} onChange={e => setSlug(e.target.value)} placeholder="如：es" />
        <label className="text-sm">标题</label>
        <input className="field mb-3" value={title} onChange={e => setTitle(e.target.value)} placeholder="如：西班牙售后政策指南" />
        <label className="text-sm">内容</label>
        <textarea className="field font-mono text-sm mb-4" rows={8} value={body} onChange={e => setBody(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost border" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={saving} onClick={submit}>{saving ? '创建中...' : '创建（草稿）'}</button>
        </div>
      </div>
    </div>
  );
}
