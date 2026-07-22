import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState, lazy, Suspense } from 'react';
import api from './api';
import Layout from './components/Layout.jsx';
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
// 自动 reload 一次拿新 index.html；仍失败则把错误抛给 Layout 的 ErrorBoundary
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

const AdminApiTest = lazyWithRetry(() => import('./pages/admin/AdminApiTest.jsx'));
const AdminStaff = lazyWithRetry(() => import('./pages/admin/AdminStaff.jsx'));
const AdminProducts = lazyWithRetry(() => import('./pages/admin/AdminProducts.jsx'));
const AdminAfterSalesPolicy = lazyWithRetry(() => import('./pages/admin/AdminAfterSalesPolicy.jsx'));
const AdminSettings = lazyWithRetry(() => import('./pages/admin/AdminSettings.jsx'));
const AdminFinance = lazyWithRetry(() => import('./pages/admin/AdminFinance.jsx'));
const AfterSalesTemplates = lazyWithRetry(() => import('./pages/AfterSalesTemplates.jsx'));

// 居中铺满主区域的加载占位，懒加载 chunk 下载时显示，避免视觉白屏
const PageLoader = () => (
  <div className="flex flex-col items-center justify-center py-24 text-gray-400 gap-3">
    <svg className="animate-spin h-8 w-8 text-blue-500" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
    <div className="text-sm">页面加载中...</div>
  </div>
);
const Lazy = ({ children }) => <Suspense fallback={<PageLoader />}>{children}</Suspense>;

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 首次进来清掉上一轮重试标记，避免循环刷新
    sessionStorage.removeItem('chunk-retry-once');
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }
    api.get('/auth/me').then(r => setUser(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="h-screen flex items-center justify-center text-gray-500">加载中...</div>;

  const home = user?.is_admin ? '/admin' : '/dashboard';
  const perms = user?.permissions || [];

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={home} /> : <Login onLogin={setUser} />} />
      <Route element={user ? <Layout user={user} setUser={setUser} /> : <Navigate to="/login" />}>
        {user?.is_admin ? (
          <>
            <Route path="/admin" element={<AdminDashboard />} />
            {(user?.is_owner || perms.includes('users')) && <Route path="/admin/users" element={<AdminUsers />} />}
            {(user?.is_owner || perms.includes('orders')) && <Route path="/admin/orders" element={<AdminOrders />} />}
            {(user?.is_owner || perms.includes('aftersales')) && <Route path="/admin/aftersales" element={<AdminAfterSales />} />}
            <Route path="/admin/aftersales-templates" element={<Lazy><AfterSalesTemplates canEdit={!!user?.is_owner || perms.includes('aftersales_template')} /></Lazy>} />
            {(user?.is_owner || perms.includes('purchase')) && <Route path="/admin/purchase" element={<PurchaseProducts />} />}
            {(user?.is_owner || perms.includes('downloads')) && <Route path="/admin/downloads" element={<Downloads />} />}
            {user?.is_owner && <Route path="/admin/staff" element={<Lazy><AdminStaff /></Lazy>} />}
            {user?.is_owner && <Route path="/admin/api-test" element={<Lazy><AdminApiTest /></Lazy>} />}
            {(user?.is_owner || perms.includes('products')) && <Route path="/admin/products" element={<Lazy><AdminProducts /></Lazy>} />}
            {(user?.is_owner || perms.includes('aftersales_policy')) && <Route path="/admin/aftersales-policy" element={<Lazy><AdminAfterSalesPolicy /></Lazy>} />}
            {(user?.is_owner || perms.includes('settings')) && <Route path="/admin/settings" element={<Lazy><AdminSettings user={user} /></Lazy>} />}
            {(user?.is_owner || perms.includes('finance')) && <Route path="/admin/finance" element={<Lazy><AdminFinance /></Lazy>} />}
            <Route path="/profile" element={<Profile user={user} setUser={setUser} />} />
            <Route path="*" element={<Navigate to="/admin" />} />
          </>
        ) : (
          <>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/after-sales" element={<AfterSales />} />
            <Route path="/after-sales-policy" element={<AfterSalesPolicy />} />
            <Route path="/after-sales-templates" element={<Lazy><AfterSalesTemplates canEdit={false} /></Lazy>} />
            <Route path="/products" element={<PurchaseProducts />} />
            <Route path="/downloads" element={<Downloads />} />
            <Route path="/balance" element={<Balance />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/profile" element={<Profile user={user} setUser={setUser} />} />
            <Route path="*" element={<Navigate to="/dashboard" />} />
          </>
        )}
      </Route>
    </Routes>
  );
}
