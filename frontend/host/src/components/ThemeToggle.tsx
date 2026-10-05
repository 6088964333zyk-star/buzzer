import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { getTheme, onThemeChange, setTheme, type Theme } from '../lib/theme';
import { cn } from '../lib/utils';

// T9 theme toggle. The host mounts it once in App.tsx, fixed top-right on every route; page
// top rows reserve `pr-16` so nothing sits underneath it.
export default function ThemeToggle({ className }: { className?: string }) {
  const [theme, setThemeState] = useState<Theme>(getTheme);
  useEffect(() => onThemeChange(setThemeState), []);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={cn(
        'fixed top-3 right-3 z-40 flex h-11 w-11 items-center justify-center rounded-full',
        'border border-border bg-surface text-fg-muted shadow hover:bg-surface-hover hover:text-fg',
        className,
      )}
    >
      {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
