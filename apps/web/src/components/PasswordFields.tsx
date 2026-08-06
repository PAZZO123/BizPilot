import { useState } from 'react';
import { Check, Eye, EyeOff, X } from 'lucide-react';
import clsx from 'clsx';

/**
 * Password entry for signup.
 *
 * Three decisions worth keeping:
 *
 * A **reveal toggle**, because the alternative on a phone keyboard is typing a
 * password you cannot see, twice, and giving up. It defaults to hidden and the
 * two fields reveal together — checking one against the other is the whole
 * point of having two.
 *
 * The **rules are shown from the start**, not sprung as errors after a failed
 * submit. They mirror what the API enforces exactly (8 characters, a letter, a
 * number); if the server's DTO changes, change these with it or people will be
 * told their password is fine and then rejected.
 *
 * The **match warning waits** until the confirm field has been left, or until it
 * is at least as long as the password. Telling someone their passwords do not
 * match while they are still on the second character is just noise.
 */

export interface PasswordRule {
  label: string;
  ok: boolean;
}

export function passwordRules(password: string): PasswordRule[] {
  return [
    { label: 'At least 8 characters', ok: password.length >= 8 },
    { label: 'Contains a letter', ok: /[A-Za-z]/.test(password) },
    { label: 'Contains a number', ok: /[0-9]/.test(password) },
  ];
}

export function isPasswordValid(password: string): boolean {
  return passwordRules(password).every((rule) => rule.ok);
}

export function PasswordFields({
  password,
  confirm,
  onPasswordChange,
  onConfirmChange,
  /** Set once the form has been submitted, to reveal everything still wrong. */
  submitted = false,
}: {
  password: string;
  confirm: string;
  onPasswordChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  submitted?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);

  const rules = passwordRules(password);
  const matches = password === confirm;

  // Only complain about a mismatch once they have plausibly finished typing it.
  const showMismatch =
    confirm.length > 0 &&
    !matches &&
    (submitted || confirmTouched || confirm.length >= password.length);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between">
          <label className="label" htmlFor="password">
            Password
          </label>
          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
            // Not a form control — stops the browser offering to fill it.
            tabIndex={-1}
          >
            {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {visible ? 'Hide' : 'Show'}
          </button>
        </div>
        <input
          id="password"
          name="password"
          className="input"
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          aria-describedby="password-rules"
        />

        <ul id="password-rules" className="mt-2 space-y-1">
          {rules.map((rule) => (
            <li
              key={rule.label}
              className={clsx(
                'flex items-center gap-1.5 text-xs',
                rule.ok ? 'text-emerald-700' : 'text-slate-500',
              )}
            >
              {rule.ok ? (
                <Check className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-current opacity-40" />
              )}
              {rule.label}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <label className="label" htmlFor="confirmPassword">
          Type it again
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          className={clsx(
            'input',
            showMismatch && 'border-red-400 focus:border-red-500 focus:ring-red-500',
          )}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => onConfirmChange(event.target.value)}
          onBlur={() => setConfirmTouched(true)}
          aria-invalid={showMismatch}
        />

        {showMismatch ? (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-red-600">
            <X className="h-4 w-4 shrink-0" />
            These do not match.
          </p>
        ) : confirm.length > 0 && matches && isPasswordValid(password) ? (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-emerald-700">
            <Check className="h-4 w-4 shrink-0" />
            Passwords match.
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            There is no password reset yet, so keep this somewhere safe.
          </p>
        )}
      </div>
    </div>
  );
}
