import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { username, password });
      localStorage.setItem('token', data.token);
      onLogin(data.user);
      nav('/dashboard');
    } catch (e) {
      setErr(e.response?.data?.error || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col lg:flex-row relative overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at top left, #4f2a8a 0%, #1f1247 45%, #0a0a23 100%)' }}
    >
      <StarsLayer />

      {/* 左侧品牌介绍区 */}
      <div className="hidden lg:flex flex-col justify-center px-14 xl:px-20 flex-1 text-white relative z-10 max-w-3xl">
        <div className="flex items-center gap-4 mb-8">
          <img src="/logo.png" alt="蓝鲸" className="w-16 h-16 rounded-2xl bg-white p-1 shadow-lg" />
          <div className="text-4xl font-bold tracking-wide">蓝鲸跨境海外仓</div>
        </div>
        <p className="text-purple-200/90 leading-relaxed mb-10 text-base max-w-xl">
          蓝鲸跨境海外仓分销平台是专业的全球仓储分销解决方案提供商，拥有 50 多个海外仓储点，服务覆盖全球主要市场。我们致力于为跨境电商企业和分销商提供高效、可靠的仓储管理、订单处理、物流跟踪等一站式服务，帮助您降低运营成本，提升业务效率，拓展全球市场。
        </p>
        <div className="grid grid-cols-2 gap-4 max-w-xl">
          <StatBlock value="50+" label="海外仓储点" />
          <StatBlock value="600K+" label="SKU 商品" />
          <StatBlock value="500+" label="合作伙伴" />
          <StatBlock value="99.8%" label="服务满意度" />
        </div>
      </div>

      {/* 右侧登录卡 */}
      <div className="flex-1 flex items-center justify-center p-6 relative z-10">
        <form onSubmit={submit} className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 lg:p-10">
          {/* 移动端小 Logo */}
          <div className="lg:hidden flex items-center justify-center gap-2 mb-4">
            <img src="/logo.png" alt="蓝鲸" className="w-9 h-9 rounded-lg bg-white p-0.5" />
            <span className="font-bold">蓝鲸跨境海外仓</span>
          </div>

          <h2 className="text-2xl font-bold text-center text-gray-800">用户登录</h2>
          <p className="text-sm text-gray-400 text-center mt-1 mb-6">请输入您的账户信息</p>

          {err && <div className="bg-red-50 border border-red-200 text-red-600 text-sm p-2.5 rounded-lg mb-4">{err}</div>}

          <label className="block text-sm text-gray-600 mb-1.5 flex items-center gap-1.5">
            <span className="text-gray-400">👤</span> 用户名/邮箱
          </label>
          <input
            className="w-full px-4 py-3 mb-4 rounded-lg bg-slate-50 border border-slate-200 focus:bg-white focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none transition"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="请输入用户名"
            autoComplete="username"
          />

          <label className="block text-sm text-gray-600 mb-1.5 flex items-center gap-1.5">
            <span className="text-gray-400">🔒</span> 密码
          </label>
          <input
            type="password"
            className="w-full px-4 py-3 mb-6 rounded-lg bg-slate-50 border border-slate-200 focus:bg-white focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none transition"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="请输入密码"
            autoComplete="current-password"
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg bg-gradient-to-r from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-white font-medium shadow-md transition disabled:opacity-60"
          >
            {loading ? '登录中...' : '→ 立即登录'}
          </button>

          <div className="text-center mt-4">
            <button type="button" onClick={() => setShowReset(true)} className="text-xs text-gray-400 hover:text-orange-500 transition">
              BOSS 账号忘记密码？通过邮箱找回
            </button>
          </div>
        </form>
      </div>

      {showReset && <BossResetModal initialUsername={username} onClose={() => setShowReset(false)} />}
    </div>
  );
}

