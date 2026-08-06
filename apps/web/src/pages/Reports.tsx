import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, errorMessage } from '../lib/api';
import { useChartTheme } from '../lib/charts';
import {
  daysAgoIso,
  firstOfMonthIso,
  formatMoney,
  formatMoneyShort,
  formatNumber,
  todayIso,
} from '../lib/format';
import { Card, ErrorState, Input, PageHeader, PageLoader, StatTile } from '../components/ui';
import { DownloadPdfButton } from '../components/DownloadPdfButton';
import { useAuth } from '../store/auth';

interface ProfitLoss {
  from: string;
  to: string;
  revenue: number;
  cost: number;
  grossProfit: number;
  grossMarginPct: number;
  expenses: number;
  netProfit: number;
  cashCollected: number;
  salesCount: number;
  expensesByCategory: { category: string; total: number }[];
  topProducts: { productId: string | null; name: string; unitsSold: number; revenue: number; profit: number }[];
  paymentMethods: { method: string; total: number; count: number }[];
}

interface DeadStock {
  id: string;
  name: string;
  stockQty: number;
  tiedUpCapital: number;
}

const PRESETS = [
  { label: 'This month', from: firstOfMonthIso, to: todayIso },
  { label: 'Last 30 days', from: () => daysAgoIso(30), to: todayIso },
  { label: 'Last 90 days', from: () => daysAgoIso(90), to: todayIso },
];

