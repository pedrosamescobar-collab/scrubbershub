import { useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle, Building2, CalendarClock, Check, CheckCircle2, ClipboardCheck, ClipboardList, Dumbbell, FileBarChart, LayoutGrid, Lock, MapPin, Pencil, Plus, Rocket, ShieldCheck, Trash2, UserRoundCheck, Users, Workflow,
} from 'lucide-react';
import { useWorkspace } from '@/auth/AuthProvider';
import type { GymContract, GymReadiness, GymReadinessStatus, GymZone } from '@/lib/types';
import { Button, ButtonLink } from '@/components/ui/Button';
import { SelectField, Switch, TextArea, TextField } from '@/components/ui/Form';
import { Alert, EmptyState, QueryState, SkeletonList } from '@/components/ui/Feedback';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Badge, PageHeader, ProgressBar, SectionTitle } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { useClients } from '@/features/shared/api';
import {
  GYM_LIMITS, SITE, STARTER_READINESS, STARTER_ZONES, gymAction, gymSetup, parseTasks, useGymCallouts, useGymContract, useGymInspections, useGymPlan, useGymRounds, useInvalidateGym, type ZoneDraft,
} from './api';

// ---------------------------------------------------------------------------
// Layout: one site per company. Before setup the layout *is* the setup page.
// ---------------------------------------------------------------------------
export interface GymCtx { contract: GymContract }
export const useGym = () => useOutletContext<GymCtx>();

const TABS = [
  { to: '/gym', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/gym/plan', label: 'Zones & plan', icon: ClipboardList },
  { to: '/gym/team', label: 'Team training', icon: UserRoundCheck },
  { to: '/gym/rounds', label: 'Rounds', icon: CalendarClock },
  { to: '/gym/callouts', label: 'Callouts', icon: Users },
  { to: '/gym/inspections', label: 'Inspections', icon: ClipboardCheck },
  { to: '/gym/reports', label: 'Reports', icon: FileBarChart },
];

export function GymLayout() {
  const q = useGymContract();
  return (
    <QueryState query={q} skeleton={<SkeletonList rows={3} height={110} />}>
      {(contract) => contract ? (
        <div className="stack" style={{ ['--gap' as string]: '16px' }}>
          <PageHeader title={contract.name}
            sub={<span className="row wrap" style={{ ['--gap' as string]: '8px' }}>
              <span className="row" style={{ ['--gap' as string]: '4px' }}><MapPin size={14} aria-hidden />{contract.address}</span>
              <PhaseBadge contract={contract} />
            </span>}
            actions={<ButtonLink to={`/clients/${contract.client_id}`} variant="secondary" size="sm" icon={<Building2 />}>Facility client</ButtonLink>} />
          <nav className="gym-tabs" aria-label="Gym operations">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end}><t.icon aria-hidden />{t.label}</NavLink>
            ))}
          </nav>
          <Outlet context={{ contract } satisfies GymCtx} />
        </div>
      ) : <GymSetupPage />}
    </QueryState>
  );
}

export function PhaseBadge({ contract }: { contract: GymContract }) {
  return contract.phase === 'operating'
    ? <Badge tone="green">Daily operations</Badge>
    : <Badge tone="amber">Pre-opening</Badge>;
}

