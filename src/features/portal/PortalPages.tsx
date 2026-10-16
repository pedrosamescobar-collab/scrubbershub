import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CalendarDays, ChevronRight, Globe, LogOut, Mail, MapPin, MessageSquare, Phone, Sparkles, Star, Users } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth, useWorkspace } from '@/auth/AuthProvider';
import type { AppNotification, Client, ClientNote, Job } from '@/lib/types';
import { clientAddress, firstName, fmtAgo, fmtDateLong, fmtRelativeDay, fmtTime, fmtTimeRange, greeting } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { TextArea, TextField, required, validate } from '@/components/ui/Form';
import { Alert, EmptyState, QueryState, SkeletonList } from '@/components/ui/Feedback';
import { OrgLogo, PageHeader, ProgressBar, SectionTitle, Segmented, StarInput, Stars, StatusBadge } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { PhotoGallery } from '@/features/shared/components';
import { checklistProgress, useJob, useJobExtras } from '@/features/shared/api';
import { AccountSection } from '@/features/shared/AccountPage';
import { useTrade } from '@/features/shared/useTrade';
import { EquipmentSection } from '@/features/equipment/EquipmentSection';

const PORTAL_SELECT = '*, job_checklist_items(id, is_required, completed_at), reviews(id, rating)';

function usePortalJobs() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: ['portal', 'jobs', ws.clientId],
    enabled: !!ws.clientId,
    refetchInterval: 30_000,
    queryFn: async () => unwrap(await supabase.from('jobs').select(PORTAL_SELECT)
      .eq('client_id', ws.clientId!).order('scheduled_start')) as unknown as Job[],
  });
}

function useCrew(jobId: string | undefined) {
  return useQuery({
    queryKey: ['portal', 'crew', jobId],
    enabled: !!jobId,
    queryFn: async () => unwrap(await supabase.rpc('job_crew_names', { p_job: jobId })) as string | null,
  });
}

function splitJobs(jobs: Job[]) {
  const now = Date.now();
  const upcoming = jobs.filter((j) => (j.status === 'scheduled' || j.status === 'in_progress') && new Date(j.scheduled_end).getTime() > now - 12 * 3600e3);
  const past = jobs.filter((j) => !upcoming.includes(j)).reverse();
  return { upcoming, past };
}

function StatusLine({ job }: { job: Job }) {
  const tp = useTrade();
  const p = checklistProgress(job.job_checklist_items);
  if (job.status === 'in_progress') {
    return (
      <div className="stack" style={{ ['--gap' as string]: '6px' }}>
        <span className="strong" style={{ color: 'var(--amber)' }}>{tp.inProgressLong}</span>
        {p.total > 0 && <><ProgressBar value={p.done} total={p.total} /><span className="subtle">{p.pct}% of tasks done</span></>}
      </div>
    );
  }
  return null;
}

