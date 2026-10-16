import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, endOfDay, startOfDay, startOfWeek, subDays } from 'date-fns';
import {
  Camera, Check, CheckCircle2, ChevronRight, Clock, KeyRound, MapPin, MessageSquare, Navigation, PawPrint, Phone, Play, Sparkles, Square, StickyNote, CalendarDays, ImagePlus,
} from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth, useWorkspace } from '@/auth/AuthProvider';
import type { Job, JobChecklistItem, PhotoKind, TimeEntry } from '@/lib/types';
import { clientAddress, firstName, fmtDate, fmtDuration, fmtRelativeDay, fmtTime, fmtTimeRange, friendlyError, greeting, mapsUrl, minutesBetween } from '@/lib/format';
import { uploadJobPhoto } from '@/lib/storage';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/Form';
import { Alert, EmptyState, QueryState, SkeletonList } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Modal';
import { PageHeader, ProgressBar, ProgressRing, SectionTitle, Segmented, StatusBadge } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { PhotoGallery } from '@/features/shared/components';
import { NotificationsPage } from '@/features/shared/notifications';
import { JOB_LIST_SELECT, checklistProgress, qk, useInvalidateJobs, useJob, useJobExtras } from '@/features/shared/api';
import { groupChecklist } from '@/features/admin/JobDetailPage';
import { JobSuppliesCard } from '@/features/inventory/components';
import { PriorityBadge } from '@/features/shared/priority';
import { EquipmentSection } from '@/features/equipment/EquipmentSection';
import { useTrade } from '@/features/shared/useTrade';

/** Jobs assigned to me (directly or via one of my teams). Admins who also clean only see their own here. */
function useMyJobs(from: Date, to: Date, key: string) {
  const ws = useWorkspace();
  return useQuery({
    queryKey: ['my-jobs', ws.org.id, ws.employeeId, key],
    enabled: !!ws.employeeId,
    queryFn: async () => {
      const teams = unwrap(await supabase.from('team_members').select('team_id').eq('employee_id', ws.employeeId!)) as { team_id: string }[];
      const or = [`employee_id.eq.${ws.employeeId}`, ...(teams.length ? [`team_id.in.(${teams.map((t) => t.team_id).join(',')})`] : [])].join(',');
      return unwrap(
        await supabase.from('jobs')
          .select(`${JOB_LIST_SELECT}, mine:job_assignments!inner(id, employee_id, team_id)`)
          .eq('org_id', ws.org.id)
          .or(or, { referencedTable: 'mine' })
          .gte('scheduled_start', from.toISOString()).lt('scheduled_start', to.toISOString())
          .order('scheduled_start'),
      ) as unknown as Job[];
    },
  });
}

function WorkJobCard({ job }: { job: Job }) {
  const p = checklistProgress(job.job_checklist_items);
  return (
    <Link to={`/work/jobs/${job.id}`} className="card card-pad card-link stack" style={{ ['--gap' as string]: '10px' }}>
      <div className="row-between">
        <span className="strong" style={{ fontSize: 17 }}>{fmtTime(job.scheduled_start)}</span>
        <span className="row" style={{ ['--gap' as string]: '6px' }}><PriorityBadge priority={job.priority} /><StatusBadge status={job.status} /></span>
      </div>
      <div>
        <p className="strong" style={{ fontSize: 17 }}>{job.client?.full_name}</p>
        <p className="muted small">{job.service_name} · until {fmtTime(job.scheduled_end)}</p>
        {job.client && clientAddress(job.client) && <p className="muted small row" style={{ ['--gap' as string]: '4px', marginTop: 4 }}><MapPin size={14} aria-hidden />{clientAddress(job.client)}</p>}
      </div>
      {p.total > 0 && job.status !== 'cancelled' && (
        <div className="row"><div className="grow"><ProgressBar value={p.done} total={p.total} /></div><span className="subtle">{p.done}/{p.total}</span></div>
      )}
      <span className="row strong small" style={{ color: 'var(--brand-strong)', ['--gap' as string]: '4px' }}>
        {job.status === 'completed' ? 'View job' : job.status === 'in_progress' ? 'Continue job' : 'Open job'}<ChevronRight size={16} aria-hidden />
      </span>
    </Link>
  );
}

