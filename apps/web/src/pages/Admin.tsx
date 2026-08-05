import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import clsx from 'clsx';
import { api, errorMessage } from '../lib/api';
import { useChartTheme } from '../lib/charts';
import { formatDate, formatMoney, formatMoneyShort, formatNumber, formatRelative } from '../lib/format';
import { Card, ErrorState, PageHeader, PageLoader, StatTile, StatusBadge } from '../components/ui';

interface Overview {
  mrr: number;
  arr: number;
  payingShops: number;
  totalShops: number;
  planCounts: { plan: string; name: string; shops: number; priceRwf: number; mrrMinor: number }[];
  trialing: number;
  trialsEndingSoon: number;
  pastDue: number;
  churnedLast30: number;
  newThisMonth: number;
  activeShopsLast30: number;
  paidConversionRate: number;
  collectedThisMonth: number;
  collectedAllTime: number;
  costs: {
    smsThisMonth: number;
    aiMessagesThisMonth: number;
    aiCostThisMonth: number;
    totalThisMonth: number;
  };
  grossMarginThisMonth: number;
}

interface Shop {
  id: string;
  name: string;
  plan: string;
  status: string;
  currency: string;
  trialEndsAt: string | null;
  createdAt: string;
  users: number;
  products: number;
  salesLast30: number;
  turnoverLast30: number;
  lastSaleAt: string | null;
  mrrMinor: number;
}

/**
 * BizPilot's own dashboard — the platform's books, not a shop's.
 *
 * Everything is in RWF because that is what we bill in, regardless of what
 * currency any individual shop trades in.
 */
