import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { applyTheme, cacheBranding, cachedBranding, type PublicBranding } from '@/lib/brand';
import { OrgLogo } from '@/components/ui/Misc';
import { Sparkles, MailCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { TextField, required, requiredEmail, validate } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';

export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="mark"><Sparkles aria-hidden /></span>
      ScrubHub
    </span>
  );
}

/** The company this device last used (or opened through its /c/<link>). */
function CompanyHeader({ b, onForget }: { b: PublicBranding; onForget: () => void }) {
  return (
    <div className="stack center" style={{ ['--gap' as string]: '8px', alignItems: 'center' }}>
      <OrgLogo name={b.name} url={b.logo_url} size="lg" />
      <p className="strong" style={{ fontSize: 20 }}>{b.theme?.app_name || b.name}</p>
      {b.theme?.tagline && <p className="muted small">{b.theme.tagline}</p>}
      <button type="button" className="subtle" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={onForget}>
        Not with {b.name}?
      </button>
    </div>
  );
}

export function AuthLayout({ children, header, branded = true }: { children: ReactNode; header?: ReactNode; branded?: boolean }) {
  const [b, setB] = useState<PublicBranding | null>(() => (branded ? cachedBranding() : null));
  const forget = () => { cacheBranding(null); applyTheme(null, {}); setB(null); };
  useEffect(() => { if (b) applyTheme(b.brand_color, b.theme); else if (!branded) applyTheme(null, {}); }, [b, branded]);
  return (
    <div className="auth-wrap">
      <div className="auth-card stack" style={{ ['--gap' as string]: '20px' }}>
        <div className="center">{header ?? (b ? <CompanyHeader b={b} onForget={forget} /> : <Wordmark />)}</div>
        <div className="card">{children}</div>
        {b && !header && <p className="subtle center">Powered by ScrubHub</p>}
      </div>
    </div>
  );
}

/** /c/:slug — a company's own sign-in link. Loads its look, then shows the login screen. */
export function CompanyLinkPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    supabase.rpc('get_org_branding', { p_slug: slug }).then(({ data }) => {
      if (!alive) return;
      const b = data as PublicBranding | null;
      if (!b) return setMissing(true);
      cacheBranding(b);
      applyTheme(b.brand_color, b.theme);
      navigate('/login', { replace: true });
    });
    return () => { alive = false; };
  }, [slug, navigate]);
  if (missing) {
    return (
      <AuthLayout branded={false}>
        <div className="stack center" style={{ padding: 24 }}>
          <h1 style={{ fontSize: 20 }}>Company link not found</h1>
          <p className="muted">Check the link with your company, or sign in below.</p>
          <Link to="/login" className="btn btn-primary">Go to sign in</Link>
        </div>
      </AuthLayout>
    );
  }
  return <div className="auth-wrap" role="status" aria-label="Loading"><span className="spinner" style={{ width: 28, height: 28, color: 'var(--brand)' }} /></div>;
}

export function LoginPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validate({ email, password }, { email: requiredEmail, password: required('Password') });
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(friendlyError(error));
    // on success PublicOnly redirects automatically
  };

  return (
    <AuthLayout>
      <form className="stack" style={{ ['--gap' as string]: '16px' }} onSubmit={submit} noValidate>
        <div>
          <h1>Welcome back</h1>
          <p className="muted">Sign in to your ScrubHub account.</p>
        </div>
        {params.get('reset') === '1' && <Alert tone="success">Password updated. Sign in with your new password.</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <TextField label="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <div className="row-between">
          <span />
          <Link to="/forgot-password" className="small strong">Forgot password?</Link>
        </div>
        <Button type="submit" size="lg" block loading={busy}>Sign in</Button>
        <p className="center muted small">
          New business? <Link to="/signup" className="strong">Create your workspace</Link>
        </p>
        <p className="center subtle">Employees and clients: use the invite link your company sent you.</p>
      </form>
    </AuthLayout>
  );
}

