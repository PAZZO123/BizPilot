import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { MessageSquare, Plus, Search, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { api, errorMessage } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';
import {
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  Pagination,
  Spinner,
  StatusBadge,
} from '../components/ui';
import { canManage, useAuth } from '../store/auth';

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  note: string | null;
  balance: number;
}

interface Statement {
  customer: Customer;
  lifetimeValue: number;
  sales: { id: string; number: string; total: number; amountPaid: number; status: string; soldAt: string }[];
  invoices: { id: string; number: string; total: number; amountPaid: number; status: string; dueDate: string | null }[];
}

const PAGE_SIZE = 25;

export function Customers() {
  const { user, business } = useAuth();
  const currency = business?.currency ?? 'RWF';

  const [params, setParams] = useSearchParams();
  const owingOnly = params.get('owing') === '1';
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [smsTo, setSmsTo] = useState<Customer | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', { search: debounced, page, owingOnly }],
    queryFn: async () =>
      (
        await api.get<{ items: Customer[]; total: number }>('/customers', {
          params: {
            search: debounced || undefined,
            page,
            pageSize: PAGE_SIZE,
            owingOnly: owingOnly || undefined,
          },
        })
      ).data,
  });

  const { data: statement } = useQuery({
    queryKey: ['customer-statement', openId],
    queryFn: async () => (await api.get<Statement>(`/customers/${openId}/statement`)).data,
    enabled: Boolean(openId),
  });

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Who buys from you, and who still owes you."
        action={
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            Add customer
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Search by name or phone…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <button
          type="button"
          className={clsx(owingOnly ? 'btn-primary' : 'btn-secondary', 'shrink-0')}
          onClick={() => {
            const next = new URLSearchParams(params);
            if (owingOnly) next.delete('owing');
            else next.set('owing', '1');
            setParams(next);
            setPage(1);
          }}
        >
          Owing me
        </button>
      </div>

      {isLoading ? (
        <PageLoader />
      ) : !data?.items.length ? (
        <Card>
          <EmptyState
            icon={<Users className="h-10 w-10" />}
            title={owingOnly ? 'Nobody owes you' : 'No customers yet'}
            description={
              owingOnly
                ? 'Every credit sale has been settled.'
                : 'Add regulars so you can sell on credit and send them invoices.'
            }
          />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-slate-100">
            {data.items.map((customer) => (
              <li key={customer.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setOpenId(customer.id)}
                >
                  <p className="truncate font-medium text-slate-900">{customer.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {customer.phone ?? customer.email ?? 'No contact details'}
                  </p>
                </button>

                {customer.balance > 0 && (
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold text-amber-700">
                      {formatMoney(customer.balance, currency)}
                    </span>
                    <span className="text-xs text-slate-500">owed</span>
                  </span>
                )}

                {customer.phone && canManage(user?.role) && (
                  <button
                    type="button"
                    className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-brand-700"
                    onClick={() => setSmsTo(customer)}
                    aria-label={`Send an SMS to ${customer.name}`}
                    title="Send SMS"
                  >
                    <MessageSquare className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onChange={setPage} />
        </Card>
      )}

      <CustomerForm
        open={creating || Boolean(editing)}
        customer={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />

      <Modal
        open={Boolean(openId)}
        onClose={() => setOpenId(null)}
        title={statement?.customer.name ?? 'Customer'}
        wide
      >
        {!statement ? (
          <PageLoader />
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Lifetime spend</p>
                <p className="mt-0.5 text-lg font-bold text-slate-900">
                  {formatMoney(statement.lifetimeValue, currency)}
                </p>
              </div>
              <div
                className={clsx(
                  'rounded-lg p-3',
                  statement.customer.balance > 0 ? 'bg-amber-50' : 'bg-emerald-50',
                )}
              >
                <p className="text-xs uppercase tracking-wide text-slate-500">Owes you</p>
                <p className="mt-0.5 text-lg font-bold text-slate-900">
                  {formatMoney(statement.customer.balance, currency)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
              {statement.customer.phone && <span>{statement.customer.phone}</span>}
              {statement.customer.email && <span>{statement.customer.email}</span>}
              {statement.customer.address && <span>{statement.customer.address}</span>}
            </div>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Recent purchases</h3>
              {statement.sales.length ? (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {statement.sales.slice(0, 10).map((sale) => (
                    <li key={sale.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span>
                        <span className="font-medium text-slate-900">{sale.number}</span>
                        <span className="ml-2 text-slate-500">{formatDate(sale.soldAt)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums text-slate-900">
                          {formatMoney(sale.total, currency)}
                        </span>
                        <StatusBadge status={sale.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">No purchases yet.</p>
              )}
            </section>

            {statement.invoices.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Invoices</h3>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {statement.invoices.map((invoice) => (
                    <li key={invoice.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span>
                        <span className="font-medium text-slate-900">{invoice.number}</span>
                        {invoice.dueDate && (
                          <span className="ml-2 text-slate-500">due {formatDate(invoice.dueDate)}</span>
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums text-slate-900">
                          {formatMoney(invoice.total - invoice.amountPaid, currency)}
                        </span>
                        <StatusBadge status={invoice.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setEditing(statement.customer);
                  setOpenId(null);
                }}
              >
                Edit details
              </button>
            </div>
          </div>
        )}
      </Modal>

      <SmsForm customer={smsTo} onClose={() => setSmsTo(null)} currency={currency} />
    </div>
  );
}

/** Hoisted out of `Customers` on purpose: a component defined inside another
 *  is a new type on every render, so React unmounts and remounts it and the
 *  field the user is typing in loses focus after each keystroke. */
function CustomerForm({
  open,
  customer,
  onClose,
}: {
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', note: '' });

  useEffect(() => {
    if (!open) return;
    setForm({
      name: customer?.name ?? '',
      phone: customer?.phone ?? '',
      email: customer?.email ?? '',
      address: customer?.address ?? '',
      note: customer?.note ?? '',
    });
  }, [open, customer]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        note: form.note.trim() || undefined,
      };
      return customer
        ? api.patch(`/customers/${customer.id}`, payload)
        : api.post('/customers', payload);
    },
    onSuccess: () => {
      toast.success(customer ? 'Customer updated.' : 'Customer added.');
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function update(field: keyof typeof form) {
    return (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title={customer ? 'Edit customer' : 'Add customer'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Name" required value={form.name} onChange={update('name')} placeholder="Jean Baptiste" />
        <Input
          label="Phone"
          type="tel"
          value={form.phone}
          onChange={update('phone')}
          placeholder="0788 123 456"
          hint="Needed to send SMS reminders."
        />
        <Input label="Email" type="email" value={form.email} onChange={update('email')} />
        <Input label="Address" value={form.address} onChange={update('address')} />
        <Input label="Note" value={form.note} onChange={update('note')} placeholder="Buys in bulk on Fridays" />

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={save.isPending}>
            {save.isPending && <Spinner className="h-4 w-4 text-white" />}
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SmsForm({
  customer,
  onClose,
  currency,
}: {
  customer: Customer | null;
  onClose: () => void;
  currency: string;
}) {
  const [body, setBody] = useState('');

  useEffect(() => {
    if (customer) {
      setBody(
        customer.balance > 0
          ? `Hello ${customer.name.split(' ')[0]}, a friendly reminder that your balance of ${formatMoney(customer.balance, currency)} is outstanding. Thank you.`
          : '',
      );
    }
  }, [customer, currency]);

  const send = useMutation({
    mutationFn: async () =>
      api.post('/sms', { to: customer?.phone, body, customerId: customer?.id }),
    onSuccess: () => {
      toast.success('Message queued.');
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error), { duration: 6000 }),
  });

  return (
    <Modal open={Boolean(customer)} onClose={onClose} title={`Text ${customer?.name ?? ''}`}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate();
        }}
      >
        <p className="text-sm text-slate-500">Sending to {customer?.phone}</p>
        <div>
          <label className="label" htmlFor="sms-body">
            Message
          </label>
          <textarea
            id="sms-body"
            className="input min-h-[120px]"
            maxLength={320}
            required
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            {body.length}/320 characters · counts against your monthly SMS allowance
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={send.isPending || !body.trim()}>
            {send.isPending && <Spinner className="h-4 w-4 text-white" />}
            Send
          </button>
        </div>
      </form>
    </Modal>
  );
}
