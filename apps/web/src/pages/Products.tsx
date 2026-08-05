import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Box, PackagePlus, Pencil, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { api, errorMessage, isPlanLimitError } from '../lib/api';
import { formatMoney, formatNumber, parseMoney, toMoneyInput } from '../lib/format';
import {
  Badge,
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
import { canManage, useAuth } from '../store/auth';

interface Product {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  costPrice: number;
  sellPrice: number;
  stockQty: number;
  reorderLevel: number;
  trackStock: boolean;
  isActive: boolean;
}

const PAGE_SIZE = 25;

export function Products() {
  const { user, business } = useAuth();
  const currency = business?.currency ?? 'RWF';
  const canEdit = canManage(user?.role);
  const queryClient = useQueryClient();

  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const lowStockOnly = params.get('lowStock') === '1';

  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [restocking, setRestocking] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);

  // Debounce so a search does not fire a request per keystroke on mobile data.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['products', { search: debounced, page, lowStockOnly }],
    queryFn: async () =>
      (
        await api.get<{ items: Product[]; total: number }>('/products', {
          params: {
            search: debounced || undefined,
            page,
            pageSize: PAGE_SIZE,
            lowStockOnly: lowStockOnly || undefined,
          },
        })
      ).data,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/products/${id}`),
    onSuccess: () => {
      toast.success('Product archived.');
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="What you sell, what it costs you, and what is left on the shelf."
        action={
          canEdit && (
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              Add product
            </button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Search by name, SKU or category…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            const next = new URLSearchParams(params);
            if (lowStockOnly) next.delete('lowStock');
            else next.set('lowStock', '1');
            setParams(next);
            setPage(1);
          }}
          className={clsx(lowStockOnly ? 'btn-primary' : 'btn-secondary', 'shrink-0')}
        >
          <AlertTriangle className="h-4 w-4" />
          Low stock
        </button>
      </div>

      {isLoading ? (
        <PageLoader />
      ) : !data?.items.length ? (
        <Card>
          <EmptyState
            icon={<Box className="h-10 w-10" />}
            title={lowStockOnly ? 'Nothing is running low' : debounced ? 'No match' : 'No products yet'}
            description={
              lowStockOnly
                ? 'Every product is above its reorder level.'
                : debounced
                  ? 'Try a different word.'
                  : 'Add what you sell so you can start recording sales.'
            }
            action={
              canEdit && !debounced && !lowStockOnly ? (
                <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
                  Add your first product
                </button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 text-right font-medium">Cost</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3 text-right font-medium">Margin</th>
                  <th className="px-4 py-3 text-right font-medium">Stock</th>
                  {canEdit && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((product) => {
                  const margin =
                    product.sellPrice > 0
                      ? ((product.sellPrice - product.costPrice) / product.sellPrice) * 100
                      : 0;
                  const low = product.trackStock && product.stockQty <= product.reorderLevel;

                  return (
                    <tr key={product.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{product.name}</p>
                        <p className="text-xs text-slate-500">
                          {[product.category, product.sku].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {formatMoney(product.costPrice, currency)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-900">
                        {formatMoney(product.sellPrice, currency)}
                      </td>
                      <td
                        className={clsx(
                          'px-4 py-3 text-right tabular-nums',
                          margin < 0 ? 'font-semibold text-red-600' : 'text-slate-600',
                        )}
                      >
                        {margin.toFixed(0)}%
                      </td>
                      <td className="px-4 py-3 text-right">
                        {product.trackStock ? (
                          low ? (
                            <Badge tone="warning">
                              {formatNumber(product.stockQty)} {product.unit}
                            </Badge>
                          ) : (
                            <span className="tabular-nums text-slate-700">
                              {formatNumber(product.stockQty)} {product.unit}
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-slate-400">Service</span>
                        )}
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            {product.trackStock && (
                              <button
                                type="button"
                                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"
                                onClick={() => setRestocking(product)}
                                aria-label={`Restock ${product.name}`}
                                title="Restock"
                              >
                                <PackagePlus className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"
                              onClick={() => setEditing(product)}
                              aria-label={`Edit ${product.name}`}
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onChange={setPage} />
        </Card>
      )}

      <ProductForm
        open={creating || Boolean(editing)}
        product={editing}
        currency={currency}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onDelete={editing ? () => setDeleting(editing) : undefined}
      />

      <RestockForm
        product={restocking}
        currency={currency}
        onClose={() => setRestocking(null)}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Archive this product?"
        message={`${deleting?.name} will be hidden from the till, but past sales keep it so your reports stay correct.`}
        confirmLabel="Archive"
        destructive
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function ProductForm({
  open,
  product,
  currency,
  onClose,
  onDelete,
}: {
  open: boolean;
  product: Product | null;
  currency: string;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    category: '',
    sku: '',
    unit: 'piece',
    costPrice: '',
    sellPrice: '',
    stockQty: '',
    reorderLevel: '',
    trackStock: 'true',
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      name: product?.name ?? '',
      category: product?.category ?? '',
      sku: product?.sku ?? '',
      unit: product?.unit ?? 'piece',
      costPrice: product ? toMoneyInput(product.costPrice, currency) : '',
      sellPrice: product ? toMoneyInput(product.sellPrice, currency) : '',
      stockQty: product ? String(product.stockQty) : '',
      reorderLevel: product ? String(product.reorderLevel) : '',
      trackStock: String(product?.trackStock ?? true),
    });
  }, [open, product, currency]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        category: form.category.trim() || undefined,
        sku: form.sku.trim() || undefined,
        unit: form.unit.trim() || 'piece',
        costPrice: parseMoney(form.costPrice),
        sellPrice: parseMoney(form.sellPrice),
        reorderLevel: Number(form.reorderLevel) || 0,
        trackStock: form.trackStock === 'true',
        // Stock is only settable at creation; afterwards it moves through
        // restock/adjust so the ledger always explains the balance.
        ...(product ? {} : { stockQty: Number(form.stockQty) || 0 }),
      };
      return product
        ? (await api.patch(`/products/${product.id}`, payload)).data
        : (await api.post('/products', payload)).data;
    },
    onSuccess: () => {
      toast.success(product ? 'Product updated.' : 'Product added.');
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error), { duration: 6000 }),
  });

  const cost = parseMoney(form.costPrice);
  const sell = parseMoney(form.sellPrice);
  const margin = sell > 0 ? ((sell - cost) / sell) * 100 : null;

  function update(field: keyof typeof form) {
    return (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title={product ? 'Edit product' : 'Add product'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Name" required value={form.name} onChange={update('name')} placeholder="Inyange Milk 1L" />

        <div className="grid grid-cols-2 gap-3">
          <Input label="Category" value={form.category} onChange={update('category')} placeholder="Drinks" />
          <Input label="Unit" value={form.unit} onChange={update('unit')} placeholder="piece" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="What it costs you"
            inputMode="decimal"
            required
            value={form.costPrice}
            onChange={update('costPrice')}
            placeholder="900"
          />
          <Input
            label="What you sell it for"
            inputMode="decimal"
            required
            value={form.sellPrice}
            onChange={update('sellPrice')}
            placeholder="1200"
          />
        </div>

        {margin !== null && (
          <p
            className={clsx(
              'rounded-lg px-3 py-2 text-sm',
              margin < 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800',
            )}
          >
            {margin < 0
              ? `You would lose ${formatMoney(cost - sell, currency)} on every one.`
              : `You keep ${formatMoney(sell - cost, currency)} on each — a ${margin.toFixed(0)}% margin.`}
          </p>
        )}

        <Select label="Does this carry stock?" value={form.trackStock} onChange={update('trackStock')}>
          <option value="true">Yes — count it</option>
          <option value="false">No — it is a service</option>
        </Select>

        {form.trackStock === 'true' && (
          <div className="grid grid-cols-2 gap-3">
            {!product && (
              <Input
                label="How many now"
                inputMode="numeric"
                value={form.stockQty}
                onChange={update('stockQty')}
                placeholder="0"
              />
            )}
            <Input
              label="Warn me at"
              inputMode="numeric"
              value={form.reorderLevel}
              onChange={update('reorderLevel')}
              placeholder="5"
              hint="Low-stock alert level"
            />
          </div>
        )}

        {save.isError && isPlanLimitError(save.error) && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {errorMessage(save.error)}
          </p>
        )}

        <div className="flex justify-between gap-2 pt-1">
          {onDelete ? (
            <button type="button" className="btn-ghost text-red-600" onClick={onDelete}>
              Archive
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={save.isPending}>
              {save.isPending && <Spinner className="h-4 w-4 text-white" />}
              Save
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function RestockForm({
  product,
  currency,
  onClose,
}: {
  product: Product | null;
  currency: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [type, setType] = useState('PURCHASE');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (product) {
      setType('PURCHASE');
      setQuantity('');
      setUnitCost(toMoneyInput(product.costPrice, currency));
      setNote('');
    }
  }, [product, currency]);

  const submit = useMutation({
    mutationFn: async () => {
      if (!product) return;
      const amount = Number(quantity) || 0;
      return api.post(`/products/${product.id}/stock`, {
        type,
        // PURCHASE and RETURN add stock; DAMAGE removes it. ADJUSTMENT takes
        // the sign the user typed, so a correction can go either way.
        quantity: type === 'DAMAGE' ? -Math.abs(amount) : type === 'ADJUSTMENT' ? amount : Math.abs(amount),
        unitCost: type === 'PURCHASE' ? parseMoney(unitCost) : undefined,
        note: note.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Stock updated.');
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Modal open={Boolean(product)} onClose={onClose} title={`Stock — ${product?.name ?? ''}`}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit.mutate();
        }}
      >
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Currently {formatNumber(product?.stockQty ?? 0)} {product?.unit} in stock.
        </p>

        <Select label="What happened?" value={type} onChange={(event) => setType(event.target.value)}>
          <option value="PURCHASE">Bought more stock</option>
          <option value="RETURN">Customer returned goods</option>
          <option value="DAMAGE">Damaged, expired or stolen</option>
          <option value="ADJUSTMENT">Correcting a count</option>
        </Select>

        <Input
          label={type === 'ADJUSTMENT' ? 'Change (use −5 to reduce)' : 'How many'}
          inputMode="numeric"
          required
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          placeholder={type === 'ADJUSTMENT' ? '-3' : '24'}
        />

        {type === 'PURCHASE' && (
          <Input
            label="Cost per unit"
            inputMode="decimal"
            value={unitCost}
            onChange={(event) => setUnitCost(event.target.value)}
            hint="Updates the cost used for future profit. Past sales keep their old cost."
          />
        )}

        <Input
          label="Note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Delivery from supplier"
        />

        <div className="flex justify-end gap-2 pt-1">
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
