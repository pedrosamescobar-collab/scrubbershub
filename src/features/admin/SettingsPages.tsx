import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bell, Building2, ChevronRight, ClipboardList, CreditCard, LogOut, Star, HardHat, UserRound, UsersRound, Receipt, Package } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { applyTheme, type Theme } from '@/lib/brand';
import { BrandKitEditor } from './BrandKit';
import { TradeSettingsCard } from './TradeSettings';
import { uploadLogo } from '@/lib/storage';
import { useAuth, useWorkspace } from '@/auth/AuthProvider';
import type { Review, Subscription } from '@/lib/types';
import { fmtAgo, fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Switch, TextField, SelectField, optionalEmail, required, validate } from '@/components/ui/Form';
import { EmptyState, QueryState } from '@/components/ui/Feedback';
import { BrandColorPicker, LogoUploader } from '@/components/ui/Branding';
import { Badge, PageHeader, Segmented, Stars } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { OrgSwitcher } from '@/components/layout/AppShell';
import { qk } from '@/features/shared/api';
import { useTrade } from '@/features/shared/useTrade';

export function SettingsPage() {
  const ws = useWorkspace();
  const { refresh } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ name: ws.org.name, phone: ws.org.phone ?? '', email: ws.org.email ?? '', website: ws.org.website ?? '', address: ws.org.address ?? '' });
  const [color, setColor] = useState(ws.org.brand_color);
  const [theme, setTheme] = useState<Theme>(ws.org.theme ?? {});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [uploading, setUploading] = useState(false);
  const s = ws.settings;
  const [ops, setOps] = useState({
    reminder_hours_before: s?.reminder_hours_before ?? 24,
    review_requests_enabled: s?.review_requests_enabled ?? true,
    require_photos_to_complete: s?.require_photos_to_complete ?? false,
    email_notifications: s?.email_notifications ?? true,
    sms_notifications: s?.sms_notifications ?? false,
  });

  // Live preview while editing; put the saved look back when leaving the page.
  useEffect(() => { applyTheme(color, theme); }, [color, theme]);
  useEffect(() => () => applyTheme(ws.org.brand_color, ws.org.theme), [ws.org.brand_color, ws.org.theme]);

  const saveTheme = useMutation({
    mutationFn: async () => {
      const clean: Theme = Object.fromEntries(Object.entries(theme).filter(([, v]) => v !== null && v !== undefined && v !== '')) as Theme;
      return unwrap(await supabase.from('organizations').update({ theme: clean, brand_color: color }).eq('id', ws.org.id));
    },
    onSuccess: async () => { await refresh(); toast.success('Brand kit saved'); },
    onError: (e) => toast.error(e),
  });

  const sub = useQuery({
    queryKey: ['subscription', ws.org.id],
    queryFn: async () => unwrap(await supabase.from('subscriptions').select('*').eq('org_id', ws.org.id).maybeSingle()) as Subscription | null,
  });

  const saveProfile = useMutation({
    mutationFn: async () => unwrap(await supabase.from('organizations').update({
      name: form.name.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null,
      website: form.website.trim() || null, address: form.address.trim() || null, brand_color: color,
    }).eq('id', ws.org.id)),
    onSuccess: async () => { await refresh(); toast.success('Company profile saved'); },
    onError: (e) => toast.error(e),
  });
  const saveOps = useMutation({
    mutationFn: async () => unwrap(await supabase.from('organization_settings').update(ops).eq('org_id', ws.org.id)),
    onSuccess: async () => { await refresh(); toast.success('Settings saved'); },
    onError: (e) => toast.error(e),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validate(form, { name: required('Business name'), email: optionalEmail });
    setErrors(v);
    if (!Object.keys(v).length) saveProfile.mutate();
  };

  const onLogo = async (f: File) => {
    setUploading(true);
    try {
      const url = await uploadLogo(ws.org.id, f);
      unwrap(await supabase.from('organizations').update({ logo_url: url }).eq('id', ws.org.id));
      await refresh();
      toast.success('Logo updated');
    } catch (e) { toast.error(e); } finally { setUploading(false); }
  };

  const trialDays = sub.data?.trial_ends_at ? Math.max(0, Math.ceil((new Date(sub.data.trial_ends_at).getTime() - Date.now()) / 864e5)) : null;

  return (
    <>
      <PageHeader back={{ to: '/more', label: 'More' }} title="Company settings" />
      <div className="stack" style={{ ['--gap' as string]: '16px', maxWidth: 760 }}>
        <form className="card card-pad stack" onSubmit={submit} noValidate>
          <h2>Branding</h2>
          <LogoUploader name={form.name} url={ws.org.logo_url} onFile={onLogo} uploading={uploading} />
          <span className="label">Brand color</span>
          <BrandColorPicker value={color} onChange={setColor} />
          <hr className="divider" />
          <h2>Company profile</h2>
          <div className="form-grid two">
            <TextField className="span-2" label="Business name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
            <TextField label="Phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <TextField label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
            <TextField label="Website" type="url" placeholder="https://" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            <TextField label="Service area / address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="submit" loading={saveProfile.isPending}>Save profile</Button></div>
        </form>

        <TradeSettingsCard />

        <BrandKitEditor theme={theme} onChange={setTheme} onSave={() => saveTheme.mutate()} saving={saveTheme.isPending}
          name={form.name} logoUrl={ws.org.logo_url} />

        <div className="card card-pad stack">
          <h2>Operations</h2>
          <SelectField label="Send reminders" value={ops.reminder_hours_before} onChange={(e) => setOps({ ...ops, reminder_hours_before: Number(e.target.value) })}
            hint="Clients and assigned crew get a reminder this far ahead (automatic when the scheduled function is enabled — see README).">
            {[2, 12, 24, 48, 72].map((h) => <option key={h} value={h}>{h} hours before</option>)}
          </SelectField>
          <Switch label="Ask clients for a review" description="Sent automatically when a job is completed" checked={ops.review_requests_enabled} onChange={(v) => setOps({ ...ops, review_requests_enabled: v })} />
          <Switch label="Require an after photo to complete a job" checked={ops.require_photos_to_complete} onChange={(v) => setOps({ ...ops, require_photos_to_complete: v })} />
          <Switch label="Email notifications" description="Requires an email provider key (RESEND_API_KEY)" checked={ops.email_notifications} onChange={(v) => setOps({ ...ops, email_notifications: v })} />
          <Switch label="Text message notifications" description="Requires Twilio keys" checked={ops.sms_notifications} onChange={(v) => setOps({ ...ops, sms_notifications: v })} />
          <div className="row" style={{ justifyContent: 'flex-end' }}><Button onClick={() => saveOps.mutate()} loading={saveOps.isPending}>Save settings</Button></div>
        </div>

        <div className="card card-pad stack">
          <h2>Plan</h2>
          <QueryState query={sub}>
            {(sd) => (
              <div className="row-between wrap">
                <span>
                  <span className="strong" style={{ textTransform: 'capitalize' }}>{sd?.plan ?? 'Trial'}</span>{' '}
                  <Badge tone={sd?.status === 'active' ? 'green' : sd?.status === 'trialing' ? 'brand' : 'amber'}>{sd?.status ?? 'trialing'}</Badge>
                  {sd?.status === 'trialing' && trialDays !== null && <span className="muted small" style={{ display: 'block' }}>{trialDays} day{trialDays === 1 ? '' : 's'} left in your free trial</span>}
                </span>
                <Button variant="secondary" disabled title="Billing is coming soon">Manage billing</Button>
              </div>
            )}
          </QueryState>
        </div>
      </div>
    </>
  );
}

