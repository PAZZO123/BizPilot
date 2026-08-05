import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, errorMessage } from '../lib/api';
import {
  Badge,
  Card,
  ConfirmDialog,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  Select,
  Spinner,
} from '../components/ui';
import { canManage, isOwner, useAuth } from '../store/auth';

interface BusinessProfile {
  id: string;
  name: string;
  type: string;
  currency: string;
  country: string;
  timezone: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  logoUrl: string | null;
  taxId: string | null;
  defaultTaxBps: number;
  invoicePrefix: string;
  receiptPrefix: string;
}

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

export function SettingsPage() {
  const { user, setBusiness } = useAuth();
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['business'],
    queryFn: async () => (await api.get<BusinessProfile>('/business')).data,
  });

  const [form, setForm] = useState<Partial<BusinessProfile>>({});
  const [taxPercent, setTaxPercent] = useState('0');

  useEffect(() => {
    if (profile) {
      setForm(profile);
      setTaxPercent(String(profile.defaultTaxBps / 100));
    }
  }, [profile]);

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch<BusinessProfile>('/business', {
          name: form.name,
          type: form.type,
          phone: form.phone ?? '',
          email: form.email ?? '',
          address: form.address ?? '',
          taxId: form.taxId ?? '',
          logoUrl: form.logoUrl ?? '',
          // The API stores basis points so an 18% VAT is exact; the form asks
          // for a percentage because that is what the owner knows.
          defaultTaxBps: Math.round((Number(taxPercent) || 0) * 100),
          invoicePrefix: form.invoicePrefix,
          receiptPrefix: form.receiptPrefix,
        })
      ).data,
    onSuccess: (updated) => {
      toast.success('Settings saved.');
      setBusiness({ name: updated.name, logoUrl: updated.logoUrl });
      void queryClient.invalidateQueries({ queryKey: ['business'] });
    },
    onError: (error) => toast.error(errorMessage(error), { duration: 6000 }),
  });

  if (isLoading || !profile) return <PageLoader />;

  const editable = canManage(user?.role);

  function update(field: keyof BusinessProfile) {
    return (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Your business details and who can use BizPilot." />

      <Card>
        <h2 className="mb-4 font-semibold text-slate-900">Business details</h2>
        <form
          className="space-y-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <Input label="Business name" value={form.name ?? ''} onChange={update('name')} disabled={!editable} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Phone" value={form.phone ?? ''} onChange={update('phone')} disabled={!editable} />
            <Input
              label="Email"
              type="email"
              value={form.email ?? ''}
              onChange={update('email')}
              disabled={!editable}
            />
          </div>

          <Input
            label="Address"
            value={form.address ?? ''}
            onChange={update('address')}
            disabled={!editable}
            hint="Printed at the top of your invoices."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Tax number (TIN)"
              value={form.taxId ?? ''}
              onChange={update('taxId')}
              disabled={!editable}
            />
            <Input
              label="Default tax rate"
              inputMode="decimal"
              value={taxPercent}
              onChange={(event) => setTaxPercent(event.target.value)}
              disabled={!editable}
              hint="Percent, e.g. 18 for VAT. Use 0 if you do not charge tax."
            />
          </div>

          <Input
            label="Logo URL"
            value={form.logoUrl ?? ''}
            onChange={update('logoUrl')}
            disabled={!editable}
            placeholder="https://…"
            hint="Shown on invoices. Paid plans only."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Receipt prefix"
              value={form.receiptPrefix ?? ''}
              onChange={update('receiptPrefix')}
              disabled={!editable}
              hint="e.g. RCP-2026-0001"
            />
            <Input
              label="Invoice prefix"
              value={form.invoicePrefix ?? ''}
              onChange={update('invoicePrefix')}
              disabled={!editable}
              hint="e.g. INV-2026-0001"
            />
          </div>

          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Currency is <strong>{profile.currency}</strong>. It cannot be changed once sales have
            been recorded, because it would silently reprice your history.
          </div>

          {editable && (
            <div className="flex justify-end">
              <button type="submit" className="btn-primary" disabled={save.isPending}>
                {save.isPending && <Spinner className="h-4 w-4 text-white" />}
                Save changes
              </button>
            </div>
          )}
        </form>
      </Card>

      {canManage(user?.role) && <StaffSection canEditRoles={isOwner(user?.role)} myId={user?.id} />}

      <PasswordSection />
    </div>
  );
}

