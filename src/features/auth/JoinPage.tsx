import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { applyTheme, cacheBranding, type PublicBranding } from '@/lib/brand';
import { friendlyError } from '@/lib/format';
import { useAuth, PENDING_INVITE_KEY } from '@/auth/AuthProvider';
import { AuthLayout } from './AuthPages';
import { Button } from '@/components/ui/Button';
import { TextField, required, requiredEmail, validate } from '@/components/ui/Form';
import { Alert, EmptyState, LoadingState } from '@/components/ui/Feedback';
import { OrgLogo, Segmented } from '@/components/ui/Misc';

interface InviteInfo {
  org_name: string;
  org_logo_url: string | null;
  org_brand_color: string;
  role: 'admin' | 'employee' | 'client';
  invitee_name: string | null;
  invitee_email: string | null;
  is_expired: boolean;
  is_accepted: boolean;
}

const ROLE_COPY = {
  employee: { title: 'Join the team', body: 'See your assigned jobs, checklists and clock in from your phone.' },
  client: { title: 'Your client portal', body: 'See upcoming appointments, leave notes for the team and share feedback.' },
  admin: { title: 'Join as an admin', body: 'Help manage the schedule, team and clients.' },
};

export function JoinPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { session, refresh, signOut, user } = useAuth();
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  const q = useQuery({
    queryKey: ['invite', token],
    queryFn: async () => {
      const rows = unwrap(await supabase.rpc('get_invitation', { p_token: token })) as InviteInfo[];
      return rows[0] ?? null;
    },
  });
  const inv = q.data;

  useEffect(() => {
    if (inv) {
      applyTheme(inv.org_brand_color, null);
      void supabase.rpc('get_org_branding', { p_token: token }).then(({ data }) => {
        const b = data as PublicBranding | null;
        if (b) { applyTheme(b.brand_color, b.theme); cacheBranding(b); }
      });
      setForm((f) => ({ ...f, fullName: f.fullName || inv.invitee_name || '', email: f.email || inv.invitee_email || '' }));
    }
  }, [inv]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('accept_invitation', { p_token: token });
    if (error) { setBusy(false); return setError(friendlyError(error)); }
    try { localStorage.removeItem(PENDING_INVITE_KEY); } catch { /* ignore */ }
    await refresh();
    setBusy(false);
    navigate(inv?.role === 'client' ? '/portal' : inv?.role === 'employee' ? '/work' : '/dashboard', { replace: true });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const rules = mode === 'signup'
      ? { fullName: required('Your name'), email: requiredEmail, password: (p: unknown) => (String(p).length >= 8 ? null : 'Use at least 8 characters') }
      : { email: requiredEmail, password: required('Password') };
    const v = validate(form, rules);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setError(null);
    try { localStorage.setItem(PENDING_INVITE_KEY, token); } catch { /* ignore */ }
    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: { data: { full_name: form.fullName.trim() }, emailRedirectTo: `${window.location.origin}/join/${token}` },
      });
      setBusy(false);
      if (error) return setError(friendlyError(error));
      if (!data.session) return setCheckEmail(true);
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: form.email.trim(), password: form.password });
      setBusy(false);
      if (error) return setError(friendlyError(error));
    }
    // AuthProvider accepts the pending invite as soon as the new session loads,
    // then the home redirect sends the user to the right app.
    navigate('/', { replace: true });
  };

  const header = inv ? (
    <div className="stack" style={{ alignItems: 'center', ['--gap' as string]: '10px' }}>
      <OrgLogo name={inv.org_name} url={inv.org_logo_url} size="lg" />
      <p className="strong" style={{ fontSize: 18 }}>{inv.org_name}</p>
    </div>
  ) : undefined;

  if (q.isLoading) return <AuthLayout><LoadingState label="Checking your invite…" /></AuthLayout>;
  if (q.error || !inv) {
    return (
      <AuthLayout>
        <EmptyState title="Invite link not found">Double-check the link, or ask the business to send you a new one.</EmptyState>
      </AuthLayout>
    );
  }
  if (inv.is_expired) {
    return <AuthLayout header={header}><EmptyState title="This invite has expired">Ask {inv.org_name} to send you a fresh link.</EmptyState></AuthLayout>;
  }
  if (checkEmail) {
    return (
      <AuthLayout header={header}>
        <div className="empty">
          <div className="icon"><MailCheck /></div>
          <h1 style={{ fontSize: 22 }}>Confirm your email</h1>
          <p>We sent a link to <strong>{form.email}</strong>. Open it to finish joining {inv.org_name}.</p>
        </div>
      </AuthLayout>
    );
  }

  const copy = ROLE_COPY[inv.role];

  if (session) {
    return (
      <AuthLayout header={header}>
        <div className="stack" style={{ ['--gap' as string]: '16px' }}>
          <div>
            <h1>{copy.title}</h1>
            <p className="muted">{copy.body}</p>
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          <p className="small muted">Signed in as <strong>{user?.email}</strong></p>
          <Button size="lg" block onClick={accept} loading={busy}>Join {inv.org_name}</Button>
          <Button variant="ghost" block onClick={() => signOut()}>Use a different account</Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout header={header}>
      <form className="stack" style={{ ['--gap' as string]: '16px' }} onSubmit={submit} noValidate>
        <div>
          <h1>{copy.title}</h1>
          <p className="muted">{copy.body}</p>
        </div>
        {inv.is_accepted && <Alert tone="info">This invite was already used. Sign in with the account that accepted it.</Alert>}
        <Segmented
          label="Account"
          block
          value={mode}
          onChange={setMode}
          options={[{ value: 'signup', label: 'Create account' }, { value: 'signin', label: 'I have an account' }]}
        />
        {error && <Alert tone="error">{error}</Alert>}
        {mode === 'signup' && (
          <TextField label="Your name" autoComplete="name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} error={errors.fullName} />
        )}
        <TextField label="Email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
        <TextField
          label="Password" type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          hint={mode === 'signup' ? 'At least 8 characters' : undefined}
          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={errors.password}
        />
        <Button type="submit" size="lg" block loading={busy}>{mode === 'signup' ? 'Create account & join' : 'Sign in & join'}</Button>
      </form>
    </AuthLayout>
  );
}
