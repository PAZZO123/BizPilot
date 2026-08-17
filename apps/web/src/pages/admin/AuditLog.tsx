import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { api } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { Card, EmptyState, PageLoader } from '../../components/ui';
import { readableAction } from './AccountDetail';

interface AuditEntry {
  id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  user: { email: string; name: string } | null;
  business: { id: string; name: string } | null;
}

/**
 * Everything admins have done, newest first.
 *
 * The reason is shown at the same size as the action, not tucked away as
 * metadata, because the reason is the only part that answers the question
 * anybody actually brings to this screen.
 */
export function AdminAuditLog() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit'],
    queryFn: async () => (await api.get<AuditEntry[]>('/admin/audit')).data,
  });

  if (isLoading) return <PageLoader />;

  if (!data?.length) {
    return (
      <EmptyState
        icon={<ScrollText className="h-8 w-8" />}
        title="Nothing here yet"
        description="Every suspension, plan grant and role change will be listed here."
      />
    );
  }

  return (
    <Card padded={false}>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {data.map((entry) => (
          <li key={entry.id} className="px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="font-medium text-slate-900 dark:text-white">
                {readableAction(entry.action)}
                {entry.business && (
                  <span className="font-normal text-slate-500"> · {entry.business.name}</span>
                )}
              </p>
              <p className="text-xs text-slate-500">
                {entry.user?.email ?? 'unknown'} · {formatRelative(entry.createdAt)}
              </p>
            </div>

            {typeof entry.metadata?.reason === 'string' && (
              <p className="mt-1 text-sm italic text-slate-600 dark:text-slate-300">
                “{entry.metadata.reason as string}”
              </p>
            )}

            <p className="mt-1 text-xs text-slate-400">{changeSummary(entry)}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The before and after, when there is one, in a single readable line. */
function changeSummary(entry: AuditEntry): string {
  const meta = entry.metadata ?? {};
  const parts: string[] = [];

  if (meta.from !== undefined && meta.to !== undefined) {
    parts.push(`${String(meta.from ?? '—')} → ${String(meta.to ?? '—')}`);
  }
  if (typeof meta.email === 'string') parts.push(meta.email);
  if (typeof meta.months === 'number') parts.push(`${meta.months} month(s)`);
  if (typeof meta.days === 'number') parts.push(`${meta.days} day(s)`);
  if (typeof meta.reference === 'string') parts.push(meta.reference);
  if (entry.ip) parts.push(`from ${entry.ip}`);

  return parts.join(' · ');
}
