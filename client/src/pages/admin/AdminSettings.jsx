import { useEffect, useState } from 'react';
import api from '../../api';

export default function AdminSettings({ user }) {

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">⚙️ 系统设置</h1>
        <p className="text-gray-500 text-sm mt-1">这里维护的参数对所有分销商生效。</p>
      </div>

      <AutoSyncCard />
      <AmazonRatesCard />
      <DropxlAccountsCard />
      {user?.is_owner && <SmtpCard />}
    </div>
  );
}

// SMTP 邮件设置（仅 BOSS 可见/可改）：用于登录页 BOSS 账号忘记密码时发邮箱验证码
function SmtpCard() {
  const [f, setF] = useState({ smtp_host: '', smtp_port: 465, smtp_secure: true, smtp_user: '', smtp_pass: '', smtp_from: '' });
  const [passSet, setPassSet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/admin/settings/smtp').then(r => {
      const d = r.data;
      setF({ smtp_host: d.smtp_host || '', smtp_port: d.smtp_port || 465, smtp_secure: !!d.smtp_secure, smtp_user: d.smtp_user || '', smtp_pass: '', smtp_from: d.smtp_from || '' });
      setPassSet(!!d.smtp_pass_set);
    });
  }, []);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      await api.put('/admin/settings/smtp', { ...f, smtp_port: Number(f.smtp_port) });
      if (f.smtp_pass) setPassSet(true);
      setF(p => ({ ...p, smtp_pass: '' }));
      setMsg('✓ 已保存');
    } catch (e) {
      alert(e.response?.data?.error || '保存失败');
    } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setMsg('');
    try {
      const { data } = await api.post('/admin/settings/smtp-test');
      setMsg('✓ ' + data.message);
    } catch (e) {
      alert(e.response?.data?.error || '测试失败');
    } finally { setTesting(false); }
  };

  return (
    <div className="bg-white rounded-xl shadow border p-5 space-y-3">
      <div className="border-b pb-3">
        <div className="font-semibold">📧 邮件(SMTP)设置 <span className="badge bg-red-100 text-red-700 ml-1">仅 BOSS</span></div>
        <div className="text-xs text-gray-500 mt-1">
          用于 <b>管理员账号忘记密码时通过邮箱验证码自助找回</b>（登录页「忘记密码（仅管理员）」入口）。
          配置好后请在 个人资料 中确认已填写你的邮箱，并点「发送测试邮件」验证可用。
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <label className="block">
          <span className="text-xs text-gray-500">SMTP 服务器</span>
          <input className="field w-full" placeholder="如 smtp.qq.com / smtp.163.com" value={f.smtp_host} onChange={e => set('smtp_host', e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">端口</span>
          <input type="number" className="field w-full" value={f.smtp_port} onChange={e => set('smtp_port', e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">发信账号</span>
          <input className="field w-full" placeholder="邮箱地址" value={f.smtp_user} onChange={e => set('smtp_user', e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">密码 / 授权码 {passSet && <span className="text-green-600">（已配置，留空=不修改）</span>}</span>
          <input type="password" className="field w-full" placeholder={passSet ? '留空保持不变' : 'QQ/163 邮箱需用授权码'} value={f.smtp_pass} onChange={e => set('smtp_pass', e.target.value)} autoComplete="new-password" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">发件人显示（可选）</span>
          <input className="field w-full" placeholder="留空=发信账号" value={f.smtp_from} onChange={e => set('smtp_from', e.target.value)} />
        </label>
        <label className="flex items-center gap-2 mt-4 cursor-pointer">
          <input type="checkbox" checked={f.smtp_secure} onChange={e => set('smtp_secure', e.target.checked)} />
          <span>SSL 加密（465 端口勾选；587 STARTTLS 不勾选）</span>
        </label>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button onClick={save} disabled={saving} className="btn btn-primary text-sm">{saving ? '保存中...' : '保存'}</button>
        <button onClick={test} disabled={testing} className="btn btn-ghost border text-sm">{testing ? '发送中...' : '📨 发送测试邮件'}</button>
        {msg && <span className="text-sm text-green-600">{msg}</span>}
      </div>
    </div>
  );
}

function AutoSyncCard() {
  const [status, setStatus] = useState(null);
  const [triggering, setTriggering] = useState(false);
  const load = () => api.get('/admin/auto-sync-status').then(r => setStatus(r.data));
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  const trigger = async () => {
    if (status?.busy) return alert('上一轮同步还在跑，请稍后');
    if (!confirm('立即触发一次完整同步（商品 + 订单状态）？\n按 1 秒/请求限速，每国约 10-20 分钟。')) return;
    setTriggering(true);
    try {
      await api.post('/admin/auto-sync-now');
      setTimeout(load, 1000);
    } catch (e) {
      alert(e.response?.data?.error || '触发失败');
    } finally { setTriggering(false); }
  };
  const fmt = (s) => s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '从未运行';
  const last = status?.last_run;
  return (
    <div className="bg-white rounded-xl shadow border p-5 space-y-3">
      <div className="border-b pb-3 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-semibold">🔁 自动同步调度</div>
          <div className="text-xs text-gray-500 mt-1">
            服务器每 <b>{status?.interval_hours || 6}</b> 小时自动跑一次：
            ① 已配置凭据的国家做商品库存 API 同步 ② 所有国家订单跟踪号/状态拉取（限 1 秒/请求）。
            <b>纯后台运行，无需登录或打开页面</b>；按真实间隔调度，重启/部署不会重复触发（上次运行时间已持久化）。
          </div>
        </div>
        <button onClick={trigger} disabled={triggering || status?.busy} className="btn btn-primary text-sm whitespace-nowrap">
          {status?.busy ? '⏳ 同步中...' : (triggering ? '触发中...' : '🚀 立即同步一次')}
        </button>
      </div>
      {status && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-gray-500">状态</div>
            <div className={`font-semibold ${status.busy ? 'text-blue-600' : 'text-gray-700'}`}>
              {status.busy ? '⏳ 同步进行中' : '✓ 空闲'}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">下次自动运行</div>
            <div className="text-gray-700">{fmt(status.next_run_at)}</div>
          </div>
          <div className="col-span-2">
            <div className="text-xs text-gray-500">上次运行</div>
            <div className="text-gray-700">
              {last
                ? `${fmt(last.started_at)} → ${last.finished_at ? fmt(last.finished_at) : '运行中'} （${last.reason}）`
                : (status.last_run_at ? fmt(status.last_run_at) : '从未运行')}
            </div>
          </div>
          {last && (
            <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="bg-gray-50 rounded p-2">
                <div className="text-gray-500 mb-1">商品同步结果</div>
                {last.products?.length > 0 ? last.products.map(p => (
                  <div key={p.country} className={p.ok ? 'text-green-700' : 'text-red-600'}>
                    {p.ok ? '✓' : '✗'} {p.country}
                    {p.skipped && <span className="text-gray-400">（跳过：{p.reason}）</span>}
                    {p.ok && !p.skipped && <span className="text-gray-500"> · 抓取 {p.fetched} · 有库存 {p.in_stock}</span>}
                    {p.error && <span className="text-red-500"> · {p.error}</span>}
                  </div>
                )) : <div className="text-gray-400">无</div>}
              </div>
              <div className="bg-gray-50 rounded p-2">
                <div className="text-gray-500 mb-1">订单同步结果</div>
                {last.orders?.length > 0 ? last.orders.map(o => (
                  <div key={o.country} className={o.ok ? 'text-green-700' : 'text-red-600'}>
                    {o.ok ? '✓' : '✗'} {o.country}
                    {o.ok && <span className="text-gray-500"> · 拉取 {o.total} · 更新 {o.updated}</span>}
                    {o.error && <span className="text-red-500"> · {o.error}</span>}
                  </div>
                )) : <div className="text-gray-400">无</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AmazonRatesCard() {
  const [rows, setRows] = useState([]);
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(null);

  // 实时汇率（聚合数据）相关
  const [fxStatus, setFxStatus] = useState(null);
  const [keyInput, setKeyInput] = useState('');
  const [keySet, setKeySet] = useState(false);
  const [keyHint, setKeyHint] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fxMsg, setFxMsg] = useState('');

  const load = () => { api.get('/admin/country-amazon-rates').then(r => setRows(r.data)); };
  const loadFx = () => {
    api.get('/admin/fx-status').then(r => setFxStatus(r.data));
    api.get('/admin/settings').then(r => {
      setKeySet(!!r.data.juhe_fx_api_key_set);
      setKeyHint(r.data.juhe_fx_api_key_hint || '');
    });
  };
  useEffect(() => { load(); loadFx(); }, []);

  const save = async (country) => {
    const v = Number(edits[country]);
    if (!isFinite(v) || v < 0) return alert('请输入非负数');
    setSaving(country);
    try {
      await api.put(`/admin/country-amazon-rates/${encodeURIComponent(country)}`, { rate: v });
      setEdits(e => { const n = { ...e }; delete n[country]; return n; });
      load();
    } catch (err) {
      alert(err.response?.data?.error || '保存失败');
    } finally { setSaving(null); }
  };

  const saveKey = async () => {
    setSavingKey(true);
    try {
      await api.put('/admin/settings', { juhe_fx_api_key: keyInput.trim() });
      setKeyInput('');
      loadFx();
    } catch (err) {
      alert(err.response?.data?.error || '保存失败');
    } finally { setSavingKey(false); }
  };

  const refreshFx = async () => {
    setRefreshing(true);
    setFxMsg('');
    try {
      const { data } = await api.post('/admin/fx-refresh');
      if (data.ok) {
        setFxMsg('✓ 已更新：' + data.updated.map(u => `${u.currency}=${u.rate}`).join('，'));
      } else {
        const errs = (data.errors || []).map(e => `${e.currency}: ${e.error}`).join('；');
        setFxMsg('✗ ' + (data.error || errs || '拉取失败'));
      }
      load(); loadFx();
    } catch (err) {
      setFxMsg('✗ ' + (err.response?.data?.error || '请求失败'));
    } finally { setRefreshing(false); }
  };

  const fmtTime = (iso) => iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '从未';

  return (
    <div className="bg-white rounded-xl shadow border p-5 space-y-4">
      <div className="border-b pb-3">
        <div className="font-semibold">🌐 亚马逊各国汇率（外币 → 人民币）</div>
        <div className="text-xs text-gray-500 mt-1">
          ① 订单管理页计算"亚马逊金额对应的人民币利润"用此汇率。<br/>
          ② <b>分销商采购汇率 = 此汇率 × 1.012</b>（自动加 1.2% 店主汇差），下单时按订单国家自动锁定，不再单独维护采购汇率。<br/>
          店主在订单管理页保存亚马逊金额时，会用<b>当下汇率锁定</b>到该订单；之后改本页汇率不影响已锁定订单。
        </div>
      </div>

      {/* 实时汇率自动拉取（聚合数据，每 6 小时一次） */}
      <div className="border rounded-lg p-3 bg-blue-50 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm font-medium">
            🔄 实时汇率自动更新
            <span className="text-xs text-gray-500 font-normal ml-2">
              聚合数据 · 每 6 小时自动拉取一次（免费 50 次/天，远够用）
            </span>
          </div>
          <button
            onClick={refreshFx}
            disabled={refreshing || !keySet}
            className={`text-sm px-3 py-1 rounded ${keySet ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-200 text-gray-400'} disabled:opacity-60`}
            title={keySet ? '立即拉取最新汇率' : '请先配置 API Key'}
          >
            {refreshing ? '拉取中...' : '立即拉取'}
          </button>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs text-gray-500">
              聚合数据 API Key {keySet && <span className="text-green-600">（已配置 {keyHint}）</span>}
            </label>
            <input
              type="password"
              className="field text-sm"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder={keySet ? '如需更换请输入新 Key' : '粘贴你申请的 APPKEY'}
              autoComplete="off"
            />
          </div>
          <button
            onClick={saveKey}
            disabled={savingKey || !keyInput.trim()}
            className="text-sm px-3 py-1 rounded bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {savingKey ? '保存中...' : '保存 Key'}
          </button>
        </div>
        <div className="text-xs text-gray-500">
          上次更新：{fmtTime(fxStatus?.last_updated_at)}
          {fxStatus && !fxStatus.configured && <span className="text-amber-600 ml-2">· 尚未配置 Key，自动更新未启用</span>}
        </div>
        {fxMsg && <div className={`text-xs ${fxMsg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{fxMsg}</div>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {rows.map(r => {
          const isDirty = edits[r.country] !== undefined;
          const display = isDirty ? edits[r.country] : String(r.rate || '');
          return (
            <div key={r.country} className="border rounded p-3 bg-gray-50">
              <div className="text-sm font-medium mb-1">{r.country} <span className="text-xs text-gray-500">({r.currency})</span></div>
              <div className="flex gap-1">
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  className="field text-sm"
                  value={display}
                  onChange={e => setEdits({ ...edits, [r.country]: e.target.value })}
                  placeholder="未设置"
                />
                <button
                  onClick={() => save(r.country)}
                  disabled={!isDirty || saving === r.country}
                  className={`text-xs px-2 rounded ${isDirty ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gray-200 text-gray-400'}`}
                >
                  {saving === r.country ? '...' : '保存'}
                </button>
              </div>
              {r.rate > 0 && (
                <div className="text-xs text-gray-500 mt-1">
                  1 {r.currency} = {r.rate} CNY<br/>
                  采购 ×1.012 = <b>{(r.rate * 1.012).toFixed(4)}</b>
                </div>
              )}
            </div>
          );
        })}
      </div>
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
        <div className="font-semibold">🔑 供应商多国账户</div>
        <div className="text-xs text-gray-500 mt-1">
          供应商每个国家独立账户独立 API Token。配置后可在「商品库存价格管理」用 API 同步按钮拉取该国商品。
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
    if (!confirm(`确认删除 ${account.country} 的供应商凭据？`)) return;
    await api.delete(`/admin/products/dropxl-accounts/${encodeURIComponent(account.country)}`);
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-md">
        <div className="border-b p-4 flex justify-between items-center">
          <div className="font-semibold">配置 {account.country} 供应商凭据</div>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <div>
            <label className="text-xs text-gray-500">客户邮箱（供应商登录邮箱）</label>
            <input className="field" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div>
            <label className="text-xs text-gray-500">API Token</label>
            <input className="field" type="password" value={token} onChange={e => setToken(e.target.value)} placeholder={account.has_token ? '已有 token，留空则保留原值；填入新值会覆盖' : '从供应商后台复制'} />
          </div>
          <div>
            <label className="text-xs text-gray-500">Base URL（可选，留空使用默认）</label>
            <input className="field" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="留空使用默认" />
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