export function PortalHome() {
  const tp = useTrade();
  const ws = useWorkspace();
  const { profile } = useAuth();
  const jobs = usePortalJobs();
  const reminders = useQuery({
    queryKey: ['portal', 'reminders', ws.org.id],
    queryFn: async () => unwrap(await supabase.from('notifications').select('*')
      .eq('org_id', ws.org.id).in('type', ['appointment_reminder', 'review_request', 'invoice_sent', 'invoice_reminder', 'estimate_sent']).is('read_at', null)
      .order('created_at', { ascending: false }).limit(3)) as AppNotification[],
  });
  const next = jobs.data ? splitJobs(jobs.data).upcoming[0] : undefined;
  const crew = useCrew(next?.id);
  const toReview = (jobs.data ?? []).filter((j) => j.status === 'completed' && !(j.reviews ?? []).length).slice(-1)[0];

  if (!ws.clientId) return <div className="card"><EmptyState title="Your client profile isn’t linked yet">Please use the invite link {ws.org.name} sent you.</EmptyState></div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greeting()}{profile?.full_name ? `, ${firstName(profile.full_name)}` : ''}</h1>
          <p className="sub">Welcome to your {ws.org.name} portal</p>
        </div>
      </div>

      {(reminders.data ?? []).map((n) => (
        <Link key={n.id} to={n.link ?? '/portal'} className="card card-pad card-link row" style={{ marginBottom: 12, background: 'var(--brand-softer)', borderColor: 'var(--brand-soft)' }}
          onClick={() => { void supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id); }}>
          <span className="avatar">{n.type === 'review_request' ? <Star size={18} aria-hidden /> : <BellRing size={18} aria-hidden />}</span>
          <span className="grow"><span className="strong">{n.title}</span><span className="muted small" style={{ display: 'block' }}>{n.body}</span></span>
          <ChevronRight size={18} aria-hidden />
        </Link>
      ))}

      <SectionTitle>Next {tp.visit}</SectionTitle>
      <QueryState query={jobs} skeleton={<SkeletonList rows={1} height={170} />}>
        {() => next ? (
          <Link to={`/portal/appointments/${next.id}`} className="card card-pad card-link stack">
            <div className="row-between"><span className="badge badge-brand no-dot">{fmtRelativeDay(next.scheduled_start)}</span><StatusBadge status={next.status} /></div>
            <div>
              <p style={{ fontSize: 22, fontWeight: 800 }}>{fmtDateLong(next.scheduled_start)}</p>
              <p className="muted">{fmtTimeRange(next.scheduled_start, next.scheduled_end)} · {next.service_name}</p>
            </div>
            {crew.data && <p className="row small" style={{ ['--gap' as string]: '6px' }}><Users size={16} aria-hidden /> Your crew: <strong>{crew.data}</strong></p>}
            <StatusLine job={next} />
            <span className="btn btn-soft btn-sm" style={{ alignSelf: 'flex-start' }}><MessageSquare /> Add a note for the crew</span>
          </Link>
        ) : (
          <div className="card"><EmptyState icon={<CalendarDays />} title={`No upcoming ${tp.visits}`}>Contact {ws.org.name} to book your next visit.</EmptyState></div>
        )}
      </QueryState>

      {toReview && (
        <>
          <SectionTitle>How did we do?</SectionTitle>
          <Link to={`/portal/appointments/${toReview.id}`} className="card card-pad card-link row">
            <span className="avatar"><Star size={18} aria-hidden /></span>
            <span className="grow"><span className="strong">Rate your {fmtRelativeDay(toReview.scheduled_start).toLowerCase()} {tp.visit}</span><span className="muted small" style={{ display: 'block' }}>It takes 10 seconds and helps the team.</span></span>
            <ChevronRight size={18} aria-hidden />
          </Link>
        </>
      )}

      <SectionTitle>{ws.org.name}</SectionTitle>
      <div className="card card-pad stack">
        <div className="row"><OrgLogo name={ws.org.name} url={ws.org.logo_url} /><span className="strong">{ws.org.name}</span></div>
        {ws.org.phone && <a className="row" href={`tel:${ws.org.phone}`}><Phone size={18} aria-hidden /> {ws.org.phone}</a>}
        {ws.org.email && <a className="row" href={`mailto:${ws.org.email}`}><Mail size={18} aria-hidden /> {ws.org.email}</a>}
        {ws.org.website && <a className="row" href={ws.org.website} target="_blank" rel="noreferrer"><Globe size={18} aria-hidden /> {ws.org.website.replace(/^https?:\/\//, '')}</a>}
      </div>
    </>
  );
}

export function PortalAppointments() {
  const tp = useTrade();
  const ws = useWorkspace();
  const jobs = usePortalJobs();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  if (!ws.clientId) return null;
  return (
    <>
      <PageHeader title="Appointments" />
      <Segmented label="Appointments" block value={tab} onChange={setTab} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }]} />
      <div className="mt-16">
        <QueryState query={jobs}>
          {(list) => {
            const rows = splitJobs(list)[tab];
            return rows.length === 0 ? (
              <div className="card"><EmptyState icon={<CalendarDays />} title={tab === 'upcoming' ? `No upcoming ${tp.visits}` : `No past ${tp.visits} yet`} /></div>
            ) : (
              <div className="card list">
                {rows.map((j) => (
                  <Link key={j.id} to={`/portal/appointments/${j.id}`} className="list-item">
                    <span className="grow">
                      <span className="row-between"><span className="strong">{fmtRelativeDay(j.scheduled_start)}</span><StatusBadge status={j.status} /></span>
                      <span className="muted small" style={{ display: 'block' }}>{fmtTime(j.scheduled_start)} · {j.service_name}</span>
                      {j.reviews?.[0] && <Stars value={j.reviews[0].rating} />}
                    </span>
                    <ChevronRight size={18} color="var(--text-3)" aria-hidden />
                  </Link>
                ))}
              </div>
            );
          }}
        </QueryState>
      </div>
    </>
  );
}

