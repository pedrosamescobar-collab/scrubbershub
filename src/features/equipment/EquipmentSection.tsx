import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Cpu, History, Pencil, Plus, ShieldCheck, ShieldAlert, Wrench } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import type { ClientEquipment, JobEquipment } from '@/lib/types';
import { EQUIPMENT_KINDS } from '@/lib/trades';
import { format } from 'date-fns';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { TextArea, TextField } from '@/components/ui/Form';
import { EmptyState } from '@/components/ui/Feedback';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';

const EQ_SELECT = '*, job_equipment(job_id, note, created_at, job:jobs(id, service_name, scheduled_start, status))';

export const eqKeys = {
  client: (clientId: string) => ['equipment', 'client', clientId] as const,
  job: (jobId: string) => ['equipment', 'job', jobId] as const,
};

export function useClientEquipment(clientId: string | null | undefined) {
  return useQuery({
    queryKey: eqKeys.client(clientId ?? ''),
    enabled: !!clientId,
    queryFn: async () =>
      unwrap(await supabase.from('client_equipment').select(EQ_SELECT).eq('client_id', clientId!).eq('is_active', true)
        .order('created_at')) as unknown as ClientEquipment[],
  });
}

function useJobEquipment(jobId: string | undefined) {
  return useQuery({
    queryKey: eqKeys.job(jobId ?? ''),
    enabled: !!jobId,
    queryFn: async () => unwrap(await supabase.from('job_equipment').select('*').eq('job_id', jobId!)) as JobEquipment[],
  });
}

function ageText(d: string | null) {
  if (!d) return null;
  const years = (Date.now() - new Date(d).getTime()) / (365.25 * 864e5);
  if (years < 1) return 'installed this year';
  return `${Math.floor(years)} yr${Math.floor(years) === 1 ? '' : 's'} old`;
}

function WarrantyBadge({ until }: { until: string | null }) {
  if (!until) return null;
  const active = new Date(until).getTime() >= Date.now();
  return active
    ? <Badge tone="green"><ShieldCheck size={12} aria-hidden /> Warranty to {format(new Date(until + 'T12:00:00'), 'MMM yyyy')}</Badge>
    : <Badge tone="gray"><ShieldAlert size={12} aria-hidden /> Warranty ended</Badge>;
}

