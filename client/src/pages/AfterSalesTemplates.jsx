import { useEffect, useState } from 'react';
import api from '../api';

// 售后处理模板：BOSS 按售后情况分类维护固定话术/申诉模板，
// 所有分销商和管理员可一键复制；编辑仅 BOSS 或被授权 aftersales_template 的管理员（canEdit）。
export default function AfterSalesTemplates({ canEdit = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editRow, setEditRow] = useState(null);     // null=关闭；{}=新增；带 id=编辑
  const [copiedId, setCopiedId] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/aftersales-templates').then(r => setRows(r.data || [])).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const copy = async (row) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(row.body || '');
      } else {
        // http 环境无 clipboard API 时的兜底
        const ta = document.createElement('textarea');
        ta.value = row.body || '';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setCopiedId(row.id);
      setTimeout(() => setCopiedId(id => (id === row.id ? null : id)), 2000);
    } catch {
      alert('复制失败，请手动选择文本复制');
    }
  };

  const del = async (row) => {
    if (!confirm(`确认删除模板「${row.title}」？此操作不可撤销。`)) return;
    try {
      await api.delete(`/admin/aftersales-templates/${row.id}`);
      load();
    } catch (e) { alert(e.response?.data?.error || '删除失败'); }
  };

  // 按分类分组展示
  const groups = [];
  for (const r of rows) {
    const cat = r.category || '未分类';
    let g = groups.find(x => x.category === cat);
    if (!g) { g = { category: cat, items: [] }; groups.push(g); }
    g.items.push(r);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">📝 售后处理模板</h1>
          <p className="text-gray-500 text-sm mt-1">
            按售后情况分类的固定话术 / 申诉模板，点「复制」即可粘贴使用。
            {canEdit && ' 你有编辑权限，可新增/修改/删除模板。'}
          </p>
        </div>
        {canEdit && (
          <button onClick={() => setEditRow({})} className="btn btn-primary">+ 新增模板</button>
        )}
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm">加载中...</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-lg shadow border p-8 text-center text-gray-400">
          {canEdit ? '暂无模板，点击右上角「新增模板」开始' : '暂无模板'}
        </div>
      ) : (
        groups.map(g => (
          <div key={g.category} className="space-y-2">
            <div className="font-semibold text-gray-700 flex items-center gap-2">
              <span className="badge bg-blue-100 text-blue-700">{g.category}</span>
              <span className="text-xs text-gray-400">{g.items.length} 个模板</span>
            </div>
            <div className="space-y-3">
              {g.items.map(r => (
                <div key={r.id} className="bg-white rounded-lg shadow border">
                  <div className="px-4 py-2.5 border-b flex items-center justify-between gap-3">
                    <div className="font-medium truncate">{r.title}</div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => copy(r)}
                        className={`btn text-sm ${copiedId === r.id ? 'btn-success' : 'btn-primary'}`}
                      >
                        {copiedId === r.id ? '✓ 已复制' : '📋 复制'}
                      </button>
                      {canEdit && <button onClick={() => setEditRow(r)} className="btn btn-ghost border text-sm">编辑</button>}
                      {canEdit && <button onClick={() => del(r)} className="btn btn-ghost border text-sm text-red-600">删除</button>}
                    </div>
                  </div>
                  <div className="p-4 text-sm text-gray-700 whitespace-pre-line break-words">
                    {r.body || <span className="text-gray-400">（暂无内容）</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {editRow !== null && (
        <EditModal
          row={editRow}
          categories={[...new Set(rows.map(r => r.category).filter(Boolean))]}
          onClose={() => setEditRow(null)}
          onDone={() => { setEditRow(null); load(); }}
        />
      )}
    </div>
  );
}

function EditModal({ row, categories, onClose, onDone }) {
  const isNew = !row.id;
  const [f, setF] = useState({
    category: row.category || '',
    title: row.title || '',
    body: row.body || '',
    sort_order: row.sort_order || 0,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!f.title.trim()) return alert('请填写模板标题');
    setSaving(true);
    try {
      if (isNew) await api.post('/admin/aftersales-templates', f);
      else await api.put(`/admin/aftersales-templates/${row.id}`, f);
      onDone();
    } catch (e) { alert(e.response?.data?.error || '保存失败'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="font-semibold text-lg mb-4">{isNew ? '新增售后处理模板' : '编辑售后处理模板'}</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <div className="sm:col-span-2">
            <label className="text-xs text-gray-500">分类（如：退款申诉 / 物流延误 / 商品损坏）</label>
            <input className="field w-full" list="ast-categories" value={f.category} onChange={e => set('category', e.target.value)} placeholder="填写或选择已有分类" />
            <datalist id="ast-categories">
              {categories.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <label className="text-xs text-gray-500">排序（小的在前）</label>
            <input type="number" className="field w-full" value={f.sort_order} onChange={e => set('sort_order', e.target.value)} />
          </div>
        </div>
        <label className="text-xs text-gray-500">模板标题</label>
        <input className="field w-full mb-3" value={f.title} onChange={e => set('title', e.target.value)} placeholder="如：德国站丢件申诉模板" />
        <label className="text-xs text-gray-500">模板内容（保持换行格式，复制时原样带出）</label>
        <textarea className="field w-full font-mono text-sm mb-4" rows={10} value={f.body} onChange={e => set('body', e.target.value)} />
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost border" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={saving} onClick={submit}>{saving ? '保存中...' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}
