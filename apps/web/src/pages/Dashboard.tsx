import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, ArrowRight, Package, Receipt, Users } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useChartTheme } from '../lib/charts';
import { formatMoney, formatMoneyShort, formatNumber } from '../lib/format';
import { Card, ErrorState, PageLoader, StatTile } from '../components/ui';
import { useAuth } from '../store/auth';

interface PeriodTotals {
  revenue: number;
  cost: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  cashCollected: number;
  salesCount: number;
}

interface DashboardData {
  currency: string;
  businessName: string;
  today: PeriodTotals;
  thisMonth: PeriodTotals;
  lastMonth: PeriodTotals;
  revenueChangePct: number | null;
  revenueTrend: { date: string; revenue: number; profit: number; sales: number }[];
  topProducts: { productId: string | null; name: string; unitsSold: number; revenue: number }[];
  lowStockCount: number;
  overdueInvoiceCount: number;
  overdueInvoiceTotal: number;
  customersOwingCount: number;
  totalReceivable: number;
}

export function Dashboard() {
  const user = useAuth((state) => state.user);
  const chart = useChartTheme();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get<DashboardData>('/reports/dashboard')).data,
  });

  if (isLoading) return <PageLoader label="Loading your numbers…" />;
  if (error || !data) {
    return <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />;
  }

  const currency = data.currency;
  const money = (value: number) => formatMoney(value, currency);

  const chartData = data.revenueTrend.map((point) => ({
    ...point,
    label: new Date(point.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
  }));

  const hasSales = data.revenueTrend.some((point) => point.revenue > 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">
          {greeting()}, {user?.name?.split(' ')[0]}
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">Here is how {data.businessName} is doing.</p>
      </div>

      {/* Today first — it is the number a shopkeeper checks a dozen times a day. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Sales today" value={money(data.today.revenue)} sub={`${data.today.salesCount} sale${data.today.salesCount === 1 ? '' : 's'}`} />
        <StatTile label="Profit today" value={money(data.today.netProfit)} tone={data.today.netProfit >= 0 ? 'positive' : 'negative'} />
        <StatTile
          label="Sales this month"
          value={money(data.thisMonth.revenue)}
          trend={data.revenueChangePct}
          sub="vs last month"
        />
        <StatTile
          label="Profit this month"
          value={money(data.thisMonth.netProfit)}
          tone={data.thisMonth.netProfit >= 0 ? 'positive' : 'negative'}
          sub={`after ${money(data.thisMonth.expenses)} expenses`}
        />
      </div>

      {/* Things that need doing — surfaced above the chart because they are
          actionable, and a chart never is. */}
      {(data.lowStockCount > 0 || data.overdueInvoiceCount > 0 || data.customersOwingCount > 0) && (
        <div className="grid gap-3 sm:grid-cols-3">
          {data.lowStockCount > 0 && (
            <ActionCard
              to="/app/products?lowStock=1"
              tone="amber"
              icon={<AlertTriangle className="h-5 w-5" />}
              title={`${data.lowStockCount} product${data.lowStockCount === 1 ? '' : 's'} running out`}
              body="Restock before you lose the sale."
            />
          )}
          {data.overdueInvoiceCount > 0 && (
            <ActionCard
              to="/app/invoices?overdue=1"
              tone="red"
              icon={<Receipt className="h-5 w-5" />}
              title={`${money(data.overdueInvoiceTotal)} overdue`}
              body={`${data.overdueInvoiceCount} invoice${data.overdueInvoiceCount === 1 ? '' : 's'} past the due date.`}
            />
          )}
          {data.customersOwingCount > 0 && (
            <ActionCard
              to="/app/customers?owing=1"
              tone="slate"
              icon={<Users className="h-5 w-5" />}
              title={`${money(data.totalReceivable)} owed to you`}
              body={`${data.customersOwingCount} customer${data.customersOwingCount === 1 ? '' : 's'} on credit.`}
            />
          )}
        </div>
      )}

      <Card>
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="font-semibold text-slate-900">Last 30 days</h2>
          <Link to="/app/reports" className="text-sm font-medium text-brand-700 hover:underline">
            Full report
          </Link>
        </div>

        {hasSales ? (
          <div className="h-64 w-full sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chart.series.revenue} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={chart.series.revenue} stopOpacity={0.01} />
                  </linearGradient>
                  <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chart.series.profit} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={chart.series.profit} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...chart.grid} />
                <XAxis dataKey="label" {...chart.axis} interval="preserveStartEnd" minTickGap={28} />
                <YAxis {...chart.axis} width={62} tickFormatter={(value) => formatMoneyShort(value, currency)} />
                <Tooltip
                  {...chart.tooltip}
                  formatter={(value: number, name) => [money(value), name]}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  height={28}
                  iconType="plainline"
                  wrapperStyle={{ fontSize: 12, color: '#475569' }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Sales"
                  stroke={chart.series.revenue}
                  strokeWidth={2}
                  fill="url(#revenueFill)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
                />
                <Area
                  type="monotone"
                  dataKey="profit"
                  name="Gross profit"
                  stroke={chart.series.profit}
                  strokeWidth={2}
                  fill="url(#profitFill)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-56 flex-col items-center justify-center gap-3 text-center">
            <Package className="h-9 w-9 text-slate-300" />
            <p className="text-sm text-slate-500">No sales yet. Record your first one and this fills in.</p>
            <Link to="/app/sell" className="btn-primary">
              Record a sale
            </Link>
          </div>
        )}
      </Card>

      <Card padded={false}>
        <div className="flex items-baseline justify-between px-4 pb-3 pt-4 sm:px-5">
          <h2 className="font-semibold text-slate-900">Best sellers this month</h2>
          <Link to="/app/reports" className="text-sm font-medium text-brand-700 hover:underline">
            See all
          </Link>
        </div>

        {data.topProducts.length ? (
          /* A ranked table, not a chart: five rows of "name, units, money" is
             read faster as text, and it doubles as the accessible view of the
             same data the reports page charts. */
          <div className="table-wrap px-4 pb-2 sm:px-5">
            <table className="w-full min-w-[380px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="pb-2 font-medium">Product</th>
                  <th className="pb-2 text-right font-medium">Sold</th>
                  <th className="pb-2 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((product) => (
                  <tr key={product.productId ?? product.name} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-slate-900">{product.name}</td>
                    <td className="py-2.5 text-right tabular-nums text-slate-600">
                      {formatNumber(Number(product.unitsSold))}
                    </td>
                    <td className="py-2.5 text-right tabular-nums font-semibold text-slate-900">
                      {money(product.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 pb-5 text-sm text-slate-500">No sales recorded this month yet.</p>
        )}
      </Card>
    </div>
  );
}

function ActionCard({
  to,
  icon,
  title,
  body,
  tone,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  tone: 'amber' | 'red' | 'slate';
}) {
  const tones = {
    amber: 'bg-amber-50 text-amber-900 hover:bg-amber-100',
    red: 'bg-red-50 text-red-900 hover:bg-red-100',
    slate: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
  };

  return (
    <Link to={to} className={`flex items-start gap-3 rounded-xl p-4 transition-colors ${tones[tone]}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="mt-0.5 block text-sm opacity-80">{body}</span>
      </span>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 opacity-60" />
    </Link>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
