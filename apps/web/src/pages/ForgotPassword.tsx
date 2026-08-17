import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Input, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err, 'Could not send the reset email.'));
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
          {sent ? (
            <>
              <h1 className="text-lg font-bold text-slate-900">Check your email</h1>
              <p className="mt-2 text-sm text-slate-600">
                If <strong>{email}</strong> has a BizPilot account, a reset link is on its way. The
                link works for 30 minutes.
              </p>
              <p className="mt-4 text-sm text-slate-500">
                Nothing arriving? Check the spam folder, or try again with the address you signed up
                with.
              </p>
              <Link to="/login" className="btn-primary mt-5 w-full text-center">
                Back to log in
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-lg font-bold text-slate-900">Forgot your password?</h1>
              <p className="mt-1 text-sm text-slate-500">
                Enter your email and we&apos;ll send you a link to set a new one.
              </p>

              <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                <Input
                  label="Email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@shop.rw"
                />

                {error && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                    {error}
                  </p>
                )}

                <button type="submit" className="btn-primary w-full" disabled={busy}>
                  {busy && <Spinner className="h-4 w-4 text-white" />}
                  Send reset link
                </button>
              </form>

              <p className="mt-5 text-center text-sm text-slate-600">
                Remembered it?{' '}
                <Link to="/login" className="font-semibold text-brand-700 hover:underline">
                  Log in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
