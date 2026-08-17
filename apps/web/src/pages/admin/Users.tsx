import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Search, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { api, errorMessage } from '../../lib/api';
import { formatDate, formatNumber, formatRelative } from '../../lib/format';
import { Card, EmptyState, Input, PageLoader, Select } from '../../components/ui';
import { ReasonDialog } from './ReasonDialog';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  business: { id: string; name: string };
  businessSuspended: boolean;
  platformAdmin: boolean;
}

type Action =
  | { kind: 'deactivate'; user: AdminUser }
  | { kind: 'activate'; user: AdminUser }
  | { kind: 'role'; user: AdminUser }
  | { kind: 'signout'; user: AdminUser };

/**
 * Everyone with a login, across every shop.
 *
 * Platform admins are marked and their destructive actions are disabled here
 * rather than only refused by the API, so the console never offers a button
 * that is going to come back with an error.
 */
export function AdminUsers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [active, setActive] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [newRole, setNewRole] = useState('MANAGER');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', search, role, active],
    queryFn: async () =>
      (
        await api.get<{ total: number; shown: number; users: AdminUser[] }>('/admin/users', {
          params: { search: search || undefined, role: role || undefined, active: active || undefined },
        })
      ).data,
  });

  const run = useMutation({
    mutationFn: async ({ current, reason }: { current: Action; reason: string }) => {
      const { kind, user } = current;
      if (kind === 'signout') return api.post(`/admin/users/${user.id}/sign-out`, { reason });
      if (kind === 'role') return api.post(`/admin/users/${user.id}/role`, { role: newRole, reason });
      return api.post(`/admin/users/${user.id}/active`, {
        isActive: kind === 'activate',
        reason,
      });
    },
    onSuccess: (_result, variables) => {
      toast.success(DONE[variables.current.kind]);
      setAction(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-audit'] });
    },
  });

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <Input
            label="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, email, phone or shop"
          />
          <Select label="Role" value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="">Any role</option>
            <option value="OWNER">Owner</option>
            <option value="MANAGER">Manager</option>
            <option value="CASHIER">Cashier</option>
          </Select>
          <Select label="Access" value={active} onChange={(event) => setActive(event.target.value)}>
            <option value="">Everyone</option>
            <option value="true">Active only</option>
            <option value="false">Deactivated only</option>
          </Select>
        </div>
        {data && (
          <p className="mt-3 text-sm text-slate-500">
            Showing {formatNumber(data.shown)} of {formatNumber(data.total)} people.
          </p>
        )}
      </Card>

      {!data?.users.length ? (
        <EmptyState
          icon={<Search className="h-8 w-8" />}
          title="Nobody matches"
          description="Try a shorter search."
        />
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Person</th>
                  <th className="px-4 py-2.5 font-medium">Shop</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium">Last seen</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.users.map((user) => (
                  <tr key={user.id} className={clsx(!user.isActive && 'opacity-60')}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-white">{user.name}</span>
                        {user.platformAdmin && (
                          <span
                            title="Platform admin — protected"
                            className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300"
                          >
                            <ShieldCheck className="h-3 w-3" /> admin
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">{user.email}</p>
                      {!user.isActive && (
                        <p className="text-xs font-semibold text-red-600">Deactivated</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-700 dark:text-slate-200">{user.business.name}</p>
                      {user.businessSuspended && (
                        <p className="text-xs font-semibold text-red-600">shop suspended</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">
                      {user.role}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {user.lastLoginAt ? formatRelative(user.lastLoginAt) : 'never'}
                      <p className="text-xs">joined {formatDate(user.createdAt)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <IconAction
                          label="Sign out everywhere"
                          icon={LogOut}
                          onClick={() => setAction({ kind: 'signout', user })}
                        />
                        <IconAction
                          label="Change role"
                          icon={ShieldCheck}
                          disabled={user.platformAdmin}
                          onClick={() => {
                            setNewRole(user.role === 'OWNER' ? 'MANAGER' : 'OWNER');
                            setAction({ kind: 'role', user });
                          }}
                        />
                        {user.isActive ? (
                          <IconAction
                            label="Deactivate"
                            icon={UserX}
                            destructive
                            disabled={user.platformAdmin}
                            onClick={() => setAction({ kind: 'deactivate', user })}
                          />
                        ) : (
                          <IconAction
                            label="Reactivate"
                            icon={UserCheck}
                            onClick={() => setAction({ kind: 'activate', user })}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ReasonDialog
        open={action !== null}
        title={action ? TITLES[action.kind] : ''}
        destructive={action?.kind === 'deactivate'}
        confirmLabel={action ? CONFIRM[action.kind] : ''}
        busy={run.isPending}
        error={run.isError ? errorMessage(run.error) : null}
        description={action ? describe(action) : null}
        extra={
          action?.kind === 'role' ? (
            <Select label="New role" value={newRole} onChange={(event) => setNewRole(event.target.value)}>
              <option value="OWNER">Owner</option>
              <option value="MANAGER">Manager</option>
              <option value="CASHIER">Cashier</option>
            </Select>
          ) : null
        }
        onConfirm={(reason) => action && run.mutate({ current: action, reason })}
        onClose={() => setAction(null)}
      />
    </div>
  );
}

function IconAction({
  label,
  icon: Icon,
  destructive,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof LogOut;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={disabled ? `${label} — not allowed on a platform admin` : label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'rounded-lg p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-30',
        destructive
          ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950'
          : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

const TITLES: Record<Action['kind'], string> = {
  deactivate: 'Deactivate this person?',
  activate: 'Reactivate this person?',
  role: 'Change what they can do',
  signout: 'Sign this person out?',
};

const CONFIRM: Record<Action['kind'], string> = {
  deactivate: 'Deactivate',
  activate: 'Reactivate',
  role: 'Change role',
  signout: 'Sign out',
};

const DONE: Record<Action['kind'], string> = {
  deactivate: 'Deactivated and signed out.',
  activate: 'They can sign in again.',
  role: 'Role changed.',
  signout: 'Signed out of every device.',
};

function describe(action: Action) {
  const who = (
    <strong className="text-slate-900 dark:text-white">
      {action.user.name} ({action.user.email})
    </strong>
  );
  switch (action.kind) {
    case 'deactivate':
      return (
        <>
          {who} will not be able to sign in, and is signed out of every device now. Their shop keeps
          working — this affects one person, not the business.
        </>
      );
    case 'activate':
      return <>{who} will be able to sign in again.</>;
    case 'role':
      return (
        <>
          Changes what {who} can do inside {action.user.business.name}. Removing the last owner is
          refused — somebody has to be able to run the shop.
        </>
      );
    case 'signout':
      return (
        <>
          Ends every session {who} has open. They can sign straight back in — this is for a lost
          phone, not a punishment.
        </>
      );
  }
}
