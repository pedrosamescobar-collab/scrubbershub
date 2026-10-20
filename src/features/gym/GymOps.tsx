import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import {
  CalendarPlus, Check, CheckCircle2, ClipboardCheck, FileBarChart, GraduationCap, Search, Send, ShieldAlert, UserRoundCheck, Users,
} from 'lucide-react';
import type { GymCallout, GymInspection, GymInspectionResult, GymReport, GymRound, GymTraining, GymZone } from '@/lib/types';
import { fmtDate, fmtDateTime, fmtTimeRange } from '@/lib/format';
import { Button, ButtonLink } from '@/components/ui/Button';
import { SelectField, Switch, TextArea, TextField } from '@/components/ui/Form';
import { Alert, EmptyState, QueryState, SkeletonList } from '@/components/ui/Feedback';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Avatar, Badge, Segmented, StatusBadge } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { useEmployees } from '@/features/shared/api';
import {
  CALLOUT_META, GYM_LIMITS, RESULT_META, TRAINING_META, gymAction, todayIso, trainingState, useGymCallouts, useGymInspections, useGymPlan, useGymReports, useGymRounds, useGymTraining, useInvalidateGym,
} from './api';
import { useGym } from './GymPages';

// ---------------------------------------------------------------------------
// Team training: site orientation + chemical training with a review date
// ---------------------------------------------------------------------------
export function GymTeamPage() {
  const { contract } = useGym();
  const employees = useEmployees();
  const training = useGymTraining();
  const [editing, setEditing] = useState<{ employee: { id: string; full_name: string }; record: GymTraining | null } | null>(null);

  const active = (employees.data ?? []).filter((e) => e.status === 'active');
  const byEmp = new Map((training.data ?? []).map((t) => [t.employee_id, t]));
  const cleared = active.filter((e) => trainingState(byEmp.get(e.id)) === 'current').length;

  return (
    <div className="stack" style={{ ['--gap' as string]: '16px' }}>
      <div className="card card-pad row wrap">
        <span className="avatar lg"><GraduationCap aria-hidden /></span>
        <div className="grow">
          <p className="strong">{cleared} of {active.length} team members cleared for the site</p>
          <p className="muted small">Only cleared workers can be put on a round. Training must stay valid through the end of each round.</p>
        </div>
      </div>
      <QueryState query={employees} skeleton={<SkeletonList rows={4} height={64} />}>
        {() => active.length === 0 ? (
          <div className="card"><EmptyState icon={<Users />} title="No active team members" action={<ButtonLink to="/team">Go to Team</ButtonLink>}>Add employees first, then record their site training here.</EmptyState></div>
        ) : (
          <div className="card list">
            {active.map((e) => {
              const t = byEmp.get(e.id) ?? null;
              const st = trainingState(t);
              const m = TRAINING_META[st];
              return (
                <button key={e.id} className="list-item" onClick={() => setEditing({ employee: e, record: t })}>
                  <Avatar name={e.full_name} color={e.color} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="strong">{e.full_name}</span>
                    <span className="muted small" style={{ display: 'block' }}>
                      {t ? `${t.orientation ? 'Orientation ✓' : 'Orientation pending'} · ${t.chemical ? 'Chemicals ✓' : 'Chemicals pending'} · Review ${fmtDate(t.valid_until + 'T12:00:00')}` : 'No training on record'}
                    </span>
                  </span>
                  <Badge tone={m.tone}>{m.label}</Badge>
                </button>
              );
            })}
          </div>
        )}
      </QueryState>
      <TrainingModal contractId={contract.id} target={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function TrainingModal({ contractId, target, onClose }: { contractId: string; target: { employee: { id: string; full_name: string }; record: GymTraining | null } | null; onClose: () => void }) {
  return (
    <Modal open={!!target} onClose={onClose} title={target ? `Site training · ${target.employee.full_name}` : 'Site training'} size="sm">
      {target && <TrainingForm key={target.employee.id} contractId={contractId} employeeId={target.employee.id} record={target.record} onDone={onClose} />}
    </Modal>
  );
}

function TrainingForm({ contractId, employeeId, record, onDone }: { contractId: string; employeeId: string; record: GymTraining | null; onDone: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateGym();
  const [orientation, setOrientation] = useState(record?.orientation ?? false);
  const [chemical, setChemical] = useState(record?.chemical ?? false);
  const [validUntil, setValidUntil] = useState(record?.valid_until ?? format(addDays(new Date(), 365), 'yyyy-MM-dd'));
  const save = useMutation({
    mutationFn: async () => gymAction(contractId, { action: 'training', data: { employee_id: employeeId, orientation, chemical, valid_until: validUntil } }),
    onSuccess: () => { invalidate(); toast.success('Training updated'); onDone(); },
    onError: (e) => toast.error(e),
  });
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Switch checked={orientation} onChange={setOrientation} label="Site orientation" description="Walked the facility, knows access, alarm and emergency procedures" />
      <Switch checked={chemical} onChange={setChemical} label="Chemical training" description="Dilution, labels, SDS binder and the gym-approved product list" />
      <TextField type="date" label="Review by" min={todayIso()} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} hint="Training counts as current until this date" required />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={save.isPending} disabled={!validUntil}>Save</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Rounds: schedule crews onto zones (or the full facility) and log inspections
// ---------------------------------------------------------------------------
export function GymRoundsPage() {
  const { contract } = useGym();
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const rounds = useGymRounds(contract.id, scope);
  const [scheduling, setScheduling] = useState(false);
  const [inspecting, setInspecting] = useState<GymRound | null>(null);

  return (
    <div className="stack" style={{ ['--gap' as string]: '16px' }}>
      {!contract.scope_approved && <Alert tone="warn">Approve the operating plan before scheduling rounds. <Link to="/gym/plan">Open the plan</Link>.</Alert>}
      <div className="row wrap">
        <Segmented label="Rounds" value={scope} onChange={setScope} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }]} />
        <span className="grow" />
        <Button icon={<CalendarPlus />} disabled={!contract.scope_approved} onClick={() => setScheduling(true)}>Schedule rounds</Button>
      </div>
      <QueryState query={rounds} skeleton={<SkeletonList rows={4} height={88} />}>
        {(list) => list.length === 0 ? (
          <div className="card"><EmptyState icon={<CalendarPlus />} title={scope === 'upcoming' ? 'No rounds scheduled' : 'No past rounds'}>
            {scope === 'upcoming' ? 'Schedule a run of nights for the crew. Each round becomes a job with the approved checklist.' : 'Completed and cancelled rounds show up here.'}
          </EmptyState></div>
        ) : (
          <div className="stack" style={{ ['--gap' as string]: '10px' }}>
            {list.map((r) => <RoundCard key={r.id} round={r} onInspect={() => setInspecting(r)} />)}
          </div>
        )}
      </QueryState>
      <ScheduleModal open={scheduling} onClose={() => setScheduling(false)} />
      <InspectModal round={inspecting} onClose={() => setInspecting(null)} />
    </div>
  );
}

function RoundCard({ round, onInspect }: { round: GymRound; onInspect: () => void }) {
  const j = round.job;
  if (!j) return null;
  const crew = (j.job_assignments ?? []).map((a) => a.employee).filter(Boolean) as { id: string; full_name: string; color: string }[];
  const short = crew.length < round.required_staff && j.status === 'scheduled';
  const inspections = round.gym_inspections ?? [];
  const openCallouts = (round.gym_callouts ?? []).filter((c) => c.status !== 'covered');
  const canInspect = j.status === 'in_progress' || j.status === 'completed';
  return (
    <div className="card card-pad stack" style={{ ['--gap' as string]: '8px' }}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <p className="strong">{round.zone?.name ?? 'Full facility round'}</p>
          <p className="muted small">{fmtDate(j.scheduled_start)} · {fmtTimeRange(j.scheduled_start, j.scheduled_end)}</p>
        </div>
        <StatusBadge status={j.status} />
      </div>
      <div className="row wrap" style={{ ['--gap' as string]: '8px' }}>
        <span className="crew">{crew.map((c) => <Avatar key={c.id} name={c.full_name} color={c.color} size="sm" />)}</span>
        <span className={`small ${short ? 'strong' : 'muted'}`} style={short ? { color: 'var(--red)' } : undefined}>{crew.length}/{round.required_staff} staff{short ? ' — short' : ''}</span>
        {openCallouts.length > 0 && <Badge tone="red">{openCallouts.length} callout{openCallouts.length === 1 ? '' : 's'}</Badge>}
        {inspections.map((i) => <Badge key={i.id} tone={RESULT_META[i.result].tone}>{RESULT_META[i.result].label}{i.status === 'open' ? ' · open' : ''}</Badge>)}
      </div>
      <div className="row wrap" style={{ ['--gap' as string]: '8px' }}>
        <ButtonLink to={`/jobs/${j.id}`} size="sm" variant="secondary">Open job</ButtonLink>
        {canInspect && <Button size="sm" variant="soft" icon={<ClipboardCheck />} onClick={onInspect}>Inspect</Button>}
      </div>
    </div>
  );
}

function ScheduleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { contract } = useGym();
  const toast = useToast();
  const invalidate = useInvalidateGym();
  const plan = useGymPlan(contract.id);
  const employees = useEmployees();
  const training = useGymTraining();
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState('22:00');
  const [days, setDays] = useState(5);
  const [duration, setDuration] = useState(240);
  const [need, setNeed] = useState(2);
  const [zoneId, setZoneId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const byEmp = new Map((training.data ?? []).map((t) => [t.employee_id, t]));
  const active = (employees.data ?? []).filter((e) => e.status === 'active');
  const endDate = addDays(new Date(`${date}T00:00:00`), days - 1 + Math.floor((Number(time.slice(0, 2)) * 60 + duration) / 1440));
  const endIso = format(endDate, 'yyyy-MM-dd');
  const eligible = (id: string) => { const t = byEmp.get(id); return !!t && t.orientation && t.chemical && t.valid_until >= endIso; };
  const zones = (plan.data?.zones ?? []).filter((z) => z.in_scope && z.confirmed);
  const shown = active.filter((e) => !search || e.full_name.toLowerCase().includes(search.toLowerCase()));

  const schedule = useMutation({
    mutationFn: async () => gymAction(contract.id, { action: 'schedule', data: { date, time, days, duration, required_staff: need, employee_ids: picked, zone_id: zoneId || null } }),
    onSuccess: () => { invalidate(); toast.success(`${days} round${days === 1 ? '' : 's'} scheduled`); onClose(); setPicked([]); },
    onError: (e) => toast.error(e),
  });

  const err = picked.length < need ? `Pick at least ${need} cleared worker${need === 1 ? '' : 's'}` : null;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Modal open={open} onClose={onClose} title="Schedule rounds"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={<CalendarPlus />} loading={schedule.isPending} disabled={!!err} onClick={() => schedule.mutate()}>Schedule {days} round{days === 1 ? '' : 's'}</Button></>}>
      <div className="stack">
        <SelectField label="What" value={zoneId} onChange={(e) => setZoneId(e.target.value)} hint="A full round uses the approved checklist for every included zone">
          <option value="">Full facility round</option>
          {zones.map((z: GymZone) => <option key={z.id} value={z.id}>{z.name} only</option>)}
        </SelectField>
        <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <TextField type="date" label="First night" value={date} min={todayIso()} onChange={(e) => setDate(e.target.value)} />
          <TextField type="time" label="Start time" value={time} onChange={(e) => setTime(e.target.value)} />
          <TextField type="number" label="Consecutive nights" min={1} max={GYM_LIMITS.roundDays} value={days} onChange={(e) => setDays(Math.min(GYM_LIMITS.roundDays, Math.max(1, Number(e.target.value) || 1)))} />
          <TextField type="number" label="Length (minutes)" min={GYM_LIMITS.minutes.min} max={GYM_LIMITS.minutes.max} step={15} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 0)} />
          <TextField type="number" label="Staff needed" min={GYM_LIMITS.staff.min} max={GYM_LIMITS.staff.max} value={need} onChange={(e) => setNeed(Math.min(GYM_LIMITS.staff.max, Math.max(1, Number(e.target.value) || 1)))} />
        </div>
        <p className="muted small">Times are local to the site ({contract.timezone.replace('_', ' ')}). Overnight rounds past midnight are fine.</p>

        <div className="row-between"><span className="label">Crew · {picked.length} picked</span>
          <span className="search" style={{ maxWidth: 200 }}><Search aria-hidden /><input className="input" type="search" placeholder="Find…" aria-label="Find team member" value={search} onChange={(e) => setSearch(e.target.value)} /></span>
        </div>
        <div className="stack" style={{ ['--gap' as string]: '6px', maxHeight: 280, overflowY: 'auto' }}>
          {shown.map((e) => {
            const ok = eligible(e.id);
            const m = TRAINING_META[trainingState(byEmp.get(e.id))];
            return (
              <button key={e.id} type="button" className="gym-pick" aria-pressed={picked.includes(e.id)} disabled={!ok} onClick={() => toggle(e.id)}>
                <span className="box" aria-hidden><Check /></span>
                <Avatar name={e.full_name} color={e.color} size="sm" />
                <span className="grow strong truncate">{e.full_name}</span>
                <Badge tone={ok ? 'green' : m.tone}>{ok ? 'Cleared' : m.label === 'Cleared for site' ? 'Expires during run' : m.label}</Badge>
              </button>
            );
          })}
          {shown.length === 0 && <p className="subtle">No team members match.</p>}
        </div>
        {active.some((e) => !eligible(e.id)) && <p className="subtle">Greyed-out workers need current site training through {fmtDate(endIso + 'T12:00:00')} — record it under <Link to="/gym/team" onClick={onClose}>Team training</Link>.</p>}
        {err && <p className="error-text">{err}</p>}
      </div>
    </Modal>
  );
}

