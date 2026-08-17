import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, X } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { Card, PageLoader } from '../../components/ui';

interface SystemInfo {
  payments: {
    provider: string;
    configured: boolean;
    environment: string;
    takesRealMoney: boolean;
    callbackSecretSet: boolean;
  };
  assistant: { provider: string; model: string; configured: boolean };
  sms: { configured: boolean; sender: string };
  platformAdmins: number;
  environment: string;
  startedAt: string;
}

/**
 * What this installation is actually wired to.
 *
 * Half of all support questions are "is the thing switched on?", and the honest
 * answer lives in environment variables on the host. This reads them back —
 * names and on/off only, never a key or any part of one — so nobody has to shell
 * in to find out that SMS was never configured.
 */
export function AdminSystem() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-system'],
    queryFn: async () => (await api.get<SystemInfo>('/admin/system')).data,
  });

  if (isLoading || !data) return <PageLoader />;

  return (
    <div className="space-y-4">
      {data.payments.configured && !data.payments.takesRealMoney && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="text-sm text-amber-900 dark:text-amber-100">
              <p className="font-semibold">Payments are in test mode</p>
              <p>
                Checkout works, but no real money moves and no phone is ever rung. Switch to
                production credentials once MTN approves the merchant account.
              </p>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-slate-900 dark:text-white">Payments</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Provider" value={data.payments.provider} />
            <Row label="Environment" value={data.payments.environment} />
            <Flag label="Credentials set" on={data.payments.configured} />
            <Flag label="Takes real money" on={data.payments.takesRealMoney} neutral />
            <Flag label="Callback secret set" on={data.payments.callbackSecretSet} />
          </dl>
        </Card>

        <Card>
          <h2 className="font-semibold text-slate-900 dark:text-white">Assistant</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Provider" value={data.assistant.provider} />
            <Row label="Model" value={data.assistant.model} />
            <Flag label="API key set" on={data.assistant.configured} />
          </dl>
        </Card>

        <Card>
          <h2 className="font-semibold text-slate-900 dark:text-white">SMS reminders</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Flag label="Configured" on={data.sms.configured} />
            <Row label="Sender" value={data.sms.sender || '—'} />
          </dl>
        </Card>

        <Card>
          <h2 className="font-semibold text-slate-900 dark:text-white">Server</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Environment" value={data.environment} />
            <Row label="Platform admins" value={String(data.platformAdmins)} />
            <Row label="Started" value={formatRelative(data.startedAt)} />
          </dl>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900 dark:text-white">{value}</dd>
    </div>
  );
}

/**
 * `neutral` is for facts that are not good or bad on their own — "takes real
 * money" is correct in production and correct-to-be-false in a sandbox, so
 * painting it red would train people to ignore red.
 */
function Flag({ label, on, neutral }: { label: string; on: boolean; neutral?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={clsx(
          'flex items-center gap-1 font-medium',
          neutral
            ? 'text-slate-700 dark:text-slate-200'
            : on
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-red-600',
        )}
      >
        {on ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
        {on ? 'yes' : 'no'}
      </dd>
    </div>
  );
}
