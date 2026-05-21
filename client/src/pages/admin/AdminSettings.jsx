import { useEffect, useState } from 'react';
import api from '../../api';

const COUNTRIES = ['美国', '英国', '德国', '法国', '荷兰', '意大利', '西班牙', '波兰'];

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
    <div className="space-y-6 max-w-4xl">
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

      <DropxlAccountsCard />
    </div>
  );
}

function DropxlAccountsCard() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/admin/products/dropxl-accounts')
      .then(r => setAccounts(r.data))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <div className="bg-white rounded-xl shadow border p-5 space-y-4">
      <div className="border-b pb-3">
        <div className="font-semibold">🔑 DropXL 多国账户</div>
        <div className="text-xs text-gray-500 mt-1">
          DropXL 每个国家独立账户独立 API Token。配置后可在「商品库存价格管理」用 API 同步按钮拉取该国商品。
          目前已开通的国家填入凭据；未开通的国家留空，开通后再补即可。
        </div>
      </div>
      {loading ? (
        <div className="text-gray-400 text-sm">加载中...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {accounts.map(a => (
            <div key={a.country} className={`border rounded p-3 ${a.has_token ? 'border-green-200 bg-green-50/30' : 'border-gray-200'}`}>
              <div className="flex justify-between items-center mb-1">
                <div className="font-medium">🌐 {a.country}</div>
                {a.has_token ? (
                  <span className="badge bg-green-100 text-green-700">已配置</span>
                ) : (
                  <span className="badge bg-gray-100 text-gray-500">未配置</span>
                )}
              </div>
              <div className="text-xs text-gray-600 mb-2 truncate">
                {a.email || '邮箱：—'}
              </div>
              {a.last_test_at && (
                <div className={`text-xs mb-2 ${a.last_test_ok ? 'text-green-600' : 'text-red-500'}`}>
                  {a.last_test_ok ? '✓ 上次验证通过' : '✗ ' + (a.last_test_error || '验证失败')}
                  <span className="text-gray-400 ml-1">{new Date(a.last_test_at).toLocaleString()}</span>
                </div>
              )}
              <button onClick={() => setEditing(a)} className="btn btn-ghost border text-xs py-1">
                {a.has_token ? '编辑 / 重置' : '配置凭据'}
              </button>
            </div>
          ))}
        </div>
      )}
      {editing && <AccountEditor account={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function AccountEditor({ account, onClose, onSaved }) {
  const [email, setEmail] = useState(account.email || '');
  const [token, setToken] = useState('');
  const [baseUrl, setBaseUrl] = useState(account.base_url || '');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const save = async () => {
    if (!email || !token) return alert('邮箱和 token 必填');
    setSaving(true);
    try {
      await api.put(`/admin/products/dropxl-accounts/${encodeURIComponent(account.country)}`, {
        email, token, base_url: baseUrl || undefined, enabled: true,
      });
      onSaved();
    } catch (e) {
      alert(e.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    // 先保存再测试（因为测试用 DB 里的凭据）
    if (!email || !token) return alert('请先填好邮箱和 token');
    setTesting(true);
    setTestResult(null);
    try {
      await api.put(`/admin/products/dropxl-accounts/${encodeURIComponent(account.country)}`, {
        email, token, base_url: baseUrl || undefined, enabled: true,
      });
      const r = await api.post(`/admin/products/dropxl-accounts/${encodeURIComponent(account.country)}/test`);
      setTestResult(r.data);
    } catch (e) {
      setTestResult({ ok: false, error: e.response?.data?.error || e.message });
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    if (!confirm(`确认删除 ${account.country} 的 DropXL 凭据？`)) return;
    await api.delete(`/admin/products/dropxl-accounts/${encodeURIComponent(account.country)}`);
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-md">
        <div className="border-b p-4 flex justify-between items-center">
          <div className="font-semibold">配置 {account.country} DropXL 凭据</div>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <div>
            <label className="text-xs text-gray-500">客户邮箱（DropXL 登录邮箱）</label>
            <input className="field" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div>
            <label className="text-xs text-gray-500">API Token</label>
            <input className="field" type="password" value={token} onChange={e => setToken(e.target.value)} placeholder={account.has_token ? '已有 token，留空则保留原值；填入新值会覆盖' : '从 DropXL 后台复制'} />
          </div>
          <div>
            <label className="text-xs text-gray-500">Base URL（可选，默认 https://b2b.dropxl.com/api_customer）</label>
            <input className="field" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://b2b.dropxl.com/api_customer" />
          </div>
          {testResult && (
            <div className={`text-xs p-2 rounded ${testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {testResult.ok
                ? `✓ 验证通过：拉取到 ${testResult.sample_count} 条样本商品`
                : `✗ 验证失败：${testResult.error || '未知错误'}${testResult.status ? ` (HTTP ${testResult.status})` : ''}`}
            </div>
          )}
        </div>
        <div className="border-t p-4 flex justify-between gap-2">
          {account.has_token ? (
            <button onClick={remove} className="text-red-500 text-sm">删除</button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={test} disabled={testing} className="btn btn-ghost border text-sm">
              {testing ? '测试中...' : '🧪 测试连接'}
            </button>
            <button onClick={save} disabled={saving} className="btn btn-primary text-sm">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