function StaffSection({ canEditRoles, myId }: { canEditRoles: boolean; myId?: string }) {
  const queryClient = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<StaffUser | null>(null);

  const { data: users } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => (await api.get<StaffUser[]>('/business/users')).data,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/business/users/${id}`),
    onSuccess: () => {
      toast.success('Account removed.');
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card padded={false}>
      <div className="flex items-center justify-between px-4 pb-3 pt-4 sm:px-5">
        <h2 className="font-semibold text-slate-900">Staff</h2>
        <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setInviting(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>

      <ul className="divide-y divide-slate-100">
        {users?.map((staff) => (
          <li key={staff.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-slate-900">{staff.name}</p>
              <p className="truncate text-xs text-slate-500">{staff.email}</p>
            </div>
            <Badge tone={staff.role === 'OWNER' ? 'info' : 'neutral'}>{staff.role.toLowerCase()}</Badge>
            {!staff.isActive && <Badge tone="danger">inactive</Badge>}
            {canEditRoles && staff.role !== 'OWNER' && staff.id !== myId && (
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                onClick={() => setRemoving(staff)}
                aria-label={`Remove ${staff.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>

      <InviteForm open={inviting} onClose={() => setInviting(false)} />

      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove this account?"
        message={`${removing?.name} will be logged out immediately and will not be able to sign in again. Their past sales stay in your records.`}
        confirmLabel="Remove"
        destructive
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}

function InviteForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'CASHIER' });

  const invite = useMutation({
    mutationFn: async () => api.post('/auth/users', form),
    onSuccess: () => {
      toast.success('Account created. Give them the password to log in.');
      setForm({ name: '', email: '', password: '', role: 'CASHIER' });
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error), { duration: 6000 }),
  });

  function update(field: keyof typeof form) {
    return (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a staff account">
      <form
        className="space-y-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          invite.mutate();
        }}
      >
        <Input label="Their name" required value={form.name} onChange={update('name')} />
        <Input label="Their email" type="email" required value={form.email} onChange={update('email')} />
        <Input
          label="A starting password"
          type="password"
          required
          minLength={8}
          value={form.password}
          onChange={update('password')}
          hint="Give it to them in person. They can change it after logging in."
        />
        <Select label="What can they do?" value={form.role} onChange={update('role')}>
          <option value="CASHIER">Cashier — record sales only</option>
          <option value="MANAGER">Manager — everything except staff and billing</option>
        </Select>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={invite.isPending}>
            {invite.isPending && <Spinner className="h-4 w-4 text-white" />}
            Create account
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordSection() {
  const logout = useAuth((state) => state.logout);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');

  const change = useMutation({
    mutationFn: async () =>
      api.post('/auth/change-password', { currentPassword: current, newPassword: next }),
    onSuccess: async () => {
      toast.success('Password changed. Please log in again.');
      // The server revoked every session, so staying here would just 401.
      await logout();
      window.location.href = '/login';
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card>
      <h2 className="mb-4 font-semibold text-slate-900">Change your password</h2>
      <form
        className="space-y-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          change.mutate();
        }}
      >
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={next}
          onChange={(event) => setNext(event.target.value)}
          hint="At least 8 characters, with a letter and a number. This logs you out everywhere."
        />
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={change.isPending}>
            {change.isPending && <Spinner className="h-4 w-4 text-white" />}
            Change password
          </button>
        </div>
      </form>
    </Card>
  );
}
