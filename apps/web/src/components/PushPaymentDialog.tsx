import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Smartphone, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api';
import { Modal, Spinner } from './ui';

/**
 * The waiting screen for a mobile money payment.
 *
 * A push payment has no page to send anyone to and no redirect to come back on:
 * the prompt arrives on the payer's handset, they approve it on a USSD menu, and
 * the only way to learn the outcome is to ask. So this asks — every three
 * seconds, until the answer stops being "pending".
 *
 * The two things that make this bearable to sit in front of:
 *
 *  - it says the number the prompt went to. Wrong-number is the most common
 *    failure, and a payer staring at a silent handset should be able to see
 *    immediately that it went somewhere else.
 *  - it does not spin forever. Prompts expire; after two minutes it says so and
 *    offers to start again, rather than implying the money is in limbo.
 *
 * Closing it does not cancel anything — the payment is between MTN and the
 * payer, and the webhook settles it whether this is open or not.
 */
export function PushPaymentDialog({
  open,
  reference,
  sentTo,
  pollAfterMs = 4000,
  onPaid,
  onClose,
}: {
  open: boolean;
  reference: string | null;
  sentTo: string | null;
  pollAfterMs?: number;
  onPaid: () => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<'waiting' | 'paid' | 'failed' | 'timeout'>('waiting');
  const [reason, setReason] = useState<string>('');
  // Held in a ref so the polling effect never restarts when it changes.
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  useEffect(() => {
    if (!open || !reference) return;

    setState('waiting');
    setReason('');

    let cancelled = false;
    let timer: number;
    const startedAt = Date.now();
    // Long enough for a payer to find their phone, unlock it and read a menu.
    const giveUpAfterMs = 120_000;

    async function poll() {
      if (cancelled) return;

      try {
        const { data } = await api.get<{ settled: boolean; reason?: string }>(
          `/payments/${reference}/status`,
        );

        if (cancelled) return;
        if (data.settled) {
          setState('paid');
          // A beat on the tick, so it does not vanish before it is read.
          window.setTimeout(() => onPaidRef.current(), 1200);
          return;
        }
        // A declined or expired prompt comes back with a reason; still pending
        // comes back without one.
        if (data.reason && !/pending/i.test(data.reason)) {
          setState('failed');
          setReason(data.reason);
          return;
        }
      } catch {
        // A failed poll is not a failed payment — the phone may be slow, or the
        // free instance may have been asleep. Keep asking until the deadline.
      }

      if (Date.now() - startedAt > giveUpAfterMs) {
        setState('timeout');
        return;
      }
      timer = window.setTimeout(poll, 3000);
    }

    timer = window.setTimeout(poll, pollAfterMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, reference, pollAfterMs]);

  return (
    <Modal open={open} onClose={onClose} title="Approve on your phone">
      <div className="py-2 text-center">
        {state === 'waiting' && (
          <>
            <Smartphone className="mx-auto h-10 w-10 text-brand-600" />
            <p className="mt-4 font-semibold text-slate-900">Check your phone</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">
              We sent a payment request to{' '}
              <span className="font-semibold text-slate-900">{sentTo}</span>. Enter your mobile
              money PIN to approve it.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2 text-sm text-slate-500">
              <Spinner className="h-4 w-4" />
              Waiting for you to approve…
            </div>
            <p className="mt-4 text-xs text-slate-500">
              No prompt? Dial your mobile money menu and check pending approvals.
            </p>
          </>
        )}

        {state === 'paid' && (
          <>
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
            <p className="mt-4 font-semibold text-slate-900">Payment received</p>
            <p className="mt-1 text-sm text-slate-600">Thank you — that is all done.</p>
          </>
        )}

        {(state === 'failed' || state === 'timeout') && (
          <>
            <TriangleAlert className="mx-auto h-10 w-10 text-amber-600" />
            <p className="mt-4 font-semibold text-slate-900">
              {state === 'timeout' ? 'No answer yet' : 'That payment did not go through'}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">
              {state === 'timeout'
                ? 'The request may have expired on your phone. Nothing has been charged — you can try again.'
                : reason || 'It was declined or cancelled. Nothing has been charged.'}
            </p>
            <button type="button" className="btn-secondary mt-5" onClick={onClose}>
              Try again
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