export function PortalAppointmentDetail() {
  const tp = useTrade();
  const { id = '' } = useParams();
  const ws = useWorkspace();
  const { user, profile } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const job = useJob(id);
  const extras = useJobExtras(id, { includeTime: false, includeNotes: false });
  const crew = useCrew(id);
  const [note, setNote] = useState('');
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [priv, setPriv] = useState('');

  // Mark this appointment's reminder/review notifications as read.
  useEffect(() => {
    if (!user) return;
    void supabase.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id).eq('link', `/portal/appointments/${id}`).is('read_at', null)
      .then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
  }, [id, user, qc]);

  const refresh = () => { void extras.refetch(); void job.refetch(); void qc.invalidateQueries({ queryKey: ['portal'] }); };

  const addNote = useMutation({
    mutationFn: async () => unwrap(await supabase.from('client_notes').insert({
      org_id: ws.org.id, client_id: ws.clientId, job_id: id, author_id: user!.id,
      author_name: profile?.full_name ?? 'Client', from_client: true, body: note.trim(),
    })),
    onSuccess: () => { setNote(''); refresh(); toast.success('Note sent to your crew'); },
    onError: (e) => toast.error(e),
  });

  const review = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('submit_review', { p_job: id, p_rating: rating, p_body: body, p_private: priv })),
    onSuccess: () => { refresh(); toast.success('Thank you for your review!'); },
    onError: (e) => toast.error(e),
  });

  return (
    <QueryState query={job}>
      {(j) => {
        const checklist = extras.data?.checklist ?? [];
        const done = checklist.filter((i) => i.completed_at).length;
        const r = extras.data?.review;
        const canNote = j.status === 'scheduled' || j.status === 'in_progress';
        return (
          <div className="stack" style={{ ['--gap' as string]: '16px', maxWidth: 680 }}>
            <PageHeader back={{ to: '/portal/appointments', label: 'Appointments' }} title={fmtDateLong(j.scheduled_start)}
              sub={<span className="row wrap" style={{ ['--gap' as string]: '8px' }}><StatusBadge status={j.status} />{fmtTimeRange(j.scheduled_start, j.scheduled_end)} · {j.service_name}</span>} />

            <div className="card card-pad stack">
              {j.client && clientAddress(j.client) && <p className="row"><MapPin size={18} aria-hidden />{clientAddress(j.client)}</p>}
              {crew.data && <p className="row"><Users size={18} aria-hidden />Your crew: <strong>{crew.data}</strong></p>}
              {j.status === 'in_progress' && (
                <div className="stack" style={{ ['--gap' as string]: '6px' }}>
                  <p className="strong" style={{ color: 'var(--amber)' }}>{tp.inProgressShort}</p>
                  {checklist.length > 0 && <><ProgressBar value={done} total={checklist.length} size="lg" /><p className="subtle">{done} of {checklist.length} tasks done</p></>}
                </div>
              )}
              {j.status === 'completed' && <Alert tone="success">Completed {j.completed_at ? `at ${fmtTime(j.completed_at)}` : ''}. We hope you love it!</Alert>}
              {j.status === 'cancelled' && <Alert tone="warn">This appointment was cancelled.</Alert>}
            </div>

            {j.status === 'completed' && (
              <div className="card card-pad stack">
                <h2>Your review</h2>
                {r ? (
                  <>
                    <Stars value={r.rating} size="lg" />
                    {r.body && <p>“{r.body}”</p>}
                    {r.admin_response && <div className="note"><p className="label">Reply from {ws.org.name}</p><p className="small pre">{r.admin_response}</p></div>}
                    <p className="subtle">Thanks for your feedback!</p>
                  </>
                ) : (
                  <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); if (!rating) return toast.error('Tap a star to rate'); review.mutate(); }}>
                    <p className="muted">How was your {tp.visit}?</p>
                    <StarInput value={rating} onChange={setRating} />
                    <TextArea label="Tell us more (optional)" placeholder="What did you love?" value={body} onChange={(e) => setBody(e.target.value)} />
                    <TextArea label="Private feedback (optional)" hint={`Only ${ws.org.name} sees this`} placeholder="Anything we could do better?" value={priv} onChange={(e) => setPriv(e.target.value)} style={{ minHeight: 70 }} />
                    <Button type="submit" size="lg" loading={review.isPending} disabled={!rating}>Submit review</Button>
                  </form>
                )}
              </div>
            )}

            {j.status === 'completed' && (extras.data?.photos ?? []).some((p) => p.kind === 'after') && (
              <div className="card card-pad stack">
                <h2>Finished photos</h2>
                <PhotoGallery photos={extras.data!.photos} kind="after" />
              </div>
            )}

            <div className="card card-pad stack">
              <h2>Notes for your crew</h2>
              {(extras.data?.clientNotes ?? []).map((n) => (
                <div key={n.id} className={`note ${n.from_client ? 'from-client' : ''}`}>
                  <div className="row-between"><span className="strong small">{n.from_client ? 'You' : n.author_name ?? ws.org.name}</span><span className="subtle">{fmtAgo(n.created_at)}</span></div>
                  <p className="pre small mt-8">{n.body}</p>
                </div>
              ))}
              {canNote ? (
                <form className="stack" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }}>
                  <TextArea label="Add a note or special instruction" placeholder="e.g. Please focus on the guest bathroom, we have visitors this weekend." value={note} onChange={(e) => setNote(e.target.value)} />
                  <Button type="submit" disabled={!note.trim()} loading={addNote.isPending}>Send note</Button>
                </form>
              ) : !(extras.data?.clientNotes ?? []).length && <p className="subtle">No notes for this visit.</p>}
            </div>
          </div>
        );
      }}
    </QueryState>
  );
}

