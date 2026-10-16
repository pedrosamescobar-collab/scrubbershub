import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CalendarClock, CheckCircle2, ClipboardCheck, Clock, KeyRound, LogIn, LogOut, MapPin, PawPrint, Pencil, Phone, Repeat, Sparkles, Trash2, XCircle, Camera, Star, Receipt, FilePlus2,
} from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import type { Job, JobChecklistItem } from '@/lib/types';
import { clientAddress, fmtAgo, fmtDateLong, fmtDateTime, fmtDuration, fmtTime, fmtTimeRange, mapsUrl, minutesBetween } from '@/lib/format';
import { deleteJobPhoto } from '@/lib/storage';
import { Button, ButtonLink } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/Form';
import { EmptyState, QueryState, Alert } from '@/components/ui/Feedback';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Avatar, PageHeader, ProgressBar, ProgressRing, Stars, StatusBadge } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { PhotoGallery } from '@/features/shared/components';
import { crewOf, useInvalidateJobs, useJob, useJobExtras, type JobExtras } from '@/features/shared/api';
import { JobSuppliesCard } from '@/features/inventory/components';
import { PriorityBadge } from '@/features/shared/priority';
import { EquipmentSection } from '@/features/equipment/EquipmentSection';
import { useTrade } from '@/features/shared/useTrade';
import { InvoiceBadge } from '@/features/billing/components';
import { money, type Invoice } from '@/lib/billing';

/** "Create invoice" for finished jobs, or a link to the invoice once it exists. */
function JobInvoiceCard({ job }: { job: Job }) {
  const navigate = useNavigate();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['job-invoice', job.id],
    queryFn: async () => unwrap(await supabase.from('invoices').select('id, number, status, total, balance_due')
      .eq('job_id', job.id).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(1).maybeSingle()) as Pick<Invoice, 'id' | 'number' | 'status' | 'total' | 'balance_due'> | null,
  });
  const create = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('create_invoice_from_job', { p_job: job.id })) as string,
    onSuccess: (id) => navigate(`/billing/invoices/${id}/edit`),
    onError: (e) => toast.error(e),
  });
  if (job.status === 'cancelled' || q.isLoading) return null;
  const inv = q.data;
  if (inv) {
    return (
      <Link to={`/billing/invoices/${inv.id}`} className="card card-pad card-link row">
        <span className="avatar"><Receipt size={18} aria-hidden /></span>
        <span className="grow"><span className="strong">Invoice {inv.number}</span>
          <span className="muted small" style={{ display: 'block' }}>{money(inv.total)}{Number(inv.balance_due) > 0 && inv.status !== 'draft' ? ` · ${money(inv.balance_due)} due` : ''}</span></span>
        <InvoiceBadge status={inv.status} />
      </Link>
    );
  }
  if (job.status !== 'completed') return null;
  return (
    <div className="card card-pad stack invoice-cta">
      <div className="row"><span className="avatar"><Receipt size={18} aria-hidden /></span>
        <span className="grow"><span className="strong">Ready to bill</span><span className="muted small" style={{ display: 'block' }}>Client, address and services are filled in for you.</span></span></div>
      <Button size="lg" icon={<FilePlus2 />} loading={create.isPending} onClick={() => create.mutate()}>Create invoice</Button>
    </div>
  );
}

export function groupChecklist(items: JobChecklistItem[]) {
  const map = new Map<string, JobChecklistItem[]>();
  for (const it of items) map.set(it.section_name, [...(map.get(it.section_name) ?? []), it]);
  return [...map.entries()];
}

export function AdminJobPage() {
  const { id = '' } = useParams();
  const job = useJob(id);
  const extras = useJobExtras(id);
  return (
    <QueryState query={job}>
      {(j) => <AdminJobView job={j} extras={extras.data} extrasLoading={extras.isLoading} refetch={() => { void job.refetch(); void extras.refetch(); }} />}
    </QueryState>
  );
}

