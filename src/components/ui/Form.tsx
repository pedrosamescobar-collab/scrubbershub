import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface FieldWrap {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
}

function Wrap({ id, label, hint, error, className, children }: FieldWrap & { id: string; children: ReactNode }) {
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      {label && <label htmlFor={id}>{label}</label>}
      {children}
      {error ? (
        <span className="error-text" id={`${id}-err`} role="alert">{error}</span>
      ) : hint ? (
        <span className="hint" id={`${id}-hint`}>{hint}</span>
      ) : null}
    </div>
  );
}

export function TextField({ label, hint, error, className, id, ...rest }: FieldWrap & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Wrap id={fid} label={label} hint={hint} error={error} className={className}>
      <input
        id={fid}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fid}-err` : hint ? `${fid}-hint` : undefined}
        {...rest}
      />
    </Wrap>
  );
}

export function TextArea({ label, hint, error, className, id, ...rest }: FieldWrap & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Wrap id={fid} label={label} hint={hint} error={error} className={className}>
      <textarea id={fid} className="textarea" aria-invalid={error ? true : undefined} {...rest} />
    </Wrap>
  );
}

export function SelectField({
  label, hint, error, className, id, children, ...rest
}: FieldWrap & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Wrap id={fid} label={label} hint={hint} error={error} className={className}>
      <select id={fid} className="select" aria-invalid={error ? true : undefined} {...rest}>
        {children}
      </select>
    </Wrap>
  );
}

export function Switch({
  checked, onChange, label, description, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="row-between" style={{ padding: '10px 0' }}>
      <div className="grow">
        <label htmlFor={id} className="strong" style={{ cursor: 'pointer' }}>{label}</label>
        {description && <p className="subtle">{description}</p>}
      </div>
      <span className="switch">
        <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span aria-hidden onClick={() => !disabled && onChange(!checked)} />
      </span>
    </div>
  );
}

/** Simple required/email validation helper for small forms. */
export function validate<T extends Record<string, unknown>>(
  values: T,
  rules: Partial<Record<keyof T, (v: unknown, all: T) => string | null>>,
) {
  const errors: Partial<Record<keyof T, string>> = {};
  for (const key of Object.keys(rules) as (keyof T)[]) {
    const msg = rules[key]!(values[key], values);
    if (msg) errors[key] = msg;
  }
  return errors;
}

export const required = (label: string) => (v: unknown) => (String(v ?? '').trim() ? null : `${label} is required`);
export const optionalEmail = (v: unknown) =>
  !String(v ?? '').trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()) ? null : 'Enter a valid email';
export const requiredEmail = (v: unknown) =>
  !String(v ?? '').trim() ? 'Email is required' : optionalEmail(v);