export function ReviewsPage() {
  const ws = useWorkspace();
  const [filter, setFilter] = useState<'all' | 'low' | 'private'>('all');
  const q = useQuery({
    queryKey: qk.reviews(ws.org.id),
    queryFn: async () => unwrap(await supabase.from('reviews')
      .select('*, client:clients(id, full_name), job:jobs(id, service_name, scheduled_start)')
      .eq('org_id', ws.org.id).order('created_at', { ascending: false })) as Review[],
  });
  return (
    <>
      <PageHeader title="Reviews" />
      <QueryState query={q}>
        {(list) => {
          const avg = list.length ? list.reduce((a, r) => a + r.rating, 0) / list.length : 0;
          const dist = [5, 4, 3, 2, 1].map((n) => ({ n, c: list.filter((r) => r.rating === n).length }));
          const shown = list.filter((r) => filter === 'all' || (filter === 'low' ? r.rating <= 3 : !!r.private_feedback));
          return (
            <>
              <div className="card card-pad row wrap" style={{ ['--gap' as string]: '28px', marginBottom: 16 }}>
                <div className="center">
                  <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>{list.length ? avg.toFixed(1) : '—'}</div>
                  <Stars value={avg} />
                  <p className="subtle">{list.length} review{list.length === 1 ? '' : 's'}</p>
                </div>
                <div className="grow stack" style={{ ['--gap' as string]: '4px', minWidth: 200 }}>
                  {dist.map(({ n, c }) => (
                    <div key={n} className="row small" style={{ ['--gap' as string]: '8px' }}>
                      <span style={{ width: 14 }}>{n}</span>
                      <div className="progress grow"><div style={{ width: `${list.length ? (c / list.length) * 100 : 0}%`, background: '#F5A524' }} /></div>
                      <span className="subtle" style={{ width: 24, textAlign: 'right' }}>{c}</span>
                    </div>
                  ))}
                </div>
              </div>
              <Segmented label="Filter reviews" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'low', label: '3★ & below' }, { value: 'private', label: 'Private feedback' }]} />
              <div className="stack mt-16">
                {shown.length === 0 && <div className="card"><EmptyState icon={<Star />} title="No reviews here yet">When a job is completed, the client is invited to leave a rating from their portal.</EmptyState></div>}
                {shown.map((r) => (
                  <Link key={r.id} to={`/jobs/${r.job_id}`} className="card card-pad card-link stack" style={{ ['--gap' as string]: '6px' }}>
                    <div className="row-between"><span className="strong">{r.client?.full_name}</span><Stars value={r.rating} /></div>
                    {r.body && <p>“{r.body}”</p>}
                    {r.private_feedback && <div className="callout"><div className="label">Private feedback</div><p className="small">{r.private_feedback}</p></div>}
                    <p className="subtle">{r.job?.service_name} · {r.job ? fmtDate(r.job.scheduled_start) : ''} · {fmtAgo(r.created_at)} {r.is_hidden && '· hidden'}</p>
                  </Link>
                ))}
              </div>
            </>
          );
        }}
      </QueryState>
    </>
  );
}

