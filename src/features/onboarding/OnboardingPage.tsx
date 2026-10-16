import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, ClipboardList, PartyPopper, Sparkles, UserRound, Wrench } from 'lucide-react';
import { addDays, format } from 'date-fns';
import { useAuth } from '@/auth/AuthProvider';
import { supabase, unwrap } from '@/lib/supabase';
import { applyBrand, DEFAULT_BRAND } from '@/lib/brand';
import { uploadLogo } from '@/lib/storage';
import { friendlyError } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { TextField, SelectField, optionalEmail, required, validate } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Feedback';
import { BrandColorPicker, LogoUploader } from '@/components/ui/Branding';
import { OrgLogo } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { Wordmark } from '@/features/auth/AuthPages';
import { Splash } from '@/auth/guards';
import { starterTemplatesFor, installStarterTemplate } from '@/features/checklists/starterTemplates';
import { InviteLinkModal } from '@/features/shared/components';
import { inviteUrl } from '@/features/shared/api';
import { useTrade } from '@/features/shared/useTrade';
import { TRADES } from '@/lib/trades';
import type { Trade } from '@/lib/types';

const STEPS = ['Account', 'Business', 'Logo', 'Color', 'Team', 'Client', 'Checklist', 'First job', 'Done'];
const TOTAL = STEPS.length;

export function OnboardingPage() {
  const { loading, workspace, user, profile, refresh } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState<number | null>(null);

  // Resume where the owner left off.
  useEffect(() => {
    if (loading) return;
    if (!workspace) setStep(2);
    else if (step === null) setStep(Math.max(3, workspace.settings?.onboarding_step ?? 3));
  }, [loading, workspace, step]);

  if (loading || step === null) return <Splash />;
  if (workspace && !workspace.isAdmin) return <Navigate to="/" replace />;
  if (workspace?.settings?.onboarding_completed_at && step < TOTAL) return <Navigate to="/dashboard" replace />;

  const orgId = workspace?.org.id;

  const go = async (next: number) => {
    setStep(next);
    window.scrollTo(0, 0);
    if (orgId) {
      await supabase.from('organization_settings').update({ onboarding_step: next }).eq('org_id', orgId);
    }
  };

  const finish = async () => {
    if (!orgId) return;
    const { error } = await supabase.from('organization_settings')
      .update({ onboarding_step: TOTAL, onboarding_completed_at: new Date().toISOString() }).eq('org_id', orgId);
    if (error) return toast.error(error);
    await refresh();
    navigate('/dashboard', { replace: true });
  };

  const common = { orgId: orgId!, next: () => go(step + 1), back: () => go(step - 1) };

  return (
    <div className="auth-wrap" style={{ alignItems: 'start' }}>
      <div className="auth-card stack" style={{ maxWidth: 560, ['--gap' as string]: '18px', paddingTop: 12 }}>
        <div className="row-between">
          {workspace ? (
            <span className="row"><OrgLogo name={workspace.org.name} url={workspace.org.logo_url} /><span className="strong">{workspace.org.name}</span></span>
          ) : <Wordmark />}
          <span className="subtle">Step {step} of {TOTAL}</span>
        </div>
        <div className="steps" role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL} aria-valuenow={step} aria-label={`Setup step ${step} of ${TOTAL}: ${STEPS[step - 1]}`}>
          {STEPS.map((s, i) => <span key={s} className={i + 1 < step ? 'done' : i + 1 === step ? 'current' : ''} />)}
        </div>
        <div className="card card-pad">
          {step === 2 && <BusinessStep defaultName={workspace?.org.name ?? ''} ownerName={profile?.full_name ?? ''} onDone={async () => { await refresh(); setStep(3); }} />}
          {step === 3 && workspace && <LogoStep {...common} name={workspace.org.name} logo={workspace.org.logo_url} onSaved={refresh} />}
          {step === 4 && workspace && <ColorStep {...common} name={workspace.org.name} logo={workspace.org.logo_url} color={workspace.org.brand_color} onSaved={refresh} />}
          {step === 5 && workspace && <TeamStep {...common} orgName={workspace.org.name} userId={user!.id} ownerName={profile?.full_name || user?.email || 'Me'} onSaved={refresh} />}
          {step === 6 && workspace && <ClientStep {...common} />}
          {step === 7 && workspace && <ChecklistStep {...common} />}
          {step === 8 && workspace && <FirstJobStep {...common} />}
          {step === 9 && workspace && <DoneStep onFinish={finish} back={common.back} />}
        </div>
      </div>
    </div>
  );
}

function StepHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h1>{title}</h1>
      {children && <p className="muted mt-8">{children}</p>}
    </div>
  );
}

function StepNav({ back, next, nextLabel = 'Continue', skip, loading, disabled, type = 'button' }: {
  back?: () => void; next?: () => void; nextLabel?: string; skip?: () => void; loading?: boolean; disabled?: boolean; type?: 'button' | 'submit';
}) {
  return (
    <div className="stack mt-24" style={{ ['--gap' as string]: '8px' }}>
      <Button type={type} size="lg" block onClick={type === 'button' ? next : undefined} loading={loading} disabled={disabled}>{nextLabel}</Button>
      <div className="row-between">
        {back ? <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={back}>Back</Button> : <span />}
        {skip && <Button variant="ghost" size="sm" onClick={skip}>Skip for now</Button>}
      </div>
    </div>
  );
}

/* ---- Step 2: business name ---- */
function BusinessStep({ defaultName, ownerName, onDone }: { defaultName: string; ownerName: string; onDone: () => void }) {
  const [name, setName] = useState(defaultName);
  const [trade, setTrade] = useState<Trade>('cleaning');
  const [err, setErr] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const m = required('Business name')(name);
    setErr(m ?? undefined);
    if (m) return;
    setBusy(true);
    const { error } = await supabase.rpc('create_organization', { p_name: name.trim(), p_brand_color: DEFAULT_BRAND, p_trade: trade });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    onDone();
  };
  return (
    <form onSubmit={submit} noValidate>
      <StepHead title={`Welcome${ownerName ? `, ${ownerName.split(' ')[0]}` : ''}! What’s your business called?`}>
        This is what your team and clients will see in the app.
      </StepHead>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="stack" style={{ ['--gap' as string]: '8px', marginBottom: 14 }}>
        <span className="label">What kind of business?</span>
        <div className="form-grid two" role="radiogroup" aria-label="Type of business">
          {(Object.values(TRADES)).map((t) => (
            <button key={t.key} type="button" role="radio" aria-checked={trade === t.key} className="option-card" onClick={() => setTrade(t.key)}
              style={trade === t.key ? { borderColor: 'var(--brand)', boxShadow: '0 0 0 3px var(--brand-ring)' } : undefined}>
              <span className="avatar">{t.key === 'plumbing' ? <Wrench size={18} aria-hidden /> : <Sparkles size={18} aria-hidden />}</span>
              <span className="grow">
                <span className="strong">{t.label}</span>
                <span className="subtle" style={{ display: 'block' }}>{t.key === 'plumbing' ? 'Service calls, parts, equipment, emergencies' : 'Recurring visits, checklists, crews'}</span>
              </span>
              {trade === t.key && <Check aria-hidden color="var(--brand-strong)" />}
            </button>
          ))}
        </div>
      </div>
      <TextField label="Business name" placeholder={TRADES[trade].bizPlaceholder} value={name} onChange={(e) => setName(e.target.value)} error={err} autoFocus />
      <StepNav type="submit" loading={busy} nextLabel="Create my workspace" />
    </form>
  );
}

