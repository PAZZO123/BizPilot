import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Input, Spinner } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useAuth } from '../store/auth';

export function Login() {
  const login = useAuth((state) => state.login);
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? '/app', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Could not log in.'));
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
          <h1 className="text-lg font-bold text-slate-900">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">Log in to your shop.</p>

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
            <Input
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy && <Spinner className="h-4 w-4 text-white" />}
              Log in
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-600">
            New here?{' '}
            <Link to="/signup" className="font-semibold text-brand-700 hover:underline">
              Create a free account
            </Link>
          </p>
        </div>

        <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-center text-xs text-slate-500">
          Demo shop: <strong>demo@bizpilot.rw</strong> / <strong>demo1234</strong>
        </p>
      </div>
    </div>
  );
}