function InspectModal({ round, onClose }: { round: GymRound | null; onClose: () => void }) {
  const { contract } = useGym();
  const toast = useToast();
  const invalidate = useInvalidateGym();
  const [result, setResult] = useState<GymInspectionResult>('pass');
  const [finding, setFinding] = useState('');
  const [action, setAction] = useState('');
  const [due, setDue] = useState('');
  const reset = () => { setResult('pass'); setFinding(''); setAction(''); setDue(''); };
  const save = useMutation({
    mutationFn: async () => gymAction(contract.id, { action: 'inspect', data: { round_id: round!.id, result, finding: finding.trim(), corrective_action: action.trim(), due_at: result === 'pass' ? null : new Date(due).toISOString() } }),
    onSuccess: () => { invalidate(); toast.success(result === 'pass' ? 'Inspection passed' : 'Finding logged'); reset(); onClose(); },
    onError: (e) => toast.error(e),
  });
  const err = result !== 'pass' && (!finding.trim() ? 'Describe what you found' : !action.trim() ? 'Say what must be corrected' : !due ? 'Set a due date for the correction' : null);
  return (
    <Modal open={!!round} onClose={() => { reset(); onClose(); }} title={round ? `Inspect · ${round.zone?.name ?? 'Full facility round'}` : 'Inspect'}
      footer={<><Button variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button><Button icon={<ClipboardCheck />} loading={save.isPending} disabled={!!err} onClick={() => save.mutate()}>Log inspection</Button></>}>
      <div className="stack">
        {round?.job && <p className="muted small">{fmtDateTime(round.job.scheduled_start)} · {round.job.status === 'completed' ? 'Completed' : 'In progress'}</p>}
        <Segmented label="Result" block value={result} onChange={setResult} options={[{ value: 'pass', label: 'Pass' }, { value: 'rework', label: 'Rework' }, { value: 'critical', label: 'Critical' }]} />
        {result !== 'pass' && (
          <>
            {result === 'critical' && <Alert tone="error">Critical means a safety or sanitation issue the gym would notice — call the manager on duty, then log it here.</Alert>}
            <TextArea label="Finding" placeholder="Where and what — e.g. Women's locker room shower 3: soap scum on tile, drain hair" value={finding} onChange={(e) => setFinding(e.target.value)} style={{ minHeight: 80 }} />
            <TextArea label="Corrective action" placeholder="What the crew must do and who is responsible" value={action} onChange={(e) => setAction(e.target.value)} style={{ minHeight: 70 }} />
            <TextField type="datetime-local" label="Fix by" value={due} onChange={(e) => setDue(e.target.value)} />
          </>
        )}
        {err && <p className="error-text">{err}</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Callouts: a worker asks off a round → supervisor opens it → assigns cover
// ---------------------------------------------------------------------------
export function GymCalloutsPage() {
  const { contract } = useGym();
  const toast = useToast();
  const invalidate = useInvalidateGym();
  const q = useGymCallouts(contract.id);
  const [confirming, setConfirming] = useState<GymCallout | null>(null);
  const [covering, setCovering] = useState<GymCallout | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');

  const confirm = useMutation({
    mutationFn: async (c: GymCallout) => gymAction(contract.id, { action: 'confirm_callout', data: { id: c.id } }),
    onSuccess: () => { invalidate(); setConfirming(null); toast.success('Worker removed from the round — find cover'); },
    onError: (e) => { setConfirming(null); toast.error(e); },
  });

  const list = (q.data ?? []).filter((c) => filter === 'all' || c.status !== 'covered');
  return (
    <div className="stack" style={{ ['--gap' as string]: '16px' }}>
      <div className="row wrap">
        <Segmented label="Callouts" value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Needs action' }, { value: 'all', label: 'All' }]} />
        <span className="grow" />
        <p className="subtle">Workers request time off a round from the field app. Nothing personal is recorded — only availability.</p>
      </div>
      <QueryState query={q} skeleton={<SkeletonList rows={3} height={80} />}>
        {() => list.length === 0 ? (
          <div className="card"><EmptyState icon={<Users />} title={filter === 'open' ? 'All rounds are covered' : 'No callouts yet'}>{filter === 'open' ? 'No availability requests are waiting on you.' : 'Requests from the crew will appear here.'}</EmptyState></div>
        ) : (
          <div className="card list">
            {list.map((c) => {
              const m = CALLOUT_META[c.status];
              const j = c.round?.job;
              return (
                <div key={c.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <Avatar name={c.employee?.full_name} color={c.employee?.color} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="strong">{c.employee?.full_name ?? 'Team member'}</span>
                    <span className="muted small" style={{ display: 'block' }}>
                      {c.round?.zone?.name ?? 'Full facility round'}{j ? ` · ${fmtDate(j.scheduled_start)} ${fmtTimeRange(j.scheduled_start, j.scheduled_end)}` : ''}
                    </span>
                    <span className="subtle" style={{ display: 'block' }}>
                      Requested {fmtDateTime(c.created_at)}{c.status === 'covered' && c.replacement ? ` · covered by ${c.replacement.full_name}` : ''}
                    </span>
                  </span>
                  <span className="stack" style={{ ['--gap' as string]: '6px', alignItems: 'flex-end' }}>
                    <Badge tone={m.tone}>{m.label}</Badge>
                    {c.status === 'requested' && <Button size="sm" onClick={() => setConfirming(c)}>Approve request</Button>}
                    {c.status === 'open' && <Button size="sm" icon={<UserRoundCheck />} onClick={() => setCovering(c)}>Assign cover</Button>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </QueryState>
      <ConfirmDialog open={!!confirming} onClose={() => setConfirming(null)} onConfirm={() => confirm.mutate(confirming!)} loading={confirm.isPending}
        title="Approve this availability request?" confirmLabel="Approve">
        {confirming?.employee?.full_name} is taken off the round and it shows as needing coverage until you assign someone.
      </ConfirmDialog>
      <CoverModal callout={covering} onClose={() => setCovering(null)} />
    </div>
  );
}

function CoverModal({ callout, onClose }: { callout: GymCallout | null; onClose: () => void }) {
  const { contract } = useGym();
  const toast = useToast();
  const invalidate = useInvalidateGym();
  const employees = useEmployees();
  const training = useGymTraining();
  const [who, setWho] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const byEmp = new Map((training.data ?? []).map((t) => [t.employee_id, t]));
  const endIso = callout?.round?.job ? format(new Date(callout.round.job.scheduled_end), 'yyyy-MM-dd') : todayIso();
  const options = (employees.data ?? []).filter((e) => e.status === 'active' && e.id !== callout?.employee_id).map((e) => {
    const t = byEmp.get(e.id);
    return { e, ok: !!t && t.orientation && t.chemical && t.valid_until >= endIso };
  });
  const cover = useMutation({
    mutationFn: async () => gymAction(contract.id, { action: 'cover', data: { id: callout!.id, employee_id: who, confirmed: true } }),
    onSuccess: () => { invalidate(); toast.success('Round covered'); setWho(''); setConfirmed(false); onClose(); },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open={!!callout} onClose={onClose} title="Assign cover" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={cover.isPending} disabled={!who || !confirmed} onClick={() => cover.mutate()}>Assign</Button></>}>
      <div className="stack">
        {callout?.round?.job && <p className="muted small">{callout.round.zone?.name ?? 'Full facility round'} · {fmtDate(callout.round.job.scheduled_start)} {fmtTimeRange(callout.round.job.scheduled_start, callout.round.job.scheduled_end)}</p>}
        <SelectField label="Replacement" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Choose a cleared worker…</option>
          {options.map(({ e, ok }) => <option key={e.id} value={e.id} disabled={!ok}>{e.full_name}{ok ? '' : ' — not cleared'}</option>)}
        </SelectField>
        <Switch checked={confirmed} onChange={setConfirmed} label="They accepted" description="You spoke with the worker and they agreed to take the round" />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Inspections: findings stay open until re-inspected
// ---------------------------------------------------------------------------
export function GymInspectionsPage() {
  const { contract } = useGym();
  const q = useGymInspections(contract.id);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [resolving, setResolving] = useState<GymInspection | null>(null);
  const list = (q.data ?? []).filter((i) => filter === 'all' || i.status === 'open');
  return (
    <div className="stack" style={{ ['--gap' as string]: '16px' }}>
      <div className="row wrap">
        <Segmented label="Inspections" value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Open findings' }, { value: 'all', label: 'All' }]} />
        <span className="grow" />
        <p className="subtle">Log an inspection from a round under <Link to="/gym/rounds">Rounds</Link>.</p>
      </div>
      <QueryState query={q} skeleton={<SkeletonList rows={3} height={90} />}>
        {() => list.length === 0 ? (
          <div className="card"><EmptyState icon={<ShieldAlert />} title={filter === 'open' ? 'No open findings' : 'No inspections yet'}>{filter === 'open' ? 'Every finding has been corrected and re-inspected.' : 'Walk a round and log the result.'}</EmptyState></div>
        ) : (
          <div className="stack" style={{ ['--gap' as string]: '10px' }}>
            {list.map((i) => {
              const m = RESULT_META[i.result];
              const overdue = i.status === 'open' && i.due_at && new Date(i.due_at).getTime() < Date.now();
              return (
                <div key={i.id} className="card card-pad stack" style={{ ['--gap' as string]: '8px', borderColor: i.result === 'critical' && i.status === 'open' ? 'var(--red)' : undefined }}>
                  <div className="row-between" style={{ alignItems: 'flex-start' }}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <p className="strong row wrap" style={{ ['--gap' as string]: '8px' }}>{i.round?.zone?.name ?? 'Full facility round'}<Badge tone={m.tone}>{m.label}</Badge>{i.status === 'resolved' && i.result !== 'pass' && <Badge tone="green">Resolved</Badge>}{overdue && <Badge tone="red">Overdue</Badge>}</p>
                      <p className="muted small">Inspected {fmtDateTime(i.created_at)}{i.round?.job ? ` · round of ${fmtDate(i.round.job.scheduled_start)}` : ''}</p>
                    </div>
                    {i.status === 'open' && <Button size="sm" icon={<CheckCircle2 />} onClick={() => setResolving(i)}>Re-inspect</Button>}
                  </div>
                  {i.finding && <div className="callout" style={{ borderLeftColor: i.result === 'critical' ? 'var(--red)' : 'var(--amber)' }}><div className="label">Finding</div><p className="pre small">{i.finding}</p></div>}
                  {i.corrective_action && <p className="small"><span className="strong">Correct: </span>{i.corrective_action}{i.due_at ? <span className="muted"> · by {fmtDateTime(i.due_at)}</span> : null}</p>}
                  {i.resolution && <p className="small muted"><span className="strong">Re-inspection: </span>{i.resolution}{i.resolved_at ? ` · ${fmtDateTime(i.resolved_at)}` : ''}</p>}
                </div>
              );
            })}
          </div>
        )}
      </QueryState>
      <ResolveModal finding={resolving} onClose={() => setResolving(null)} />
    </div>
  );
}

function ResolveModal({ finding, onClose }: { finding: GymInspection | null; onClose: () => void }) {
  const { contract } = useGym();
  const toast = useToast();
  const invalidate = useInvalidateGym();
  const [rechecked, setRechecked] = useState(false);
  const [resolution, setResolution] = useState('');
  const save = useMutation({
    mutationFn: async () => gymAction(contract.id, { action: 'resolve', data: { id: finding!.id, rechecked: true, resolution: resolution.trim() } }),
    onSuccess: () => { invalidate(); toast.success('Finding closed'); setRechecked(false); setResolution(''); onClose(); },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open={!!finding} onClose={onClose} title="Close finding" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!rechecked || !resolution.trim()} onClick={() => save.mutate()}>Close finding</Button></>}>
      <div className="stack">
        {finding && <p className="muted small pre">{finding.finding}</p>}
        <TextArea label="What was corrected and what you saw on re-inspection" value={resolution} onChange={(e) => setResolution(e.target.value)} style={{ minHeight: 90 }} autoFocus />
        <Switch checked={rechecked} onChange={setRechecked} label="I re-inspected the area" description="Required before a finding can close" />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Reports: a snapshot the gym can see in its portal
// ---------------------------------------------------------------------------
export function GymReportsPage() {
  const { contract } = useGym();
  const toast = useToast();
  const invalidate = useInvalidateGym();
  const q = useGymReports(contract.id);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(format(addDays(new Date(), -6), 'yyyy-MM-dd'));
  const [end, setEnd] = useState(todayIso());
  const span = useMemo(() => Math.round((new Date(end).getTime() - new Date(start).getTime()) / 864e5), [start, end]);
  const err = !start || !end ? 'Pick both dates' : span < 0 ? 'End must be on or after start' : span > GYM_LIMITS.reportDays - 1 ? `Reports cover up to ${GYM_LIMITS.reportDays} days` : null;
  const publish = useMutation({
    mutationFn: async () => gymAction(contract.id, { action: 'publish', data: { start, end } }),
    onSuccess: () => { invalidate(); setOpen(false); toast.success('Report published to the facility portal'); },
    onError: (e) => toast.error(e),
  });
  return (
    <div className="stack" style={{ ['--gap' as string]: '16px' }}>
      <div className="card card-pad row wrap">
        <span className="avatar lg"><FileBarChart aria-hidden /></span>
        <div className="grow">
          <p className="strong">Service reports for {contract.client?.full_name ?? 'the facility'}</p>
          <p className="muted small">Each report freezes the numbers for a period — rounds scheduled and completed, inspections passed, findings — and appears in the gym’s client portal.</p>
        </div>
        <Button icon={<Send />} onClick={() => setOpen(true)}>Publish report</Button>
      </div>
      <QueryState query={q} skeleton={<SkeletonList rows={3} height={110} />}>
        {(list) => list.length === 0 ? (
          <div className="card"><EmptyState icon={<FileBarChart />} title="No reports yet">Publish your first weekly or monthly report once rounds are running.</EmptyState></div>
        ) : (
          <div className="stack" style={{ ['--gap' as string]: '10px' }}>
            {list.map((r) => <ReportCard key={r.id} report={r} />)}
          </div>
        )}
      </QueryState>
      <Modal open={open} onClose={() => setOpen(false)} title="Publish a report" size="sm"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button icon={<Send />} loading={publish.isPending} disabled={!!err} onClick={() => publish.mutate()}>Publish</Button></>}>
        <div className="stack">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <TextField type="date" label="From" value={start} onChange={(e) => setStart(e.target.value)} />
            <TextField type="date" label="To" value={end} max={todayIso()} onChange={(e) => setEnd(e.target.value)} />
          </div>
          {err ? <p className="error-text">{err}</p> : <p className="subtle">{span + 1} day{span === 0 ? '' : 's'}. The gym sees it right away.</p>}
        </div>
      </Modal>
    </div>
  );
}

/** Also used in the client portal. */
export function ReportCard({ report }: { report: GymReport }) {
  const s = report.snapshot;
  const rate = s.scheduled ? Math.round((s.completed / s.scheduled) * 100) : 0;
  const stat = (k: string, v: string | number, tone?: 'red' | 'amber' | 'green') => (
    <div className="card stat" style={{ background: 'var(--surface-2)' }}><div className="k">{k}</div><div className="v" style={tone ? { color: `var(--${tone})` } : undefined}>{v}</div></div>
  );
  return (
    <div className="card card-pad stack" style={{ ['--gap' as string]: '10px' }}>
      <div className="row-between">
        <div><p className="strong">{fmtDate(report.period_start + 'T12:00:00')} – {fmtDate(report.period_end + 'T12:00:00')}</p><p className="subtle">Published {fmtDateTime(report.created_at)}</p></div>
        <Badge tone={s.critical_findings ? 'red' : s.open_findings ? 'amber' : 'green'}>{s.critical_findings ? 'Critical finding' : s.open_findings ? 'Findings open' : 'Clean period'}</Badge>
      </div>
      <div className="stats">
        {stat('Rounds completed', `${s.completed}/${s.scheduled}`, s.scheduled && rate < 100 ? 'amber' : undefined)}
        {stat('Completion', `${rate}%`)}
        {stat('Inspections passed', s.passed_inspections, 'green')}
        {stat('Findings', `${s.open_findings} open · ${s.critical_findings} critical`, s.critical_findings ? 'red' : s.open_findings ? 'amber' : undefined)}
      </div>
    </div>
  );
}

// re-export so App.tsx has one import for the admin module
export { GymLayout, GymOverview, GymPlanPage } from './GymPages';