// BOSS 账号邮箱验证码找回密码：① 输入用户名发验证码 ② 输验证码 + 新密码完成重置
function BossResetModal({ initialUsername, onClose }) {
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState(initialUsername || '');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    if (!username.trim()) return setErr('请输入 BOSS 用户名');
    setErr(''); setBusy(true);
    try {
      const { data } = await api.post('/auth/boss-reset/send-code', { username: username.trim() });
      setMsg(data.message + (data.email_hint ? `（${data.email_hint}）` : ''));
      setStep(2);
    } catch (e) {
      setErr(e.response?.data?.error || '发送失败');
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!code.trim()) return setErr('请输入验证码');
    if (newPassword.length < 6) return setErr('新密码至少6位');
    setErr(''); setBusy(true);
    try {
      const { data } = await api.post('/auth/boss-reset/confirm', { username: username.trim(), code: code.trim(), new_password: newPassword });
      alert(data.message || '密码已重置，请用新密码登录');
      onClose();
    } catch (e) {
      setErr(e.response?.data?.error || '重置失败');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex justify-between items-center mb-1">
          <div className="font-bold text-lg">🔑 BOSS 密码找回</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
        <p className="text-xs text-gray-500 mb-4">验证码将发送到 BOSS 账号预留邮箱（需店主提前在系统设置中配置 SMTP 并在个人资料中绑定邮箱）</p>

        {err && <div className="bg-red-50 border border-red-200 text-red-600 text-sm p-2 rounded mb-3">{err}</div>}
        {msg && <div className="bg-green-50 border border-green-200 text-green-700 text-sm p-2 rounded mb-3">{msg}</div>}

        <label className="block text-sm text-gray-600 mb-1">BOSS 用户名</label>
        <input
          className="w-full px-3 py-2 mb-3 rounded-lg bg-slate-50 border border-slate-200 focus:bg-white focus:border-orange-400 outline-none"
          value={username}
          onChange={e => setUsername(e.target.value)}
          disabled={step === 2}
        />

        {step === 2 && (
          <>
            <label className="block text-sm text-gray-600 mb-1">邮箱验证码</label>
            <input
              className="w-full px-3 py-2 mb-3 rounded-lg bg-slate-50 border border-slate-200 focus:bg-white focus:border-orange-400 outline-none"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="6 位数字"
              inputMode="numeric"
            />
            <label className="block text-sm text-gray-600 mb-1">新密码</label>
            <input
              type="password"
              className="w-full px-3 py-2 mb-3 rounded-lg bg-slate-50 border border-slate-200 focus:bg-white focus:border-orange-400 outline-none"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="至少6位"
              autoComplete="new-password"
            />
          </>
        )}

        <div className="flex gap-2 mt-2">
          {step === 2 && (
            <button onClick={sendCode} disabled={busy} className="flex-1 py-2.5 rounded-lg border text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-60">
              重发验证码
            </button>
          )}
          <button
            onClick={step === 1 ? sendCode : confirm}
            disabled={busy}
            className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-white text-sm font-medium disabled:opacity-60"
          >
            {busy ? '处理中...' : (step === 1 ? '发送验证码' : '✓ 重置密码')}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatBlock({ value, label }) {
  return (
    <div className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-xl px-6 py-5 hover:bg-white/15 transition">
      <div className="text-3xl font-bold text-orange-300">{value}</div>
      <div className="text-sm text-purple-200/80 mt-1">{label}</div>
    </div>
  );
}

// 简易星点背景层，纯 CSS 不依赖图片
function StarsLayer() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 pointer-events-none opacity-60"
      style={{
        backgroundImage: `
          radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.9), transparent 50%),
          radial-gradient(1px 1px at 70% 20%, rgba(255,255,255,0.7), transparent 50%),
          radial-gradient(1.5px 1.5px at 40% 70%, rgba(255,255,255,0.85), transparent 50%),
          radial-gradient(1px 1px at 85% 60%, rgba(255,255,255,0.6), transparent 50%),
          radial-gradient(1.5px 1.5px at 15% 85%, rgba(255,255,255,0.7), transparent 50%),
          radial-gradient(1px 1px at 55% 45%, rgba(255,255,255,0.5), transparent 50%),
          radial-gradient(1px 1px at 90% 90%, rgba(255,255,255,0.8), transparent 50%),
          radial-gradient(1.5px 1.5px at 30% 15%, rgba(255,255,255,0.6), transparent 50%)
        `,
      }}
    />
  );
}
