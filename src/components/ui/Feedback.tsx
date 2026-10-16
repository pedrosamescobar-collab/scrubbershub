import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, Inbox } from 'lucide-react';
import { friendlyError } from '@/lib/format';
import { Button } from './Button';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden /> {label}
    </div>
  );
}

export function SkeletonList({ rows = 3, height = 64 }: { rows?: number; height?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Something went wrong' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div className="empty" role="alert">
      <div className="icon" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}><AlertCircle /></div>
      <h3>{title}</h3>
      <p>{friendlyError(error)}</p>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function EmptyState({ icon = <Inbox />, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon" aria-hidden>{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'error' | 'warn' | 'success'; children: ReactNode }) {
  const Icon = tone === 'error' ? AlertCircle : tone === 'warn' ? TriangleAlert : tone === 'success' ? CheckCircle2 : Info;
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** Wraps a React Query result with consistent loading / error UI. */
export function QueryState<T>({
  query, children, skeleton,
}: {
  query: { isLoading: boolean; error: unknown; data: T | undefined; refetch: () => unknown };
  children: (data: T) => ReactNode;
  skeleton?: ReactNode;
}) {
  if (query.isLoading) return <>{skeleton ?? <SkeletonList />}</>;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (query.data === undefined) return null;
  return <>{children(query.data)}</>;
}
