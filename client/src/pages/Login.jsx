import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
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
        </form>
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
