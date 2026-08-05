import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { Card, PageLoader } from '../components/ui';
import { useAuth } from '../store/auth';

/**
 * Where Flutterwave sends the owner after checkout.
 *
 * We confirm the payment here rather than trusting the query string, so the
 * plan is active by the time they land back in the app instead of whenever the
 * webhook happens to arrive. Both paths are idempotent.
 */
export function BillingCallback() {
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const restore = useAuth((state) => state.restore);

  const [state, setState] = useState<'checking' | 'done' | 'failed'>('checking');
  const [message, setMessage] = useState('');

  const transactionId = params.get('transaction_id');
  const status = params.get('status');

  useEffect(() => {
    if (!transactionId || status === 'cancelled') {
      setState('failed');
      setMessage(
        status === 'cancelled'
          ? 'The payment was cancelled. Nothing has been charged.'
          : 'We did not get a transaction back from the payment page.',
      );
      return;
    }

    api
      .get('/billing/confirm', { params: { transaction_id: transactionId } })
      .then(async (response) => {
        if (response.data?.settled) {
          setState('done');
          await restore();
          void queryClient.invalidateQueries();
        } else {
          setState('failed');
          setMessage(response.data?.reason ?? 'The payment did not go through.');
        }
      })
      .catch((error) => {
        setState('failed');
        setMessage(errorMessage(error, 'We could not confirm the payment.'));
      });
  }, [transactionId, status, queryClient, restore]);

  if (state === 'checking') return <PageLoader label="Confirming your payment…" />;

  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <div className="py-6 text-center">
          {state === 'done' ? (
            <>
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
              <h1 className="mt-4 text-lg font-bold text-slate-900">You are all set</h1>
              <p className="mt-1 text-sm text-slate-600">
                Your new plan is active. Thank you for supporting BizPilot.
              </p>
            </>
          ) : (
            <>
              <XCircle className="mx-auto h-12 w-12 text-red-500" />
              <h1 className="mt-4 text-lg font-bold text-slate-900">That did not go through</h1>
              <p className="mt-1 text-sm text-slate-600">{message}</p>
            </>
          )}

          <div className="mt-6 flex justify-center gap-2">
            <Link to="/app" className="btn-secondary">
              Back to dashboard
            </Link>
            <Link to="/app/billing" className="btn-primary">
              {state === 'done' ? 'See my plan' : 'Try again'}
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