function NoEmployeeRecord() {
  return (
    <div className="card"><EmptyState title="You’re not on the team roster">Ask your manager to add you as an employee, then open your invite link.</EmptyState></div>
  );
}

export function TodayPage() {
  const ws = useWorkspace();
  const { profile } = useAuth();
  const now = useMemo(() => new Date(), []);
  const today = useMyJobs(startOfDay(now), endOfDay(now), 'today');
  const next = useMyJobs(addDays(startOfDay(now), 1), addDays(startOfDay(now), 8), 'next7');
  if (!ws.employeeId) return <NoEmployeeRecord />;
  const active = (today.data ?? []).filter((j) => j.status !== 'cancelled');
  const remaining = active.filter((j) => j.status !== 'completed').length;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greeting()}{profile?.full_name ? `, ${firstName(profile.full_name)}` : ''}</h1>
          <p className="sub">{today.data ? (active.length ? `${remaining} of ${active.length} job${active.length === 1 ? '' : 's'} left today` : 'No jobs today') : ' '}</p>
        </div>
      </div>
      <QueryState query={today} skeleton={<SkeletonList rows={2} height={150} />}>
        {() => active.length === 0 ? (
          <div className="card"><EmptyState icon={<CalendarDays />} title="Nothing on your schedule today">Enjoy the break. Upcoming jobs are below.</EmptyState></div>
        ) : (
          <div className="stack">{active.map((j) => <WorkJobCard key={j.id} job={j} />)}</div>
        )}
      </QueryState>
      <SectionTitle action={<Link to="/work/jobs" className="small strong">All jobs</Link>}>Coming up</SectionTitle>
      <QueryState query={next}>
        {(list) => {
          const upcoming = list.filter((j) => j.status !== 'cancelled').slice(0, 5);
          return upcoming.length === 0 ? <p className="subtle">No jobs in the next week.</p> : (
            <div className="card list">
              {upcoming.map((j) => (
                <Link key={j.id} to={`/work/jobs/${j.id}`} className="list-item">
                  <span className="grow">
                    <span className="row" style={{ ['--gap' as string]: '6px' }}><span className="strong">{fmtRelativeDay(j.scheduled_start)} · {fmtTime(j.scheduled_start)}</span><PriorityBadge priority={j.priority} /></span>
                    <span className="muted small" style={{ display: 'block' }}>{j.client?.full_name} · {j.service_name}</span>
                  </span>
                  <ChevronRight size={18} color="var(--text-3)" aria-hidden />
                </Link>
              ))}
            </div>
          );
        }}
      </QueryState>
    </>
  );
}

export function MyJobsPage() {
  const ws = useWorkspace();
  const [tab, setTab] = useState<'upcoming' | 'completed'>('upcoming');
  const now = useMemo(() => new Date(), []);
  const upcoming = useMyJobs(startOfDay(now), addDays(now, 45), 'upcoming');
  const past = useMyJobs(subDays(now, 60), addDays(startOfDay(now), 1), 'past');
  if (!ws.employeeId) return <NoEmployeeRecord />;
  const q = tab === 'upcoming' ? upcoming : past;
  return (
    <>
      <PageHeader title="My jobs" />
      <Segmented label="Jobs" block value={tab} onChange={setTab} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'completed', label: 'Completed' }]} />
      <div className="mt-16">
        <QueryState query={q}>
          {(list) => {
            const rows = tab === 'upcoming'
              ? list.filter((j) => j.status === 'scheduled' || j.status === 'in_progress')
              : [...list].filter((j) => j.status === 'completed').reverse();
            return rows.length === 0 ? (
              <div className="card"><EmptyState icon={<CalendarDays />} title={tab === 'upcoming' ? 'No upcoming jobs' : 'No completed jobs yet'} /></div>
            ) : (
              <div className="card list">
                {rows.map((j) => {
                  const p = checklistProgress(j.job_checklist_items);
                  return (
                    <Link key={j.id} to={`/work/jobs/${j.id}`} className="list-item">
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="row-between"><span className="strong">{fmtDate(j.scheduled_start)}</span><span className="row" style={{ ['--gap' as string]: '6px' }}><PriorityBadge priority={j.priority} /><StatusBadge status={j.status} /></span></span>
                        <span className="muted small truncate" style={{ display: 'block' }}>{fmtTime(j.scheduled_start)} · {j.client?.full_name} · {j.service_name}</span>
                        {p.total > 0 && j.status === 'in_progress' && <div className="mt-8"><ProgressBar value={p.done} total={p.total} /></div>}
                      </span>
                    </Link>
                  );
                })}
              </div>
            );
          }}
        </QueryState>
      </div>
    </>
  );
}

