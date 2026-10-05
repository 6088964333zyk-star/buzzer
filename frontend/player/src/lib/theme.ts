// Light/dark theme state (T9). Byte-identical in host, player and admin (CI checks this).
// The inline script in index.html applies the theme before React renders; this module reads
// and changes it afterwards. The `dark` class on <html> is the single source of truth.

export type Theme = 'light' | 'dark';

// Shared by all three apps: they are served from one origin, so the choice carries across.
const STORAGE_KEY = 'buzzer-theme';

const root = () => document.documentElement;

function readSaved(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null; // storage blocked (private mode etc.): fall back to the OS preference
  }
}

function apply(theme: Theme) {
  root().classList.toggle('dark', theme === 'dark');
  root().style.colorScheme = theme;
}

export function getTheme(): Theme {
  return root().classList.contains('dark') ? 'dark' : 'light';
}

export function setTheme(theme: Theme) {
  apply(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not persisted, but the toggle still works for this page.
  }
}

/** Calls `cb` whenever the theme changes; returns an unsubscribe function. */
export function onThemeChange(cb: (theme: Theme) => void): () => void {
  const observer = new MutationObserver(() => cb(getTheme()));
  observer.observe(root(), { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

/**
 * A token as a CSS color string, for code Tailwind can't reach (canvas drawing, QR codes).
 * Read at draw time, so it always reflects the current theme.
 */
export function cssColor(token: string, alpha = 1): string {
  const triple = getComputedStyle(root()).getPropertyValue(`--${token}`).trim();
  return `rgb(${triple} / ${alpha})`;
}

// While the user hasn't chosen, follow changes to the OS preference.
const media = window.matchMedia('(prefers-color-scheme: dark)');
media.addEventListener('change', (e) => {
  if (readSaved() === null) apply(e.matches ? 'dark' : 'light');
});
