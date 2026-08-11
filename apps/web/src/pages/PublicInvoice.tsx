import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';
import { Card, Input, PageLoader, Spinner, StatusBadge } from '../components/ui';
import { PushPaymentDialog } from '../components/PushPaymentDialog';

interface PublicInvoice {
  number: string;
  status: string;
  issueDate: string;
  dueDate: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  notes: string | null;
  terms: string | null;
  currency: string;
  items: { name: string; description: string | null; quantity: number; unitPrice: number; total: number }[];
  customer: { name: string } | null;
  business: {
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    logoUrl: string | null;
  };
}

/**
 * What a customer sees when they tap the link in the reminder SMS.
 *
 * No login, no BizPilot chrome — just the invoice and a way to pay it. The
 * token in the URL is the only credential, and the API returns nothing beyond
 * what a payer needs to see.
 */
/** Same union as the billing screen: a page to visit, or a prompt already sent. */
type PayResponse = {
  reference: string;
  amount: number;
  checkout:
    | { kind: 'redirect'; url: string }
    | { kind: 'push'; sentTo: string; pollAfterMs: number };
};

export function PublicInvoice() {
  const { token } = useParams<{ token: string }>();
  const [params] = useSearchParams();
  const isCallback = window.location.pathname.endsWith('/callback');

  const [payerEmail, setPayerEmail] = useState('');
  const [payerName, setPayerName] = useState('');
  const [payerPhone, setPayerPhone] = useState('');
  const [push, setPush] = useState<{
    reference: string;
    sentTo: string;
    pollAfterMs: number;
  } | null>(null);
  const [confirmState, setConfirmState] = useState<'idle' | 'checking' | 'paid' | 'failed'>('idle');
  const [confirmMessage, setConfirmMessage] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['public-invoice', token],
    queryFn: async () => (await api.get<PublicInvoice>(`/public/invoices/${token}`)).data,
    enabled: Boolean(token),
  });

  // Coming back from the payment page: confirm before showing anything, so the
  // customer is not told they still owe money they have just paid.
  useEffect(() => {
    if (!isCallback) return;
    const transactionId = params.get('transaction_id');
    const status = params.get('status');

    if (!transactionId || status === 'cancelled') {
      setConfirmState('failed');
      setConfirmMessage('The payment was cancelled. Nothing has been charged.');
      return;
    }

    setConfirmState('checking');
    api
      .get('/billing/confirm', { params: { transaction_id: transactionId } })
      .then(async (response) => {
        if (response.data?.settled) {
          setConfirmState('paid');
          await refetch();
        } else {
          setConfirmState('failed');
          setConfirmMessage(response.data?.reason ?? 'The payment did not go through.');
        }
      })
      .catch((err) => {
        setConfirmState('failed');
        setConfirmMessage(errorMessage(err, 'We could not confirm the payment.'));
      });
  }, [isCallback, params, refetch]);

  const pay = useMutation({
    mutationFn: async () =>
      (
        await api.post<PayResponse>(`/public/invoices/${token}/pay`, {
          email: payerEmail,
          name: payerName || undefined,
          // Only mobile money needs this, and only mobile money asks for it.
          phone: payerPhone || undefined,
        })
      ).data,
    onSuccess: (response) => {
      if (response.checkout.kind === 'redirect') {
        window.location.href = response.checkout.url;
        return;
      }
      setPush({
        reference: response.reference,
        sentTo: response.checkout.sentTo,
        pollAfterMs: response.checkout.pollAfterMs,
      });
    },
  });

  if (isLoading || confirmState === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <PageLoader label={confirmState === 'checking' ? 'Confirming your payment…' : 'Loading invoice…'} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md text-center">
          <XCircle className="mx-auto h-10 w-10 text-slate-300" />
          <h1 className="mt-3 font-semibold text-slate-900">This link is not valid</h1>
          <p className="mt-1 text-sm text-slate-500">
            It may have been cancelled or replaced. Ask the business for a new one.
          </p>
        </Card>
      </div>
    );
  }

  const currency = data.currency;
  const settled = data.balanceDue <= 0;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        {confirmState === 'paid' && (
          <div className="flex items-start gap-3 rounded-xl bg-emerald-50 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <p className="font-semibold text-emerald-900">Payment received</p>
              <p className="text-sm text-emerald-800">
                Thank you. {data.business.name} has been notified.
              </p>
            </div>
          </div>
        )}
        {confirmState === 'failed' && (
          <div className="flex items-start gap-3 rounded-xl bg-red-50 p-4">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div>
              <p className="font-semibold text-red-900">Payment not completed</p>
              <p className="text-sm text-red-800">{confirmMessage}</p>
            </div>
          </div>
        )}

        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              {data.business.logoUrl && (
                <img
                  src={data.business.logoUrl}
                  alt=""
                  className="mb-2 h-10 w-auto object-contain"
                />
              )}
              <h1 className="text-lg font-bold text-slate-900">{data.business.name}</h1>
              <div className="mt-0.5 text-sm text-slate-500">
                {[data.business.address, data.business.phone, data.business.email]
                  .filter(Boolean)
                  .map((line) => (
                    <p key={line as string}>{line}</p>
                  ))}
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-500">Invoice</p>
              <p className="font-bold text-slate-900">{data.number}</p>
              <div className="mt-1">
                <StatusBadge status={settled ? 'PAID' : data.status} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-b border-slate-200 py-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Billed to</p>
              <p className="mt-0.5 font-medium text-slate-900">{data.customer?.name ?? '—'}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {data.dueDate ? 'Due' : 'Issued'}
              </p>
              <p className="mt-0.5 font-medium text-slate-900">
                {formatDate(data.dueDate ?? data.issueDate)}
              </p>
            </div>
          </div>

          <div className="table-wrap py-4">
            <table className="w-full min-w-[380px] text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="pb-2 font-medium">Item</th>
                  <th className="pb-2 text-right font-medium">Qty</th>
                  <th className="pb-2 text-right font-medium">Price</th>
                  <th className="pb-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((item, index) => (
                  <tr key={index}>
                    <td className="py-2.5 pr-3">
                      <p className="text-slate-900">{item.name}</p>
                      {item.description && (
                        <p className="text-xs text-slate-500">{item.description}</p>
                      )}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-slate-600">{item.quantity}</td>
                    <td className="py-2.5 text-right tabular-nums text-slate-600">
                      {formatMoney(item.unitPrice, currency)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums font-medium text-slate-900">
                      {formatMoney(item.total, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ml-auto max-w-xs space-y-1 border-t border-slate-200 pt-4 text-sm">
            <SumLine label="Subtotal" value={formatMoney(data.subtotal, currency)} />
            {data.discount > 0 && (
              <SumLine label="Discount" value={`−${formatMoney(data.discount, currency)}`} />
            )}
            {data.tax > 0 && <SumLine label="Tax" value={formatMoney(data.tax, currency)} />}
            <SumLine label="Total" value={formatMoney(data.total, currency)} strong />
            {data.amountPaid > 0 && (
              <SumLine label="Paid" value={`−${formatMoney(data.amountPaid, currency)}`} />
            )}
            <SumLine
              label="Amount due"
              value={formatMoney(Math.max(data.balanceDue, 0), currency)}
              strong
            />
          </div>

          {(data.notes || data.terms) && (
            <div className="mt-5 space-y-2 border-t border-slate-200 pt-4 text-sm text-slate-600">
              {data.notes && <p>{data.notes}</p>}
              {data.terms && <p className="text-xs text-slate-500">{data.terms}</p>}
            </div>
          )}
        </Card>

        {!settled && (
          <Card>
            <h2 className="font-semibold text-slate-900">
              Pay {formatMoney(data.balanceDue, currency)}
            </h2>
            {/* Deliberately vague about *how* the payment continues: with mobile
                money the prompt arrives on the phone and the page never changes,
                with a card gateway there is a redirect. Promising one and doing
                the other is the confusing case. */}
            <p className="mt-1 text-sm text-slate-500">
              Pay securely with mobile money or a card. Nothing is charged until you approve it.
            </p>

            <form
              className="mt-4 space-y-3"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                pay.mutate();
              }}
            >
              <Input
                label="Your email"
                type="email"
                required
                value={payerEmail}
                onChange={(event) => setPayerEmail(event.target.value)}
                placeholder="you@example.com"
                hint="Your receipt goes here."
              />
              <Input
                label="Your name"
                value={payerName}
                onChange={(event) => setPayerName(event.target.value)}
              />
              <Input
                label="Mobile money number"
                type="tel"
                inputMode="tel"
                value={payerPhone}
                onChange={(event) => setPayerPhone(event.target.value)}
                placeholder="0788 123 456"
                hint="We send the payment request here. Leave blank to pay by card."
              />

              {pay.isError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {errorMessage(pay.error, 'Could not start the payment.')}
                </p>
              )}

              <button type="submit" className="btn-primary w-full py-3" disabled={pay.isPending}>
                {pay.isPending && <Spinner className="h-4 w-4 text-white" />}
                Pay {formatMoney(data.balanceDue, currency)}
              </button>
            </form>
          </Card>
        )}

        <p className="pb-4 text-center text-xs text-slate-400">
          Sent with BizPilot — free sales and stock tracking for small businesses.
        </p>
      </div>

      <PushPaymentDialog
        open={push !== null}
        reference={push?.reference ?? null}
        sentTo={push?.sentTo ?? null}
        pollAfterMs={push?.pollAfterMs}
        onPaid={() => {
          setPush(null);
          setConfirmState('paid');
          void refetch();
        }}
        onClose={() => setPush(null)}
      />
    </div>
  );
}

function SumLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={strong ? 'font-semibold text-slate-900' : 'text-slate-600'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'font-bold text-slate-900' : 'text-slate-700'}`}>
        {value}
      </span>
    </div>
  );
}
