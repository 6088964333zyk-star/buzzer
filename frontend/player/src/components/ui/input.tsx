import { cn } from '../../lib/utils';

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'w-full rounded-xl border border-border-strong bg-surface px-4 py-3',
        'text-fg placeholder:text-fg-subtle text-base',
        ' focus:border-transparent',
        className
      )}
      {...props}
    />
  );
}
