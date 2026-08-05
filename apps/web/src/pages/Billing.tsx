import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { api, errorMessage } from '../lib/api';
import { formatDate, formatMoney, formatNumber } from '../lib/format';
import {
  Card,
  ConfirmDialog,
  PageHeader,
  PageLoader,
  Spinner,
  StatusBadge,
} from '../components/ui';
import { isOwner, useAuth } from '../store/auth';

interface Plan {
  id: string;
  name: string;
  tagline: string;
  priceRwf: number;
  priceUsd: number;
  highlights: string[];
}

interface UsageEntry {
  used: number;
  limit: number | null;
}

interface BillingOverview {
  plan: Plan;
  purchasedPlan: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  paymentsConfigured: boolean;
  usage: {
    salesThisMonth: UsageEntry;
    smsThisMonth: UsageEntry;
    aiMessagesThisMonth: UsageEntry;
    products: UsageEntry;
    users: UsageEntry;
  };
  subscription: {
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    transactions: {
      id: string;
      plan: string;
      amount: number;
      currency: string;
      status: string;
      createdAt: string;
    }[];
  } | null;
}

export function Billing() {
  const { user, business } = useAuth();
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['billing'],
    queryFn: async () => (await api.get<BillingOverview>('/billing')).data,
  });

  const { data: plans } = useQuery({
    queryKey: ['plans'],
    queryFn: async () => (await api.get<{ plans: Plan[] }>('/plans')).data.plans,
    staleTime: Infinity,
  });

  const checkout = useMutation({
    mutationFn: async (plan: string) =>
      (await api.post<{ checkoutUrl: string }>('/billing/checkout', { plan })).data,
    onSuccess: (response) => {
      // Hand off to Flutterwave's hosted page — card details never touch us.
      window.location.href = response.checkoutUrl;
    },
    onError: (error) => toast.error(errorMessage(error), { duration: 6000 }),
  });

  const cancel = useMutation({
    mutationFn: async () => (await api.post('/billing/cancel')).data,
    onSuccess: (response: { message: string }) => {
      toast.success(response.message);
      setCancelling(false);
      void queryClient.invalidateQueries({ queryKey: ['billing'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const resume = useMutation({
    mutationFn: async () => api.post('/billing/resume'),
    onSuccess: () => {
      toast.success('Your plan will keep renewing.');
      void queryClient.invalidateQueries({ queryKey: ['billing'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (isLoading || !data) return <PageLoader />;

  const owner = isOwner(user?.role);
  const localCurrency = business?.currency === 'RWF';

  return (
    <div className="space-y-5">
      <PageHeader title="Plan & billing" subtitle="What you are on, what you are using." />

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">{data.plan.name} plan</h2>
              <StatusBadge status={data.subscriptionStatus} />
            </div>
            <p className="mt-1 text-sm text-slate-500">{data.plan.tagline}</p>

            {data.subscriptionStatus === 'TRIALING' && data.trialEndsAt && (
              <p className="mt-2 text-sm text-amber-800">
                Free trial ends {formatDate(data.trialEndsAt)}.
              </p>
            )}
            {data.subscription?.currentPeriodEnd && data.subscriptionStatus === 'ACTIVE' && (
              <p className="mt-2 text-sm text-slate-600">
                {data.subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} on{' '}
                {formatDate(data.subscription.currentPeriodEnd)}.
              </p>
            )}
          </div>

          {owner && data.subscriptionStatus === 'ACTIVE' && (
            <div>
              {data.subscription?.cancelAtPeriodEnd ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => resume.mutate()}
                  disabled={resume.isPending}
                >
                  Keep my plan
                </button>
              ) : (
                <button type="button" className="btn-ghost text-sm" onClick={() => setCancelling(true)}>
                  Cancel plan
                </button>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 font-semibold text-slate-900">This month's usage</h2>
        <div className="space-y-4">
          <UsageBar label="Sales recorded" entry={data.usage.salesThisMonth} />
          <UsageBar label="Products" entry={data.usage.products} />
          <UsageBar label="Staff accounts" entry={data.usage.users} />
          <UsageBar label="SMS sent" entry={data.usage.smsThisMonth} />
          <UsageBar label="AI questions" entry={data.usage.aiMessagesThisMonth} />
        </div>
      </Card>

      {!data.paymentsConfigured && owner && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">
            Online payments are not configured on this installation yet, so upgrading will not work.
            Add your Flutterwave keys to the server environment to switch it on.
          </p>
        </Card>
      )}

      <div>
        <h2 className="mb-3 font-semibold text-slate-900">Plans</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {plans?.map((plan) => {
            const current = plan.id === data.purchasedPlan && data.subscriptionStatus === 'ACTIVE';
            const price = localCurrency ? plan.priceRwf : plan.priceUsd;
            const prefix = localCurrency ? 'RWF ' : '$';

            return (
              <div
                key={plan.id}
                className={clsx('card flex flex-col p-5', current && 'ring-2 ring-brand-600')}
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="font-bold text-slate-900">{plan.name}</h3>
                  {current && (
                    <span className="rounded-full bg-brand-700 px-2 py-0.5 text-xs font-semibold text-white">
                      Current
                    </span>
                  )}
                </div>
                <p className="mt-2">
                  <span className="text-2xl font-bold text-slate-900">
                    {price === 0 ? 'Free' : `${prefix}${formatNumber(price)}`}
                  </span>
                  {price > 0 && <span className="text-sm text-slate-500"> /month</span>}
                </p>

                <ul className="mt-4 flex-1 space-y-1.5">
                  {plan.highlights.map((line) => (
                    <li key={line} className="flex gap-2 text-sm text-slate-700">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                      {line}
                    </li>
                  ))}
                </ul>

                {owner && !current && plan.id !== 'free' && (
                  <button
                    type="button"
                    className="btn-primary mt-5"
                    onClick={() => checkout.mutate(plan.id)}
                    disabled={checkout.isPending || !data.paymentsConfigured}
                  >
                    {checkout.isPending ? (
                      <Spinner className="h-4 w-4 text-white" />
                    ) : (
                      <ExternalLink className="h-4 w-4" />
                    )}
                    Choose {plan.name}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-slate-500">
          Pay with MTN MoMo, Airtel Money or card. You are charged for one month at a time.
        </p>
      </div>

      {data.subscription?.transactions.length ? (
        <Card padded={false}>
          <h2 className="px-4 pb-3 pt-4 font-semibold text-slate-900 sm:px-5">Payment history</h2>
          <ul className="divide-y divide-slate-100">
            {data.subscription.transactions.map((transaction) => (
              <li key={transaction.id} className="flex items-center justify-between px-4 py-3 sm:px-5">
                <div>
                  <p className="text-sm font-medium capitalize text-slate-900">
                    {transaction.plan} plan
                  </p>
                  <p className="text-xs text-slate-500">{formatDate(transaction.createdAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums text-sm text-slate-900">
                    {formatMoney(transaction.amount, transaction.currency)}
                  </span>
                  <StatusBadge status={transaction.status} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <ConfirmDialog
        open={cancelling}
        title="Cancel your plan?"
        message="You keep everything until the end of the period you have already paid for. After that your shop drops to the Free plan — nothing is deleted."
        confirmLabel="Cancel plan"
        destructive
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onCancel={() => setCancelling(false)}
      />
    </div>
  );
}

function UsageBar({ label, entry }: { label: string; entry: UsageEntry }) {
  const unlimited = entry.limit === null;
  const pct = unlimited ? 0 : Math.min(100, (entry.used / Math.max(entry.limit!, 1)) * 100);
  const nearLimit = !unlimited && pct >= 80;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-slate-700">{label}</span>
        <span className={clsx('tabular-nums', nearLimit ? 'font-semibold text-amber-700' : 'text-slate-600')}>
          {formatNumber(entry.used)}
          {unlimited ? ' · unlimited' : ` / ${formatNumber(entry.limit!)}`}
        </span>
      </div>
      {!unlimited && (
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className={clsx('h-full rounded-full', nearLimit ? 'bg-amber-500' : 'bg-brand-600')}
            style={{ width: `${Math.max(pct, 1)}%` }}
          />
        </div>
      )}
    </div>
  );
}
