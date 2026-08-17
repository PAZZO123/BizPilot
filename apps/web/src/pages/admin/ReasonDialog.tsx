import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Spinner } from '../../components/ui';

/**
 * The dialog in front of every platform action.
 *
 * It asks for a reason, and it will not submit without one. That is not
 * ceremony: these actions are invisible to the person they land on — a
 * shopkeeper who has been suspended just finds they cannot log in — so this box
 * is where the explanation for that comes from. Six months later it is the only
 * record of why.
 *
 * The confirm button stays disabled below four characters, matching the API,
 * so the refusal happens here rather than after a round trip.
 */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  busy,
  error,
  extra,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  error?: string | null;
  /** Extra fields for actions that need more than a reason — days, a plan. */
  extra?: ReactNode;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');

  // Cleared on open rather than on close, so last time's reason is never
  // submitted against this time's account.
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const tooShort = reason.trim().length < 4;

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="text-sm text-slate-600 dark:text-slate-300">{description}</div>

        {extra}

        <div>
          <label htmlFor="admin-reason" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
            Why are you doing this?
          </label>
          <textarea
            id="admin-reason"
            className="input min-h-[76px] w-full"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Recorded against this account, and readable by every admin."
            autoFocus
          />
          <p className="mt-1 text-xs text-slate-500">
            Stored in the audit log with your email. Required.
          </p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={destructive ? 'btn-danger' : 'btn-primary'}
            disabled={busy || tooShort}
            onClick={() => onConfirm(reason.trim())}
          >
            {busy && <Spinner className="h-4 w-4 text-white" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
