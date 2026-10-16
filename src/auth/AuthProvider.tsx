import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { applyTheme, applyAppIdentity, cacheBranding, cachedBranding } from '@/lib/brand';
import type { Membership, Organization, OrganizationSettings, Profile, Role } from '@/lib/types';

const ACTIVE_ORG_KEY = 'scrubhub.activeOrg';
export const PENDING_INVITE_KEY = 'scrubhub.pendingInvite';

const ROLE_RANK: Record<Role, number> = { owner: 4, admin: 3, employee: 2, client: 1 };

export interface Workspace {
  org: Organization;
  settings: OrganizationSettings | null;
  role: Role;             // highest role in this org
  isAdmin: boolean;
  employeeId: string | null; // if the user is also a field worker here
  clientId: string | null;   // if the user is a client here
  billingAccess: boolean;    // admin, or an employee granted read-only billing
}

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  memberships: Membership[];
  workspace: Workspace | null;
  workspaces: { org: Organization; role: Role }[];
  switchOrg: (orgId: string) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(() => {
    try { return localStorage.getItem(ACTIVE_ORG_KEY); } catch { return null; }
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession((prev) => (prev?.user.id === s?.user.id && prev?.access_token === s?.access_token ? prev : s));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  const load = useCallback(async () => {
    if (!userId) {
      setProfile(null); setMemberships([]); setWorkspace(null); setLoadedFor(null);
      return;
    }
    setLoadingData(true);
    try {
      // Accept an invitation the user started before confirming their email.
      let pending: string | null = null;
      try { pending = localStorage.getItem(PENDING_INVITE_KEY); } catch { /* ignore */ }
      if (pending) {
        const { data } = await supabase.rpc('accept_invitation', { p_token: pending });
        try { localStorage.removeItem(PENDING_INVITE_KEY); } catch { /* ignore */ }
        const joined = Array.isArray(data) ? data[0] : null;
        if (joined?.joined_org_id) {
          setActiveOrgId(joined.joined_org_id);
          try { localStorage.setItem(ACTIVE_ORG_KEY, joined.joined_org_id); } catch { /* ignore */ }
        }
      }

      const [p, m] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
        supabase.from('memberships').select('*, organization:organizations(*)').eq('user_id', userId).eq('status', 'active'),
      ]);
      setProfile((p.data as Profile) ?? null);
      const ms = ((m.data as Membership[]) ?? []).filter((x) => x.organization);
      setMemberships(ms);
    } finally {
      setLoadingData(false);
      setLoadedFor(userId);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  // Pick one org per user as the active workspace (highest role wins inside an org).
  const workspaces = useMemo(() => {
    const byOrg = new Map<string, { org: Organization; role: Role }>();
    for (const m of memberships) {
      const cur = byOrg.get(m.org_id);
      if (!cur || ROLE_RANK[m.role] > ROLE_RANK[cur.role]) byOrg.set(m.org_id, { org: m.organization!, role: m.role });
    }
    return [...byOrg.values()].sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role]);
  }, [memberships]);

  const resolveWorkspace = useCallback(async () => {
    if (!userId || !workspaces.length) { setWorkspace(null); const c = cachedBranding(); applyTheme(c?.brand_color, c?.theme); return; }
    const chosen = workspaces.find((w) => w.org.id === activeOrgId) ?? workspaces[0];
    const [settings, emp, cli] = await Promise.all([
      supabase.from('organization_settings').select('*').eq('org_id', chosen.org.id).maybeSingle(),
      supabase.from('employees').select('id, billing_access').eq('org_id', chosen.org.id).eq('user_id', userId).eq('status', 'active').maybeSingle(),
      supabase.from('clients').select('id').eq('org_id', chosen.org.id).eq('user_id', userId).maybeSingle(),
    ]);
    setWorkspace({
      org: chosen.org,
      settings: (settings.data as OrganizationSettings) ?? null,
      role: chosen.role,
      isAdmin: chosen.role === 'owner' || chosen.role === 'admin',
      employeeId: (emp.data as { id: string } | null)?.id ?? null,
      billingAccess: chosen.role === 'owner' || chosen.role === 'admin' || !!(emp.data as { billing_access?: boolean } | null)?.billing_access,
      clientId: (cli.data as { id: string } | null)?.id ?? null,
    });
    applyTheme(chosen.org.brand_color, chosen.org.theme);
    applyAppIdentity(chosen.org.theme?.app_name || chosen.org.name, chosen.org.logo_url);
    cacheBranding({ name: chosen.org.name, slug: chosen.org.slug, logo_url: chosen.org.logo_url, brand_color: chosen.org.brand_color, theme: chosen.org.theme, trade: chosen.org.trade });
  }, [userId, workspaces, activeOrgId]);

  useEffect(() => { void resolveWorkspace(); }, [resolveWorkspace]);

  const switchOrg = useCallback((orgId: string) => {
    setActiveOrgId(orgId);
    try { localStorage.setItem(ACTIVE_ORG_KEY, orgId); } catch { /* ignore */ }
    qc.clear();
  }, [qc]);

  const refresh = useCallback(async () => { await load(); }, [load]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    qc.clear();
    setWorkspace(null);
    const c = cachedBranding();
    applyTheme(c?.brand_color, c?.theme);
    document.title = c?.name ?? 'ScrubHub';
  }, [qc]);

  // Still resolving if: session unknown, loading data, or we have orgs but haven't built the workspace yet.
  const loading =
    !sessionReady ||
    loadingData ||
    (!!userId && loadedFor !== userId) ||
    (!!userId && workspaces.length > 0 && !workspace);

  const value: AuthState = {
    loading,
    session,
    user: session?.user ?? null,
    profile,
    memberships,
    workspace,
    workspaces,
    switchOrg,
    refresh,
    signOut,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

/** For screens that only render inside a resolved workspace. */
export function useWorkspace(): Workspace {
  const { workspace } = useAuth();
  if (!workspace) throw new Error('No active workspace');
  return workspace;
}
