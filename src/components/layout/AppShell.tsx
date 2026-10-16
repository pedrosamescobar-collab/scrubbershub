import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom';
import { Bell, LogOut, Repeat, type LucideIcon } from 'lucide-react';
import { useAuth, useWorkspace } from '@/auth/AuthProvider';
import { OrgLogo } from '@/components/ui/Misc';
import { useNotificationsRealtime, useUnreadCount } from '@/features/shared/notifications';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  desktopOnly?: boolean;
  mobileOnly?: boolean;
}

export function AppShell({
  nav, notificationsPath, sidebarExtra,
}: { nav: NavItem[]; notificationsPath: string; sidebarExtra?: ReactNode }) {
  const ws = useWorkspace();
  const { signOut, workspaces, switchOrg, profile } = useAuth();
  const navigate = useNavigate();
  const unread = useUnreadCount();
  useNotificationsRealtime();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const doSignOut = async () => { await signOut(); navigate('/login'); };

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand-row">
          <OrgLogo name={ws.org.name} url={ws.org.logo_url} />
          <div className="grow">
            <p className="strong truncate">{ws.org.theme?.app_name || ws.org.name}</p>
            <p className="subtle truncate">{profile?.full_name || profile?.email}</p>
          </div>
        </div>
        <nav>
          {nav.filter((n) => !n.mobileOnly).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              <n.icon aria-hidden />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="foot">
          {sidebarExtra}
          {workspaces.length > 1 && <OrgSwitcher workspaces={workspaces} currentId={ws.org.id} onSwitch={(id) => { switchOrg(id); navigate('/'); }} />}
          <button className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={doSignOut}>
            <LogOut aria-hidden /> Sign out
          </button>
          <p className="subtle" style={{ padding: '0 12px' }}>Powered by ScrubHub</p>
        </div>
      </aside>

      <div>
        <header className={`topbar ${scrolled ? 'scrolled' : ''}`}>
          <Link to="/" className="row mobile-only" style={{ color: 'inherit', textDecoration: 'none', minWidth: 0 }}>
            <OrgLogo name={ws.org.name} url={ws.org.logo_url} />
            <span className="org-name truncate">{ws.org.theme?.app_name || ws.org.name}</span>
          </Link>
          <div className="grow" />
          <Link to={notificationsPath} className="icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
            <Bell aria-hidden />
            {unread > 0 && <span className="count">{unread > 9 ? '9+' : unread}</span>}
          </Link>
        </header>
        <main className="main" id="main">
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Main navigation">
        {nav.filter((n) => !n.desktopOnly).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            <n.icon aria-hidden />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function OrgSwitcher({
  workspaces, currentId, onSwitch,
}: { workspaces: { org: { id: string; name: string }; role: string }[]; currentId: string; onSwitch: (id: string) => void }) {
  return (
    <label className="field" style={{ padding: '0 4px' }}>
      <span className="label row" style={{ gap: 6 }}><Repeat size={14} aria-hidden /> Switch workspace</span>
      <select className="select" value={currentId} onChange={(e) => onSwitch(e.target.value)}>
        {workspaces.map((w) => (
          <option key={w.org.id} value={w.org.id}>{w.org.name} ({w.role})</option>
        ))}
      </select>
    </label>
  );
}

export { OrgSwitcher };