// ---------------------------------------------------------------------------
function EquipmentModal({ open, onClose, orgId, clientId, item, trade }: {
  open: boolean; onClose: () => void; orgId: string; clientId: string; item?: ClientEquipment | null; trade: string;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const { user, workspace } = useAuth();
  const blank = { kind: '', brand: '', model: '', serial: '', location: '', installed_on: '', warranty_until: '', notes: '' };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF(item ? {
      kind: item.kind, brand: item.brand ?? '', model: item.model ?? '', serial: item.serial ?? '', location: item.location ?? '',
      installed_on: item.installed_on ?? '', warranty_until: item.warranty_until ?? '', notes: item.notes ?? '',
    } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      const row = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]));
      if (item) return unwrap(await supabase.from('client_equipment').update(row).eq('id', item.id));
      return unwrap(await supabase.from('client_equipment').insert({ ...row, org_id: orgId, client_id: clientId, created_by: user?.id }));
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['equipment'] }); toast.success(item ? 'Equipment updated' : 'Equipment added'); onClose(); },
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({
    mutationFn: async () => unwrap(await supabase.from('client_equipment').update({ is_active: false }).eq('id', item!.id)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['equipment'] }); toast.success('Removed'); setConfirmRemove(false); onClose(); },
    onError: (e) => toast.error(e),
  });
  const submit = () => {
    if (!f.kind.trim()) return setErr('What kind of equipment is it?');
    save.mutate();
  };
  const kinds = EQUIPMENT_KINDS[trade as keyof typeof EQUIPMENT_KINDS] ?? EQUIPMENT_KINDS.plumbing;

  return (
    <Modal open={open} onClose={onClose} title={item ? 'Edit equipment' : 'Add equipment'}
      footer={<>
        {item && workspace?.isAdmin && <Button variant="danger-ghost" onClick={() => setConfirmRemove(true)}>Remove</Button>}
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} loading={save.isPending}>{item ? 'Save' : 'Add'}</Button>
      </>}>
      <form className="form-grid two" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <TextField className="span-2" label="Type" list="eq-kinds" placeholder="e.g. Water heater (tank)" value={f.kind} onChange={set('kind')} error={err} autoFocus />
        <TextField label="Brand" placeholder="e.g. Rheem" value={f.brand} onChange={set('brand')} />
        <TextField label="Model #" value={f.model} onChange={set('model')} />
        <TextField label="Serial #" value={f.serial} onChange={set('serial')} />
        <TextField label="Where in the home" placeholder="Garage, attic, hall closet…" value={f.location} onChange={set('location')} />
        <TextField label="Installed" type="date" value={f.installed_on} onChange={set('installed_on')} />
        <TextField label="Warranty until" type="date" value={f.warranty_until} onChange={set('warranty_until')} />
        <TextArea className="span-2" label="Notes" placeholder="Size, fuel type, known issues…" value={f.notes} onChange={set('notes')} style={{ minHeight: 70 }} />
        <button type="submit" hidden />
      </form>
      <datalist id="eq-kinds">{kinds.map((k) => <option key={k} value={k} />)}</datalist>
      <ConfirmDialog open={confirmRemove} onClose={() => setConfirmRemove(false)} onConfirm={() => remove.mutate()} loading={remove.isPending}
        title="Remove this equipment?" confirmLabel="Remove">It’s hidden from the property but its service history is kept.</ConfirmDialog>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function HistoryModal({ item, onClose, jobBase }: { item: ClientEquipment | null; onClose: () => void; jobBase: string | null }) {
  const rows = [...(item?.job_equipment ?? [])].sort((a, b) => (b.job?.scheduled_start ?? '').localeCompare(a.job?.scheduled_start ?? ''));
  return (
    <Modal open={!!item} onClose={onClose} title={item ? `${item.kind} — service history` : ''} size="sm">
      {rows.length === 0 ? <EmptyState icon={<History />} title="No service logged yet">Mark it as serviced on a job to build its history.</EmptyState> : (
        <div className="card list">
          {rows.map((r) => (
            <div key={r.job_id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <span className="grow">
                <span className="strong" style={{ display: 'block' }}>
                  {jobBase && r.job ? <Link to={`${jobBase}${r.job.id}`}>{r.job.service_name}</Link> : r.job?.service_name ?? 'Job'}
                </span>
                <span className="subtle">{r.job ? fmtDate(r.job.scheduled_start) : fmtDate(r.created_at)}</span>
                {r.note && <span className="small pre" style={{ display: 'block', marginTop: 2 }}>{r.note}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
/**
 * Equipment at a client's property.
 *  - mode "admin" / "crew": can add & edit; with a jobId, each item can be marked "serviced on this job" with a note.
 *  - mode "client": read-only (client portal).
 */
export function EquipmentSection({ orgId, clientId, jobId, mode, trade, locked }: {
  orgId: string; clientId: string; jobId?: string; mode: 'admin' | 'crew' | 'client'; trade: string; locked?: boolean;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const q = useClientEquipment(clientId);
  const onJob = useJobEquipment(jobId);
  const [edit, setEdit] = useState<ClientEquipment | null | 'new'>(null);
  const [history, setHistory] = useState<ClientEquipment | null>(null);
  const [noteFor, setNoteFor] = useState<ClientEquipment | null>(null);
  const [note, setNote] = useState('');
  const canEdit = mode !== 'client';
  const jobBase = mode === 'admin' ? '/jobs/' : mode === 'crew' ? '/work/jobs/' : '/portal/appointments/';

  const mark = useMutation({
    mutationFn: async ({ eq, on, text }: { eq: ClientEquipment; on: boolean; text?: string }) => {
      if (!jobId) return;
      if (on) {
        unwrap(await supabase.from('job_equipment').upsert({ org_id: orgId, job_id: jobId, equipment_id: eq.id, note: text?.trim() || null, created_by: user?.id }));
      } else {
        unwrap(await supabase.from('job_equipment').delete().eq('job_id', jobId).eq('equipment_id', eq.id));
      }
    },
    onSuccess: (_d, v) => { void qc.invalidateQueries({ queryKey: ['equipment'] }); if (v.on) toast.success('Service logged'); setNoteFor(null); },
    onError: (e) => toast.error(e),
  });

  const list = q.data ?? [];
  const serviced = new Map((onJob.data ?? []).map((r) => [r.equipment_id, r]));

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2>Equipment at this property</h2>
          <p className="subtle">{mode === 'client' ? 'What we service at your home' : 'Brand, model, serial and service history'}</p>
        </div>
        {canEdit && <Button size="sm" variant="soft" icon={<Plus />} onClick={() => setEdit('new')}>Add</Button>}
      </div>
      <div className="list mt-8">
        {q.isLoading && <div className="card-body"><div className="skeleton" style={{ height: 56 }} /></div>}
        {!q.isLoading && list.length === 0 && (
          <p className="subtle card-body">{mode === 'client' ? 'Nothing recorded yet.' : 'Record water heaters, softeners, pumps and other equipment so the next visit starts with the facts.'}</p>
        )}
        {list.map((eq) => {
          const done = serviced.get(eq.id);
          const visits = eq.job_equipment?.length ?? 0;
          return (
            <div key={eq.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <span className="avatar"><Cpu size={18} aria-hidden /></span>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="strong" style={{ display: 'block' }}>{eq.kind}</span>
                <span className="muted small" style={{ display: 'block' }}>
                  {[eq.brand, eq.model && `Model ${eq.model}`, eq.serial && `S/N ${eq.serial}`].filter(Boolean).join(' · ') || 'No details yet'}
                </span>
                <span className="subtle" style={{ display: 'block' }}>
                  {[eq.location, eq.installed_on && ageText(eq.installed_on)].filter(Boolean).join(' · ')}
                </span>
                <span className="row wrap mt-8" style={{ ['--gap' as string]: '6px' }}>
                  <WarrantyBadge until={eq.warranty_until} />
                  <button type="button" className="chip" style={{ height: 26, fontSize: 12 }} onClick={() => setHistory(eq)}>
                    <History size={12} aria-hidden /> {visits} service{visits === 1 ? '' : 's'}
                  </button>
                  {done && <Badge tone="green"><Check size={12} aria-hidden /> Serviced this visit</Badge>}
                </span>
                {done?.note && <span className="small pre" style={{ display: 'block', marginTop: 4 }}>{done.note}</span>}
                {canEdit && jobId && !locked && (
                  <span className="row mt-8" style={{ ['--gap' as string]: '6px' }}>
                    {done
                      ? <Button size="sm" variant="ghost" onClick={() => mark.mutate({ eq, on: false })}>Undo serviced</Button>
                      : <Button size="sm" variant="secondary" icon={<Wrench />} onClick={() => { setNote(''); setNoteFor(eq); }}>Mark serviced</Button>}
                  </span>
                )}
              </span>
              {canEdit && <Button size="sm" variant="ghost" iconOnly aria-label={`Edit ${eq.kind}`} icon={<Pencil />} onClick={() => setEdit(eq)} />}
            </div>
          );
        })}
      </div>

      {canEdit && (
        <EquipmentModal open={edit !== null} onClose={() => setEdit(null)} orgId={orgId} clientId={clientId}
          item={edit === 'new' ? null : edit} trade={trade} />
      )}
      <HistoryModal item={history} onClose={() => setHistory(null)} jobBase={jobBase} />
      <Modal open={!!noteFor} onClose={() => setNoteFor(null)} title={noteFor ? `Serviced: ${noteFor.kind}` : ''} size="sm"
        footer={<><Button variant="secondary" onClick={() => setNoteFor(null)}>Cancel</Button>
          <Button loading={mark.isPending} onClick={() => noteFor && mark.mutate({ eq: noteFor, on: true, text: note })}>Save</Button></>}>
        <TextArea label="What was done?" placeholder="e.g. Flushed tank, replaced anode rod, set to 120°F" value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </div>
  );
}
