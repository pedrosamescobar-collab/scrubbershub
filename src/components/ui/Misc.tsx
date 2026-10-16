import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Star } from 'lucide-react';
import { initials, STATUS_META } from '@/lib/format';
import type { JobStatus } from '@/lib/types';

export function Badge({ tone = 'gray', children, dot = true }: { tone?: 'blue' | 'amber' | 'green' | 'gray' | 'red' | 'brand'; children: ReactNode; dot?: boolean }) {
  return <span className={`badge badge-${tone} ${dot ? '' : 'no-dot'}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: JobStatus }) {
  const m = STATUS_META[status] ?? { label: status, tone: 'gray' as const };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function Avatar({ name, color, size, src }: { name?: string | null; color?: string | null; size?: 'sm' | 'lg'; src?: string | null }) {
  return (
    <span
      className={`avatar ${size ?? ''}`}
      style={color ? { background: color, color: '#fff' } : undefined}
      aria-hidden
      title={name ?? undefined}
    >
      {src ? <img src={src} alt="" /> : initials(name)}
    </span>
  );
}

export function OrgLogo({ name, url, size }: { name?: string | null; url?: string | null; size?: 'lg' }) {
  if (url) {
    return (
      <span className={`logo-box ${size ?? ''}`}>
        <img src={url} alt={`${name ?? 'Company'} logo`} />
      </span>
    );
  }
  return <span className={`logo-box fallback ${size ?? ''}`} aria-hidden>{initials(name)}</span>;
}

export function ProgressBar({ value, total, size }: { value: number; total: number; size?: 'lg' }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div
      className={`progress ${size ?? ''} ${pct === 100 ? 'done' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={`${value} of ${total} complete`}
    >
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ProgressRing({ value, total, size = 56 }: { value: number; total: number; size?: number }) {
  const pct = total ? value / total : 0;
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ ['--size' as string]: `${size}px` }} role="img" aria-label={`${Math.round(pct * 100)}% complete`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--gray-soft)" strokeWidth="7" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={pct >= 1 ? 'var(--green)' : 'var(--brand)'} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: 'stroke-dashoffset .3s' }}
        />
      </svg>
      <span className="ring-label">{Math.round(pct * 100)}%</span>
    </div>
  );
}

export function Stars({ value, size }: { value: number; size?: 'lg' }) {
  return (
    <span className={`stars ${size ?? ''}`} aria-label={`${value} out of 5 stars`} role="img">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} fill={i <= Math.round(value) ? 'currentColor' : 'none'} strokeWidth={i <= Math.round(value) ? 0 : 1.8} />
      ))}
    </span>
  );
}

export function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="stars lg" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={`${i} star${i > 1 ? 's' : ''}`}
          onClick={() => onChange(i)}
        >
          <Star fill={i <= value ? 'currentColor' : 'none'} strokeWidth={i <= value ? 0 : 1.6} />
        </button>
      ))}
    </div>
  );
}

export function PageHeader({
  title, sub, actions, back,
}: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="page-head">
      <div className="grow">
        {back && (
          <Link to={back.to} className="back-link"><ChevronLeft aria-hidden />{back.label}</Link>
        )}
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value, onChange, options, block, label,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; block?: boolean; label: string }) {
  return (
    <div className={`segmented ${block ? 'block' : ''}`} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="section-title">
      <h2>{children}</h2>
      {action}
    </div>
  );
}
