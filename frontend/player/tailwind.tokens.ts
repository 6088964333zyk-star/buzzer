// Tailwind color names for the T9 design tokens in src/theme.css. Byte-identical in host,
// player and admin (CI checks this). It replaces Tailwind's palette entirely, so a raw class
// like `bg-slate-800` generates no CSS. See docs/design-t9-theming.md (T1, T2).

const TOKENS = [
  'bg',
  'surface',
  'surface-raised',
  'surface-hover',
  'border',
  'border-strong',
  'fg',
  'fg-muted',
  'fg-subtle',
  'accent',
  'accent-hover',
  'on-accent',
  'accent-fg',
  'success',
  'success-fg',
  'danger',
  'danger-fg',
  'warning',
  'warning-fg',
  'on-status',
  'on-warning',
  'focus',
  'map-water',
  'qr-bg',
  'qr-fg',
  'option-1',
  'option-2',
  'option-3',
  'option-4',
  'option-5',
  'option-6',
  'option-7',
  'option-8',
  'on-option-1',
  'on-option-2',
  'on-option-3',
  'on-option-4',
  'on-option-5',
  'on-option-6',
  'on-option-7',
  'on-option-8',
] as const;

const tokenColor = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export const colors: Record<string, string> = {
  transparent: 'transparent',
  current: 'currentColor',
  inherit: 'inherit',
  ...Object.fromEntries(TOKENS.map((name) => [name, tokenColor(name)])),
};

// With the default palette gone, a bare `border` / `divide-y` would fall back to the text
// color; point the defaults at the border token instead.
export const defaultBorderColor = tokenColor('border');
