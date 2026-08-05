import { Moon, Sun } from 'lucide-react';
import clsx from 'clsx';
import { useTheme } from '../store/theme';

/**
 * One button, not a three-way light/dark/system control. A shopkeeper wants the
 * screen readable now; picking between three options is a settings screen's job,
 * and this lives in a nav bar.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      className={clsx(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900',
        className,
      )}
      // The label says what pressing it does, not what the current state is —
      // that is what a screen reader user needs from a button.
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
