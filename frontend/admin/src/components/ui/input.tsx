import { cn } from '../../lib/utils';

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'w-full rounded-lg border border-border-strong bg-surface px-3 py-2',
        'text-fg placeholder:text-fg-subtle',
        ' focus:border-transparent',
        className
      )}
      {...props}
    />
  );
}
