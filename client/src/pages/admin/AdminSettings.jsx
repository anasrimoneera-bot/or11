import { useEffect, useState } from 'react';
import api from '../../api';

export default function AdminSettings() {
  const [rate, setRate] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    api.get('/admin/settings').then(r => {
      setRate(String(r.data.exchange_rate_cny_per_usd ?? ''));
      setLoaded(true);
    });
  }, []);

  const save = async () => {
    const v = Number(rate);
    if (!isFinite(v) || v <= 0) return alert('汇率必须是正数');
    setSaving(true);
    try {
      await api.put('/admin/settings', { exchange_rate_cny_per_usd: v });
      setSavedAt(new Date());
    } catch (e) {
      alert(e.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">⚙️ 系统设置</h1>
        <p className="text-gray-500 text-sm mt-1">这里维护的参数对所有分销商生效。</p>
      </div>

      <div className="bg-white rounded-xl shadow border p-5 space-y-4">
        <div className="border-b pb-3">
          <div className="font-semibold">💱 人民币 / 美元汇率</div>
          <div className="text-xs text-gray-500 mt-1">
            分销商提交新订单时按此汇率换算人民币应付金额。<br />
            已锁定汇率的订单（已提交未确认/已确认）不会被回算。
          </div>
        </div>
        {!loaded ? (
          <div className="text-gray-400 text-sm">加载中...</div>
        ) : (
          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-xs">
              <label className="text-xs text-gray-500">1 USD = ? CNY</label>
              <input
                type="number"
                step="0.0001"
                min="0"
                className="field"
                value={rate}
                onChange={e => setRate(e.target.value)}
              />
            </div>
            <button onClick={save} disabled={saving} className="btn btn-primary">
              {saving ? '保存中...' : '保存'}
            </button>
            {savedAt && (
              <span className="text-xs text-green-600 mb-2">
                ✓ 已保存于 {savedAt.toLocaleTimeString()}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
