import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 to-cyan-500">
      <form onSubmit={submit} className="bg-white rounded-2xl p-8 w-96 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-xl">🐋</div>
          <div>
            <div className="text-xl font-bold">蓝鲸跨境海外仓分销平台</div>
            <div className="text-sm text-gray-500">B2B 订单管理系统</div>
          </div>
        </div>
        {err && <div className="bg-red-50 text-red-600 text-sm p-2 rounded mb-3">{err}</div>}
        <label className="block text-sm font-medium mb-1">用户名</label>
        <input className="field mb-3" value={username} onChange={e => setUsername(e.target.value)} />
        <label className="block text-sm font-medium mb-1">密码</label>
        <input className="field mb-4" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        <button disabled={loading} className="btn btn-primary w-full justify-center">
          {loading ? '登录中...' : '登录'}
        </button>
        <div className="text-xs text-gray-400 mt-4 text-center">默认账号 admin / admin123</div>
      </form>
    </div>
  );
}
