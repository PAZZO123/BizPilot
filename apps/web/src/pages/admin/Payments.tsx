import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, errorMessage } from '../../lib/api';
import { formatDate, formatMoney } from '../../lib/format';
import { Card, EmptyState, Input, PageLoader, Select, Spinner, StatusBadge } from '../../components/ui';

interface AdminPayment {
  id: string;
  plan: string;
  amount: number;
  currency: string;
  status: string;
  provider: string;
  reference: string;
  providerRef: string | null;
  createdAt: string;
  periodEnd: string | null;
  business: { id: string; name: string };
}

/**
 * Every subscription payment, and one button.
 *
 * "Re-check" exists for the case that actually happens: money left a customer's
 * wallet, the callback never arrived, and the shop is still on the free plan.
 * It asks the provider again and settles only if the provider says the payment
 * succeeded — so it can confirm a real payment but never invent one, which is
 * why it is safe to put next to every row.
 */
export function AdminPayments() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-payments', search, status],
    queryFn: async () =>
      (
        await api.get<AdminPayment[]>('/admin/payments', {
          params: { search: search || undefined, status: status || undefined },
        })
      ).data,
  });

  const recheck = useMutation({
    mutationFn: async (reference: string) =>
      (await api.post<{ settled: boolean; reason?: string }>(`/admin/payments/${reference}/recheck`))
        .data,
    onSuccess: (result) => {
      if (result.settled) {
        toast.success('Confirmed with the provider and credited.');
      } else {
        toast(result.reason ?? 'The provider still does not call this one paid.', { icon: 'ℹ️' });
      }
      void queryClient.invalidateQueries({ queryKey: ['admin-payments'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-accounts'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Input
            label="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Reference, provider id or shop name"
          />
          <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Any status</option>
            <option value="PENDING">Pending</option>
            <option value="SUCCESSFUL">Successful</option>
            <option value="FAILED">Failed</option>
            <option value="REFUNDED">Refunded</option>
          </Select>
        </div>
      </Card>

      {!data?.length ? (
        <EmptyState
          icon={<Search className="h-8 w-8" />}
          title="No payments"
          description="Nothing matches those filters yet."
        />
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Shop</th>
                  <th className="px-4 py-2.5 font-medium">Plan</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Reference</th>
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 text-right font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.map((payment) => (
                  <tr key={payment.id}>
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                      {payment.business.name}
                    </td>
                    <td className="px-4 py-3 capitalize">{payment.plan}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatMoney(payment.amount, payment.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={payment.status} />
                    </td>
                    <td className="px-4 py-3">
                      <p className="max-w-[220px] truncate font-mono text-xs text-slate-500">
                        {payment.reference}
                      </p>
                      <p className="text-xs text-slate-400">{payment.provider}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(payment.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {payment.status !== 'SUCCESSFUL' && (
                        <button
                          type="button"
                          className="btn-secondary px-2.5 py-1.5 text-xs"
                          disabled={recheck.isPending}
                          onClick={() => recheck.mutate(payment.reference)}
                        >
                          {recheck.isPending ? (
                            <Spinner className="h-3.5 w-3.5" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          Re-check
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