export function SignupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validate(form, {
      fullName: required('Your name'),
      email: requiredEmail,
      password: (p) => (String(p).length >= 8 ? null : 'Use at least 8 characters'),
    });
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: { data: { full_name: form.fullName.trim() }, emailRedirectTo: `${window.location.origin}/onboarding` },
    });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    if (data.session) navigate('/onboarding');
    else setSentTo(form.email.trim());
  };

  if (sentTo) {
    return (
      <AuthLayout branded={false}>
        <div className="empty">
          <div className="icon"><MailCheck /></div>
          <h1 style={{ fontSize: 22 }}>Check your email</h1>
          <p>We sent a confirmation link to <strong>{sentTo}</strong>. Open it on this device to finish setting up your business.</p>
          <Link to="/login" className="btn btn-secondary mt-8">Back to sign in</Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout branded={false}>
      <form className="stack" style={{ ['--gap' as string]: '16px' }} onSubmit={submit} noValidate>
        <div className="steps" aria-label="Step 1 of 9"><span className="current" />{Array.from({ length: 8 }).map((_, i) => <span key={i} />)}</div>
        <div>
          <h1>Create your account</h1>
          <p className="muted">Set up your cleaning or plumbing business in about 5 minutes. Free 14-day trial.</p>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <TextField label="Your name" autoComplete="name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} error={errors.fullName} />
        <TextField label="Work email" type="email" autoComplete="email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
        <TextField label="Password" type="password" autoComplete="new-password" hint="At least 8 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={errors.password} />
        <Button type="submit" size="lg" block loading={busy}>Create account</Button>
        <p className="center muted small">Already have an account? <Link to="/login" className="strong">Sign in</Link></p>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const m = requiredEmail(email);
    setErr(m ?? undefined);
    if (m) return;
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    setBusy(false);
    if (error) setError(friendlyError(error));
    else setSent(true);
  };

  return (
    <AuthLayout>
      {sent ? (
        <div className="empty">
          <div className="icon"><MailCheck /></div>
          <h1 style={{ fontSize: 22 }}>Check your inbox</h1>
          <p>If an account exists for <strong>{email}</strong>, you’ll get a link to reset your password.</p>
          <Link to="/login" className="btn btn-secondary mt-8">Back to sign in</Link>
        </div>
      ) : (
        <form className="stack" style={{ ['--gap' as string]: '16px' }} onSubmit={submit} noValidate>
          <div>
            <h1>Reset password</h1>
            <p className="muted">We’ll email you a secure link.</p>
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={err} />
          <Button type="submit" size="lg" block loading={busy}>Send reset link</Button>
          <p className="center small"><Link to="/login" className="strong">Back to sign in</Link></p>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Supabase exchanges the recovery token from the URL and signs the user in.
    const { data } = supabase.auth.onAuthStateChange((evt, session) => {
      if (evt === 'PASSWORD_RECOVERY' || session) setReady(true);
    });
    supabase.auth.getSession().then(({ data: d }) => d.session && setReady(true));
    return () => data.subscription.unsubscribe();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validate({ password, confirm }, {
      password: (p) => (String(p).length >= 8 ? null : 'Use at least 8 characters'),
      confirm: (c, all) => (c === all.password ? null : 'Passwords don’t match'),
    });
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    toast.success('Password updated');
    navigate('/');
  };

  return (
    <AuthLayout>
      <form className="stack" style={{ ['--gap' as string]: '16px' }} onSubmit={submit} noValidate>
        <div>
          <h1>Choose a new password</h1>
          <p className="muted">You’ll use it the next time you sign in.</p>
        </div>
        {!ready && <Alert tone="warn">Open this page from the link in your reset email. Links expire after an hour.</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <TextField label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <TextField label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
        <Button type="submit" size="lg" block loading={busy} disabled={!ready}>Update password</Button>
      </form>
    </AuthLayout>
  );
}
