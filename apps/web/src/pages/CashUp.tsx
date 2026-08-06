import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Banknote, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import { api, errorMessage } from '../lib/api';
import { useChartTheme } from '../lib/charts';
import { formatMoney, formatMoneyShort, formatNumber, todayIso } from '../lib/format';
import { Card, ErrorState, Input, PageHeader, PageLoader, StatTile } from '../components/ui';
import { DownloadPdfButton } from '../components/DownloadPdfButton';

interface CashUp {
  date: string;
  currency: string;
  businessName: string;
  salesCount: number;
  revenue: number;
  grossProfit: number;
  byMethod: { method: string; total: number; count: number }[];
  cashSales: number;
  cashExpenses: number;
  cashExpenseCount: number;
  cashExpected: number;
  creditGiven: number;
  voidedCount: number;
  voidedTotal: number;
  byUser: {
    userId: string | null;
    name: string;
    role: string | null;
    sales: number;
    revenue: number;
    profit: number;
    discounts: number;
    voided: number;
    averageSale: number;
  }[];
  hourly: { hour: number; revenue: number; sales: number }[];
}

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  MOMO: 'Mobile money',
  CARD: 'Card',
  BANK: 'Bank transfer',
  CREDIT: 'On credit',
};

/**
 * The screen a shop closes on. Everything else in BizPilot answers "how is the
 * business doing"; this one answers the single question asked at 8pm every
 * night — how much money should be in the drawer, and does it match.
 */
export function CashUp() {
  const chart = useChartTheme();
  const [date, setDate] = useState(todayIso());
  const [counted, setCounted] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['cash-up', date],
    queryFn: async () => (await api.get<CashUp>('/reports/cash-up', { params: { date } })).data,
  });

  if (isLoading) return <PageLoader label="Counting up…" />;
  if (error || !data) {
    return <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />;
  }

  const currency = data.currency;
  const money = (value: number) => formatMoney(value, currency);

  // Only compare once something has actually been typed — an empty box is not
  // a count of zero, and showing a huge shortfall before the till is counted
  // would be alarming for no reason.
  const countedMinor = counted.trim() === '' ? null : Math.round(Number(counted) * 100);
  const difference =
    countedMinor !== null && Number.isFinite(countedMinor)
      ? countedMinor - data.cashExpected
      : null;

  const hourly = data.hourly.map((row) => ({
    label: `${String(row.hour).padStart(2, '0')}:00`,
    revenue: row.revenue,
    sales: row.sales,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="End of day"
        subtitle="Count the drawer and close the day."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              aria-label="Day to close"
              value={date}
              max={todayIso()}
              onChange={(event) => setDate(event.target.value)}
              className="w-auto"
            />
            <DownloadPdfButton
              label="Print sheet"
              path="/reports/cash-up.pdf"
              params={{ date }}
            />
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Sales" value={formatNumber(data.salesCount)} sub={`on ${data.date}`} />
        <StatTile label="Takings" value={money(data.revenue)} sub="all payment methods" />
        <StatTile label="Gross profit" value={money(data.grossProfit)} tone="positive" />
        <StatTile
          label="Given on credit"
          value={money(data.creditGiven)}
          sub="no money today"
          tone={data.creditGiven > 0 ? 'negative' : 'neutral'}
        />
      </div>

      {/* The cash drawer — the reason this page exists. */}
      <Card>
        <div className="flex items-center gap-2">
          <Banknote className="h-5 w-5 text-brand-600" />
          <h2 className="font-semibold text-slate-900">The drawer</h2>
        </div>

        <div className="mt-4 space-y-2 text-sm">
          <Line label="Cash sales" value={money(data.cashSales)} />
          <Line
            label={`Cash paid out${data.cashExpenseCount ? ` (${data.cashExpenseCount} expenses)` : ''}`}
            value={`−${money(data.cashExpenses)}`}
          />
          <div className="flex items-center justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900">
            <span>Should be in the drawer</span>
            <span className="tabular-nums">{money(data.cashExpected)}</span>
          </div>
        </div>

        <div className="mt-5 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <Input
              label="What you counted"
              inputMode="decimal"
              placeholder="0"
              value={counted}
              onChange={(event) => setCounted(event.target.value)}
              className="max-w-[200px]"
            />
            {difference !== null && (
              <div
                className={clsx(
                  'mb-1 rounded-lg px-3 py-2 text-sm font-semibold',
                  difference === 0 && 'bg-emerald-100 text-emerald-800',
                  difference > 0 && 'bg-blue-100 text-blue-800',
                  difference < 0 && 'bg-red-100 text-red-800',
                )}
              >
                {difference === 0
                  ? 'Balances exactly.'
                  : difference > 0
                    ? `${money(difference)} more than expected.`
                    : `${money(Math.abs(difference))} short.`}
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Counted figures are not saved — this is a check, not a record.
          </p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-slate-900">How they paid</h2>
          <div className="mt-4 space-y-3">
            {data.byMethod.length === 0 && <p className="text-sm text-slate-500">No sales today.</p>}
            {data.byMethod.map((row, index) => {
              const share = data.revenue > 0 ? (row.total / data.revenue) * 100 : 0;
              return (
                <div key={row.method}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="flex items-center gap-2 text-slate-700">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: chart.color(index) }}
                      />
                      {METHOD_LABELS[row.method] ?? row.method}
                      <span className="text-xs text-slate-500">({row.count})</span>
                    </span>
                    <span className="tabular-nums text-slate-900">{money(row.total)}</span>
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
          <h2 className="font-semibold text-slate-900">When the money came in</h2>
          <p className="text-sm text-slate-500">Useful for deciding when to have staff on.</p>
          <div className="mt-4 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourly} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...chart.grid} />
                <XAxis dataKey="label" {...chart.axis} interval="preserveStartEnd" minTickGap={20} />
                <YAxis
                  {...chart.axis}
                  width={58}
                  tickFormatter={(value: number) => formatMoneyShort(value, currency)}
                />
                <Tooltip
                  {...chart.tooltip}
                  formatter={(value: number) => [money(value), 'Takings']}
                />
                <Bar dataKey="revenue" fill={chart.sequentialHue} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {data.byUser.length > 0 && (
        <Card padded={false}>
          <h2 className="px-4 pb-3 pt-4 font-semibold text-slate-900 sm:px-5">Who served</h2>
          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium sm:px-5">Person</th>
                  <th className="px-4 py-2 text-right font-medium">Sales</th>
                  <th className="px-4 py-2 text-right font-medium">Takings</th>
                  <th className="px-4 py-2 text-right font-medium">Average</th>
                  <th className="px-4 py-2 text-right font-medium sm:px-5">Voided</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.byUser.map((row) => (
                  <tr key={row.userId ?? 'removed'}>
                    <td className="px-4 py-2.5 font-medium text-slate-900 sm:px-5">{row.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                      {formatNumber(row.sales)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">
                      {money(row.revenue)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                      {money(row.averageSale)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums sm:px-5">
                      {row.voided > 0 ? (
                        <span className="font-semibold text-amber-700">{row.voided}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {data.voidedCount > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <div className="flex gap-3">
            <TriangleAlert className="h-5 w-5 shrink-0 text-amber-700" />
            <p className="text-sm text-amber-900">
              {data.voidedCount} sale{data.voidedCount === 1 ? ' was' : 's were'} voided today,
              worth {money(data.voidedTotal)}. Voided sales are excluded from every figure above.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-slate-700">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
