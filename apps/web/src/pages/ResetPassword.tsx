import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Input, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: password });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err, 'Could not reset the password.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 font-bold text-white">
            BP
          </div>
          <span className="font-display text-2xl font-bold text-slate-900">BizPilot</span>
        </Link>

        <div className="card p-6">
          {done ? (
            <>
              <h1 className="text-lg font-bold text-slate-900">Password changed</h1>
              <p className="mt-2 text-sm text-slate-600">
                Your new password is set and every old session has been signed out. Log in with the
                new one.
              </p>
              <Link to="/login" className="btn-primary mt-5 w-full text-center">
                Log in
              </Link>
            </>
          ) : !token ? (
            <>
              <h1 className="text-lg font-bold text-slate-900">Missing reset link</h1>
              <p className="mt-2 text-sm text-slate-600">
                This page only works from the link in a reset email. Request a new one and open the
                email on this device.
              </p>
              <Link to="/forgot-password" className="btn-primary mt-5 w-full text-center">
                Request a reset link
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-lg font-bold text-slate-900">Choose a new password</h1>
              <p className="mt-1 text-sm text-slate-500">
                At least 8 characters, with a letter and a number.
              </p>

              <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                <Input
                  label="New password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <Input
                  label="Confirm new password"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />

                {error && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                    {error}
                  </p>
                )}

                <button type="submit" className="btn-primary w-full" disabled={busy}>
                  {busy && <Spinner className="h-4 w-4 text-white" />}
                  Set new password
                </button>
              </form>

              <p className="mt-5 text-center text-sm text-slate-600">
                Link expired?{' '}
                <Link to="/forgot-password" className="font-semibold text-brand-700 hover:underline">
                  Request a new one
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
