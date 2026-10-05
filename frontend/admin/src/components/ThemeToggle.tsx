import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { getTheme, onThemeChange, setTheme, type Theme } from '../lib/theme';
import { cn } from '../lib/utils';

// T9 theme toggle. `variant="sidebar"` sits in the AdminLayout sidebar footer with a visible
// label; `"floating"` is fixed top-right on the pages without a sidebar (Login, NotAdmin).
export default function ThemeToggle({ variant }: { variant: 'sidebar' | 'floating' }) {
  const [theme, setThemeState] = useState<Theme>(getTheme);
  useEffect(() => onThemeChange(setThemeState), []);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const Icon = theme === 'dark' ? Sun : Moon;
  const label = `Switch to ${next} theme`;

  if (variant === 'sidebar') {
    return (
      <button
        type="button"
        onClick={() => setTheme(next)}
        aria-label={label}
        className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-fg-muted hover:bg-surface-hover hover:text-fg w-full transition-colors"
      >
        <Icon size={16} /> {next === 'light' ? 'Light theme' : 'Dark theme'}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
      className={cn(
        'fixed top-3 right-3 z-40 flex h-11 w-11 items-center justify-center rounded-full',
        'border border-border bg-surface text-fg-muted shadow hover:bg-surface-hover hover:text-fg',
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