/* ---- Step 3: logo ---- */
function LogoStep({ orgId, name, logo, next, back, onSaved }: { orgId: string; name: string; logo: string | null; next: () => void; back: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const onFile = async (f: File) => {
    setBusy(true);
    try {
      const url = await uploadLogo(orgId, f);
      unwrap(await supabase.from('organizations').update({ logo_url: url }).eq('id', orgId));
      await onSaved();
      toast.success('Logo uploaded');
    } catch (e) { toast.error(e); }
    finally { setBusy(false); }
  };
  return (
    <>
      <StepHead title="Add your logo">It appears on your team’s app and your clients’ portal.</StepHead>
      <LogoUploader name={name} url={logo} onFile={onFile} uploading={busy} />
      <StepNav back={back} next={next} skip={logo ? undefined : next} nextLabel={logo ? 'Continue' : 'Continue without logo'} disabled={busy} />
    </>
  );
}

/* ---- Step 4: color ---- */
function ColorStep({ orgId, name, logo, color, next, back, onSaved }: { orgId: string; name: string; logo: string | null; color: string; next: () => void; back: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [value, setValue] = useState(color);
  const [busy, setBusy] = useState(false);
  useEffect(() => { applyBrand(value); }, [value]);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from('organizations').update({ brand_color: value }).eq('id', orgId);
    setBusy(false);
    if (error) return toast.error(error);
    await onSaved();
    next();
  };
  return (
    <>
      <StepHead title="Pick your brand color">Used for buttons and highlights across your workspace.</StepHead>
      <BrandColorPicker value={value} onChange={setValue} />
      <div className="card card-pad mt-16" style={{ background: 'var(--surface-2)' }} aria-label="Preview">
        <div className="row"><OrgLogo name={name} url={logo} /><span className="strong">{name}</span></div>
        <div className="row mt-16 wrap">
          <Button size="sm">Clock in</Button>
          <span className="badge badge-brand">Today</span>
          <span style={{ width: 120 }}><div className="progress"><div style={{ width: '65%' }} /></div></span>
        </div>
      </div>
      <StepNav back={back} next={save} loading={busy} />
    </>
  );
}

/* ---- Step 5: first team member ---- */
function TeamStep({ orgId, orgName, userId, ownerName, next, back, onSaved }: {
  orgId: string; orgName: string; userId: string; ownerName: string; next: () => void; back: () => void; onSaved: () => Promise<void>;
}) {
  const tp = useTrade();
  const toast = useToast();
  const existing = useQuery({
    queryKey: ['onb-employees', orgId],
    queryFn: async () => unwrap(await supabase.from('employees').select('id, full_name, user_id').eq('org_id', orgId)) as { id: string; full_name: string; user_id: string | null }[],
  });
  const iWork = (existing.data ?? []).some((e) => e.user_id === userId);
  const [form, setForm] = useState({ full_name: '', phone: '', email: '' });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<{ url: string; name: string } | null>(null);

  const toggleSelf = async () => {
    setBusy(true);
    try {
      if (iWork) {
        const me = existing.data!.find((e) => e.user_id === userId)!;
        unwrap(await supabase.from('employees').delete().eq('id', me.id));
      } else {
        unwrap(await supabase.from('employees').insert({ org_id: orgId, full_name: ownerName, user_id: userId, role_title: 'Owner' }));
      }
      await existing.refetch();
      await onSaved();
    } catch (e) { toast.error(e); }
    finally { setBusy(false); }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const v = validate(form, { full_name: required('Name'), email: optionalEmail });
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const emp = unwrap(await supabase.from('employees').insert({
        org_id: orgId, full_name: form.full_name.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null,
      }).select('id').single()) as { id: string };
      const inv = unwrap(await supabase.from('invitations').insert({
        org_id: orgId, role: 'employee', employee_id: emp.id, email: form.email.trim() || null, created_by: userId,
      }).select('token').single()) as { token: string };
      setInvite({ url: inviteUrl(inv.token), name: form.full_name.trim() });
      setForm({ full_name: '', phone: '', email: '' });
      await existing.refetch();
    } catch (err) { toast.error(err); }
    finally { setBusy(false); }
  };

  const others = (existing.data ?? []).filter((e) => e.user_id !== userId);

  return (
    <>
      <StepHead title={tp.whoDoesWork}>Add your first team member. They’ll get a private link to set up their account.</StepHead>
      <button type="button" className="option-card" aria-pressed={iWork} onClick={toggleSelf} disabled={busy}>
        <span className="avatar"><UserRound size={18} aria-hidden /></span>
        <span className="grow">
          <span className="strong">{tp.selfWorkLabel}</span>
          <span className="subtle" style={{ display: 'block' }}>Adds you to the team so you can be assigned jobs and use the field app.</span>
        </span>
        {iWork && <Check aria-hidden color="var(--brand-strong)" />}
      </button>

      {others.length > 0 && (
        <div className="stack mt-16" style={{ ['--gap' as string]: '6px' }}>
          {others.map((e) => <div key={e.id} className="row"><Check size={16} color="var(--green)" aria-hidden /> {e.full_name}</div>)}
        </div>
      )}

      <form className="stack mt-16" onSubmit={add} noValidate>
        <p className="label">Add a team member</p>
        <TextField label="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} error={errors.full_name} />
        <div className="form-grid two">
          <TextField label="Mobile (optional)" type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <TextField label="Email (optional)" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
        </div>
        <Button type="submit" variant="secondary" loading={busy}>Add & get invite link</Button>
      </form>

      <StepNav back={back} next={next} skip={!iWork && !others.length ? next : undefined} />
      <InviteLinkModal open={!!invite} onClose={() => setInvite(null)} url={invite?.url ?? null} name={invite?.name ?? ''} role="employee" orgName={orgName} />
    </>
  );
}

