import { NavLink, Outlet, useNavigate } from 'react-router-dom';

const userMenu = [
  { to: '/dashboard', icon: '📊', label: '仪表板' },
  { to: '/orders', icon: '📋', label: '订单管理' },
  { to: '/after-sales', icon: '🔧', label: '售后工单' },
  { to: '/after-sales-policy', icon: '📄', label: '售后政策' },
  { to: '/products', icon: '📦', label: '采购商品' },
  { to: '/downloads', icon: '⬇️', label: '下载支持' },
  { to: '/balance', icon: '💰', label: '我的余额记录' },
  { to: '/accounts', icon: '👥', label: '账户管理' },
  { to: '/profile', icon: '👤', label: '个人资料' },
];

const adminMenu = [
  { to: '/admin', icon: '🏠', label: '管理控制台' },
  { to: '/admin/users', icon: '👥', label: '用户管理' },
  { to: '/admin/orders', icon: '📋', label: '订单审核' },
  { to: '/admin/aftersales', icon: '🔧', label: '售后管理' },
  { to: '/admin/staff', icon: '🛡️', label: '员工管理', ownerOnly: true },
  { to: '/admin/audit-logs', icon: '📜', label: '操作审计日志', ownerOnly: true },
  { to: '/admin/api-test', icon: '🧪', label: 'DropXL API测试', ownerOnly: true },
  { to: '/profile', icon: '👤', label: '个人资料' },
];

export default function Layout({ user, setUser }) {
  const nav = useNavigate();
  const menu = (user?.is_admin ? adminMenu : userMenu).filter(m => !m.ownerOnly || user?.is_owner);
  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    nav('/login');
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <aside className="w-60 bg-slate-900 text-white flex flex-col">
        <div className="px-6 py-5 border-b border-slate-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-500 flex items-center justify-center font-bold">D</div>
          <div>
            <div className="font-semibold">DropXL 分销</div>
            <div className="text-xs text-gray-400">{user?.is_admin ? '管理后台' : '分销平台'}</div>
          </div>
        </div>
        <nav className="flex-1 py-3 overflow-y-auto">
          {menu.map(m => (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.to === '/admin'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-6 py-3 text-sm hover:bg-slate-800 ${isActive ? 'bg-orange-500 text-white' : 'text-gray-300'}`
              }
            >
              <span className="text-lg">{m.icon}</span>
              <span>{m.label}</span>
            </NavLink>
          ))}
        </nav>
        <button onClick={logout} className="mx-4 mb-4 mt-2 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-sm">
          ⎋ 退出登录
        </button>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b flex items-center justify-between px-6 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-orange-500 flex items-center justify-center text-white font-bold text-sm">D</div>
            <span className="font-semibold">DropXL {user?.is_admin ? '管理后台' : '分销平台'}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-500">欢迎，</span>
            <div className={`w-9 h-9 rounded-full text-white flex items-center justify-center font-semibold ${user?.is_admin ? 'bg-purple-600' : 'bg-red-500'}`}>
              {(user?.display_name || user?.username || '?').slice(0, 1)}
            </div>
            <span className="font-medium">{user?.display_name || user?.username}</span>
            {user?.is_owner
              ? <span className="badge bg-red-100 text-red-700">👑 店主</span>
              : user?.is_admin
                ? <span className="badge bg-purple-100 text-purple-700">员工</span>
                : <span className="badge bg-orange-100 text-orange-600">分销商</span>}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
