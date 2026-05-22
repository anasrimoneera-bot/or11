import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState, lazy, Suspense } from 'react';
import api from './api';
import Layout from './components/Layout.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Orders from './pages/Orders.jsx';
import AfterSales from './pages/AfterSales.jsx';
import AfterSalesPolicy from './pages/AfterSalesPolicy.jsx';
import PurchaseProducts from './pages/PurchaseProducts.jsx';
import Downloads from './pages/Downloads.jsx';
import Balance from './pages/Balance.jsx';
import Accounts from './pages/Accounts.jsx';
import Profile from './pages/Profile.jsx';
import AdminDashboard from './pages/admin/AdminDashboard.jsx';
import AdminUsers from './pages/admin/AdminUsers.jsx';
import AdminOrders from './pages/admin/AdminOrders.jsx';
import AdminAfterSales from './pages/admin/AdminAfterSales.jsx';

// 懒加载 + 自动重试：部署后旧 tab 引用了已不存在的 chunk hash，会触发 chunk load error
// 自动 reload 一次拿新 index.html；仍失败则把错误抛给 ErrorBoundary
function lazyWithRetry(importer) {
  return lazy(async () => {
    try { return await importer(); }
    catch (e) {
      const msg = String(e?.message || '');
      const isChunkErr = e?.name === 'ChunkLoadError' || /dynamically imported module|Loading chunk|Failed to fetch/.test(msg);
      if (isChunkErr && !sessionStorage.getItem('chunk-retry-once')) {
        sessionStorage.setItem('chunk-retry-once', '1');
        window.location.reload();
        return { default: () => null };
      }
      throw e;
    }
  });
}

// 店主专属页面 - 通过动态 import 隔离，员工的浏览器永远不会下载这些 JS 块
const AdminApiTest = lazyWithRetry(() => import('./pages/admin/AdminApiTest.jsx'));
const AdminStaff = lazyWithRetry(() => import('./pages/admin/AdminStaff.jsx'));
const AdminProducts = lazyWithRetry(() => import('./pages/admin/AdminProducts.jsx'));
const AdminAfterSalesPolicy = lazyWithRetry(() => import('./pages/admin/AdminAfterSalesPolicy.jsx'));
const AdminSettings = lazyWithRetry(() => import('./pages/admin/AdminSettings.jsx'));

// 切换路由时统一用这个 Loader，铺满主区域避免视觉白屏
const PageLoader = () => (
  <div className="flex items-center justify-center py-24 text-gray-400">
    <svg className="animate-spin h-6 w-6 text-blue-500 mr-2" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
    页面加载中...
  </div>
);
const RouteSlot = ({ children }) => (
  <ErrorBoundary>
    <Suspense fallback={<PageLoader />}>{children}</Suspense>
  </ErrorBoundary>
);

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 首次进来清掉上一轮的重试标记，避免无限刷新
    sessionStorage.removeItem('chunk-retry-once');
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }
    api.get('/auth/me').then(r => setUser(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="h-screen flex items-center justify-center text-gray-500">加载中...</div>;

  const home = user?.is_admin ? '/admin' : '/dashboard';

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={home} /> : <Login onLogin={setUser} />} />
      <Route element={user ? <Layout user={user} setUser={setUser} /> : <Navigate to="/login" />}>
        {user?.is_admin ? (
          <>
            <Route path="/admin" element={<RouteSlot><AdminDashboard /></RouteSlot>} />
            <Route path="/admin/users" element={<RouteSlot><AdminUsers /></RouteSlot>} />
            <Route path="/admin/orders" element={<RouteSlot><AdminOrders /></RouteSlot>} />
            <Route path="/admin/aftersales" element={<RouteSlot><AdminAfterSales /></RouteSlot>} />
            {user?.is_owner && <Route path="/admin/staff" element={<RouteSlot><AdminStaff /></RouteSlot>} />}
            {user?.is_owner && <Route path="/admin/api-test" element={<RouteSlot><AdminApiTest /></RouteSlot>} />}
            {user?.is_owner && <Route path="/admin/products" element={<RouteSlot><AdminProducts /></RouteSlot>} />}
            {user?.is_owner && <Route path="/admin/aftersales-policy" element={<RouteSlot><AdminAfterSalesPolicy /></RouteSlot>} />}
            {user?.is_owner && <Route path="/admin/settings" element={<RouteSlot><AdminSettings /></RouteSlot>} />}
            <Route path="/profile" element={<RouteSlot><Profile user={user} setUser={setUser} /></RouteSlot>} />
            <Route path="*" element={<Navigate to="/admin" />} />
          </>
        ) : (
          <>
            <Route path="/dashboard" element={<RouteSlot><Dashboard /></RouteSlot>} />
            <Route path="/orders" element={<RouteSlot><Orders /></RouteSlot>} />
            <Route path="/after-sales" element={<RouteSlot><AfterSales /></RouteSlot>} />
            <Route path="/after-sales-policy" element={<RouteSlot><AfterSalesPolicy /></RouteSlot>} />
            <Route path="/products" element={<RouteSlot><PurchaseProducts /></RouteSlot>} />
            <Route path="/downloads" element={<RouteSlot><Downloads /></RouteSlot>} />
            <Route path="/balance" element={<RouteSlot><Balance /></RouteSlot>} />
            <Route path="/accounts" element={<RouteSlot><Accounts /></RouteSlot>} />
            <Route path="/profile" element={<RouteSlot><Profile user={user} setUser={setUser} /></RouteSlot>} />
            <Route path="*" element={<Navigate to="/dashboard" />} />
          </>
        )}
      </Route>
    </Routes>
  );
}