function AdminJobView({ job, extras, extrasLoading, refetch }: { job: Job; extras?: JobExtras; extrasLoading: boolean; refetch: () => void }) {
  const tp = useTrade();
  const { user, profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidateJobs();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelScope, setCancelScope] = useState<'this' | 'future'>('this');
  const [cancelReason, setCancelReason] = useState('');
  const [confirm, setConfirm] = useState<'complete' | 'delete' | 'reopen' | null>(null);
  const [note, setNote] = useState('');
  const [response, setResponse] = useState<string | null>(null);

  const c = job.client;
  const checklist = extras?.checklist ?? [];
  const done = checklist.filter((i) => i.completed_at).length;
  const requiredOpen = checklist.filter((i) => i.is_required && !i.completed_at).length;
  const totalMinutes = (extras?.time ?? []).reduce((m, t) => m + minutesBetween(t.clock_in_at, t.clock_out_at), 0);
  const crew = crewOf(job);
  const isSeries = job.appointment?.recurrence && job.appointment.recurrence !== 'none';

  const after = () => { invalidate(job.id); refetch(); };

  const cancel = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('cancel_job', { p_job: job.id, p_scope: cancelScope, p_reason: cancelReason.trim() || null })) as number,
    onSuccess: (n) => { setCancelOpen(false); after(); toast.success(n > 1 ? `${n} visits cancelled` : 'Job cancelled'); },
    onError: (e) => toast.error(e),
  });
  const complete = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('complete_job', { p_job: job.id })),
    onSuccess: () => { setConfirm(null); after(); toast.success('Job marked complete'); },
    onError: (e) => { setConfirm(null); toast.error(e); },
  });
  const reopen = useMutation({
    mutationFn: async () => unwrap(await supabase.from('jobs').update({ status: 'scheduled', cancelled_at: null, cancel_reason: null }).eq('id', job.id)),
    onSuccess: () => { setConfirm(null); after(); toast.success('Job restored'); },
    onError: (e) => toast.error(e),
  });
  const del = useMutation({
    mutationFn: async () => unwrap(await supabase.from('jobs').delete().eq('id', job.id)),
    onSuccess: () => { invalidate(); toast.success('Job deleted'); navigate('/calendar', { replace: true }); },
    onError: (e) => toast.error(e),
  });
  const addNote = useMutation({
    mutationFn: async () => unwrap(await supabase.from('job_notes').insert({
      org_id: job.org_id, job_id: job.id, author_id: user!.id, author_name: profile?.full_name ?? 'Office', body: note.trim(),
    })),
    onSuccess: () => { setNote(''); after(); },
    onError: (e) => toast.error(e),
  });
  const updateReview = useMutation({
    mutationFn: async (patch: { admin_response?: string | null; is_hidden?: boolean }) =>
      unwrap(await supabase.from('reviews').update(patch).eq('id', extras!.review!.id)),
    onSuccess: () => { setResponse(null); after(); toast.success('Review updated'); },
    onError: (e) => toast.error(e),
  });
  const toggleItem = useMutation({
    mutationFn: async (it: JobChecklistItem) => unwrap(await supabase.rpc('set_checklist_item', { p_item: it.id, p_done: !it.completed_at })),
    onSuccess: after,
    onError: (e) => toast.error(e),
  });

  const timeline = useMemo(() => {
    if (!extras) return [];
    const ev: { at: string; icon: typeof Clock; text: string }[] = [];
    for (const t of extras.time) {
      ev.push({ at: t.clock_in_at, icon: LogIn, text: `${t.employee?.full_name ?? 'Crew'} clocked in` });
      if (t.clock_out_at) ev.push({ at: t.clock_out_at, icon: LogOut, text: `${t.employee?.full_name ?? 'Crew'} clocked out` });
    }
    const photosByKind = new Map<string, string>();
    for (const p of extras.photos) if (!photosByKind.has(p.kind)) photosByKind.set(p.kind, p.created_at);
    for (const [k, at] of photosByKind) ev.push({ at, icon: Camera, text: `${k === 'before' ? 'Before' : 'After'} photos added` });
    const lastItem = checklist.filter((i) => i.completed_at).sort((a, b) => a.completed_at!.localeCompare(b.completed_at!)).pop();
    if (lastItem && done === checklist.length) ev.push({ at: lastItem.completed_at!, icon: ClipboardCheck, text: 'Checklist finished' });
    if (job.completed_at) ev.push({ at: job.completed_at, icon: CheckCircle2, text: 'Job completed' });
    if (job.cancelled_at) ev.push({ at: job.cancelled_at, icon: XCircle, text: `Cancelled${job.cancel_reason ? ` — ${job.cancel_reason}` : ''}` });
    if (extras.review) ev.push({ at: extras.review.created_at, icon: Star, text: `Client left a ${extras.review.rating}★ review` });
    return ev.sort((a, b) => a.at.localeCompare(b.at));
  }, [extras, checklist, done, job]);

  return (
    <>
      <PageHeader
        back={{ to: '/calendar', label: 'Schedule' }}
        title={c?.full_name ?? 'Job'}
        sub={<span className="row wrap" style={{ ['--gap' as string]: '8px' }}><StatusBadge status={job.status} /><PriorityBadge priority={job.priority} />{job.service_name}{isSeries && <span className="badge badge-gray no-dot"><Repeat size={12} aria-hidden /> {job.appointment!.recurrence}</span>}</span>}
        actions={
          <>
            {job.status !== 'completed' && job.status !== 'cancelled' && <ButtonLink to={`/jobs/${job.id}/edit`} variant="secondary" icon={<Pencil />}>Edit</ButtonLink>}
            {job.status === 'scheduled' && <Button variant="danger-ghost" icon={<XCircle />} onClick={() => setCancelOpen(true)}>Cancel</Button>}
            {job.status === 'cancelled' && <Button variant="secondary" onClick={() => setConfirm('reopen')}>Restore</Button>}
          </>
        }
      />

      <div className="grid-2-lg">
        <div className="stack" style={{ ['--gap' as string]: '16px' }}>
          <div className="card card-pad stack">
            <div className="row"><CalendarClock size={18} aria-hidden /><span><strong>{fmtDateLong(job.scheduled_start)}</strong><br /><span className="muted">{fmtTimeRange(job.scheduled_start, job.scheduled_end)}</span></span></div>
            {c && clientAddress(c) && <a className="row" href={mapsUrl(c) ?? undefined} target="_blank" rel="noreferrer"><MapPin size={18} aria-hidden />{clientAddress(c)}</a>}
            {c?.phone && <a className="row" href={`tel:${c.phone}`}><Phone size={18} aria-hidden />{c.phone}</a>}
            <div className="row wrap">
              {crew.length ? crew.map((m) => <span key={m.id} className="chip" style={{ cursor: 'default' }}><Avatar name={m.name} color={m.color} size="sm" />{m.name}</span>)
                : <span className="badge badge-red">No one assigned</span>}
            </div>
            {c?.access_instructions && <div className="callout"><div className="label"><KeyRound aria-hidden />Access</div><p className="pre">{c.access_instructions}</p></div>}
            {c?.pets && <div className="callout"><div className="label"><PawPrint aria-hidden />Pets</div><p>{c.pets}</p></div>}
            {c?.cleaning_preferences && <div className="callout"><div className="label"><Sparkles aria-hidden />Preferences</div><p className="pre">{c.cleaning_preferences}</p></div>}
            {job.appointment?.internal_notes && <div className="callout"><div className="label">Internal notes</div><p className="pre">{job.appointment.internal_notes}</p></div>}
            {c && <Link to={`/clients/${c.id}`} className="small strong">View client profile →</Link>}
          </div>

          <div className="card">
            <div className="card-header">
              <h2>Checklist</h2>
              {checklist.length > 0 && <span className="subtle">{done}/{checklist.length} done</span>}
            </div>
            <div className="card-body">
              {extrasLoading ? <div className="skeleton" style={{ height: 120 }} /> : checklist.length === 0 ? (
                <p className="subtle">No checklist attached. <Link to={`/jobs/${job.id}/edit`}>Attach one</Link></p>
              ) : (
                <div className="stack" style={{ ['--gap' as string]: '16px' }}>
                  <ProgressBar value={done} total={checklist.length} size="lg" />
                  {groupChecklist(checklist).map(([section, items]) => (
                    <div key={section}>
                      <p className="label" style={{ marginBottom: 6 }}>{section} · {items.filter((i) => i.completed_at).length}/{items.length}</p>
                      {items.map((it) => (
                        <label key={it.id} className="check-row" style={{ padding: '6px 0' }}>
                          <input type="checkbox" checked={!!it.completed_at} disabled={job.status === 'completed' || job.status === 'cancelled' || toggleItem.isPending}
                            onChange={() => toggleItem.mutate(it)} />
                          <span className="grow">
                            <span style={it.completed_at ? { color: 'var(--text-3)' } : undefined}>{it.label}</span>
                            {!it.is_required && <span className="subtle"> · optional</span>}
                            {it.completed_at && <span className="subtle" style={{ display: 'block' }}>Done {fmtTime(it.completed_at)}</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h2>Photos</h2></div>
            <div className="card-body stack">
              <p className="label">Before</p>
              <PhotoGallery photos={extras?.photos ?? []} kind="before" emptyText="No before photos."
                onDelete={async (p) => { try { await deleteJobPhoto(p.id, p.storage_path); after(); toast.success('Photo deleted'); } catch (e) { toast.error(e); } }} />
              <p className="label mt-8">After</p>
              <PhotoGallery photos={extras?.photos ?? []} kind="after" emptyText="No after photos."
                onDelete={async (p) => { try { await deleteJobPhoto(p.id, p.storage_path); after(); toast.success('Photo deleted'); } catch (e) { toast.error(e); } }} />
            </div>
          </div>
        </div>

        <div className="stack" style={{ ['--gap' as string]: '16px' }}>
          <JobInvoiceCard job={job} />
          {job.status !== 'cancelled' && (
            <div className="card card-pad row">
              <ProgressRing value={done} total={checklist.length || 1} />
              <div className="grow">
                <p className="strong">{job.status === 'completed' ? `Completed ${fmtDateTime(job.completed_at!)}` : job.status === 'in_progress' ? 'Work in progress' : 'Not started'}</p>
                <p className="muted small"><Clock size={13} aria-hidden style={{ display: 'inline', verticalAlign: '-2px' }} /> {fmtDuration(totalMinutes)} on the clock</p>
              </div>
              {job.status !== 'completed' && (
                <Button size="sm" variant="soft" onClick={() => setConfirm('complete')}>Mark complete</Button>
              )}
            </div>
          )}

          <div className="card">
            <div className="card-header"><h2>Time</h2><span className="subtle">{fmtDuration(totalMinutes)} total</span></div>
            <div className="list mt-8">
              {(extras?.time ?? []).length === 0 && <p className="subtle card-body">No one has clocked in yet.</p>}
              {(extras?.time ?? []).map((t) => (
                <div key={t.id} className="list-item">
                  <Avatar name={t.employee?.full_name} color={t.employee?.color} size="sm" />
                  <span className="grow">
                    <span className="strong">{t.employee?.full_name}</span>
                    <span className="muted small" style={{ display: 'block' }}>{fmtTime(t.clock_in_at)} – {t.clock_out_at ? fmtTime(t.clock_out_at) : 'now'}</span>
                  </span>
                  {t.clock_out_at ? <span className="strong">{fmtDuration(minutesBetween(t.clock_in_at, t.clock_out_at))}</span> : <span className="badge badge-green">On the clock</span>}
                </div>
              ))}
            </div>
          </div>

          <JobSuppliesCard job={job} mode="admin" />
          {tp.features.equipment && c && (
            <EquipmentSection orgId={job.org_id} clientId={c.id} jobId={job.id} mode="admin" trade={tp.key} locked={job.status === 'cancelled'} />
          )}

          <div className="card">
            <div className="card-header"><h2>Review</h2></div>
            <div className="card-body stack">
              {!extras?.review ? (
                <p className="subtle">{job.status === 'completed' ? 'Waiting for the client’s review.' : 'Clients are asked for a review after completion.'}</p>
              ) : (
                <>
                  <div className="row-between"><Stars value={extras.review.rating} size="lg" />{extras.review.is_hidden && <span className="badge badge-gray">Hidden</span>}</div>
                  {extras.review.body && <p>“{extras.review.body}”</p>}
                  {extras.review.private_feedback && (
                    <div className="callout"><div className="label">Private feedback (only you see this)</div><p className="pre">{extras.review.private_feedback}</p></div>
                  )}
                  <p className="subtle">{fmtAgo(extras.review.created_at)}</p>
                  {extras.review.admin_response && response === null && <div className="note"><p className="label">Your response</p><p className="pre small">{extras.review.admin_response}</p></div>}
                  {response !== null ? (
                    <div className="stack">
                      <TextArea label="Response to client" value={response} onChange={(e) => setResponse(e.target.value)} />
                      <div className="row"><Button size="sm" onClick={() => updateReview.mutate({ admin_response: response.trim() || null })} loading={updateReview.isPending}>Save</Button><Button size="sm" variant="ghost" onClick={() => setResponse(null)}>Cancel</Button></div>
                    </div>
                  ) : (
                    <div className="row">
                      <Button size="sm" variant="secondary" onClick={() => setResponse(extras.review!.admin_response ?? '')}>{extras.review.admin_response ? 'Edit response' : 'Respond'}</Button>
                      <Button size="sm" variant="ghost" onClick={() => updateReview.mutate({ is_hidden: !extras.review!.is_hidden })}>{extras.review.is_hidden ? 'Unhide' : 'Hide'}</Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h2>Notes</h2></div>
            <div className="card-body stack">
              {(extras?.clientNotes ?? []).map((n) => (
                <div key={n.id} className={`note ${n.from_client ? 'from-client' : ''}`}>
                  <div className="row-between"><span className="strong small">{n.from_client ? `${c?.full_name ?? 'Client'} (client)` : n.author_name ?? 'Office'}</span><span className="subtle">{fmtAgo(n.created_at)}</span></div>
                  <p className="pre small mt-8">{n.body}</p>
                </div>
              ))}
              {(extras?.notes ?? []).map((n) => (
                <div key={n.id} className="note">
                  <div className="row-between"><span className="strong small">{n.author_name ?? 'Crew'} · crew note</span><span className="subtle">{fmtAgo(n.created_at)}</span></div>
                  <p className="pre small mt-8">{n.body}</p>
                </div>
              ))}
              {!extras?.notes.length && !extras?.clientNotes.length && <p className="subtle">No notes yet.</p>}
              <form className="stack" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }}>
                <TextArea label="Add a crew note" placeholder="Visible to assigned crew — not the client" value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 70 }} />
                <Button type="submit" size="sm" variant="secondary" disabled={!note.trim()} loading={addNote.isPending}>Add note</Button>
              </form>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h2>Activity</h2></div>
            <div className="card-body timeline">
              {timeline.length === 0 && <p className="subtle">Nothing yet.</p>}
              {timeline.map((e, i) => (
                <div key={i} className="ev">
                  <span className="ic"><e.icon aria-hidden /></span>
                  <span><span className="small strong">{e.text}</span><span className="subtle" style={{ display: 'block' }}>{fmtDateTime(e.at)}</span></span>
                </div>
              ))}
            </div>
          </div>

          <Button variant="danger-ghost" icon={<Trash2 />} onClick={() => setConfirm('delete')}>Delete this job</Button>
        </div>
      </div>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel job" size="sm"
        footer={<><Button variant="secondary" onClick={() => setCancelOpen(false)}>Keep job</Button><Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel {cancelScope === 'future' ? 'visits' : 'job'}</Button></>}>
        <div className="stack">
          {isSeries && (
            <div className="stack" role="radiogroup" aria-label="Which visits">
              <button type="button" role="radio" className="option-card" aria-checked={cancelScope === 'this'} onClick={() => setCancelScope('this')}>This visit only</button>
              <button type="button" role="radio" className="option-card" aria-checked={cancelScope === 'future'} onClick={() => setCancelScope('future')}>This and all future visits</button>
            </div>
          )}
          <TextArea label="Reason (optional)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} style={{ minHeight: 70 }} />
        </div>
      </Modal>
      <ConfirmDialog open={confirm === 'complete'} onClose={() => setConfirm(null)} onConfirm={() => complete.mutate()} loading={complete.isPending}
        title="Mark job complete?" confirmLabel="Mark complete">
        {requiredOpen > 0
          ? <Alert tone="warn">{requiredOpen} required task{requiredOpen === 1 ? ' is' : 's are'} still open. Check them off first, or the job can’t be completed.</Alert>
          : 'Open time entries will be clocked out and the client will be asked for a review.'}
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'reopen'} onClose={() => setConfirm(null)} onConfirm={() => reopen.mutate()} loading={reopen.isPending}
        title="Restore this job?" confirmLabel="Restore">It will go back on the schedule.</ConfirmDialog>
      <ConfirmDialog open={confirm === 'delete'} onClose={() => setConfirm(null)} onConfirm={() => del.mutate()} loading={del.isPending} danger
        title="Delete this job permanently?" confirmLabel="Delete job">
        This removes the job with its checklist, photos, notes and time entries. To keep history, cancel it instead.
      </ConfirmDialog>
      {!extras && !extrasLoading && <EmptyState title="Couldn’t load job details" />}
    </>
  );
}
