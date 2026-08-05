import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Minus, Plus, Search, ShoppingCart, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { api, errorMessage, isPlanLimitError } from '../lib/api';
import { formatMoney, parseMoney, toMoneyInput } from '../lib/format';
import { Card, EmptyState, Input, Modal, PageLoader, Select, Spinner } from '../components/ui';
import { useAuth } from '../store/auth';

interface Product {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  sellPrice: number;
  stockQty: number;
  trackStock: boolean;
}

interface Customer {
  id: string;
  name: string;
  phone: string | null;
}

interface CartLine {
  product: Product;
  quantity: number;
  /** Overridden price in minor units, when the shopkeeper haggles. */
  unitPrice: number;
}

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'MOMO', label: 'Mobile money' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK', label: 'Bank transfer' },
  { value: 'CREDIT', label: 'Credit (pay later)' },
];

export function Sell() {
  const business = useAuth((state) => state.business);
  const currency = business?.currency ?? 'RWF';
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [customerId, setCustomerId] = useState('');
  const [amountPaidInput, setAmountPaidInput] = useState('');
  const [discountInput, setDiscountInput] = useState('');

  const { data: products, isLoading } = useQuery({
    queryKey: ['products', 'sell'],
    queryFn: async () =>
      (await api.get<{ items: Product[] }>('/products', { params: { pageSize: 200 } })).data.items,
  });

  const { data: customers } = useQuery({
    queryKey: ['customers', 'picker'],
    queryFn: async () =>
      (await api.get<{ items: Customer[] }>('/customers', { params: { pageSize: 200 } })).data.items,
  });

  const filtered = useMemo(() => {
    if (!products) return [];
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(term) ||
        product.category?.toLowerCase().includes(term),
    );
  }, [products, search]);

  const subtotal = cart.reduce((total, line) => total + line.unitPrice * line.quantity, 0);
  const discount = Math.min(parseMoney(discountInput), subtotal);
  const total = subtotal - discount;

  const isCredit = paymentMethod === 'CREDIT';
  const amountPaid = isCredit ? parseMoney(amountPaidInput) : total;
  const balanceDue = total - amountPaid;

  function addToCart(product: Product) {
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        // The button on a product that is already in the basket just bumps the
        // quantity — a second row for the same product would be confusing at
        // the till and would also fail the server's combined stock check.
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [...current, { product, quantity: 1, unitPrice: product.sellPrice }];
    });
  }

  function setQuantity(productId: string, quantity: number) {
    setCart((current) =>
      quantity <= 0
        ? current.filter((line) => line.product.id !== productId)
        : current.map((line) => (line.product.id === productId ? { ...line, quantity } : line)),
    );
  }

  function setLinePrice(productId: string, value: string) {
    const price = parseMoney(value);
    setCart((current) =>
      current.map((line) => (line.product.id === productId ? { ...line, unitPrice: price } : line)),
    );
  }

  const createSale = useMutation({
    mutationFn: async () => {
      const payload = {
        items: cart.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
        paymentMethod,
        discount: discount || undefined,
        customerId: customerId || undefined,
        amountPaid: isCredit ? amountPaid : undefined,
      };
      return (await api.post('/sales', payload)).data;
    },
    onSuccess: (sale: { number: string; total: number }) => {
      toast.success(`Sale ${sale.number} recorded — ${formatMoney(sale.total, currency)}`);
      setCart([]);
      setCheckoutOpen(false);
      setDiscountInput('');
      setAmountPaidInput('');
      setCustomerId('');
      setPaymentMethod('CASH');
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
    onError: (error) => {
      toast.error(errorMessage(error, 'Could not record the sale.'), { duration: 6000 });
    },
  });

  const canCheckout =
    cart.length > 0 && (!isCredit || (Boolean(customerId) && amountPaid >= 0 && amountPaid <= total));

  if (isLoading) return <PageLoader label="Loading products…" />;

  return (
    <div className="lg:flex lg:gap-5">
      {/* Product picker */}
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-10 -mx-4 mb-4 bg-slate-50 px-4 pb-3 pt-1 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:px-0">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search products…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <Card>
            <EmptyState
              icon={<ShoppingCart className="h-10 w-10" />}
              title={products?.length ? 'No product matches that' : 'No products yet'}
              description={
                products?.length
                  ? 'Try a different word, or clear the search.'
                  : 'Add what you sell and it will show up here.'
              }
              action={
                !products?.length && (
                  <Link to="/app/products" className="btn-primary">
                    Add products
                  </Link>
                )
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
            {filtered.map((product) => {
              const inCart = cart.find((line) => line.product.id === product.id);
              const soldOut = product.trackStock && product.stockQty <= 0;

              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => !soldOut && addToCart(product)}
                  disabled={soldOut}
                  className={clsx(
                    'card flex flex-col p-3 text-left transition-colors',
                    soldOut ? 'cursor-not-allowed opacity-50' : 'hover:border-brand-400 active:bg-brand-50',
                    inCart && 'border-brand-500 ring-1 ring-brand-500',
                  )}
                >
                  <span className="line-clamp-2 text-sm font-medium text-slate-900">{product.name}</span>
                  <span className="mt-1.5 text-sm font-bold text-brand-700">
                    {formatMoney(product.sellPrice, currency)}
                  </span>
                  <span className="mt-0.5 text-xs text-slate-500">
                    {product.trackStock ? `${product.stockQty} ${product.unit} left` : 'Service'}
                  </span>
                  {inCart && (
                    <span className="mt-2 w-fit rounded-full bg-brand-700 px-2 py-0.5 text-xs font-bold text-white">
                      {inCart.quantity} in basket
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Basket — a sidebar on desktop, a bottom sheet trigger on a phone. */}
      <aside className="hidden w-80 shrink-0 lg:block">
        <div className="sticky top-4">
          <Card padded={false}>
            <BasketContents
              cart={cart}
              currency={currency}
              subtotal={subtotal}
              onSetQuantity={setQuantity}
              onSetPrice={setLinePrice}
              onClear={() => setCart([])}
            />
            <div className="border-t border-slate-200 p-4">
              <button
                type="button"
                className="btn-primary w-full"
                disabled={cart.length === 0}
                onClick={() => setCheckoutOpen(true)}
              >
                Charge {formatMoney(subtotal, currency)}
              </button>
            </div>
          </Card>
        </div>
      </aside>

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-[60px] z-20 border-t border-slate-200 bg-white p-3 lg:hidden">
          <button type="button" className="btn-primary w-full" onClick={() => setCheckoutOpen(true)}>
            <ShoppingCart className="h-4 w-4" />
            {cart.reduce((count, line) => count + line.quantity, 0)} items ·{' '}
            {formatMoney(subtotal, currency)}
          </button>
        </div>
      )}

      <Modal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        title="Complete the sale"
        wide
      >
        <BasketContents
          cart={cart}
          currency={currency}
          subtotal={subtotal}
          onSetQuantity={setQuantity}
          onSetPrice={setLinePrice}
          onClear={() => setCart([])}
        />

        <div className="mt-5 space-y-4 border-t border-slate-200 pt-4">
          <Input
            label="Discount"
            inputMode="decimal"
            value={discountInput}
            onChange={(event) => setDiscountInput(event.target.value)}
            placeholder="0"
            hint={discount > 0 ? `Total becomes ${formatMoney(total, currency)}` : undefined}
          />

          <Select
            label="How are they paying?"
            value={paymentMethod}
            onChange={(event) => setPaymentMethod(event.target.value)}
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </Select>

          {isCredit && (
            <>
              <Select
                label="Which customer?"
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
                error={!customerId ? 'Credit sales need a customer, so you know who owes you.' : undefined}
              >
                <option value="">Choose a customer…</option>
                {customers?.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                    {customer.phone ? ` — ${customer.phone}` : ''}
                  </option>
                ))}
              </Select>
              <Input
                label="Paying now"
                inputMode="decimal"
                value={amountPaidInput}
                onChange={(event) => setAmountPaidInput(event.target.value)}
                placeholder="0"
                hint={
                  balanceDue > 0
                    ? `${formatMoney(balanceDue, currency)} will be added to their balance.`
                    : 'Leave empty if they are paying nothing today.'
                }
              />
            </>
          )}

          {!isCredit && (
            <Select
              label="Customer (optional)"
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <option value="">Walk-in customer</option>
              {customers?.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </Select>
          )}

          <div className="rounded-lg bg-slate-50 p-4">
            <Row label="Subtotal" value={formatMoney(subtotal, currency)} />
            {discount > 0 && <Row label="Discount" value={`−${formatMoney(discount, currency)}`} />}
            <Row label="Total" value={formatMoney(total, currency)} strong />
            {isCredit && (
              <>
                <Row label="Paying now" value={formatMoney(amountPaid, currency)} />
                <Row label="Still owed" value={formatMoney(balanceDue, currency)} strong />
              </>
            )}
          </div>

          <button
            type="button"
            className="btn-primary w-full py-3 text-base"
            disabled={!canCheckout || createSale.isPending}
            onClick={() => createSale.mutate()}
          >
            {createSale.isPending && <Spinner className="h-4 w-4 text-white" />}
            Record sale
          </button>

          {createSale.isError && isPlanLimitError(createSale.error) && (
            <Link to="/app/billing" className="block text-center text-sm font-semibold text-brand-700 underline">
              Upgrade your plan to keep selling
            </Link>
          )}
        </div>
      </Modal>
    </div>
  );
}

function BasketContents({
  cart,
  currency,
  subtotal,
  onSetQuantity,
  onSetPrice,
  onClear,
}: {
  cart: CartLine[];
  currency: string;
  subtotal: number;
  onSetQuantity: (productId: string, quantity: number) => void;
  onSetPrice: (productId: string, value: string) => void;
  onClear: () => void;
}) {
  if (cart.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-slate-500">
        Tap a product to start a sale.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="font-semibold text-slate-900">Basket</h2>
        <button type="button" onClick={onClear} className="text-xs font-medium text-slate-500 hover:text-red-600">
          <Trash2 className="mr-1 inline h-3.5 w-3.5" />
          Clear
        </button>
      </div>

      <ul className="max-h-[46vh] divide-y divide-slate-100 overflow-y-auto">
        {cart.map((line) => (
          <li key={line.product.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">{line.product.name}</span>
              <button
                type="button"
                onClick={() => onSetQuantity(line.product.id, 0)}
                className="shrink-0 rounded p-0.5 text-slate-400 hover:text-red-600"
                aria-label={`Remove ${line.product.name}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <div className="flex items-center rounded-lg border border-slate-300">
                <button
                  type="button"
                  className="px-2.5 py-1.5 text-slate-600 hover:bg-slate-50"
                  onClick={() => onSetQuantity(line.product.id, line.quantity - 1)}
                  aria-label="One fewer"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <input
                  className="w-12 border-x border-slate-300 py-1.5 text-center text-sm tabular-nums outline-none"
                  inputMode="numeric"
                  value={line.quantity}
                  onChange={(event) => onSetQuantity(line.product.id, Number(event.target.value) || 0)}
                  aria-label={`Quantity of ${line.product.name}`}
                />
                <button
                  type="button"
                  className="px-2.5 py-1.5 text-slate-600 hover:bg-slate-50"
                  onClick={() => onSetQuantity(line.product.id, line.quantity + 1)}
                  aria-label="One more"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              <span className="text-xs text-slate-400">×</span>
              <input
                className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-brand-500"
                inputMode="decimal"
                value={toMoneyInput(line.unitPrice, currency)}
                onChange={(event) => onSetPrice(line.product.id, event.target.value)}
                aria-label={`Price of ${line.product.name}`}
              />

              <span className="ml-auto text-sm font-semibold tabular-nums text-slate-900">
                {formatMoney(line.unitPrice * line.quantity, currency)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <div className="border-t border-slate-200 px-4 py-3">
        <Row label="Subtotal" value={formatMoney(subtotal, currency)} strong />
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span className={clsx('text-sm', strong ? 'font-semibold text-slate-900' : 'text-slate-600')}>
        {label}
      </span>
      <span
        className={clsx(
          'tabular-nums',
          strong ? 'text-base font-bold text-slate-900' : 'text-sm text-slate-700',
        )}
      >
        {value}
      </span>
    </div>
  );
}