/* ---- Step 6: first client ---- */
function ClientStep({ orgId, next, back }: { orgId: string; next: () => void; back: () => void }) {
  const toast = useToast();
  const existing = useQuery({
    queryKey: ['onb-clients', orgId],
    queryFn: async () => unwrap(await supabase.from('clients').select('id, full_name').eq('org_id', orgId).limit(5)) as { id: string; full_name: string }[],
  });
  const [form, setForm] = useState({ full_name: '', phone: '', email: '', address_line1: '', city: '', state: '', postal_code: '' });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const v = validate(form, { full_name: required('Client name'), email: optionalEmail });
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || null]));
      unwrap(await supabase.from('clients').insert({ org_id: orgId, ...clean }));
      toast.success('Client added');
      next();
    } catch (err) { toast.error(err); }
    finally { setBusy(false); }
  };

  if (existing.data?.length) {
    return (
      <>
        <StepHead title="Your first client">You already added:</StepHead>
        {existing.data.map((c) => <div key={c.id} className="row"><Check size={16} color="var(--green)" aria-hidden /> {c.full_name}</div>)}
        <StepNav back={back} next={next} />
      </>
    );
  }

  return (
    <form onSubmit={save} noValidate>
      <StepHead title="Add your first client">You can add access codes, pets and preferences later.</StepHead>
      <div className="form-grid two">
        <TextField className="span-2" label="Client name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} error={errors.full_name} />
        <TextField label="Phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <TextField label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
        <TextField className="span-2" label="Street address" autoComplete="street-address" value={form.address_line1} onChange={(e) => setForm({ ...form, address_line1: e.target.value })} />
        <TextField label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <div className="form-grid two">
          <TextField label="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          <TextField label="ZIP" inputMode="numeric" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} />
        </div>
      </div>
      <StepNav type="submit" back={back} skip={next} loading={busy} nextLabel="Save client" />
    </form>
  );
}

/* ---- Step 7: checklist ---- */
function ChecklistStep({ orgId, next, back }: { orgId: string; next: () => void; back: () => void }) {
  const tp = useTrade();
  const toast = useToast();
  const existing = useQuery({
    queryKey: ['onb-templates', orgId],
    queryFn: async () => unwrap(await supabase.from('checklist_templates').select('id, name').eq('org_id', orgId)) as { id: string; name: string }[],
  });
  const templates = starterTemplatesFor(tp.key);
  const [picked, setPicked] = useState<string[]>(templates.slice(0, 2).map((t) => t.key));
  const [busy, setBusy] = useState(false);
  const installed = new Set((existing.data ?? []).map((t) => t.name));

  const save = async () => {
    setBusy(true);
    try {
      for (const t of templates.filter((t) => picked.includes(t.key) && !installed.has(t.name))) {
        await installStarterTemplate(orgId, t);
      }
      next();
    } catch (e) { toast.error(e); }
    finally { setBusy(false); }
  };

  return (
    <>
      <StepHead title={tp.checklistTitle}>{tp.checklistSub}</StepHead>
      <div className="stack">
        {templates.map((t) => {
          const on = picked.includes(t.key) || installed.has(t.name);
          const count = t.sections.reduce((n, s) => n + s.items.length, 0);
          return (
            <button
              key={t.key}
              type="button"
              className="option-card"
              role="checkbox"
              aria-checked={on}
              disabled={installed.has(t.name)}
              onClick={() => setPicked((p) => (p.includes(t.key) ? p.filter((x) => x !== t.key) : [...p, t.key]))}
            >
              <span className="avatar"><ClipboardList size={18} aria-hidden /></span>
              <span className="grow">
                <span className="strong">{t.name}</span>
                <span className="subtle" style={{ display: 'block' }}>{t.description} · {t.sections.length} {tp.key === 'plumbing' ? 'stages' : 'rooms'} · {count} tasks</span>
              </span>
              {on && <Check aria-hidden color="var(--brand-strong)" />}
            </button>
          );
        })}
      </div>
      <StepNav back={back} next={save} loading={busy} skip={next} nextLabel={picked.length ? 'Add checklists' : 'Continue'} />
    </>
  );
}

