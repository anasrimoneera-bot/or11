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

// 店主专属页面 - 通过动态 import 隔离，员工的浏览器永远不会下载这些 JS 块
const AdminApiTest = lazy(() => import('./pages/admin/AdminApiTest.jsx'));
const AdminStaff = lazy(() => import('./pages/admin/AdminStaff.jsx'));
const AdminAuditLogs = lazy(() => import('./pages/admin/AdminAuditLogs.jsx'));
const AdminProducts = lazy(() => import('./pages/admin/AdminProducts.jsx'));
const AdminAfterSalesPolicy = lazy(() => import('./pages/admin/AdminAfterSalesPolicy.jsx'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings.jsx'));

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/orders" element={<AdminOrders />} />
            <Route path="/admin/aftersales" element={<AdminAfterSales />} />
            {user?.is_owner && <Route path="/admin/staff" element={<Suspense fallback={<div>加载中...</div>}><AdminStaff /></Suspense>} />}
            {user?.is_owner && <Route path="/admin/audit-logs" element={<Suspense fallback={<div>加载中...</div>}><AdminAuditLogs /></Suspense>} />}
            {user?.is_owner && <Route path="/admin/api-test" element={<Suspense fallback={<div>加载中...</div>}><AdminApiTest /></Suspense>} />}
            {user?.is_owner && <Route path="/admin/products" element={<Suspense fallback={<div>加载中...</div>}><AdminProducts /></Suspense>} />}
            {user?.is_owner && <Route path="/admin/aftersales-policy" element={<Suspense fallback={<div>加载中...</div>}><AdminAfterSalesPolicy /></Suspense>} />}
            {user?.is_owner && <Route path="/admin/settings" element={<Suspense fallback={<div>加载中...</div>}><AdminSettings /></Suspense>} />}
            <Route path="/profile" element={<Profile user={user} setUser={setUser} />} />
            <Route path="*" element={<Navigate to="/admin" />} />
          </>
        ) : (
          <>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/after-sales" element={<AfterSales />} />
            <Route path="/after-sales-policy" element={<AfterSalesPolicy />} />
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