// ---------------------------------------------------------------------------
// Setup: propose the operating plan, then create the facility client + contract
// ---------------------------------------------------------------------------
function GymSetupPage() {
  const ws = useWorkspace();
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidateGym();
  const clients = useClients();
  const [clientId, setClientId] = useState('');
  const [zones, setZones] = useState<ZoneDraft[]>(STARTER_ZONES);
  const [readiness, setReadiness] = useState<string[]>(STARTER_READINESS);
  const [editing, setEditing] = useState<number | null>(null);
  const [newItem, setNewItem] = useState('');

  const included = zones.filter((z) => z.in_scope).length;
  const create = useMutation({
    mutationFn: async () => gymSetup(ws.org.id, zones, readiness, clientId || null),
    onSuccess: () => { invalidate(); toast.success('Facility set up — work through the readiness list next'); navigate('/gym'); },
    onError: (e) => toast.error(e),
  });

  const activeClients = (clients.data ?? []).filter((c) => c.status === 'active');

  return (
    <div className="stack" style={{ ['--gap' as string]: '16px' }}>
      <PageHeader title="Gym operations" sub={`Set up ${SITE.name} as a managed site`} />

      <div className="card card-pad stack" style={{ ['--gap' as string]: '12px' }}>
        <div className="row" style={{ ['--gap' as string]: '12px' }}>
          <span className="avatar lg"><Dumbbell aria-hidden /></span>
          <div className="grow">
            <p className="strong">{SITE.name}</p>
            <p className="muted small">{SITE.address}</p>
          </div>
        </div>
        <p className="muted small">
          This creates the facility as a client, a checklist template for every zone, and a pre-opening readiness list. Nothing is scheduled until you confirm each zone and approve the plan.
        </p>
        <SelectField label="Facility client record" value={clientId} onChange={(e) => setClientId(e.target.value)}
          hint="Pick the gym if you already added it as a client; otherwise a new client is created for the site.">
          <option value="">Create a new client for this site</option>
          {activeClients.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
        </SelectField>
      </div>

      <SectionTitle action={<span className="subtle">{included} of {zones.length} included</span>}>Proposed zones</SectionTitle>
      <div className="card list">
        {zones.map((z, i) => (
          <div key={i} className="list-item" style={{ alignItems: 'flex-start' }}>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="row" style={{ ['--gap' as string]: '8px' }}>
                <span className={`strong ${z.in_scope ? '' : 'muted'}`}>{z.name}</span>
                {!z.in_scope && <Badge tone="gray">Optional</Badge>}
              </span>
              <span className="muted small" style={{ display: 'block' }}>{z.cadence} · {z.tasks.length} tasks</span>
            </span>
            <span className="row" style={{ ['--gap' as string]: '4px' }}>
              <Button size="sm" variant="secondary" iconOnly aria-label={`Edit ${z.name}`} icon={<Pencil />} onClick={() => setEditing(i)} />
              <Button size="sm" variant={z.in_scope ? 'soft' : 'ghost'} onClick={() => setZones(zones.map((x, j) => (j === i ? { ...x, in_scope: !x.in_scope } : x)))}>
                {z.in_scope ? 'Included' : 'Include'}
              </Button>
            </span>
          </div>
        ))}
      </div>
      {zones.length < GYM_LIMITS.zones && (
        <Button variant="secondary" icon={<Plus />} onClick={() => { setZones([...zones, { name: 'New zone', cadence: 'Nightly', in_scope: true, tasks: ['Empty trash'], instructions: '' }]); setEditing(zones.length); }}>Add a zone</Button>
      )}

      <SectionTitle action={<span className="subtle">{readiness.length} items</span>}>Pre-opening readiness</SectionTitle>
      <div className="card list">
        {readiness.map((r, i) => (
          <div key={i} className="list-item" style={{ minHeight: 52 }}>
            <span className="grow">{r}</span>
            <Button size="sm" variant="ghost" iconOnly aria-label="Remove" icon={<Trash2 />} onClick={() => setReadiness(readiness.filter((_, j) => j !== i))} />
          </div>
        ))}
        <form className="list-item" onSubmit={(e) => { e.preventDefault(); if (newItem.trim() && readiness.length < GYM_LIMITS.readiness) { setReadiness([...readiness, newItem.trim()]); setNewItem(''); } }}>
          <input className="input grow" placeholder="Add a readiness item…" value={newItem} onChange={(e) => setNewItem(e.target.value)} aria-label="New readiness item" />
          <Button type="submit" size="sm" variant="secondary" disabled={!newItem.trim() || readiness.length >= GYM_LIMITS.readiness}>Add</Button>
        </form>
      </div>

      <div className="sticky-actions">
        <Button size="xl" block icon={<Rocket />} loading={create.isPending} disabled={included === 0 || readiness.length === 0}
          onClick={() => create.mutate()}>Set up {SITE.name.split(' ·')[0]}</Button>
      </div>

      <ZoneDraftModal open={editing !== null} draft={editing !== null ? zones[editing] : null} onClose={() => setEditing(null)}
        onSave={(d) => { setZones(zones.map((x, j) => (j === editing ? d : x))); setEditing(null); }}
        onRemove={zones.length > 1 ? () => { setZones(zones.filter((_, j) => j !== editing)); setEditing(null); } : undefined} />
    </div>
  );
}

function ZoneDraftModal({ open, draft, onClose, onSave, onRemove }: { open: boolean; draft: ZoneDraft | null; onClose: () => void; onSave: (d: ZoneDraft) => void; onRemove?: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Zone">
      {draft && <ZoneForm key={draft.name + draft.tasks.length} initial={draft} allowName onCancel={onClose} onRemove={onRemove} onSubmit={(d) => onSave(d)} />}
    </Modal>
  );
}

/** Shared editor for a zone (proposal stage allows renaming; after setup the name is fixed by its checklist template). */
function ZoneForm({ initial, allowName, onSubmit, onCancel, onRemove, saving }: {
  initial: ZoneDraft & { confirmed?: boolean }; allowName?: boolean; saving?: boolean;
  onSubmit: (d: ZoneDraft & { confirmed: boolean }) => void; onCancel: () => void; onRemove?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [cadence, setCadence] = useState(initial.cadence);
  const [tasks, setTasks] = useState(initial.tasks.join('\n'));
  const [instructions, setInstructions] = useState(initial.instructions);
  const [inScope, setInScope] = useState(initial.in_scope);
  const [confirmed, setConfirmed] = useState(!!initial.confirmed);
  const list = parseTasks(tasks);
  const tooLong = list.filter((t) => t.length > GYM_LIMITS.taskLength);
  const err = !name.trim() ? 'Name the zone' : name.trim().length > GYM_LIMITS.zoneNameLength ? `Keep the name under ${GYM_LIMITS.zoneNameLength} characters`
    : !cadence.trim() ? 'Say how often this zone is cleaned' : cadence.length > GYM_LIMITS.cadenceLength ? 'Frequency is too long'
    : list.length === 0 ? 'Add at least one task' : list.length > GYM_LIMITS.tasksPerZone ? `Keep it to ${GYM_LIMITS.tasksPerZone} tasks`
    : tooLong.length ? `${tooLong.length} task${tooLong.length === 1 ? ' is' : 's are'} over ${GYM_LIMITS.taskLength} characters` : null;
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!err) onSubmit({ name: name.trim(), cadence: cadence.trim(), in_scope: inScope, tasks: list, instructions: instructions.trim(), confirmed }); }}>
      {allowName ? <TextField label="Zone" value={name} onChange={(e) => setName(e.target.value)} maxLength={GYM_LIMITS.zoneNameLength} autoFocus /> : <p className="strong">{name}</p>}
      <TextField label="Frequency" value={cadence} onChange={(e) => setCadence(e.target.value)} placeholder="e.g. Nightly; restrooms checked every 2 hours" />
      <TextArea label="Checklist tasks" hint={`One per line · ${list.length}/${GYM_LIMITS.tasksPerZone}`} value={tasks} onChange={(e) => setTasks(e.target.value)} style={{ minHeight: 160 }} />
      <TextArea label="Instructions for the crew" hint="Chemicals, access, wet-floor controls, anything the gym asked for" value={instructions} onChange={(e) => setInstructions(e.target.value)} style={{ minHeight: 70 }} />
      <Switch checked={inScope} onChange={setInScope} label="Included in the contract" description="Optional zones stay in the plan but aren’t scheduled" />
      {!allowName && <Switch checked={confirmed} onChange={setConfirmed} label="Confirmed with the facility" description="Frequency and tasks were walked through with gym management" />}
      {err && <p className="error-text">{err}</p>}
      <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
        {onRemove && <Button type="button" variant="danger-ghost" icon={<Trash2 />} onClick={onRemove}>Remove</Button>}
        <span className="grow" />
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={!!err} loading={saving}>Save</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Overview: phase, readiness list and what needs attention today
// ---------------------------------------------------------------------------
export function GymOverview() {
  const { contract } = useGym();
  const toast = useToast();
  const invalidate = useInvalidateGym();
  const plan = useGymPlan(contract.id);
  const rounds = useGymRounds(contract.id, 'upcoming');
  const callouts = useGymCallouts(contract.id);
  const inspections = useGymInspections(contract.id);
  const [confirmPhase, setConfirmPhase] = useState<'operating' | 'pre_opening' | null>(null);

  const ready = plan.data?.readiness ?? [];
  const done = ready.filter((r) => r.status === 'done').length;
  const blocked = ready.filter((r) => r.status === 'blocked').length;
  const zonesIn = (plan.data?.zones ?? []).filter((z) => z.in_scope);
  const unconfirmed = zonesIn.filter((z) => !z.confirmed).length;
  const canOperate = contract.scope_approved && ready.length > 0 && done === ready.length;

  const phase = useMutation({
    mutationFn: async (p: 'operating' | 'pre_opening') => gymAction(contract.id, { action: 'phase', data: { phase: p } }),
    onSuccess: (_d, p) => { setConfirmPhase(null); invalidate(); toast.success(p === 'operating' ? 'Daily operations started' : 'Back in pre-opening'); },
    onError: (e) => { setConfirmPhase(null); toast.error(e); },
  });

  const upcoming = rounds.data ?? [];
  const next24 = upcoming.filter((r) => r.job && new Date(r.job.scheduled_start).getTime() < Date.now() + 24 * 3600e3);
  const openCallouts = (callouts.data ?? []).filter((c) => c.status !== 'covered');
  const openFindings = (inspections.data ?? []).filter((i) => i.status === 'open');
  const critical = openFindings.filter((i) => i.result === 'critical').length;

  return (
    <div className="grid-2-lg">
      <div className="stack" style={{ ['--gap' as string]: '16px' }}>
        {contract.phase === 'pre_opening' ? (
          <div className="card card-pad stack">
            <div className="row-between">
              <div><h2>Pre-opening</h2><p className="subtle">{done} of {ready.length} readiness items done</p></div>
              <Badge tone={contract.scope_approved ? 'green' : 'amber'}>{contract.scope_approved ? 'Plan approved' : 'Plan not approved'}</Badge>
            </div>
            <ProgressBar value={done} total={ready.length} size="lg" />
            {!contract.scope_approved && (
              <Alert tone="info">{unconfirmed ? `${unconfirmed} included zone${unconfirmed === 1 ? ' still needs' : 's still need'} confirming.` : 'Every included zone is confirmed.'} <Link to="/gym/plan">Review and approve the plan</Link> before scheduling rounds.</Alert>
            )}
            {blocked > 0 && <Alert tone="warn">{blocked} readiness item{blocked === 1 ? ' is' : 's are'} blocked — see notes below.</Alert>}
            <Button icon={<Rocket />} disabled={!canOperate} onClick={() => setConfirmPhase('operating')}>Start daily operations</Button>
            {!canOperate && <p className="subtle">Available once the plan is approved and every readiness item is done.</p>}
          </div>
        ) : (
          <>
            <div className="stats">
              <Link to="/gym/rounds" className="card stat card-link"><div className="k">Rounds · next 24h</div><div className="v">{next24.length}</div></Link>
              <Link to="/gym/callouts" className="card stat card-link"><div className="k">Callouts to handle</div><div className="v" style={openCallouts.length ? { color: 'var(--red)' } : undefined}>{openCallouts.length}</div></Link>
              <Link to="/gym/inspections" className="card stat card-link"><div className="k">Open findings</div><div className="v" style={critical ? { color: 'var(--red)' } : openFindings.length ? { color: 'var(--amber)' } : undefined}>{openFindings.length}{critical ? ` · ${critical} critical` : ''}</div></Link>
              <Link to="/gym/plan" className="card stat card-link"><div className="k">Zones in scope</div><div className="v">{zonesIn.length}</div></Link>
            </div>
            <div className="card">
              <div className="card-header"><h2>Next rounds</h2><ButtonLink to="/gym/rounds" variant="soft" size="sm">All rounds</ButtonLink></div>
              <div className="list mt-8">
                {rounds.isLoading && <div className="card-body"><SkeletonList rows={2} height={56} /></div>}
                {!rounds.isLoading && upcoming.length === 0 && <p className="subtle card-body">Nothing scheduled. <Link to="/gym/rounds">Schedule rounds</Link>.</p>}
                {upcoming.slice(0, 5).map((r) => (
                  <Link key={r.id} to={`/jobs/${r.job_id}`} className="list-item">
                    <span className="grow"><span className="strong">{r.zone?.name ?? 'Full facility round'}</span><span className="muted small" style={{ display: 'block' }}>{r.job && new Date(r.job.scheduled_start).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {r.job?.job_assignments?.length ?? 0}/{r.required_staff} staff</span></span>
                    <Badge tone={r.job?.status === 'completed' ? 'green' : r.job?.status === 'in_progress' ? 'amber' : 'blue'}>{r.job?.status === 'in_progress' ? 'In progress' : r.job?.status === 'completed' ? 'Done' : 'Scheduled'}</Badge>
                  </Link>
                ))}
              </div>
            </div>
            <div className="card card-pad row wrap">
              <span className="grow muted small">Need to pause the site (re-walk the scope, renegotiate)? You can return to pre-opening; scheduled rounds stay as they are.</span>
              <Button variant="ghost" size="sm" icon={<Lock />} onClick={() => setConfirmPhase('pre_opening')}>Back to pre-opening</Button>
            </div>
          </>
        )}
      </div>

      <div className="stack" style={{ ['--gap' as string]: '16px' }}>
        <div className="card">
          <div className="card-header"><h2 className="row" style={{ ['--gap' as string]: '8px' }}><ShieldCheck size={18} aria-hidden />Readiness</h2><span className="subtle">{done}/{ready.length}</span></div>
          <div className="list mt-8">
            {plan.isLoading && <div className="card-body"><SkeletonList rows={4} height={48} /></div>}
            {ready.map((r) => <ReadinessRow key={r.id} item={r} contractId={contract.id} />)}
          </div>
        </div>
      </div>

      <ConfirmDialog open={!!confirmPhase} onClose={() => setConfirmPhase(null)} onConfirm={() => phase.mutate(confirmPhase!)} loading={phase.isPending}
        title={confirmPhase === 'operating' ? 'Start daily operations?' : 'Return to pre-opening?'} confirmLabel={confirmPhase === 'operating' ? 'Start operations' : 'Go back'}>
        {confirmPhase === 'operating' ? 'The site moves to daily operations. Use Rounds to schedule the crew, Inspections to log walkthroughs, and Reports to publish results to the gym.' : 'The site is marked as pre-opening again. Existing rounds are not cancelled.'}
      </ConfirmDialog>
    </div>
  );
}

const READY_META: Record<GymReadinessStatus, { label: string; tone: 'gray' | 'red' | 'green' }> = {
  todo: { label: 'To do', tone: 'gray' }, blocked: { label: 'Blocked', tone: 'red' }, done: { label: 'Done', tone: 'green' },
};

function ReadinessRow({ item, contractId }: { item: GymReadiness; contractId: string }) {
  const toast = useToast();
  const invalidate = useInvalidateGym();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<GymReadinessStatus>(item.status);
  const [note, setNote] = useState(item.note);
  const save = useMutation({
    mutationFn: async (d: { status: GymReadinessStatus; note: string }) => gymAction(contractId, { action: 'readiness', data: { id: item.id, ...d } }),
    onSuccess: () => { invalidate(); setOpen(false); },
    onError: (e) => toast.error(e),
  });
  const m = READY_META[item.status];
  return (
    <>
      <button className="list-item" onClick={() => { setStatus(item.status); setNote(item.note); setOpen(true); }} style={{ minHeight: 56 }}>
        <span className="box" aria-hidden style={{ width: 26, height: 26, borderRadius: 8, border: '2px solid var(--border-strong)', display: 'grid', placeItems: 'center', flexShrink: 0, background: item.status === 'done' ? 'var(--green)' : item.status === 'blocked' ? 'var(--red)' : undefined, borderColor: item.status === 'done' ? 'var(--green)' : item.status === 'blocked' ? 'var(--red)' : undefined, color: '#fff' }}>
          {item.status === 'done' ? <Check size={16} /> : item.status === 'blocked' ? <AlertTriangle size={14} /> : null}
        </span>
        <span className="grow" style={{ minWidth: 0 }}>
          <span className={item.status === 'done' ? 'muted' : ''} style={{ textDecoration: item.status === 'done' ? 'line-through' : undefined }}>{item.label}</span>
          {item.note && <span className="subtle truncate" style={{ display: 'block' }}>{item.note}</span>}
        </span>
        <Badge tone={m.tone}>{m.label}</Badge>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Readiness item" size="sm"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate({ status, note: note.trim() })}>Save</Button></>}>
        <div className="stack">
          <p className="strong">{item.label}</p>
          <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as GymReadinessStatus)}>
            <option value="todo">To do</option><option value="blocked">Blocked</option><option value="done">Done</option>
          </SelectField>
          <TextArea label="Note" placeholder={status === 'blocked' ? 'What is it waiting on?' : 'Who confirmed it, dates, where things are stored…'} value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 80 }} />
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Plan: zones, their frequency and checklists; approval snapshots the template
// ---------------------------------------------------------------------------
export function GymPlanPage() {
  const { contract } = useGym();
  const toast = useToast();
  const invalidate = useInvalidateGym();
  const plan = useGymPlan(contract.id);
  const [editing, setEditing] = useState<GymZone | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);

  const zones = plan.data?.zones ?? [];
  const included = zones.filter((z) => z.in_scope);
  const unconfirmed = included.filter((z) => !z.confirmed);
  const totalTasks = useMemo(() => included.reduce((s, z) => s + z.tasks.length, 0), [included]);

  const saveZone = useMutation({
    mutationFn: async (d: ZoneDraft & { confirmed: boolean; id: string }) => gymAction(contract.id, { action: 'zone', data: { id: d.id, cadence: d.cadence, in_scope: d.in_scope, confirmed: d.confirmed, tasks: d.tasks, instructions: d.instructions } }),
    onSuccess: () => { invalidate(); setEditing(null); toast.success(contract.scope_approved ? 'Zone saved — approve the plan again to use the change on new rounds' : 'Zone saved'); },
    onError: (e) => toast.error(e),
  });
  const quick = useMutation({
    mutationFn: async (z: GymZone & { patch: Partial<Pick<GymZone, 'in_scope' | 'confirmed'>> }) =>
      gymAction(contract.id, { action: 'zone', data: { id: z.id, cadence: z.cadence, in_scope: z.patch.in_scope ?? z.in_scope, confirmed: z.patch.confirmed ?? z.confirmed, tasks: z.tasks, instructions: z.instructions } }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e),
  });
  const approve = useMutation({
    mutationFn: async () => gymAction(contract.id, { action: 'approve' }),
    onSuccess: () => { invalidate(); setConfirmApprove(false); toast.success('Plan approved — rounds can be scheduled'); },
    onError: (e) => { setConfirmApprove(false); toast.error(e); },
  });

  return (
    <div className="stack" style={{ ['--gap' as string]: '16px' }}>
      <div className="card card-pad row wrap">
        <div className="grow">
          <p className="strong">{included.length} zones in scope · {totalTasks} checklist tasks</p>
          <p className="muted small">
            {contract.scope_approved ? 'Approved. Editing a zone un-approves the plan until you approve it again, so rounds always run on a checklist the gym signed off.'
              : unconfirmed.length ? `Confirm ${unconfirmed.length} more zone${unconfirmed.length === 1 ? '' : 's'} with the facility, then approve.` : 'Every included zone is confirmed. Approve the plan to allow scheduling.'}
          </p>
        </div>
        {contract.scope_approved
          ? <Badge tone="green">Approved</Badge>
          : <Button icon={<CheckCircle2 />} disabled={included.length === 0 || unconfirmed.length > 0} onClick={() => setConfirmApprove(true)}>Approve plan</Button>}
      </div>

      <QueryState query={plan} skeleton={<SkeletonList rows={4} height={96} />}>
        {() => zones.length === 0 ? <div className="card"><EmptyState icon={<Workflow />} title="No zones">The plan has no zones.</EmptyState></div> : (
          <div className="stack" style={{ ['--gap' as string]: '12px' }}>
            {zones.map((z) => (
              <div key={z.id} className="card card-pad stack" style={{ ['--gap' as string]: '10px', opacity: z.in_scope ? 1 : 0.7 }}>
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <p className="strong row wrap" style={{ ['--gap' as string]: '8px' }}>{z.name}
                      {!z.in_scope ? <Badge tone="gray">Not in contract</Badge> : z.confirmed ? <Badge tone="green">Confirmed</Badge> : <Badge tone="amber">Needs confirming</Badge>}
                    </p>
                    <p className="muted small">{z.cadence}</p>
                  </div>
                  <Button size="sm" variant="secondary" icon={<Pencil />} onClick={() => setEditing(z)}>Edit</Button>
                </div>
                <ul className="small muted" style={{ paddingLeft: 18, columns: z.tasks.length > 4 ? 2 : 1, columnGap: 24 }}>
                  {z.tasks.map((t, i) => <li key={i} style={{ breakInside: 'avoid' }}>{t}</li>)}
                </ul>
                {z.instructions && <div className="callout"><div className="label"><ClipboardList aria-hidden />Crew instructions</div><p className="pre small">{z.instructions}</p></div>}
                <div className="row wrap" style={{ ['--gap' as string]: '8px' }}>
                  <Button size="sm" variant={z.in_scope ? 'ghost' : 'soft'} loading={quick.isPending && quick.variables?.id === z.id && 'in_scope' in quick.variables.patch}
                    onClick={() => quick.mutate({ ...z, patch: { in_scope: !z.in_scope } })}>{z.in_scope ? 'Remove from contract' : 'Add to contract'}</Button>
                  {z.in_scope && (
                    <Button size="sm" variant={z.confirmed ? 'ghost' : 'primary'} icon={z.confirmed ? undefined : <Check />} loading={quick.isPending && quick.variables?.id === z.id && 'confirmed' in quick.variables.patch}
                      onClick={() => quick.mutate({ ...z, patch: { confirmed: !z.confirmed } })}>{z.confirmed ? 'Un-confirm' : 'Confirm with facility'}</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </QueryState>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.name ?? 'Zone'}>
        {editing && <ZoneForm key={editing.id} initial={editing} saving={saveZone.isPending} onCancel={() => setEditing(null)} onSubmit={(d) => saveZone.mutate({ ...d, id: editing.id })} />}
      </Modal>
      <ConfirmDialog open={confirmApprove} onClose={() => setConfirmApprove(false)} onConfirm={() => approve.mutate()} loading={approve.isPending}
        title="Approve the operating plan?" confirmLabel="Approve">
        A “Full facility round” checklist is built from the {included.length} included zones ({totalTasks} tasks). New rounds use it until a zone changes and you approve again.
      </ConfirmDialog>
    </div>
  );
}