export function PortalNotes() {
  const ws = useWorkspace();
  const { user, profile } = useAuth();
  const toast = useToast();
  const [body, setBody] = useState('');
  const q = useQuery({
    queryKey: ['portal', 'notes', ws.clientId],
    enabled: !!ws.clientId,
    queryFn: async () => unwrap(await supabase.from('client_notes').select('*').eq('client_id', ws.clientId!).order('created_at', { ascending: false })) as ClientNote[],
  });
  const add = useMutation({
    mutationFn: async () => unwrap(await supabase.from('client_notes').insert({
      org_id: ws.org.id, client_id: ws.clientId, author_id: user!.id, author_name: profile?.full_name ?? 'Client', from_client: true, body: body.trim(),
    })),
    onSuccess: () => { setBody(''); void q.refetch(); toast.success(`Sent to ${ws.org.name}`); },
    onError: (e) => toast.error(e),
  });
  return (
    <>
      <PageHeader title="Notes" sub={`Standing instructions and messages for ${ws.org.name}`} />
      <form className="card card-pad stack" onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(); }}>
        <TextArea label="New note" placeholder="e.g. We got a new puppy — please keep the back door closed." value={body} onChange={(e) => setBody(e.target.value)} />
        <Button type="submit" disabled={!body.trim()} loading={add.isPending}>Send</Button>
      </form>
      <div className="stack mt-16">
        <QueryState query={q}>
          {(list) => list.length === 0 ? <div className="card"><EmptyState icon={<MessageSquare />} title="No notes yet">Anything you send here goes to the office and your crew.</EmptyState></div>
            : list.map((n) => (
              <div key={n.id} className={`note ${n.from_client ? 'from-client' : ''}`}>
                <div className="row-between"><span className="strong small">{n.from_client ? 'You' : n.author_name ?? ws.org.name}</span><span className="subtle">{fmtAgo(n.created_at)}</span></div>
                <p className="pre mt-8">{n.body}</p>
                {n.job_id && <Link to={`/portal/appointments/${n.job_id}`} className="small strong">View appointment</Link>}
              </div>
            ))}
        </QueryState>
      </div>
    </>
  );
}

