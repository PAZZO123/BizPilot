import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Input, Select, Spinner } from '../components/ui';
import { PasswordFields, isPasswordValid } from '../components/PasswordFields';
import { errorMessage } from '../lib/api';
import { useAuth } from '../store/auth';

const BUSINESS_TYPES = [
  { value: 'SHOP', label: 'Shop / retail' },
  { value: 'PHARMACY', label: 'Pharmacy' },
  { value: 'RESTAURANT', label: 'Restaurant / bar' },
  { value: 'HARDWARE', label: 'Hardware store' },
  { value: 'SALON', label: 'Salon / barber' },
  { value: 'OTHER', label: 'Something else' },
];

export function Register() {
  const register = useAuth((state) => state.register);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    businessName: '',
    businessType: 'SHOP',
    name: '',
    email: '',
    phone: '',
    password: '',
  });
  // Kept out of `form` deliberately — it is never sent to the API.
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function update(field: keyof typeof form) {
    return (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setError('');

    // Checked here as well as in the fields themselves: the rules below mirror
    // what the API enforces, and catching it now saves a round trip that would
    // come back as a validation error with no idea which field it meant.
    if (!isPasswordValid(form.password)) {
      setError('Your password needs at least 8 characters, including a letter and a number.');
      return;
    }
    if (form.password !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await register(form);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Could not create the account.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 font-bold text-white">
            BP
          </div>
          <span className="font-display text-2xl font-bold text-slate-900">BizPilot</span>
        </Link>

        <div className="card p-6">
          <h1 className="text-lg font-bold text-slate-900">Start free</h1>
          <p className="mt-1 text-sm text-slate-500">
            14 days of everything, no card needed. Then stay free or upgrade.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <Input
              label="Business name"
              name="businessName"
              required
              value={form.businessName}
              onChange={update('businessName')}
              placeholder="Uwase Mini Market"
            />
            <Select label="What kind of business?" name="businessType" value={form.businessType} onChange={update('businessType')}>
              {BUSINESS_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
            <Input
              label="Your name"
              name="name"
              required
              value={form.name}
              onChange={update('name')}
              placeholder="Alice Uwase"
            />
            <Input
              label="Email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={form.email}
              onChange={update('email')}
              placeholder="you@shop.rw"
            />
            <Input
              label="Phone"
              name="phone"
              type="tel"
              value={form.phone}
              onChange={update('phone')}
              placeholder="+250 788 123 456"
              hint="Optional. Used for SMS reminders you send."
            />
            <PasswordFields
              password={form.password}
              confirm={confirmPassword}
              onPasswordChange={(value) => setForm((current) => ({ ...current, password: value }))}
              onConfirmChange={setConfirmPassword}
              submitted={submitted}
            />

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy && <Spinner className="h-4 w-4 text-white" />}
              Create my shop
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-600">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-brand-700 hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
