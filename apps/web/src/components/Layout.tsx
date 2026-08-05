import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Banknote,
  BarChart3,
  Box,
  Building2,
  CreditCard,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Receipt,
  Settings,
  ShoppingCart,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { canManage, useAuth } from '../store/auth';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  managerOnly?: boolean;
  /** BizPilot's own dashboard, not the shop's. */
  platformOnly?: boolean;
  /** Shown in the phone tab bar. Only five fit. */
  primary?: boolean;
}

const NAV: NavItem[] = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, primary: true },
  { to: '/app/sell', label: 'Sell', icon: ShoppingCart, primary: true },
  { to: '/app/products', label: 'Products', icon: Box, primary: true },
  { to: '/app/sales', label: 'Sales', icon: Receipt },
  { to: '/app/cash-up', label: 'End of day', icon: Banknote },
  { to: '/app/invoices', label: 'Invoices', icon: FileText },
  { to: '/app/customers', label: 'Customers', icon: Users },
  { to: '/app/expenses', label: 'Expenses', icon: Wallet, managerOnly: true },
  { to: '/app/reports', label: 'Reports', icon: BarChart3, managerOnly: true },
  { to: '/app/assistant', label: 'Assistant', icon: MessageSquare, primary: true },
  { to: '/app/billing', label: 'Plan & billing', icon: CreditCard },
  { to: '/app/settings', label: 'Settings', icon: Settings },
  { to: '/app/admin', label: 'Platform', icon: Building2, platformOnly: true },
];

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, business, logout } = useAuth();
  const navigate = useNavigate();

  const visible = NAV.filter(
    (item) =>
      (!item.managerOnly || canManage(user?.role)) &&
      (!item.platformOnly || user?.isPlatformAdmin === true),
  );
  const primary = visible.filter((item) => item.primary).slice(0, 4);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const trialDaysLeft = business?.trialEndsAt
    ? Math.ceil((new Date(business.trialEndsAt).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <BrandMark />
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {visible.map((item) => (
            <SidebarLink key={item.to} item={item} onNavigate={() => undefined} />
          ))}
        </nav>
        <UserFooter name={user?.name} role={user?.role} onLogout={handleLogout} />
      </aside>

      {/* Mobile slide-over */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMenuOpen(false)} aria-hidden />
          <aside className="relative flex h-full w-64 flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between pr-2">
              <BrandMark />
              <button type="button" onClick={() => setMenuOpen(false)} className="rounded-lg p-2 text-slate-400" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
              {visible.map((item) => (
                <SidebarLink key={item.to} item={item} onNavigate={() => setMenuOpen(false)} />
              ))}
            </nav>
            <UserFooter name={user?.name} role={user?.role} onLogout={handleLogout} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 lg:hidden">
          <button type="button" onClick={() => setMenuOpen(true)} className="rounded-lg p-2 text-slate-600" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="truncate font-semibold text-slate-900">{business?.name ?? 'BizPilot'}</span>
          <ThemeToggle className="ml-auto shrink-0" />
        </header>

        {trialDaysLeft !== null && trialDaysLeft <= 7 && trialDaysLeft >= 0 && (
          <div className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
            {trialDaysLeft === 0
              ? 'Your free trial ends today.'
              : `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left in your free trial.`}{' '}
            <NavLink to="/app/billing" className="font-semibold underline">
              Choose a plan
            </NavLink>
          </div>
        )}

        {/* pb-20 leaves room for the fixed phone tab bar. */}
        <main className="min-w-0 flex-1 px-4 py-5 pb-24 sm:px-6 lg:pb-8">
          <Outlet />
        </main>

        {/* Phone tab bar — the four screens a shopkeeper uses all day. */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
          {primary.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/app'}
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium',
                  isActive ? 'text-brand-700' : 'text-slate-500',
                )
              }
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-2 px-4 py-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white">
        BP
      </div>
      <span className="font-display text-xl font-bold text-slate-900">BizPilot</span>
    </div>
  );
}

function SidebarLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/app'}
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100',
        )
      }
    >
      <item.icon className="h-4.5 w-4.5 shrink-0" style={{ width: 18, height: 18 }} />
      {item.label}
    </NavLink>
  );
}

function UserFooter({
  name,
  role,
  onLogout,
}: {
  name?: string;
  role?: string;
  onLogout: () => void;
}) {
  return (
    <div className="border-t border-slate-200 p-3">
      <div className="mb-2 flex items-center gap-2 px-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">{name}</p>
          <p className="text-xs capitalize text-slate-500">{role?.toLowerCase()}</p>
        </div>
        <ThemeToggle className="shrink-0" />
      </div>
      <button type="button" onClick={onLogout} className="btn-ghost w-full justify-start px-3 py-2 text-sm">
        <LogOut className="h-4 w-4" />
        Log out
      </button>
    </div>
  );
}