export function Reports() {
  const business = useAuth((state) => state.business);
  const chart = useChartTheme();
  const currency = business?.currency ?? 'RWF';

  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(todayIso());

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['profit-loss', { from, to }],
    queryFn: async () =>
      (await api.get<ProfitLoss>('/reports/profit-loss', { params: { from, to } })).data,
  });

  const { data: deadStock } = useQuery({
    queryKey: ['dead-stock', { from, to }],
    queryFn: async () =>
      (await api.get<DeadStock[]>('/reports/dead-stock', { params: { from, to } })).data,
  });

  const money = (value: number) => formatMoney(value, currency);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        subtitle="Where the money came from, and where it went."
        action={
          <DownloadPdfButton
            label="Download PDF"
            path="/reports/profit-loss.pdf"
            params={{ from, to }}
          />
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Input label="From" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          <Input label="To" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="btn-secondary px-3 py-2 text-sm"
                onClick={() => {
                  setFrom(preset.from());
                  setTo(preset.to());
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {isLoading ? (
        <PageLoader />
      ) : error || !data ? (
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Revenue" value={money(data.revenue)} sub={`${data.salesCount} sales`} />
            <StatTile
              label="Gross profit"
              value={money(data.grossProfit)}
              sub={`${data.grossMarginPct.toFixed(1)}% margin`}
              tone={data.grossProfit >= 0 ? 'positive' : 'negative'}
            />
            <StatTile label="Expenses" value={money(data.expenses)} />
            <StatTile
              label="Net profit"
              value={money(data.netProfit)}
              tone={data.netProfit >= 0 ? 'positive' : 'negative'}
              sub="after everything"
            />
          </div>

          {/* Profit and loss as a statement, not a chart — this is the number
              an owner takes to the bank, and it needs to be exact and readable. */}
          <Card>
            <h2 className="mb-3 font-semibold text-slate-900">Profit and loss</h2>
            <dl className="divide-y divide-slate-100 text-sm">
              <PlRow label="Sales revenue" value={money(data.revenue)} />
              <PlRow label="Cost of the goods sold" value={`−${money(data.cost)}`} />
              <PlRow label="Gross profit" value={money(data.grossProfit)} strong />
              <PlRow label="Running costs" value={`−${money(data.expenses)}`} />
              <PlRow label="Net profit" value={money(data.netProfit)} strong highlight />
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              Revenue counts a sale when it happens, not when the cash arrives. You have actually
              collected {money(data.cashCollected)} of it so far.
            </p>
          </Card>

          {data.topProducts.length > 0 && (
            <Card>
              <h2 className="mb-1 font-semibold text-slate-900">What made you the most money</h2>
              <p className="mb-4 text-sm text-slate-500">Profit per product over the period.</p>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.topProducts.slice(0, 10)}
                    layout="vertical"
                    margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid {...chart.grid} horizontal={false} vertical />
                    <XAxis
                      type="number"
                      {...chart.axis}
                      tickFormatter={(value) => formatMoneyShort(value, currency)}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      {...chart.axis}
                      width={128}
                      tickFormatter={(value: string) =>
                        value.length > 18 ? `${value.slice(0, 17)}…` : value
                      }
                    />
                    <Tooltip
                      {...chart.tooltip}
                      formatter={(value: number) => [money(value), 'Profit']}
                    />
                    {/* Single series, so one hue carries magnitude — colour is
                        not encoding identity here and must not be cycled. */}
                    <Bar dataKey="profit" fill={chart.sequentialHue} radius={[0, 4, 4, 0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            {data.expensesByCategory.length > 0 && (
              <Card>
                <h2 className="mb-1 font-semibold text-slate-900">Where the money went</h2>
                <p className="mb-4 text-sm text-slate-500">Spending by category.</p>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.expensesByCategory.slice(0, 8)}
                      layout="vertical"
                      margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid {...chart.grid} horizontal={false} vertical />
                      <XAxis
                        type="number"
                        {...chart.axis}
                        tickFormatter={(value) => formatMoneyShort(value, currency)}
                      />
                      <YAxis type="category" dataKey="category" {...chart.axis} width={104} />
                      <Tooltip {...chart.tooltip} formatter={(value: number) => [money(value), 'Spent']} />
                      <Bar dataKey="total" radius={[0, 4, 4, 0]} barSize={16}>
                        {/* Categories are identities, so each gets its own fixed
                            slot from the validated categorical order. */}
                        {data.expensesByCategory.slice(0, 8).map((row, index) => (
                          <Cell key={row.category} fill={chart.color(index)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* The table is the accessible view of the same numbers, and it
                    also carries the exact figures the chart only approximates. */}
                <ul className="mt-3 space-y-1 text-sm">
                  {data.expensesByCategory.slice(0, 8).map((row, index) => (
                    <li key={row.category} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-slate-700">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: chart.color(index) }}
                          aria-hidden
                        />
                        {row.category}
                      </span>
                      <span className="tabular-nums text-slate-900">{money(row.total)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {data.paymentMethods.length > 0 && (
              <Card>
                <h2 className="mb-1 font-semibold text-slate-900">How customers paid</h2>
                <p className="mb-4 text-sm text-slate-500">
                  Useful for knowing how much float you need in the till.
                </p>
                <ul className="space-y-2.5">
                  {data.paymentMethods.map((row, index) => {
                    const share = data.revenue > 0 ? (row.total / data.revenue) * 100 : 0;
                    return (
                      <li key={row.method}>
                        <div className="mb-1 flex items-baseline justify-between text-sm">
                          <span className="font-medium capitalize text-slate-900">
                            {row.method.toLowerCase()}
                          </span>
                          <span className="tabular-nums text-slate-700">
                            {money(row.total)}{' '}
                            <span className="text-slate-400">({share.toFixed(0)}%)</span>
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(share, 1)}%`,
                              backgroundColor: chart.color(index),
                            }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
          </div>

          {deadStock && deadStock.length > 0 && (
            <Card>
              <h2 className="mb-1 font-semibold text-slate-900">Money sitting on the shelf</h2>
              <p className="mb-4 text-sm text-slate-500">
                These did not sell at all in this period. Consider discounting them to free up cash.
              </p>
              <div className="table-wrap">
                <table className="w-full min-w-[420px] text-sm">
                  <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="pb-2 font-medium">Product</th>
                      <th className="pb-2 text-right font-medium">In stock</th>
                      <th className="pb-2 text-right font-medium">Cash tied up</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {deadStock.map((row) => (
                      <tr key={row.id}>
                        <td className="py-2.5 pr-3 font-medium text-slate-900">{row.name}</td>
                        <td className="py-2.5 text-right tabular-nums text-slate-600">
                          {formatNumber(row.stockQty)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums font-semibold text-amber-700">
                          {money(row.tiedUpCapital)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function PlRow({
  label,
  value,
  strong,
  highlight,
}: {
  label: string;
  value: string;
  strong?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className={`flex justify-between py-2 ${highlight ? 'bg-slate-50 px-2' : ''}`}>
      <dt className={strong ? 'font-semibold text-slate-900' : 'text-slate-600'}>{label}</dt>
      <dd
        className={`tabular-nums ${strong ? 'text-base font-bold text-slate-900' : 'text-slate-700'}`}
      >
        {value}
      </dd>
    </div>
  );
}
