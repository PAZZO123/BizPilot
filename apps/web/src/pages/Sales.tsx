import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileText, Receipt } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, errorMessage } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';
import {
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  Pagination,
  Select,
  Spinner,
  StatusBadge,
} from '../components/ui';
import { canManage, useAuth } from '../store/auth';

interface SaleRow {
  id: string;
  number: string;
  total: number;
  amountPaid: number;
  status: string;
  paymentMethod: string;
  soldAt: string;
  customer: { id: string; name: string } | null;
  user: { id: string; name: string } | null;
  _count: { items: number };
}

interface SaleDetail extends SaleRow {
  subtotal: number;
  discount: number;
  tax: number;
  note: string | null;
  items: { id: string; name: string; quantity: number; unitPrice: number; total: number }[];
  payments: { id: string; amount: number; method: string; paidAt: string }[];
  invoice: { id: string; number: string; status: string } | null;
}

const PAGE_SIZE = 25;

export function Sales() {
  const { user, business } = useAuth();
  const currency = business?.currency ?? 'RWF';
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<SaleDetail | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['sales', { page, status }],
    queryFn: async () =>
      (
        await api.get<{ items: SaleRow[]; total: number }>('/sales', {
          params: { page, pageSize: PAGE_SIZE, status: status || undefined },
        })
      ).data,
  });

  const { data: detail } = useQuery({
    queryKey: ['sale', openId],
    queryFn: async () => (await api.get<SaleDetail>(`/sales/${openId}`)).data,
    enabled: Boolean(openId),
  });

  const voidSale = useMutation({
    mutationFn: async () => api.post(`/sales/${voiding?.id}/void`, { reason: voidReason }),
    onSuccess: () => {
      toast.success('Sale cancelled and stock returned.');
      setVoiding(null);
      setOpenId(null);
      setVoidReason('');
      void queryClient.invalidateQueries({ queryKey: ['sales'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const invoiceIt = useMutation({
    mutationFn: async (saleId: string) => (await api.post('/invoices/from-sale', { saleId })).data,
    onSuccess: (invoice: { number: string }) => {
      toast.success(`Invoice ${invoice.number} created.`);
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['sale', openId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div>
      <PageHeader
        title="Sales"
        subtitle="Every sale you have recorded."
        action={
          <Link to="/app/sell" className="btn-primary">
            <Receipt className="h-4 w-4" />
            New sale
          </Link>
        }
      />

      <div className="mb-4 max-w-xs">
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All sales</option>
          <option value="COMPLETED">Fully paid</option>
          <option value="PARTIAL">Not fully paid</option>
          <option value="VOIDED">Cancelled</option>
        </Select>
      </div>

      {isLoading ? (
        <PageLoader />
      ) : !data?.items.length ? (
        <Card>
          <EmptyState
            icon={<Receipt className="h-10 w-10" />}
            title="No sales yet"
            description="Record one at the till and it will appear here."
            action={
              <Link to="/app/sell" className="btn-primary">
                Record a sale
              </Link>
            }
          />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Receipt</th>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((sale) => (
                  <tr
                    key={sale.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setOpenId(sale.id)}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{sale.number}</p>
                      <p className="text-xs text-slate-500">
                        {sale._count.items} item{sale._count.items === 1 ? '' : 's'} ·{' '}
                        {sale.paymentMethod.toLowerCase()}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(sale.soldAt)}</td>
                    <td className="px-4 py-3 text-slate-600">{sale.customer?.name ?? 'Walk-in'}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">
                      {formatMoney(sale.total, currency)}
                      {sale.amountPaid < sale.total && sale.status !== 'VOIDED' && (
                        <p className="text-xs font-normal text-amber-700">
                          {formatMoney(sale.total - sale.amountPaid, currency)} owed
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={sale.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onChange={setPage} />
        </Card>
      )}

      <Modal
        open={Boolean(openId)}
        onClose={() => setOpenId(null)}
        title={detail ? `Sale ${detail.number}` : 'Sale'}
        wide
      >
        {!detail ? (
          <PageLoader />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="When" value={formatDateTime(detail.soldAt)} />
              <Field label="Served by" value={detail.user?.name ?? '—'} />
              <Field label="Customer" value={detail.customer?.name ?? 'Walk-in'} />
              <Field label="Paid by" value={detail.paymentMethod.toLowerCase()} />
            </div>

            <div className="table-wrap">
              <table className="w-full min-w-[380px] text-sm">
                <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 font-medium">Item</th>
                    <th className="py-2 text-right font-medium">Qty</th>
                    <th className="py-2 text-right font-medium">Price</th>
                    <th className="py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2 pr-2 text-slate-900">{item.name}</td>
                      <td className="py-2 text-right tabular-nums text-slate-600">{item.quantity}</td>
                      <td className="py-2 text-right tabular-nums text-slate-600">
                        {formatMoney(item.unitPrice, currency)}
                      </td>
                      <td className="py-2 text-right tabular-nums font-medium text-slate-900">
                        {formatMoney(item.total, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg bg-slate-50 p-4 text-sm">
              <SumRow label="Subtotal" value={formatMoney(detail.subtotal, currency)} />
              {detail.discount > 0 && (
                <SumRow label="Discount" value={`−${formatMoney(detail.discount, currency)}`} />
              )}
              {detail.tax > 0 && <SumRow label="Tax" value={formatMoney(detail.tax, currency)} />}
              <SumRow label="Total" value={formatMoney(detail.total, currency)} strong />
              <SumRow label="Paid" value={formatMoney(detail.amountPaid, currency)} />
              {detail.total > detail.amountPaid && (
                <SumRow
                  label="Still owed"
                  value={formatMoney(detail.total - detail.amountPaid, currency)}
                  strong
                />
              )}
            </div>

            {detail.note && <p className="text-sm text-slate-600">{detail.note}</p>}

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
              {detail.invoice ? (
                <Link to="/app/invoices" className="btn-secondary">
                  <FileText className="h-4 w-4" />
                  Invoice {detail.invoice.number}
                </Link>
              ) : (
                detail.customer &&
                detail.status !== 'VOIDED' && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => invoiceIt.mutate(detail.id)}
                    disabled={invoiceIt.isPending}
                  >
                    {invoiceIt.isPending && <Spinner className="h-4 w-4" />}
                    Make an invoice
                  </button>
                )
              )}
              {canManage(user?.role) && detail.status !== 'VOIDED' && (
                <button type="button" className="btn-danger" onClick={() => setVoiding(detail)}>
                  Cancel this sale
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(voiding)}
        title="Cancel this sale?"
        message="The stock goes back on the shelf and any money still owed is written off. The record is kept, marked as cancelled."
        confirmLabel="Cancel sale"
        destructive
        busy={voidSale.isPending}
        onConfirm={() => voidSale.mutate()}
        onCancel={() => setVoiding(null)}
      />

      {voiding && (
        <Modal open onClose={() => setVoiding(null)} title="Why are you cancelling?">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              voidSale.mutate();
            }}
          >
            <Input
              label="Reason"
              required
              minLength={3}
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              placeholder="Customer returned everything"
              hint="Saved with the sale so the record explains itself later."
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setVoiding(null)}>
                Keep the sale
              </button>
              <button type="submit" className="btn-danger" disabled={voidSale.isPending || voidReason.length < 3}>
                {voidSale.isPending && <Spinner className="h-4 w-4 text-white" />}
                Cancel sale
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 capitalize text-slate-900">{value}</p>
    </div>
  );
}

function SumRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className={strong ? 'font-semibold text-slate-900' : 'text-slate-600'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'font-bold text-slate-900' : 'text-slate-700'}`}>
        {value}
      </span>
    </div>
  );
}