function useTicker(active: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const i = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, [active]);
}

function fmtClock(fromIso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function WorkJobPage() {
  const { id = '' } = useParams();
  const job = useJob(id);
  const extras = useJobExtras(id);
  return (
    <QueryState query={job} skeleton={<SkeletonList rows={3} height={140} />}>
      {(j) => <WorkJobView job={j} extras={extras} />}
    </QueryState>
  );
}

function WorkJobView({ job, extras }: { job: Job; extras: ReturnType<typeof useJobExtras> }) {
  const tp = useTrade();
  const ws = useWorkspace();
  const { user, profile } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const invalidate = useInvalidateJobs();
  const [note, setNote] = useState('');
  const [confirmDone, setConfirmDone] = useState(false);
  const [uploading, setUploading] = useState<PhotoKind | null>(null);

  const data = extras.data;
  const myEntries = (data?.time ?? []).filter((t) => t.employee_id === ws.employeeId);
  const open = myEntries.find((t) => !t.clock_out_at);
  const worked = myEntries.reduce((m, t) => m + minutesBetween(t.clock_in_at, t.clock_out_at), 0);
  useTicker(!!open);

  const checklist = data?.checklist ?? [];
  const done = checklist.filter((i) => i.completed_at).length;
  const requiredLeft = checklist.filter((i) => i.is_required && !i.completed_at).length;
  const locked = job.status === 'completed' || job.status === 'cancelled';
  const c = job.client;

  const refresh = () => invalidate(job.id);

  const clock = useMutation({
    mutationFn: async (dir: 'in' | 'out') => unwrap(await supabase.rpc(dir === 'in' ? 'clock_in' : 'clock_out', { p_job: job.id })) as TimeEntry,
    onSuccess: (_d, dir) => { refresh(); toast.success(dir === 'in' ? tp.clockInToast : 'Clocked out'); },
    onError: (e) => toast.error(e),
  });

  const toggle = useMutation({
    mutationFn: async (it: JobChecklistItem) => unwrap(await supabase.rpc('set_checklist_item', { p_item: it.id, p_done: !it.completed_at })),
    onMutate: async (it) => {
      await qc.cancelQueries({ queryKey: qk.jobExtras(job.id) });
      qc.setQueriesData({ queryKey: qk.jobExtras(job.id) }, (old: typeof data) => old && ({
        ...old,
        checklist: old.checklist.map((x) => (x.id === it.id ? { ...x, completed_at: x.completed_at ? null : new Date().toISOString() } : x)),
      }));
    },
    onError: (e) => { toast.error(e); refresh(); },
    onSettled: () => { if (job.status === 'scheduled') void qc.invalidateQueries({ queryKey: qk.job(job.id) }); void qc.invalidateQueries({ queryKey: qk.jobExtras(job.id) }); void qc.invalidateQueries({ queryKey: ['my-jobs'] }); },
  });

  const addNote = useMutation({
    mutationFn: async () => unwrap(await supabase.from('job_notes').insert({
      org_id: job.org_id, job_id: job.id, author_id: user!.id, author_name: profile?.full_name ?? 'Crew', body: note.trim(),
    })),
    onSuccess: () => { setNote(''); refresh(); toast.success('Note added'); },
    onError: (e) => toast.error(e),
  });

  const complete = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('complete_job', { p_job: job.id })),
    onSuccess: () => { setConfirmDone(false); refresh(); toast.success('Job complete. Nice work!'); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    onError: (e) => { setConfirmDone(false); toast.error(e); },
  });

  const upload = async (kind: PhotoKind, files: FileList | null) => {
    if (!files?.length) return;
    setUploading(kind);
    let ok = 0;
    for (const f of Array.from(files)) {
      try { await uploadJobPhoto(job.org_id, job.id, kind, f, user!.id); ok++; }
      catch (e) { toast.error(`Photo failed: ${friendlyError(e)}`); }
    }
    setUploading(null);
    if (ok) { refresh(); toast.success(`${ok} ${kind} photo${ok === 1 ? '' : 's'} uploaded`); }
  };

  const clientNotes = data?.clientNotes ?? [];

  return (
    <div className="stack" style={{ ['--gap' as string]: '16px', maxWidth: 720, margin: '0 auto' }}>
      <Link to="/work" className="back-link">← Today</Link>

      <div className="work-hero stack" style={{ ['--gap' as string]: '10px' }}>
        <div className="row-between">
          <span className="meta">{fmtRelativeDay(job.scheduled_start)} · {fmtTimeRange(job.scheduled_start, job.scheduled_end)}</span>
          <span className="badge no-dot" style={{ background: 'rgba(255,255,255,.2)', color: 'inherit' }}>{job.status === 'in_progress' ? 'In progress' : job.status === 'completed' ? 'Completed' : job.status === 'cancelled' ? 'Cancelled' : 'Scheduled'}</span>
        </div>
        <h1 style={{ color: 'inherit', fontSize: 26 }}>{c?.full_name}</h1>
        <p className="meta">{job.service_name}</p>
        {job.priority && job.priority !== 'normal' && (
          <span className="badge no-dot" style={{ background: job.priority === 'emergency' ? 'var(--red)' : 'var(--amber)', color: '#fff', alignSelf: 'flex-start' }}>
            {job.priority === 'emergency' ? 'Emergency — go now' : 'Urgent'}
          </span>
        )}
        <div className="row wrap" style={{ marginTop: 4 }}>
          {mapsUrl(c) && <a className="btn btn-sm" style={{ background: 'rgba(255,255,255,.18)', color: 'inherit' }} href={mapsUrl(c)!} target="_blank" rel="noreferrer"><Navigation aria-hidden /> Directions</a>}
          {c?.phone && <a className="btn btn-sm" style={{ background: 'rgba(255,255,255,.18)', color: 'inherit' }} href={`tel:${c.phone}`}><Phone aria-hidden /> Call</a>}
        </div>
        {c && clientAddress(c) && <p className="meta row" style={{ ['--gap' as string]: '6px' }}><MapPin size={15} aria-hidden />{clientAddress(c)}</p>}
      </div>

      {job.status === 'completed' && <Alert tone="success">Completed at {fmtTime(job.completed_at!)}. Thanks for your hard work!</Alert>}
      {job.status === 'cancelled' && <Alert tone="warn">This job was cancelled{job.cancel_reason ? `: ${job.cancel_reason}` : '.'}</Alert>}

      {!locked && (
        <div className="card card-pad clock-card">
          <span className="avatar lg" style={open ? { background: 'var(--green-soft)', color: 'var(--green)' } : undefined}><Clock aria-hidden /></span>
          <div className="grow">
            {open ? (
              <>
                <p className="subtle">On the clock since {fmtTime(open.clock_in_at)}</p>
                <p className="timer" aria-live="off">{fmtClock(open.clock_in_at)}</p>
              </>
            ) : (
              <>
                <p className="strong">{myEntries.length ? 'Clocked out' : 'Ready to start?'}</p>
                <p className="subtle">{myEntries.length ? `${fmtDuration(worked)} logged on this job` : 'Clock in when you arrive'}</p>
              </>
            )}
          </div>
          {open ? (
            <Button size="lg" variant="secondary" icon={<Square />} loading={clock.isPending} onClick={() => clock.mutate('out')}>Clock out</Button>
          ) : (
            <Button size="lg" icon={<Play />} loading={clock.isPending} onClick={() => clock.mutate('in')}>Clock in</Button>
          )}
        </div>
      )}

      {(c?.access_instructions || c?.pets || c?.cleaning_preferences || job.appointment?.internal_notes || clientNotes.length > 0) && (
        <div className="card card-pad stack">
          <h2>Before you start</h2>
          {c?.access_instructions && <div className="callout"><div className="label"><KeyRound aria-hidden />Access</div><p className="pre">{c.access_instructions}</p></div>}
          {c?.pets && <div className="callout"><div className="label"><PawPrint aria-hidden />Pets</div><p>{c.pets}</p></div>}
          {c?.cleaning_preferences && <div className="callout"><div className="label"><Sparkles aria-hidden />Client preferences</div><p className="pre">{c.cleaning_preferences}</p></div>}
          {job.appointment?.internal_notes && <div className="callout"><div className="label"><StickyNote aria-hidden />From the office</div><p className="pre">{job.appointment.internal_notes}</p></div>}
          {clientNotes.map((n) => (
            <div key={n.id} className="callout"><div className="label"><MessageSquare aria-hidden />{n.from_client ? 'Note from client' : 'Office note'}</div><p className="pre">{n.body}</p></div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div>
            <h2>Checklist</h2>
            <p className="subtle">{checklist.length ? `${done} of ${checklist.length} tasks${requiredLeft ? ` · ${requiredLeft} required left` : ''}` : 'No checklist for this job'}</p>
          </div>
          {checklist.length > 0 && <ProgressRing value={done} total={checklist.length} />}
        </div>
        {extras.isLoading ? <div className="card-body"><SkeletonList rows={4} height={52} /></div> : (
          <div className="mt-8">
            {groupChecklist(checklist).map(([section, items]) => {
              const sd = items.filter((i) => i.completed_at).length;
              return (
                <div key={section}>
                  <div className="room-head" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}>
                    <span className="strong">{section}</span>
                    <span className={sd === items.length ? 'badge badge-green' : 'subtle'}>{sd === items.length ? 'Done' : `${sd}/${items.length}`}</span>
                  </div>
                  {items.map((it) => (
                    <button key={it.id} className="task" role="checkbox" aria-checked={!!it.completed_at} disabled={locked}
                      onClick={() => toggle.mutate(it)}>
                      <span className="box" aria-hidden><Check /></span>
                      <span className="lbl grow">{it.label}</span>
                      {it.is_required && !it.completed_at && <span className="req">Required</span>}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card card-pad stack">
        <h2>Photos</h2>
        {(['before', 'after'] as PhotoKind[]).map((kind) => (
          <div key={kind} className="stack" style={{ ['--gap' as string]: '8px' }}>
            <p className="label">{kind === 'before' ? 'Before' : 'After'}</p>
            <div className="photo-grid">
              <PhotoUploadTile kind={kind} disabled={locked || !!uploading} uploading={uploading === kind} onFiles={(f) => upload(kind, f)} />
            </div>
            <PhotoGallery photos={data?.photos ?? []} kind={kind} emptyText="" />
          </div>
        ))}
      </div>

      {tp.features.equipment && c && <EquipmentSection orgId={job.org_id} clientId={c.id} jobId={job.id} mode="crew" trade={tp.key} locked={job.status === 'cancelled'} />}

      <JobSuppliesCard job={job} mode="employee" />

      <div className="card card-pad stack">
        <h2>Job notes</h2>
        {(data?.notes ?? []).map((n) => (
          <div key={n.id} className="note">
            <div className="row-between"><span className="strong small">{n.author_name ?? 'Crew'}</span><span className="subtle">{fmtTime(n.created_at)}</span></div>
            <p className="pre small mt-8">{n.body}</p>
          </div>
        ))}
        {!locked && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }}>
            <TextArea label="Add a note for the office" placeholder="Broken item, supplies needed, anything unusual…" value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 80 }} />
            <Button type="submit" variant="secondary" disabled={!note.trim()} loading={addNote.isPending}>Save note</Button>
          </form>
        )}
      </div>

      {!locked && (
        <div className="sticky-actions">
          <Button size="xl" block icon={<CheckCircle2 />} disabled={requiredLeft > 0} onClick={() => setConfirmDone(true)}>
            {requiredLeft > 0 ? `${requiredLeft} required task${requiredLeft === 1 ? '' : 's'} left` : 'Complete job'}
          </Button>
        </div>
      )}

      <ConfirmDialog open={confirmDone} onClose={() => setConfirmDone(false)} onConfirm={() => complete.mutate()} loading={complete.isPending}
        title="Complete this job?" confirmLabel="Complete job">
        {open ? 'You’ll be clocked out automatically. ' : ''}
        {!(data?.photos ?? []).some((p) => p.kind === 'after') ? 'You haven’t added any after photos yet. ' : ''}
        The office and client will be notified.
      </ConfirmDialog>
    </div>
  );
}

function PhotoUploadTile({ kind, onFiles, disabled, uploading }: { kind: PhotoKind; onFiles: (f: FileList | null) => void; disabled?: boolean; uploading?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="photo-add" disabled={disabled} onClick={() => ref.current?.click()} aria-label={`Add ${kind} photos`}>
        {uploading ? <span className="spinner" /> : kind === 'before' ? <Camera aria-hidden /> : <ImagePlus aria-hidden />}
        {uploading ? 'Uploading' : 'Add photo'}
      </button>
      <input ref={ref} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
    </>
  );
}

export function ActivityPage() {
  const ws = useWorkspace();
  const hours = useQuery({
    queryKey: ['my-hours', ws.employeeId],
    enabled: !!ws.employeeId,
    queryFn: async () => unwrap(await supabase.from('time_entries')
      .select('*, job:jobs(id, service_name, client_id, client:clients(full_name))')
      .eq('employee_id', ws.employeeId!).gte('clock_in_at', subDays(new Date(), 14).toISOString())
      .order('clock_in_at', { ascending: false })) as TimeEntry[],
  });
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekMin = (hours.data ?? []).filter((t) => new Date(t.clock_in_at) >= weekStart).reduce((m, t) => m + minutesBetween(t.clock_in_at, t.clock_out_at), 0);
  return (
    <>
      {ws.employeeId && (
        <div className="card card-pad" style={{ marginBottom: 8 }}>
          <div className="row-between">
            <div><p className="subtle">Hours this week</p><p style={{ fontSize: 30, fontWeight: 800 }}>{(weekMin / 60).toFixed(1)}</p></div>
            <Clock size={32} color="var(--brand-strong)" aria-hidden />
          </div>
          {(hours.data ?? []).slice(0, 6).map((t) => (
            <Link key={t.id} to={`/work/jobs/${t.job_id}`} className="row-between small" style={{ padding: '8px 0', borderTop: '1px solid var(--border)', color: 'inherit' }}>
              <span>{fmtDate(t.clock_in_at)} · {t.job?.client?.full_name}</span>
              <span className="strong">{t.clock_out_at ? fmtDuration(minutesBetween(t.clock_in_at, t.clock_out_at)) : 'Now'}</span>
            </Link>
          ))}
        </div>
      )}
      <NotificationsPage title="Activity" />
    </>
  );
}
