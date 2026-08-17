import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarPlus, Gift, RotateCcw, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { api, errorMessage } from '../../lib/api';
import { formatDate, formatMoney, formatNumber, formatRelative } from '../../lib/format';
import { Card, EmptyState, Input, PageLoader, Select, StatusBadge } from '../../components/ui';
import { ReasonDialog } from './ReasonDialog';
import { AccountDetail } from './AccountDetail';

export interface AdminAccount {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  plan: string;
  status: string;
  suspended: boolean;
  suspendedAt: string | null;
  trialEndsAt: string | null;
  createdAt: string;
  currency: string;
  users: number;
  products: number;
  sales: number;
  mrrMinor: number;
}

type Action =
  | { kind: 'suspend'; account: AdminAccount }
  | { kind: 'restore'; account: AdminAccount }
  | { kind: 'plan'; account: AdminAccount }
  | { kind: 'trial'; account: AdminAccount };

/**
 * Every shop on the platform, searchable.
 *
 * This is the screen someone opens with a customer on the phone, so it searches
 * what a customer will say out loud — the shop's name, the address they signed
 * up with, a staff member's email — rather than an id nobody has to hand.
 */
export function AdminAccounts() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [suspended, setSuspended] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [planChoice, setPlanChoice] = useState('starter');
  const [months, setMonths] = useState(1);
  const [days, setDays] = useState(14);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-accounts', search, status, suspended],
    queryFn: async () =>
      (
        await api.get<{ total: number; shown: number; accounts: AdminAccount[] }>('/admin/accounts', {
          params: {
            search: search || undefined,
            status: status || undefined,
            suspended: suspended || undefined,
          },
        })
      ).data,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-accounts'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-account'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-audit'] });
  };

  const run = useMutation({
    mutationFn: async ({ current, reason }: { current: Action; reason: string }) => {
      const { kind, account } = current;
      if (kind === 'suspend') return api.post(`/admin/accounts/${account.id}/suspend`, { reason });
      if (kind === 'restore') return api.post(`/admin/accounts/${account.id}/restore`, { reason });
      if (kind === 'plan')
        return api.post(`/admin/accounts/${account.id}/plan`, { plan: planChoice, months, reason });
      return api.post(`/admin/accounts/${account.id}/trial`, { days, reason });
    },
    onSuccess: (_result, variables) => {
      toast.success(DONE[variables.current.kind]);
      setAction(null);
      refresh();
    },
  });

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <Input
            label="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Shop name, email, phone, staff email"
          />
          <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Any status</option>
            <option value="TRIALING">Trialing</option>
            <option value="ACTIVE">Active</option>
            <option value="PAST_DUE">Past due</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="EXPIRED">Expired</option>
          </Select>
          <Select
            label="Suspended"
            value={suspended}
            onChange={(event) => setSuspended(event.target.value)}
          >
            <option value="">All accounts</option>
            <option value="false">Active only</option>
            <option value="true">Suspended only</option>
          </Select>
        </div>
        {data && (
          <p className="mt-3 text-sm text-slate-500">
            Showing {formatNumber(data.shown)} of {formatNumber(data.total)} accounts.
          </p>
        )}
      </Card>

      {!data?.accounts.length ? (
        <EmptyState
          icon={<Search className="h-8 w-8" />}
          title="No accounts match"
          description="Try a shorter search, or clear the filters."
        />
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Shop</th>
                  <th className="px-4 py-2.5 font-medium">Plan</th>
                  <th className="px-4 py-2.5 text-right font-medium">MRR</th>
                  <th className="px-4 py-2.5 text-right font-medium">Sales</th>
                  <th className="px-4 py-2.5 text-right font-medium">People</th>
                  <th className="px-4 py-2.5 font-medium">Joined</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.accounts.map((account) => (
                  <tr
                    key={account.id}
                    className={clsx('align-middle', account.suspended && 'opacity-60')}
                  >
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className="text-left font-medium text-brand-700 hover:underline dark:text-brand-400"
                        onClick={() => setOpenId(account.id)}
                      >
                        {account.name}
                      </button>
                      <p className="text-xs text-slate-500">{account.email ?? account.phone ?? '—'}</p>
                      {account.suspended && (
                        <p className="mt-0.5 text-xs font-semibold text-red-600">
                          Suspended {account.suspendedAt ? formatRelative(account.suspendedAt) : ''}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <span className="capitalize">{account.plan}</span>
                        <StatusBadge status={account.status} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {account.mrrMinor ? formatMoney(account.mrrMinor, 'RWF') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatNumber(account.sales)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatNumber(account.users)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(account.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <IconAction
                          label="Give a plan"
                          icon={Gift}
                          onClick={() => setAction({ kind: 'plan', account })}
                        />
                        <IconAction
                          label="Extend trial"
                          icon={CalendarPlus}
                          onClick={() => setAction({ kind: 'trial', account })}
                        />
                        {account.suspended ? (
                          <IconAction
                            label="Restore"
                            icon={RotateCcw}
                            onClick={() => setAction({ kind: 'restore', account })}
                          />
                        ) : (
                          <IconAction
                            label="Suspend"
                            icon={Ban}
                            destructive
                            onClick={() => setAction({ kind: 'suspend', account })}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <AccountDetail id={openId} onClose={() => setOpenId(null)} />

      <ReasonDialog
        open={action !== null}
        title={action ? TITLES[action.kind] : ''}
        destructive={action?.kind === 'suspend'}
        confirmLabel={action ? CONFIRM[action.kind] : ''}
        busy={run.isPending}
        error={run.isError ? errorMessage(run.error) : null}
        description={action ? describe(action) : null}
        extra={
          action?.kind === 'plan' ? (
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Plan"
                value={planChoice}
                onChange={(event) => setPlanChoice(event.target.value)}
              >
                <option value="free">Free</option>
                <option value="starter">Starter</option>
                <option value="business">Business</option>
              </Select>
              <Input
                label="Months"
                type="number"
                min={1}
                max={24}
                value={months}
                onChange={(event) => setMonths(Number(event.target.value))}
              />
            </div>
          ) : action?.kind === 'trial' ? (
            <Input
              label="Extra days"
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            />
          ) : null
        }
        onConfirm={(reason) => action && run.mutate({ current: action, reason })}
        onClose={() => setAction(null)}
      />
    </div>
  );
}

function IconAction({
  label,
  icon: Icon,
  destructive,
  onClick,
}: {
  label: string;
  icon: typeof Ban;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={clsx(
        'rounded-lg p-2 transition-colors',
        destructive
          ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950'
          : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

const TITLES: Record<Action['kind'], string> = {
  suspend: 'Suspend this shop?',
  restore: 'Restore this shop?',
  plan: 'Put this shop on a plan',
  trial: 'Extend this trial',
};

const CONFIRM: Record<Action['kind'], string> = {
  suspend: 'Suspend',
  restore: 'Restore',
  plan: 'Grant plan',
  trial: 'Extend',
};

const DONE: Record<Action['kind'], string> = {
  suspend: 'Suspended. Everyone has been signed out.',
  restore: 'Restored. They can sign in again.',
  plan: 'Plan granted.',
  trial: 'Trial extended.',
};

/** Says what will actually happen to real people, in plain words. */
function describe(action: Action) {
  const name = <strong className="text-slate-900 dark:text-white">{action.account.name}</strong>;
  switch (action.kind) {
    case 'suspend':
      return (
        <>
          Nobody at {name} will be able to sign in, and its {action.account.users}{' '}
          {action.account.users === 1 ? 'person is' : 'people are'} signed out immediately. Nothing
          is deleted and you can undo this at any time.
        </>
      );
    case 'restore':
      return <>{name} will be able to sign in again, exactly as it was before.</>;
    case 'plan':
      return (
        <>
          {name} gets this plan without paying. Recorded as a manual grant, so it does not count
          towards revenue.
        </>
      );
    case 'trial':
      return (
        <>
          Adds days to {name}&apos;s trial, counting from whichever is later: today, or the trial
          they already have.
        </>
      );
  }
}
