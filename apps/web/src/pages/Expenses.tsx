import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, errorMessage } from '../lib/api';
import { firstOfMonthIso, formatDate, formatMoney, parseMoney, todayIso } from '../lib/format';
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
} from '../components/ui';
import { useAuth } from '../store/auth';

interface Expense {
  id: string;
  category: string;
  amount: number;
  note: string | null;
  vendor: string | null;
  method: string;
  spentAt: string;
  user: { id: string; name: string } | null;
}

const PAGE_SIZE = 25;

export function Expenses() {
  const business = useAuth((state) => state.business);
  const currency = business?.currency ?? 'RWF';
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(todayIso());
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', { page, from, to }],
    queryFn: async () =>
      (
        await api.get<{ items: Expense[]; total: number; totalAmount: number }>('/expenses', {
          params: { page, pageSize: PAGE_SIZE, from, to },
        })
      ).data,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/expenses/${id}`),
    onSuccess: () => {
      toast.success('Expense removed.');
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Everything the business spends — rent, salaries, stock, transport."
        action={
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            Add expense
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Input
          label="From"
          type="date"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
            setPage(1);
          }}
        />
        <Input
          label="To"
          type="date"
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
            setPage(1);
          }}
        />
        {data && (
          <div className="ml-auto rounded-lg bg-slate-100 px-4 py-2.5">
            <span className="text-xs uppercase tracking-wide text-slate-500">Total </span>
            <span className="font-bold tabular-nums text-slate-900">
              {formatMoney(data.totalAmount, currency)}
            </span>
          </div>
        )}
      </div>

      {isLoading ? (
        <PageLoader />
      ) : !data?.items.length ? (
        <Card>
          <EmptyState
            icon={<Wallet className="h-10 w-10" />}
            title="No expenses in this period"
            description="Record what you spend so your profit figure means something."
            action={
              <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
                Add an expense
              </button>
            }
          />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-slate-100">
            {data.items.map((expense) => (
              <li key={expense.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{expense.category}</p>
                  <p className="truncate text-xs text-slate-500">
                    {[formatDate(expense.spentAt), expense.vendor, expense.note]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums font-semibold text-slate-900">
                  {formatMoney(expense.amount, currency)}
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                  onClick={() => setDeleting(expense)}
                  aria-label={`Delete ${expense.category} expense`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onChange={setPage} />
        </Card>
      )}

      <ExpenseForm open={creating} onClose={() => setCreating(false)} />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this expense?"
        message={`${deleting?.category} — ${deleting ? formatMoney(deleting.amount, currency) : ''}. Your profit figures will change to match.`}
        confirmLabel="Delete"
        destructive
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function ExpenseForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    category: '',
    amount: '',
    vendor: '',
    note: '',
    method: 'CASH',
    spentAt: todayIso(),
  });

  const { data: categories } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => (await api.get<string[]>('/expenses/categories')).data,
    enabled: open,
  });

  const save = useMutation({
    mutationFn: async () =>
      api.post('/expenses', {
        category: form.category.trim(),
        amount: parseMoney(form.amount),
        vendor: form.vendor.trim() || undefined,
        note: form.note.trim() || undefined,
        method: form.method,
        spentAt: form.spentAt,
      }),
    onSuccess: () => {
      toast.success('Expense recorded.');
      setForm({ category: '', amount: '', vendor: '', note: '', method: 'CASH', spentAt: todayIso() });
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function update(field: keyof typeof form) {
    return (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  return (
    <Modal open={open} onClose={onClose} title="Add expense">
      <form
        className="space-y-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div>
          <label className="label" htmlFor="expense-category">
            What was it for?
          </label>
          <input
            id="expense-category"
            className="input"
            list="expense-categories"
            required
            value={form.category}
            onChange={update('category')}
            placeholder="Rent"
          />
          <datalist id="expense-categories">
            {categories?.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
        </div>

        <Input
          label="How much"
          inputMode="decimal"
          required
          value={form.amount}
          onChange={update('amount')}
          placeholder="150000"
        />
        <Input label="Paid to" value={form.vendor} onChange={update('vendor')} placeholder="Landlord" />
        <Input label="When" type="date" value={form.spentAt} max={todayIso()} onChange={update('spentAt')} />
        <Select label="Paid by" value={form.method} onChange={update('method')}>
          <option value="CASH">Cash</option>
          <option value="MOMO">Mobile money</option>
          <option value="BANK">Bank transfer</option>
          <option value="CARD">Card</option>
        </Select>
        <Input label="Note" value={form.note} onChange={update('note')} />

        <div className="flex justify-end gap-2">
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
