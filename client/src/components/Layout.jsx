import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary.jsx';

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
  { to: '/admin/users', icon: '👥', label: '用户管理', perm: 'users' },
  { to: '/admin/orders', icon: '📋', label: '订单管理', perm: 'orders' },
  { to: '/admin/aftersales', icon: '🔧', label: '售后管理', perm: 'aftersales' },
  { to: '/admin/purchase', icon: '🛒', label: '采购商品', perm: 'purchase' },
  { to: '/admin/downloads', icon: '⬇️', label: '下载支持', perm: 'downloads' },
  { to: '/admin/aftersales-policy', icon: '📄', label: '售后政策维护', perm: 'aftersales_policy' },
  { to: '/admin/staff', icon: '🛡️', label: '管理员', ownerOnly: true },
  { to: '/admin/api-test', icon: '🧪', label: '供应商接口测试', ownerOnly: true },
  { to: '/admin/products', icon: '📦', label: '商品库存价格管理', perm: 'products' },
  { to: '/admin/finance', icon: '💰', label: '财务管理', perm: 'finance' },
  { to: '/admin/settings', icon: '⚙️', label: '系统设置', perm: 'settings' },
  { to: '/profile', icon: '👤', label: '个人资料' },
];

export default function Layout({ user, setUser }) {
  const nav = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // ownerOnly: 仅 BOSS；perm: BOSS 或被分配了该功能的管理员；其余: 所有管理员
  const perms = user?.permissions || [];
  const canSee = (m) => {
    if (m.ownerOnly) return !!user?.is_owner;
    if (m.perm) return !!user?.is_owner || perms.includes(m.perm);
    return true;
  };
  const menu = (user?.is_admin ? adminMenu : userMenu).filter(canSee);
  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    nav('/login');
  };

  // 路由变化时收起抽屉，并锁定 body 滚动（抽屉打开时）
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (drawerOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [drawerOpen]);

  return (
    <div className="flex h-screen bg-gray-100">
      {/* 移动端抽屉打开时的半透明遮罩；点击关闭 */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`
          fixed md:static inset-y-0 left-0 z-40 w-60 bg-slate-900 text-white flex flex-col
          transform transition-transform duration-200 ease-out
          ${drawerOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
        `}
      >
        <div className="px-6 py-5 border-b border-slate-800 flex items-center gap-3">
          <img src="/logo.png" alt="蓝鲸" className="w-10 h-10 rounded-lg bg-white p-0.5" />
          <div className="min-w-0">
            <div className="font-semibold truncate">蓝鲸跨境海外仓</div>
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

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-14 md:h-16 bg-white border-b flex items-center justify-between px-3 md:px-6 shadow-sm gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="md:hidden inline-flex items-center justify-center w-10 h-10 -ml-2 rounded-md hover:bg-gray-100 text-xl"
              aria-label="打开菜单"
            >
              ☰
            </button>
            <img src="/logo.png" alt="蓝鲸" className="w-7 h-7 md:w-8 md:h-8 rounded-md bg-white p-0.5" />
            <span className="font-semibold truncate hidden sm:inline">蓝鲸跨境海外仓分销平台</span>
            <span className="font-semibold truncate sm:hidden text-sm">蓝鲸海外仓</span>
          </div>
          <div className="flex items-center gap-2 md:gap-3 text-sm">
            <span className="text-gray-500 hidden md:inline">欢迎，</span>
            <div className={`w-8 h-8 md:w-9 md:h-9 rounded-full text-white flex items-center justify-center font-semibold ${user?.is_admin ? 'bg-purple-600' : 'bg-red-500'}`}>
              {(user?.display_name || user?.username || '?').slice(0, 1)}
            </div>
            <span className="font-medium truncate max-w-[6rem] md:max-w-none hidden sm:inline">{user?.display_name || user?.username}</span>
            {user?.is_owner
              ? <span className="badge bg-red-100 text-red-700">👑 BOSS</span>
              : user?.is_admin
                ? <span className="badge bg-purple-100 text-purple-700">管理员</span>
                : <span className="badge bg-orange-100 text-orange-600">分销商</span>}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-3 md:p-6">
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
