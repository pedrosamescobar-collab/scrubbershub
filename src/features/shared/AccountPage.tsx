import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, LayoutDashboard } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { Button, ButtonLink } from '@/components/ui/Button';
import { TextField, required, validate } from '@/components/ui/Form';
import { OrgLogo, PageHeader } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';

/** Name / phone / password — shared by every role. */
export function AccountSection({ showProfile = true }: { showProfile?: boolean }) {
  const { user, profile, refresh } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ full_name: '', phone: '' });
  const [pw, setPw] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState<'profile' | 'pw' | null>(null);

  useEffect(() => { setForm({ full_name: profile?.full_name ?? '', phone: profile?.phone ?? '' }); }, [profile]);

  const saveProfile = async () => {
    const v = validate(form, { full_name: required('Name') });
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy('profile');
    const { error } = await supabase.from('profiles').update({ full_name: form.full_name.trim(), phone: form.phone.trim() || null }).eq('id', user!.id);
    setBusy(null);
    if (error) return toast.error(error);
    await refresh();
    toast.success('Profile saved');
  };

  const savePw = async () => {
    const v = validate(pw, {
      password: (p) => (String(p).length >= 8 ? null : 'Use at least 8 characters'),
      confirm: (c, all) => (c === all.password ? null : 'Passwords don’t match'),
    });
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy('pw');
    const { error } = await supabase.auth.updateUser({ password: pw.password });
    setBusy(null);
    if (error) return toast.error(error);
    setPw({ password: '', confirm: '' });
    toast.success('Password changed');
  };

  return (
    <div className="stack" style={{ ['--gap' as string]: '16px' }}>
      {showProfile && (
        <form className="card card-pad stack" onSubmit={(e) => { e.preventDefault(); void saveProfile(); }} noValidate>
          <h2>Your profile</h2>
          <TextField label="Email" value={user?.email ?? ''} disabled hint="Contact support to change your sign-in email" />
          <TextField label="Name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} error={errors.full_name} />
          <TextField label="Phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Button type="submit" loading={busy === 'profile'}>Save profile</Button>
        </form>
      )}
      <form className="card card-pad stack" onSubmit={(e) => { e.preventDefault(); void savePw(); }} noValidate>
        <h2>Change password</h2>
        <TextField label="New password" type="password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} error={errors.password} />
        <TextField label="Confirm new password" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} error={errors.confirm} />
        <Button type="submit" variant="secondary" loading={busy === 'pw'}>Update password</Button>
      </form>
    </div>
  );
}

export function AccountPage({ backTo }: { backTo?: { to: string; label: string } }) {
  const { signOut, workspace } = useAuth();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader back={backTo} title="My account" />
      {workspace && (
        <div className="card card-pad row" style={{ marginBottom: 16 }}>
          <OrgLogo name={workspace.org.name} url={workspace.org.logo_url} />
          <span className="grow"><span className="strong">{workspace.org.name}</span><span className="subtle" style={{ display: 'block', textTransform: 'capitalize' }}>{workspace.role}</span></span>
          {workspace.isAdmin && <ButtonLink to="/dashboard" size="sm" variant="soft" icon={<LayoutDashboard />}>Admin</ButtonLink>}
        </div>
      )}
      <AccountSection />
      <Button variant="secondary" block className="mt-16" icon={<LogOut />} onClick={async () => { await signOut(); navigate('/login'); }}>Sign out</Button>
    </>
  );
}