/* ---- Step 8: first job ---- */
function FirstJobStep({ orgId, next, back }: { orgId: string; next: () => void; back: () => void }) {
  const tp = useTrade();
  const toast = useToast();
  const data = useQuery({
    queryKey: ['onb-job-data', orgId],
    queryFn: async () => {
      const [c, e, t] = await Promise.all([
        supabase.from('clients').select('id, full_name').eq('org_id', orgId).order('created_at'),
        supabase.from('employees').select('id, full_name').eq('org_id', orgId).eq('status', 'active').order('created_at'),
        supabase.from('checklist_templates').select('id, name').eq('org_id', orgId).eq('is_archived', false).order('created_at'),
      ]);
      return {
        clients: unwrap(c) as { id: string; full_name: string }[],
        employees: unwrap(e) as { id: string; full_name: string }[],
        templates: unwrap(t) as { id: string; name: string }[],
      };
    },
  });
  const tomorrow = useMemo(() => format(addDays(new Date(), 1), 'yyyy-MM-dd'), []);
  const [form, setForm] = useState({ client_id: '', date: tomorrow, time: '09:00', duration: '120', template: '', employee: '', recurrence: 'none' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data.data) {
      setForm((f) => ({
        ...f,
        client_id: f.client_id || data.data.clients[0]?.id || '',
        template: f.template || data.data.templates[0]?.id || '',
        employee: f.employee || data.data.employees[0]?.id || '',
      }));
    }
  }, [data.data]);

  if (data.isLoading) return <Splash />;
  if (!data.data?.clients.length) {
    return (
      <>
        <StepHead title="Schedule your first job">Add a client first — then you can book them from the calendar anytime.</StepHead>
        <StepNav back={back} next={next} nextLabel="Continue" />
      </>
    );
  }

  const save = async () => {
    setBusy(true);
    const starts = new Date(`${form.date}T${form.time}`);
    const { error } = await supabase.rpc('schedule_appointment', {
      p: {
        org_id: orgId, client_id: form.client_id, service_name: data.data!.templates.find((t) => t.id === form.template)?.name ?? tp.serviceDefault,
        checklist_template_id: form.template || null, starts_at: starts.toISOString(), duration_minutes: Number(form.duration),
        recurrence: form.recurrence, employee_ids: form.employee ? [form.employee] : [], team_ids: [],
      },
    });
    setBusy(false);
    if (error) return toast.error(error);
    toast.success('First job scheduled');
    next();
  };

  return (
    <>
      <StepHead title="Schedule your first job">Pick a client, a time and who’s going.</StepHead>
      <div className="form-grid two">
        <SelectField className="span-2" label="Client" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
          {data.data.clients.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
        </SelectField>
        <TextField label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <TextField label="Start time" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
        <SelectField label="Duration" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })}>
          {[60, 90, 120, 150, 180, 240, 300, 360, 480].map((m) => <option key={m} value={m}>{m / 60} hr{m > 60 ? 's' : ''}</option>)}
        </SelectField>
        <SelectField label="Repeats" value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })}>
          <option value="none">Does not repeat</option><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option>
        </SelectField>
        <SelectField label="Checklist" value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })}>
          <option value="">No checklist</option>
          {data.data.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </SelectField>
        <SelectField label="Assign to" value={form.employee} onChange={(e) => setForm({ ...form, employee: e.target.value })}>
          <option value="">Unassigned</option>
          {data.data.employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </SelectField>
      </div>
      <StepNav back={back} next={save} skip={next} loading={busy} nextLabel="Schedule job" />
    </>
  );
}

function DoneStep({ onFinish, back }: { onFinish: () => void; back: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="empty" style={{ padding: '12px 0' }}>
      <div className="icon"><PartyPopper /></div>
      <h1>You’re all set!</h1>
      <p>Your workspace is ready. Next up: invite the rest of your team and send clients their portal links.</p>
      <div className="stack mt-16" style={{ width: '100%' }}>
        <Button size="lg" block loading={busy} onClick={() => { setBusy(true); onFinish(); }}>Go to my dashboard</Button>
        <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={back}>Back</Button>
      </div>
    </div>
  );
}
