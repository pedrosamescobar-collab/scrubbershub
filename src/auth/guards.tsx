import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, type Workspace } from './AuthProvider';
import type { Role } from '@/lib/types';

export function Splash() {
  return (
    <div className="auth-wrap" role="status" aria-label="Loading">
      <span className="spinner" style={{ width: 28, height: 28, color: 'var(--brand)' }} />
    </div>
  );
}

export function homePathFor(ws: Workspace | null): string {
  if (!ws) return '/onboarding';
  if (ws.isAdmin) return ws.settings?.onboarding_completed_at ? '/dashboard' : '/onboarding';
  if (ws.role === 'employee') return '/work';
  return '/portal';
}

/** Requires a signed-in user. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session } = useAuth();
  const loc = useLocation();
  if (loading) return <Splash />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

/**
 * Requires a workspace where the user holds one of `roles`.
 * UI gating only — the database enforces the same rules with RLS.
 */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { loading, session, workspace } = useAuth();
  const loc = useLocation();
  if (loading) return <Splash />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!workspace) return <Navigate to="/onboarding" replace />;
  const ok =
    roles.includes(workspace.role) ||
    // an owner/admin who also works jobs can use the field app
    (roles.includes('employee') && !!workspace.employeeId);
  if (!ok) return <Navigate to={homePathFor(workspace)} replace />;
  return <>{children}</>;
}

export function HomeRedirect() {
  const { loading, session, workspace } = useAuth();
  if (loading) return <Splash />;
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={homePathFor(workspace)} replace />;
}

/** Keeps signed-in users away from login/signup screens. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { loading, session, workspace } = useAuth();
  const loc = useLocation();
  if (loading) return <Splash />;
  if (session) {
    const next = new URLSearchParams(loc.search).get('next');
    return <Navigate to={next && next.startsWith('/') ? next : homePathFor(workspace)} replace />;
  }
  return <>{children}</>;
}
