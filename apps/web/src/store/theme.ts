import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'bizpilot-theme';

/**
 * The class is already on <html> by the time React mounts — index.html sets it
 * inline to avoid a flash of the wrong theme. This store only has to read back
 * what that script decided and keep the two in step from then on.
 */
function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function paint(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

function remember(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing. The choice lasts for this tab and that is good enough.
  }
}

function storedChoice(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

interface ThemeState {
  theme: Theme;
  /** The user flipping the switch — this is what gets remembered. */
  toggle: () => void;
  /** The OS changing under us. Deliberately not persisted, so the app keeps
   *  following the phone until the user overrides it once. */
  follow: (theme: Theme) => void;
}

export const useTheme = create<ThemeState>((set) => ({
  theme: currentTheme(),
  toggle: () =>
    set((state) => {
      const next: Theme = state.theme === 'dark' ? 'light' : 'dark';
      paint(next);
      remember(next);
      return { theme: next };
    }),
  follow: (theme) => {
    paint(theme);
    set({ theme });
  },
}));

/**
 * Follow the OS only while the user has never expressed a preference. Once they
 * touch the switch their choice wins, including after the phone flips to its
 * night schedule.
 */
export function watchSystemTheme(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const onChange = (event: MediaQueryListEvent) => {
    if (storedChoice()) return;
    useTheme.getState().follow(event.matches ? 'dark' : 'light');
  };

  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
