import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { PageLoader } from './components/ui';
import { canManage, useAuth } from './store/auth';

import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { Dashboard } from './pages/Dashboard';
import { Sell } from './pages/Sell';
import { Sales } from './pages/Sales';
import { Products } from './pages/Products';
import { Customers } from './pages/Customers';
import { Invoices } from './pages/Invoices';
import { Expenses } from './pages/Expenses';
import { Reports } from './pages/Reports';
import { Assistant } from './pages/Assistant';
import { CashUp } from './pages/CashUp';
import { Admin } from './pages/Admin';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminAccounts } from './pages/admin/Accounts';
import { AdminUsers } from './pages/admin/Users';
import { AdminPayments } from './pages/admin/Payments';
import { AdminAuditLog } from './pages/admin/AuditLog';
import { AdminSystem } from './pages/admin/System';
import { Billing } from './pages/Billing';
import { BillingCallback } from './pages/BillingCallback';
import { SettingsPage } from './pages/Settings';
import { PublicInvoice } from './pages/PublicInvoice';

export function App() {
  const { status, restore, user } = useAuth();

  useEffect(() => {
    void restore();
  }, [restore]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <PageLoader label="Starting BizPilot…" />
      </div>
    );
  }

  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={status === 'authenticated' ? <Navigate to="/app" replace /> : <Landing />} />
      <Route path="/login" element={status === 'authenticated' ? <Navigate to="/app" replace /> : <Login />} />
      <Route path="/signup" element={status === 'authenticated' ? <Navigate to="/app" replace /> : <Register />} />
      {/* Reachable while logged in on purpose: the link arrives by email, and
          someone logged in on a shared shop computer may be resetting the
          password precisely because of it. */}
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {/* Customer-facing invoice link — deliberately reachable without an account. */}
      <Route path="/pay/:token" element={<PublicInvoice />} />
      <Route path="/pay/:token/callback" element={<PublicInvoice />} />

      {/* Authenticated */}
      <Route element={<RequireAuth />}>
        <Route path="/app" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="sell" element={<Sell />} />
          <Route path="sales" element={<Sales />} />
          <Route path="products" element={<Products />} />
          <Route path="customers" element={<Customers />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="billing" element={<Billing />} />
          <Route path="billing/callback" element={<BillingCallback />} />
          <Route path="assistant" element={<Assistant />} />
          <Route path="settings" element={<SettingsPage />} />
          {/* Cash-up is deliberately open to cashiers — they are the ones
              counting the drawer at closing time. */}
          <Route path="cash-up" element={<CashUp />} />

          {/* Money-side screens are for owners and managers only. */}
          <Route element={<RequireManager role={user?.role} />}>
            <Route path="expenses" element={<Expenses />} />
            <Route path="reports" element={<Reports />} />
          </Route>

          {/* BizPilot's own books and controls. The routes are always mounted —
              the API is what refuses, so there is nothing to gain by guessing
              the URL. */}
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<Admin />} />
            <Route path="accounts" element={<AdminAccounts />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="payments" element={<AdminPayments />} />
            <Route path="audit" element={<AdminAuditLog />} />
            <Route path="system" element={<AdminSystem />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status !== 'authenticated') {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <Outlet />;
}

function RequireManager({ role }: { role?: string }) {
  if (!canManage(role as never)) {
    return <Navigate to="/app" replace />;
  }
  return <Outlet />;
}