export function Admin() {
  const chart = useChartTheme();

  const overview = useQuery({
    queryKey: ['admin-overview'],
    queryFn: async () => (await api.get<Overview>('/admin/overview')).data,
  });

  const revenue = useQuery({
    queryKey: ['admin-revenue'],
    queryFn: async () =>
      (await api.get<{ month: string; collected: number; payments: number }[]>('/admin/revenue'))
        .data,
  });

  const signups = useQuery({
    queryKey: ['admin-signups'],
    queryFn: async () =>
      (await api.get<{ week: string; signups: number }[]>('/admin/signups')).data,
  });

  const shops = useQuery({
    queryKey: ['admin-shops'],
    queryFn: async () => (await api.get<Shop[]>('/admin/shops')).data,
  });

  if (overview.isLoading) return <PageLoader label="Reading the books…" />;
  if (overview.error || !overview.data) {
    return (
      <ErrorState
        message={errorMessage(overview.error)}
        onRetry={() => void overview.refetch()}
      />
    );
  }

  const data = overview.data;
  const money = (value: number) => formatMoney(value, 'RWF');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Platform"
        subtitle="What BizPilot earns, what it costs to run, and who is about to decide."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="MRR"
          value={money(data.mrr)}
          sub={`${formatNumber(data.payingShops)} paying`}
          tone="positive"
        />
        <StatTile label="ARR (run rate)" value={money(data.arr)} sub="MRR × 12" />
        <StatTile
          label="Collected this month"
          value={money(data.collectedThisMonth)}
          sub={`${money(data.collectedAllTime)} all time`}
        />
        <StatTile
          label="Gross margin"
          value={money(data.grossMarginThisMonth)}
          sub="collected − SMS and AI"
          tone={data.grossMarginThisMonth >= 0 ? 'positive' : 'negative'}
        />
      </div>

      {/* The funnel, left to right: signed up → trialing → paying → left. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Shops total" value={formatNumber(data.totalShops)} />
        <StatTile
          label="New this month"
          value={formatNumber(data.newThisMonth)}
          sub="signups"
        />
        <StatTile
          label="On trial"
          value={formatNumber(data.trialing)}
          sub={`${formatNumber(data.trialsEndingSoon)} ending in 7 days`}
          tone={data.trialsEndingSoon > 0 ? 'positive' : 'neutral'}
        />
        <StatTile
          label="Paying"
          value={formatNumber(data.payingShops)}
          sub={`${(data.paidConversionRate * 100).toFixed(1)}% of all shops`}
        />
        <StatTile
          label="Lost in 30 days"
          value={formatNumber(data.churnedLast30)}
          sub={data.pastDue > 0 ? `${formatNumber(data.pastDue)} payment failing` : 'cancelled or expired'}
          tone={data.churnedLast30 > 0 ? 'negative' : 'neutral'}
        />
      </div>

      {data.trialsEndingSoon > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">
            <strong>{data.trialsEndingSoon}</strong> trial
            {data.trialsEndingSoon === 1 ? '' : 's'} end in the next seven days. The table below
            shows how much each of those shops has actually been using BizPilot — the ones with
            sales are the ones worth calling.
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-slate-900">Cash collected</h2>
          <p className="text-sm text-slate-500">Successful subscription payments, by month.</p>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenue.data ?? []} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="collected" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chart.series.revenue} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={chart.series.revenue} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...chart.grid} />
                <XAxis dataKey="month" {...chart.axis} minTickGap={20} />
                <YAxis
                  {...chart.axis}
                  width={62}
                  tickFormatter={(value: number) => formatMoneyShort(value, 'RWF')}
                />
                <Tooltip
                  {...chart.tooltip}
                  formatter={(value: number) => [money(value), 'Collected']}
                />
                <Area
                  type="monotone"
                  dataKey="collected"
                  stroke={chart.series.revenue}
                  strokeWidth={2}
                  fill="url(#collected)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h2 className="font-semibold text-slate-900">New shops</h2>
          <p className="text-sm text-slate-500">Signups per week — is the top of the funnel filling?</p>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={signups.data ?? []} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...chart.grid} />
                <XAxis dataKey="week" {...chart.axis} minTickGap={20} />
                <YAxis {...chart.axis} width={34} allowDecimals={false} />
                <Tooltip {...chart.tooltip} formatter={(value: number) => [value, 'Signups']} />
                <Bar dataKey="signups" fill={chart.sequentialHue} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-slate-900">Where the MRR comes from</h2>
          <div className="mt-4 space-y-3">
            {data.planCounts.length === 0 && (
              <p className="text-sm text-slate-500">Nobody is paying yet.</p>
            )}
            {data.planCounts.map((row, index) => {
              const share = data.mrr > 0 ? (row.mrrMinor / data.mrr) * 100 : 0;
              return (
                <div key={row.plan}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="flex items-center gap-2 text-slate-700">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: chart.color(index) }}
                      />
                      {row.name}
                      <span className="text-xs text-slate-500">
                        {formatNumber(row.shops)} × {formatNumber(row.priceRwf)}
                      </span>
                    </span>
                    <span className="tabular-nums text-slate-900">{money(row.mrrMinor)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(share, 1)}%`, backgroundColor: chart.color(index) }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <h2 className="font-semibold text-slate-900">What it costs to serve</h2>
          <p className="text-sm text-slate-500">This month, against what was collected.</p>
          <div className="mt-4 space-y-2 text-sm">
            <Row label="SMS sent through the gateway" value={money(data.costs.smsThisMonth)} />
            <Row
              label={`Assistant questions (${formatNumber(data.costs.aiMessagesThisMonth)})`}
              value={money(data.costs.aiCostThisMonth)}
            />
            <div className="flex items-center justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900">
              <span>Total cost</span>
              <span className="tabular-nums">{money(data.costs.totalThisMonth)}</span>
            </div>
            <div className="flex items-center justify-between text-slate-700">
              <span>Collected</span>
              <span className="tabular-nums">{money(data.collectedThisMonth)}</span>
            </div>
            <div
              className={clsx(
                'flex items-center justify-between border-t border-slate-200 pt-2 font-semibold',
                data.grossMarginThisMonth >= 0 ? 'text-emerald-700' : 'text-red-600',
              )}
            >
              <span>Gross margin</span>
              <span className="tabular-nums">{money(data.grossMarginThisMonth)}</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            The assistant is priced from <code>AI_COST_PER_MESSAGE_RWF</code>, an estimate. Check it
            against a real Anthropic invoice before trusting this line.
          </p>
        </Card>
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-3 pt-4 sm:px-5">
          <h2 className="font-semibold text-slate-900">Every shop</h2>
          <p className="text-sm text-slate-500">
            {formatNumber(data.activeShopsLast30)} of {formatNumber(data.totalShops)} recorded a
            sale in the last 30 days
          </p>
        </div>
        <div className="table-wrap">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium sm:px-5">Shop</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">MRR</th>
                <th className="px-4 py-2 text-right font-medium">Sales 30d</th>
                <th className="px-4 py-2 text-right font-medium">Their turnover</th>
                <th className="px-4 py-2 font-medium">Last sale</th>
                <th className="px-4 py-2 font-medium sm:px-5">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shops.data?.map((shop) => (
                <tr key={shop.id}>
                  <td className="px-4 py-2.5 sm:px-5">
                    <p className="font-medium text-slate-900">{shop.name}</p>
                    <p className="text-xs capitalize text-slate-500">
                      {shop.plan} · {shop.users} user{shop.users === 1 ? '' : 's'} ·{' '}
                      {shop.products} products
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={shop.status} />
                    {shop.status === 'TRIALING' && shop.trialEndsAt && (
                      <p className="mt-1 text-xs text-slate-500">
                        until {formatDate(shop.trialEndsAt)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">
                    {shop.mrrMinor > 0 ? money(shop.mrrMinor) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {formatNumber(shop.salesLast30)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {formatMoney(shop.turnoverLast30, shop.currency)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {shop.lastSaleAt ? formatRelative(shop.lastSaleAt) : (
                      <span className="text-slate-400">never</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 sm:px-5">
                    {formatDate(shop.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-slate-700">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
