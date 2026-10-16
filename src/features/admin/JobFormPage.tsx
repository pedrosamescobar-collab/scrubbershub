import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { Plus, Repeat } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useWorkspace } from '@/auth/AuthProvider';
import type { Job, JobPriority, Recurrence } from '@/lib/types';
import { fmtDateLong } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { SelectField, TextArea, TextField } from '@/components/ui/Form';
import { Alert, QueryState } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { ClientFormModal } from './ClientsPages';
import { useClients, useEmployees, useInvalidateJobs, useJob, useTeams, useTemplates } from '@/features/shared/api';
import { useTrade } from '@/features/shared/useTrade';
import { PriorityPicker } from '@/features/shared/priority';

const DURATIONS = [60, 90, 120, 150, 180, 210, 240, 300, 360, 420, 480];
const REC_LABEL: Record<Recurrence, string> = { none: 'Does not repeat', weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month' };

interface FormState {
  client_id: string;
  service_name: string;
  date: string;
  time: string;
  duration: number;
  recurrence: Recurrence;
  occurrences: number;
  template: string;
  employee_ids: string[];
  team_ids: string[];
  internal_notes: string;
  priority: JobPriority;
}

function CrewPicker({ value, teams, onChange }: { value: { employee_ids: string[]; team_ids: string[] }; teams?: boolean; onChange: (v: { employee_ids: string[]; team_ids: string[] }) => void }) {
  const employees = useEmployees();
  const teamQ = useTeams();
  const toggle = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  const active = (employees.data ?? []).filter((e) => e.status === 'active');
  return (
    <div className="field">
      <span className="label">Assign crew</span>
      {active.length === 0 && (teamQ.data ?? []).length === 0 && <p className="subtle">No employees yet — add them on the Team page.</p>}
      <div className="row wrap">
        {active.map((e) => (
          <button key={e.id} type="button" className="chip" aria-pressed={value.employee_ids.includes(e.id)}
            onClick={() => onChange({ ...value, employee_ids: toggle(value.employee_ids, e.id) })}>
            <span className="dot" style={{ background: e.color }} />{e.full_name}
          </button>
        ))}
        {teams !== false && (teamQ.data ?? []).map((t) => (
          <button key={t.id} type="button" className="chip" aria-pressed={value.team_ids.includes(t.id)}
            onClick={() => onChange({ ...value, team_ids: toggle(value.team_ids, t.id) })}>
            👥 {t.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function NewJobPage() {
  const tp = useTrade();
  const ws = useWorkspace();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateJobs();
  const clients = useClients();
  const templates = useTemplates();
  const [clientModal, setClientModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<FormState>({
    client_id: params.get('client') ?? '',
    service_name: '',
    date: params.get('date') ?? format(addDays(new Date(), 1), 'yyyy-MM-dd'),
    time: '09:00',
    duration: 120,
    recurrence: 'none',
    occurrences: 12,
    template: '',
    employee_ids: [],
    team_ids: [],
    internal_notes: '',
    priority: 'normal',
  });

  useEffect(() => {
    if (templates.data?.length && !form.template && !form.service_name) {
      setForm((f) => ({ ...f, template: templates.data![0].id, service_name: templates.data![0].name }));
    }
  }, [templates.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeClients = useMemo(() => (clients.data ?? []).filter((c) => c.status === 'active'), [clients.data]);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.client_id) errs.client_id = 'Choose a client';
    if (!form.date) errs.date = 'Pick a date';
    if (!form.time) errs.time = 'Pick a start time';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const starts = new Date(`${form.date}T${form.time}`);
      const apptId = unwrap(await supabase.rpc('schedule_appointment', {
        p: {
          org_id: ws.org.id,
          client_id: form.client_id,
          service_name: form.service_name.trim() || tp.serviceDefault,
          checklist_template_id: form.template || null,
          starts_at: starts.toISOString(),
          duration_minutes: form.duration,
          recurrence: form.recurrence,
          occurrences: form.recurrence === 'none' ? 1 : form.occurrences,
          internal_notes: form.internal_notes,
          employee_ids: form.employee_ids,
          team_ids: form.team_ids,
        },
      })) as string;
      if (form.priority !== 'normal') {
        // Flag the first visit (alerts go to the office and the assigned technician)
        const firstJob = unwrap(await supabase.from('jobs').select('id').eq('appointment_id', apptId).order('scheduled_start').limit(1)) as { id: string }[];
        if (firstJob[0]) unwrap(await supabase.from('jobs').update({ priority: form.priority }).eq('id', firstJob[0].id));
      }
      const first = unwrap(await supabase.from('jobs').select('id').eq('appointment_id', apptId).order('scheduled_start').limit(1)) as { id: string }[];
      invalidate();
      toast.success(form.recurrence === 'none' ? 'Job scheduled' : `${form.occurrences} visits scheduled`);
      navigate(first[0] ? `/jobs/${first[0].id}` : '/calendar', { replace: true });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader back={{ to: '/calendar', label: 'Schedule' }} title="New job" />
      <form className="card card-pad" style={{ maxWidth: 760 }} onSubmit={submit} noValidate>
        <div className="form-grid two">
          <div className="span-2 row" style={{ alignItems: 'flex-end' }}>
            <SelectField className="grow" label="Client" value={form.client_id} onChange={(e) => set('client_id', e.target.value)} error={errors.client_id}>
              <option value="">{clients.isLoading ? 'Loading…' : 'Choose a client'}</option>
              {activeClients.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.address_line1 ? ` — ${c.address_line1}` : ''}</option>)}
            </SelectField>
            <Button variant="secondary" icon={<Plus />} onClick={() => setClientModal(true)}>New</Button>
          </div>
          <SelectField label="Checklist" value={form.template} onChange={(e) => {
            const t = templates.data?.find((x) => x.id === e.target.value);
            setForm((f) => ({ ...f, template: e.target.value, service_name: t && (!f.service_name || templates.data?.some((x) => x.name === f.service_name)) ? t.name : f.service_name }));
          }} hint={templates.data?.length === 0 ? 'Create checklists on the Checklists page' : undefined}>
            <option value="">No checklist</option>
            {(templates.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectField>
          <TextField label="Service name" placeholder={tp.servicePlaceholder} value={form.service_name} onChange={(e) => set('service_name', e.target.value)} />
          {tp.features.priority && <PriorityPicker value={form.priority} onChange={(v) => set('priority', v)} />}
          <TextField label="Date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} error={errors.date} />
          <div className="form-grid two">
            <TextField label="Start" type="time" value={form.time} onChange={(e) => set('time', e.target.value)} error={errors.time} />
            <SelectField label="Duration" value={form.duration} onChange={(e) => set('duration', Number(e.target.value))}>
              {DURATIONS.map((m) => <option key={m} value={m}>{m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`}</option>)}
            </SelectField>
          </div>
          <SelectField label="Repeats" value={form.recurrence} onChange={(e) => {
            const r = e.target.value as Recurrence;
            setForm((f) => ({ ...f, recurrence: r, occurrences: r === 'weekly' ? 12 : r === 'biweekly' ? 8 : 6 }));
          }}>
            {(Object.keys(REC_LABEL) as Recurrence[]).map((r) => <option key={r} value={r}>{REC_LABEL[r]}</option>)}
          </SelectField>
          {form.recurrence !== 'none' ? (
            <TextField label="Number of visits" type="number" min={2} max={52} value={form.occurrences}
              onChange={(e) => set('occurrences', Math.max(1, Math.min(52, Number(e.target.value) || 1)))} hint="Up to 52 — extend the series any time" />
          ) : <span />}
          <div className="span-2">
            <CrewPicker value={form} onChange={(v) => setForm((f) => ({ ...f, ...v }))} />
          </div>
          <TextArea className="span-2" label="Internal notes for the crew" placeholder="Visible to your team only — never to the client" value={form.internal_notes} onChange={(e) => set('internal_notes', e.target.value)} />
        </div>
        {form.recurrence !== 'none' && form.date && (
          <div className="mt-16"><Alert tone="info"><span className="row" style={{ ['--gap' as string]: '6px' }}><Repeat size={16} aria-hidden />{REC_LABEL[form.recurrence]} starting {fmtDateLong(`${form.date}T12:00`)} · {form.occurrences} visits</span></Alert></div>
        )}
        <div className="row mt-24" style={{ justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
          <Button type="submit" loading={busy}>Schedule</Button>
        </div>
      </form>
      <ClientFormModal open={clientModal} onClose={() => setClientModal(false)} onSaved={(c) => set('client_id', c.id)} />
    </>
  );
}

export function EditJobPage() {
  const { id = '' } = useParams();
  const q = useJob(id);
  return <QueryState query={q}>{(job) => <EditJobForm job={job} />}</QueryState>;
}

function EditJobForm({ job }: { job: Job }) {
  const tp = useTrade();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const invalidate = useInvalidateJobs();
  const templates = useTemplates();
  const start = new Date(job.scheduled_start);
  const dur = Math.round((new Date(job.scheduled_end).getTime() - start.getTime()) / 60000);
  const initialEmp = (job.job_assignments ?? []).filter((a) => a.employee_id).map((a) => a.employee_id!);
  const initialTeams = (job.job_assignments ?? []).filter((a) => a.team_id).map((a) => a.team_id!);
  const [form, setForm] = useState({
    service_name: job.service_name,
    date: format(start, 'yyyy-MM-dd'),
    time: format(start, 'HH:mm'),
    duration: DURATIONS.includes(dur) ? dur : dur,
    employee_ids: initialEmp,
    team_ids: initialTeams,
    template: '__keep',
    internal_notes: job.appointment?.internal_notes ?? '',
    priority: (job.priority ?? 'normal') as JobPriority,
  });
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const s = new Date(`${form.date}T${form.time}`);
      unwrap(await supabase.from('jobs').update({
        service_name: form.service_name.trim() || tp.serviceDefault,
        scheduled_start: s.toISOString(),
        scheduled_end: new Date(s.getTime() + form.duration * 60000).toISOString(),
      }).eq('id', job.id));

      const addEmp = form.employee_ids.filter((x) => !initialEmp.includes(x));
      const rmEmp = initialEmp.filter((x) => !form.employee_ids.includes(x));
      const addTeam = form.team_ids.filter((x) => !initialTeams.includes(x));
      const rmTeam = initialTeams.filter((x) => !form.team_ids.includes(x));
      if (rmEmp.length) unwrap(await supabase.from('job_assignments').delete().eq('job_id', job.id).in('employee_id', rmEmp));
      if (rmTeam.length) unwrap(await supabase.from('job_assignments').delete().eq('job_id', job.id).in('team_id', rmTeam));
      const adds = [
        ...addEmp.map((employee_id) => ({ org_id: job.org_id, job_id: job.id, employee_id })),
        ...addTeam.map((team_id) => ({ org_id: job.org_id, job_id: job.id, team_id })),
      ];
      if (adds.length) unwrap(await supabase.from('job_assignments').insert(adds));

      if (form.priority !== (job.priority ?? 'normal')) {
        unwrap(await supabase.from('jobs').update({ priority: form.priority }).eq('id', job.id));
      }
      if (form.template !== '__keep') {
        unwrap(await supabase.rpc('set_job_checklist', { p_job: job.id, p_template: form.template || null }));
      }
      if (job.appointment_id && form.internal_notes !== (job.appointment?.internal_notes ?? '')) {
        unwrap(await supabase.from('appointments').update({ internal_notes: form.internal_notes.trim() || null }).eq('id', job.appointment_id));
      }
      invalidate(job.id);
      void qc.invalidateQueries({ queryKey: ['job', job.id] });
      toast.success('Job updated');
      navigate(`/jobs/${job.id}`, { replace: true });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader back={{ to: `/jobs/${job.id}`, label: 'Job' }} title="Edit job" sub={`${job.client?.full_name} · this visit only`} />
      <form className="card card-pad" style={{ maxWidth: 760 }} onSubmit={save}>
        <div className="form-grid two">
          <TextField className="span-2" label="Service name" value={form.service_name} onChange={(e) => setForm({ ...form, service_name: e.target.value })} />
          {(tp.features.priority || form.priority !== 'normal') && <div className="span-2"><PriorityPicker value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} /></div>}
          <TextField label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <div className="form-grid two">
            <TextField label="Start" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            <SelectField label="Duration" value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })}>
              {[...new Set([...DURATIONS, form.duration])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`}</option>)}
            </SelectField>
          </div>
          <SelectField className="span-2" label="Checklist" value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })}
            disabled={job.status !== 'scheduled'} hint={job.status !== 'scheduled' ? 'Checklist can’t be swapped once work has started' : 'Replaces this visit’s checklist'}>
            <option value="__keep">Keep current checklist</option>
            <option value="">Remove checklist</option>
            {(templates.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectField>
          <div className="span-2"><CrewPicker value={form} onChange={(v) => setForm({ ...form, ...v })} /></div>
          {job.appointment_id && (
            <TextArea className="span-2" label="Internal notes for the crew" hint={job.appointment?.recurrence !== 'none' ? 'Shared by every visit in this recurring series' : undefined}
              value={form.internal_notes} onChange={(e) => setForm({ ...form, internal_notes: e.target.value })} />
          )}
        </div>
        <div className="row mt-24" style={{ justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
          <Button type="submit" loading={busy}>Save changes</Button>
        </div>
      </form>
    </>
  );
}
