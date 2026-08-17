import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { Activity, Building2, CreditCard, LineChart, ScrollText, Users } from 'lucide-react';
import { PageHeader } from '../../components/ui';

const TABS = [
  { to: '/app/admin', label: 'Overview', icon: LineChart, end: true },
  { to: '/app/admin/accounts', label: 'Accounts', icon: Building2 },
  { to: '/app/admin/users', label: 'People', icon: Users },
  { to: '/app/admin/payments', label: 'Payments', icon: CreditCard },
  { to: '/app/admin/audit', label: 'Audit log', icon: ScrollText },
  { to: '/app/admin/system', label: 'System', icon: Activity },
];

/**
 * The platform console.
 *
 * Deliberately looks different from the shop-facing app: this is the one place
 * where a click affects somebody else's business, and it should not feel like
 * the screen where you add a product. The subtitle says whose data you are
 * looking at, because the fastest way to cause real damage here is to forget.
 */
export function AdminLayout() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Platform console"
        subtitle="Every account on BizPilot. Changes here affect real customers and are logged."
      />

      <nav className="table-wrap -mb-px flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              clsx(
                'flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'border-brand-600 text-brand-700 dark:text-brand-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
              )
            }
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
