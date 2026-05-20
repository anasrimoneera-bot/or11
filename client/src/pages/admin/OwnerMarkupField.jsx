// 店主专属字段 - 通过 lazy load 隔离, 员工不会下载此 chunk
export default function OwnerMarkupField({ value, onChange }) {
  return (
    <div className="col-span-2 bg-red-50 border border-red-200 rounded p-2">
      <label className="text-sm text-red-700">🔒 加价百分比 (仅店主可见)</label>
      <div className="flex items-center gap-2">
        <input className="field" type="number" step="0.1" value={value} onChange={e => onChange(e.target.value)} />
        <span className="text-red-700">%</span>
      </div>
    </div>
  );
}
