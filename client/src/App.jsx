import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
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
import AdminApiTest from './pages/admin/AdminApiTest.jsx';

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
            <Route path="/admin/api-test" element={<AdminApiTest />} />
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
