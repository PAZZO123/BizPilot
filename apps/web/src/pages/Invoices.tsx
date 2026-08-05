import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Copy, Download, FileText, Plus, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { api, errorMessage } from '../lib/api';
import { formatDate, formatMoney, parseMoney, todayIso } from '../lib/format';
import {
  Card,
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
import { useAuth } from '../store/auth';

interface InvoiceRow {
  id: string;
  number: string;
  status: string;
  total: number;
  amountPaid: number;
  issueDate: string;
  dueDate: string | null;
  customer: { id: string; name: string; phone: string | null } | null;
}

interface InvoiceDetail extends InvoiceRow {
  subtotal: number;
  discount: number;
  tax: number;
  notes: string | null;
  terms: string | null;
  publicToken: string;
  items: { id: string; name: string; quantity: number; unitPrice: number; total: number }[];
  payments: { id: string; amount: number; method: string; paidAt: string }[];
}

interface Customer {
  id: string;
  name: string;
}

const PAGE_SIZE = 25;

export function Invoices() {
  const business = useAuth((state) => state.business);
  const currency = business?.currency ?? 'RWF';
  const queryClient = useQueryClient();

  const [params, setParams] = useSearchParams();
  const overdueOnly = params.get('overdue') === '1';
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', { page, overdueOnly }],
    queryFn: async () =>
      (
        await api.get<{ items: InvoiceRow[]; total: number; outstandingTotal: number }>('/invoices', {
          params: { page, pageSize: PAGE_SIZE, overdueOnly: overdueOnly || undefined },
        })
      ).data,
  });

  const { data: detail } = useQuery({
    queryKey: ['invoice', openId],
    queryFn: async () => (await api.get<InvoiceDetail>(`/invoices/${openId}`)).data,
    enabled: Boolean(openId),
  });

  const send = useMutation({
    mutationFn: async (id: string) => (await api.post(`/invoices/${id}/send`, {})).data,
    onSuccess: () => {
      toast.success('Reminder sent by SMS.');
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['invoice', openId] });
    },
    onError: (error) => toast.error(errorMessage(error), { duration: 6000 }),
  });

  async function downloadPdf(invoice: InvoiceRow) {
    try {
      const response = await api.get(`/invoices/${invoice.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${invoice.number}.pdf`;
      link.click();
      // Revoking immediately would cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not build the PDF.'));
    }
  }

  function copyLink(token: string) {
    const link = `${window.location.origin}/pay/${token}`;
    void navigator.clipboard.writeText(link).then(
      () => toast.success('Payment link copied.'),
      () => toast.error('Could not copy. The link is ' + link),
    );
  }

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle={
          data ? `${formatMoney(data.outstandingTotal, currency)} still outstanding.` : undefined
        }
        action={
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New invoice
          </button>
        }
      />

      <div className="mb-4">
        <button
          type="button"
          className={clsx(overdueOnly ? 'btn-primary' : 'btn-secondary')}
          onClick={() => {
            const next = new URLSearchParams(params);
            if (overdueOnly) next.delete('overdue');
            else next.set('overdue', '1');
            setParams(next);
            setPage(1);
          }}
        >
          Overdue only
        </button>
      </div>

      {isLoading ? (
        <PageLoader />
      ) : !data?.items.length ? (
        <Card>
          <EmptyState
            icon={<FileText className="h-10 w-10" />}
            title={overdueOnly ? 'Nothing is overdue' : 'No invoices yet'}
            description={
              overdueOnly
                ? 'Every invoice is either paid or still within its due date.'
                : 'Create one for a customer, or raise one from a credit sale.'
            }
          />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Invoice</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 text-right font-medium">Outstanding</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setOpenId(invoice.id)}
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">{invoice.number}</td>
                    <td className="px-4 py-3 text-slate-600">{invoice.customer?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(invoice.dueDate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">
                      {formatMoney(invoice.total - invoice.amountPaid, currency)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={invoice.status} />
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
        title={detail ? `Invoice ${detail.number}` : 'Invoice'}
        wide
      >
        {!detail ? (
          <PageLoader />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-slate-900">{detail.customer?.name}</p>
                <p className="text-sm text-slate-500">
                  Issued {formatDate(detail.issueDate)}
                  {detail.dueDate ? ` · due ${formatDate(detail.dueDate)}` : ''}
                </p>
              </div>
              <StatusBadge status={detail.status} />
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
              <div className="flex justify-between py-0.5">
                <span className="text-slate-600">Total</span>
                <span className="tabular-nums font-semibold text-slate-900">
                  {formatMoney(detail.total, currency)}
                </span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-slate-600">Paid</span>
                <span className="tabular-nums text-slate-700">
                  {formatMoney(detail.amountPaid, currency)}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5">
                <span className="font-semibold text-slate-900">Outstanding</span>
                <span className="tabular-nums text-base font-bold text-slate-900">
                  {formatMoney(detail.total - detail.amountPaid, currency)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
              <button type="button" className="btn-secondary" onClick={() => void downloadPdf(detail)}>
                <Download className="h-4 w-4" />
                PDF
              </button>
              <button type="button" className="btn-secondary" onClick={() => copyLink(detail.publicToken)}>
                <Copy className="h-4 w-4" />
                Copy pay link
              </button>
              {detail.customer?.phone && detail.total > detail.amountPaid && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => send.mutate(detail.id)}
                  disabled={send.isPending}
                >
                  {send.isPending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                  Text a reminder
                </button>
              )}
              {detail.total > detail.amountPaid && (
                <button type="button" className="btn-primary ml-auto" onClick={() => setPayingId(detail.id)}>
                  Record a payment
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <RecordPaymentForm
        invoiceId={payingId}
        outstanding={detail ? detail.total - detail.amountPaid : 0}
        currency={currency}
        onClose={() => setPayingId(null)}
      />

      <CreateInvoiceForm open={creating} currency={currency} onClose={() => setCreating(false)} />
    </div>
  );
}

function RecordPaymentForm({
  invoiceId,
  outstanding,
  currency,
  onClose,
}: {
  invoiceId: string | null;
  outstanding: number;
  currency: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');

  const submit = useMutation({
    mutationFn: async () =>
      api.post(`/invoices/${invoiceId}/payments`, { amount: parseMoney(amount), method }),
    onSuccess: () => {
      toast.success('Payment recorded.');
      setAmount('');
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['invoice'] });
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Modal open={Boolean(invoiceId)} onClose={onClose} title="Record a payment">
      <form
        className="space-y-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          submit.mutate();
        }}
      >
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {formatMoney(outstanding, currency)} still outstanding.
        </p>
        <Input
          label="How much did they pay?"
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder={String(Math.round(outstanding / 100))}
        />
        <Select label="How?" value={method} onChange={(event) => setMethod(event.target.value)}>
          <option value="CASH">Cash</option>
          <option value="MOMO">Mobile money</option>
          <option value="BANK">Bank transfer</option>
          <option value="CARD">Card</option>
        </Select>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={submit.isPending}>
            {submit.isPending && <Spinner className="h-4 w-4 text-white" />}
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface DraftLine {
  name: string;
  quantity: string;
  unitPrice: string;
}

function CreateInvoiceForm({
  open,
  currency,
  onClose,
}: {
  open: boolean;
  currency: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ name: '', quantity: '1', unitPrice: '' }]);

  const { data: customers } = useQuery({
    queryKey: ['customers', 'picker'],
    queryFn: async () =>
      (await api.get<{ items: Customer[] }>('/customers', { params: { pageSize: 200 } })).data.items,
    enabled: open,
  });

  const total = lines.reduce(
    (sum, line) => sum + parseMoney(line.unitPrice) * (Number(line.quantity) || 0),
    0,
  );

  const create = useMutation({
    mutationFn: async () =>
      api.post('/invoices', {
        customerId,
        dueDate: dueDate || undefined,
        notes: notes.trim() || undefined,
        items: lines
          .filter((line) => line.name.trim())
          .map((line) => ({
            name: line.name.trim(),
            quantity: Number(line.quantity) || 1,
            unitPrice: parseMoney(line.unitPrice),
          })),
      }),
    onSuccess: () => {
      toast.success('Invoice created.');
      setLines([{ name: '', quantity: '1', unitPrice: '' }]);
      setCustomerId('');
      setDueDate('');
      setNotes('');
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function updateLine(index: number, field: keyof DraftLine, value: string) {
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, [field]: value } : line)),
    );
  }

  const valid = customerId && lines.some((line) => line.name.trim() && parseMoney(line.unitPrice) > 0);

  return (
    <Modal open={open} onClose={onClose} title="New invoice" wide>
      <form
        className="space-y-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <Select
          label="Customer"
          required
          value={customerId}
          onChange={(event) => setCustomerId(event.target.value)}
        >
          <option value="">Choose a customer…</option>
          {customers?.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </Select>

        <Input
          label="Due date"
          type="date"
          value={dueDate}
          min={todayIso()}
          onChange={(event) => setDueDate(event.target.value)}
          hint="Reminders start going out after this date."
        />

        <div>
          <p className="label">Items</p>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="flex gap-2">
                <input
                  className="input flex-1"
                  placeholder="Description"
                  value={line.name}
                  onChange={(event) => updateLine(index, 'name', event.target.value)}
                  aria-label={`Item ${index + 1} description`}
                />
                <input
                  className="input w-16 text-center"
                  inputMode="numeric"
                  value={line.quantity}
                  onChange={(event) => updateLine(index, 'quantity', event.target.value)}
                  aria-label={`Item ${index + 1} quantity`}
                />
                <input
                  className="input w-28 text-right"
                  inputMode="decimal"
                  placeholder="Price"
                  value={line.unitPrice}
                  onChange={(event) => updateLine(index, 'unitPrice', event.target.value)}
                  aria-label={`Item ${index + 1} price`}
                />
                {lines.length > 1 && (
                  <button
                    type="button"
                    className="shrink-0 rounded-lg px-2 text-slate-400 hover:text-red-600"
                    onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                    aria-label={`Remove item ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn-ghost mt-2 px-2 py-1 text-sm"
            onClick={() => setLines((current) => [...current, { name: '', quantity: '1', unitPrice: '' }])}
          >
            <Plus className="h-3.5 w-3.5" />
            Add another line
          </button>
        </div>

        <Input
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Thank you for your business."
        />

        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
          <span className="font-semibold text-slate-900">Total</span>
          <span className="text-lg font-bold tabular-nums text-slate-900">
            {formatMoney(total, currency)}
          </span>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!valid || create.isPending}>
            {create.isPending && <Spinner className="h-4 w-4 text-white" />}
            Create invoice
          </button>
        </div>
      </form>
    </Modal>
  );
}