export function MorePage() {
  const tp = useTrade();
  const ws = useWorkspace();
  const { signOut, workspaces, switchOrg, profile, user } = useAuth();
  const navigate = useNavigate();
  const items = [
    { to: '/team', icon: UsersRound, label: 'Team', sub: 'Employees, crews and invites' },
    { to: '/billing/settings', icon: Receipt, label: 'Billing settings', sub: 'Tax, terms, reminders, online payments' },
    { to: '/inventory', icon: Package, label: 'Inventory', sub: 'Supplies, equipment, reorder list' },
    { to: '/checklists', icon: ClipboardList, label: 'Checklists', sub: tp.checklistTemplatesSub },
    { to: '/reviews', icon: Star, label: 'Reviews', sub: 'Ratings and private feedback' },
    { to: '/notifications', icon: Bell, label: 'Notifications', sub: 'Reminders and activity' },
    { to: '/settings', icon: Building2, label: 'Company settings', sub: 'Branding, profile, operations' },
    { to: '/settings', icon: CreditCard, label: 'ScrubHub plan', sub: 'Trial status' },
    ...(ws.employeeId ? [{ to: '/work', icon: HardHat, label: 'My jobs (field app)', sub: 'Clock in and work your checklist' }] : []),
    { to: '/account', icon: UserRound, label: 'My account', sub: profile?.full_name || user?.email || '' },
  ];
  return (
    <>
      <PageHeader title="More" />
      <div className="card list">
        {items.map((i) => (
          <Link key={i.label} to={i.to} className="list-item">
            <span className="avatar"><i.icon size={18} aria-hidden /></span>
            <span className="grow"><span className="strong">{i.label}</span><span className="muted small" style={{ display: 'block' }}>{i.sub}</span></span>
            <ChevronRight size={18} color="var(--text-3)" aria-hidden />
          </Link>
        ))}
      </div>
      {workspaces.length > 1 && <div className="card card-pad mt-16"><OrgSwitcher workspaces={workspaces} currentId={ws.org.id} onSwitch={(id) => { switchOrg(id); navigate('/'); }} /></div>}
      <Button variant="secondary" block className="mt-16" icon={<LogOut />} onClick={async () => { await signOut(); navigate('/login'); }}>Sign out</Button>
      <p className="subtle center mt-16">ScrubHub · {ws.org.name}</p>
    </>
  );
}
