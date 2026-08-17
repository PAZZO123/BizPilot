import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatDate, formatMoney, formatNumber, formatRelative } from '../../lib/format';
import { Modal, PageLoader, StatusBadge } from '../../components/ui';

interface AccountDetailData {
  id: string;
  name: string;
  type: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  currency: string;
  country: string;
  plan: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  createdAt: string;
  suspended: boolean;
  users: {
    id: string;
    email: string;
    name: string;
    role: string;
    isActive: boolean;
    lastLoginAt: string | null;
  }[];
  subscription: {
    plan: string;
    status: string;
    provider: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    transactions: {
      id: string;
      plan: string;
      amount: number;
      currency: string;
      status: string;
      reference: string;
      createdAt: string;
    }[];
  } | null;
  usage: {
    salesLast30: number;
    turnoverLast30: number;
    lastSaleAt: string | null;
    smsThisMonth: number;
    products: number;
    customers: number;
    invoices: number;
  };
  adminHistory: {
    id: string;
    action: string;
    metadata: Record<string, unknown> | null;
    createdAt: string;
    user: { email: string } | null;
  }[];
}

/**
 * One account, in full.
 *
 * Ordered by what someone actually needs when a complaint arrives: is this shop
 * alive, who works there, what have they paid, and what have we already done to
 * them. That last section is the one that stops two admins undoing each other.
 */
export function AccountDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-account', id],
    queryFn: async () => (await api.get<AccountDetailData>(`/admin/accounts/${id}`)).data,
    enabled: Boolean(id),
  });

  return (
    <Modal open={Boolean(id)} onClose={onClose} title={data?.name ?? 'Account'} wide>
      {isLoading || !data ? (
        <PageLoader />
      ) : (
        <div className="space-y-5">
          {data.suspended && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800 dark:bg-red-950 dark:text-red-200">
              This shop is suspended. Nobody there can sign in.
            </p>
          )}

          <section className="grid gap-3 sm:grid-cols-2">
            <Fact label="Plan" value={<span className="capitalize">{data.plan}</span>} />
            <Fact label="Status" value={<StatusBadge status={data.subscriptionStatus} />} />
            <Fact label="Joined" value={formatDate(data.createdAt)} />
            <Fact
              label="Trial ends"
              value={data.trialEndsAt ? formatDate(data.trialEndsAt) : '—'}
            />
            <Fact label="Contact" value={data.email ?? data.phone ?? '—'} />
            <Fact label="Currency" value={`${data.currency} · ${data.country}`} />
          </section>

          <Section title="Activity">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fact label="Sales (30d)" value={formatNumber(data.usage.salesLast30)} />
              <Fact
                label="Turnover (30d)"
                value={formatMoney(data.usage.turnoverLast30, data.currency)}
              />
              <Fact
                label="Last sale"
                value={data.usage.lastSaleAt ? formatRelative(data.usage.lastSaleAt) : 'never'}
              />
              <Fact label="SMS this month" value={formatNumber(data.usage.smsThisMonth)} />
              <Fact label="Products" value={formatNumber(data.usage.products)} />
              <Fact label="Customers" value={formatNumber(data.usage.customers)} />
              <Fact label="Invoices" value={formatNumber(data.usage.invoices)} />
            </div>
          </Section>

          <Section title={`People (${data.users.length})`}>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.users.map((user) => (
                <li key={user.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">{user.name}</p>
                    <p className="text-xs text-slate-500">{user.email}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold uppercase text-slate-500">{user.role}</p>
                    <p className="text-xs text-slate-500">
                      {!user.isActive
                        ? 'deactivated'
                        : user.lastLoginAt
                          ? `seen ${formatRelative(user.lastLoginAt)}`
                          : 'never signed in'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Payments">
            {!data.subscription?.transactions.length ? (
              <p className="text-sm text-slate-500">Nothing has ever been charged.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.subscription.transactions.map((transaction) => (
                  <li
                    key={transaction.id}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="capitalize text-slate-900 dark:text-white">
                        {transaction.plan} plan
                      </p>
                      <p className="truncate text-xs text-slate-500">{transaction.reference}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="tabular-nums">
                        {formatMoney(transaction.amount, transaction.currency)}
                      </span>
                      <StatusBadge status={transaction.status} />
                      <span className="text-xs text-slate-500">
                        {formatDate(transaction.createdAt)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="What admins have done here">
            {!data.adminHistory.length ? (
              <p className="text-sm text-slate-500">Nothing yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.adminHistory.map((entry) => (
                  <li key={entry.id} className="text-sm">
                    <span className="font-medium text-slate-900 dark:text-white">
                      {readableAction(entry.action)}
                    </span>{' '}
                    <span className="text-slate-500">
                      by {entry.user?.email ?? 'unknown'} · {formatRelative(entry.createdAt)}
                    </span>
                    {typeof entry.metadata?.reason === 'string' && (
                      <p className="text-xs italic text-slate-500">
                        “{entry.metadata.reason as string}”
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-0.5 text-sm text-slate-900 dark:text-white">{value}</div>
    </div>
  );
}

/** `admin.account.suspend` reads badly in a list a human is scanning. */
export function readableAction(action: string): string {
  return (
    {
      'admin.account.suspend': 'Suspended the shop',
      'admin.account.restore': 'Restored the shop',
      'admin.account.plan': 'Changed the plan',
      'admin.account.trial': 'Extended the trial',
      'admin.user.active': 'Changed someone’s access',
      'admin.user.role': 'Changed someone’s role',
      'admin.user.signout': 'Signed someone out',
      'admin.payment.recheck': 'Re-checked a payment',
    }[action] ?? action
  );
}
