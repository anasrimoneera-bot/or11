import { useEffect, useRef, useState } from 'react';

export default function EditableAmount({ value, onSave, prefix = '$', decimals = 2, disabled = false }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);

  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);
  useEffect(() => { setV(value); }, [value]);

  const commit = async () => {
    const num = Number(v);
    if (!isFinite(num) || num < 0) { setV(value); setEditing(false); return; }
    if (num === Number(value)) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(num); } catch (e) { alert(e.response?.data?.error || '保存失败'); setV(value); }
    finally { setSaving(false); setEditing(false); }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => !disabled && setEditing(true)}
        className={`px-2 py-1 rounded text-right w-full ${disabled ? '' : 'hover:bg-blue-50 cursor-pointer'}`}
        title={disabled ? '' : '点击编辑'}
        disabled={disabled}
      >
        {prefix}{Number(value).toFixed(decimals)}
      </button>
    );
  }
  return (
    <input
      ref={ref}
      type="number"
      step={1 / Math.pow(10, decimals)}
      disabled={saving}
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') { setV(value); setEditing(false); }
      }}
      className="w-24 text-right border border-blue-400 rounded px-1 py-0.5 focus:outline-none"
    />
  );
}
