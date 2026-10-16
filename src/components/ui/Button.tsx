import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger' | 'danger-ghost';
type Size = 'sm' | 'md' | 'lg' | 'xl';

interface Common {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  icon?: ReactNode;
  iconOnly?: boolean;
}

function cls({ variant = 'primary', size = 'md', block, iconOnly }: Common, extra?: string) {
  return ['btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', iconOnly && 'btn-icon', extra]
    .filter(Boolean)
    .join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, Common {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, block, icon, iconOnly, loading, children, className, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cls({ variant, size, block, iconOnly }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({ variant, size, block, icon, iconOnly, children, className, ...rest }: LinkProps & Common) {
  return (
    <Link className={cls({ variant, size, block, iconOnly }, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