export function PortalProfile() {
  const tp = useTrade();
  const ws = useWorkspace();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['portal', 'me', ws.clientId],
    enabled: !!ws.clientId,
    queryFn: async () => unwrap(await supabase.from('clients').select('*').eq('id', ws.clientId!).single()) as Client,
  });
  const [form, setForm] = useState({ full_name: '', phone: '', access_instructions: '', cleaning_preferences: '', pets: '' });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  useEffect(() => {
    if (q.data) setForm({
      full_name: q.data.full_name, phone: q.data.phone ?? '', access_instructions: q.data.access_instructions ?? '',
      cleaning_preferences: q.data.cleaning_preferences ?? '', pets: q.data.pets ?? '',
    });
  }, [q.data]);
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('update_my_client_profile', {
      p_client: ws.clientId, p_full_name: form.full_name, p_phone: form.phone || null,
      p_access: form.access_instructions || null, p_prefs: form.cleaning_preferences || null, p_pets: form.pets || null,
    })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['portal', 'me'] }); toast.success('Profile updated'); },
    onError: (e) => toast.error(e),
  });
  return (
    <>
      <PageHeader title="Profile" />
      <QueryState query={q}>
        {(c) => (
          <form className="card card-pad stack" onSubmit={(e) => { e.preventDefault(); const v = validate(form, { full_name: required('Name') }); setErrors(v); if (!Object.keys(v).length) save.mutate(); }} noValidate>
            <h2>Your details</h2>
            <TextField label="Name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} error={errors.full_name} />
            <TextField label="Phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            {clientAddress(c) && <div className="field"><span className="label">Service address</span><p>{clientAddress(c)}</p><span className="hint">To change your address, contact {ws.org.name}.</span></div>}
            <TextArea label="Access instructions" placeholder="Gate code, lockbox, parking…" value={form.access_instructions} onChange={(e) => setForm({ ...form, access_instructions: e.target.value })} />
            <TextArea label={tp.prefsLabel} placeholder={tp.prefsPlaceholder} value={form.cleaning_preferences} onChange={(e) => setForm({ ...form, cleaning_preferences: e.target.value })} />
            <TextField label="Pets" value={form.pets} onChange={(e) => setForm({ ...form, pets: e.target.value })} />
            <Button type="submit" loading={save.isPending} icon={<Sparkles />}>Save</Button>
          </form>
        )}
      </QueryState>
      {tp.features.equipment && ws.clientId && <div className="mt-16"><EquipmentSection orgId={ws.org.id} clientId={ws.clientId} mode="client" trade={tp.key} /></div>}
      <div className="mt-16"><AccountSection showProfile={false} /></div>
      <Button variant="secondary" block className="mt-16" icon={<LogOut />} onClick={async () => { await signOut(); navigate('/login'); }}>Sign out</Button>
    </>
  );
}
