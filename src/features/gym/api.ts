import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import { useWorkspace } from '@/auth/AuthProvider';
import { JOB_LIST_SELECT } from '@/features/shared/api';
import type {
  GymCallout, GymContract, GymInspection, GymInspectionResult, GymPhase, GymReadiness, GymReadinessStatus, GymReport, GymRound, GymTraining, GymZone,
} from '@/lib/types';

// Limits enforced by the database (gym migration + 0001 checklist tables).
export const GYM_LIMITS = {
  zones: 20,
  readiness: 30,
  tasksPerZone: 50,
  taskLength: 200,      // checklist_items.label
  zoneNameLength: 74,   // 'EōS · ' + name must fit checklist_templates.name (80)
  cadenceLength: 500,
  roundDays: 14,
  minutes: { min: 15, max: 720 },
  staff: { min: 1, max: 20 },
  reportDays: 94,
};

export const SITE = {
  name: 'EōS Fitness · 54th Ave S',
  address: '2830 54th Avenue S, St. Petersburg, FL 33712',
  timezone: 'America/New_York',
};

export const gymKeys = {
  all: ['gym'] as const,
  contract: (org: string) => ['gym', org, 'contract'] as const,
  plan: (contract: string) => ['gym', 'plan', contract] as const,
  training: (org: string) => ['gym', org, 'training'] as const,
  rounds: (contract: string, scope: string) => ['gym', 'rounds', contract, scope] as const,
  callouts: (contract: string) => ['gym', 'callouts', contract] as const,
  inspections: (contract: string) => ['gym', 'inspections', contract] as const,
  reports: (contract: string) => ['gym', 'reports', contract] as const,
  roundForJob: (job: string) => ['gym', 'round-for-job', job] as const,
  myTraining: (employee: string) => ['gym', 'my-training', employee] as const,
  myReports: (client: string) => ['gym', 'my-reports', client] as const,
};

const CONTRACT_SELECT = '*, client:clients(id, full_name, email, phone, user_id)';
const TRAINING_SELECT = '*, employee:employees(id, full_name, color, status, role_title)';
const ROUND_SELECT = `*, zone:gym_zones(id, name), job:jobs(${JOB_LIST_SELECT}), gym_inspections(*), gym_callouts(*)`;
const CALLOUT_SELECT = '*, employee:employees!gym_callouts_employee_id_fkey(id, full_name, color), replacement:employees!gym_callouts_replacement_id_fkey(id, full_name, color), round:gym_rounds(id, job_id, required_staff, zone:gym_zones(id, name), job:jobs(id, service_name, scheduled_start, scheduled_end, status))';
const INSPECTION_SELECT = '*, round:gym_rounds(id, job_id, zone:gym_zones(id, name), job:jobs(id, service_name, scheduled_start, status))';

// ---- queries --------------------------------------------------------------
/** The gym contract for this workspace (one site per company), or null before setup. */
export function useGymContract() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: gymKeys.contract(ws.org.id),
    queryFn: async () =>
      (unwrap(await supabase.from('gym_contracts').select(CONTRACT_SELECT).eq('org_id', ws.org.id).order('created_at').limit(1).maybeSingle()) as unknown as GymContract | null) ?? null,
  });
}

export function useGymPlan(contractId: string | undefined) {
  return useQuery({
    queryKey: gymKeys.plan(contractId ?? ''),
    enabled: !!contractId,
    queryFn: async () => {
      const [zones, readiness] = await Promise.all([
        supabase.from('gym_zones').select('*').eq('contract_id', contractId!).order('name'),
        supabase.from('gym_readiness').select('*').eq('contract_id', contractId!).order('label'),
      ]);
      return { zones: unwrap(zones) as GymZone[], readiness: unwrap(readiness) as GymReadiness[] };
    },
  });
}

export function useGymTraining() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: gymKeys.training(ws.org.id),
    queryFn: async () => unwrap(await supabase.from('gym_training').select(TRAINING_SELECT).eq('org_id', ws.org.id)) as unknown as GymTraining[],
  });
}

export function useGymRounds(contractId: string | undefined, scope: 'upcoming' | 'past') {
  return useQuery({
    queryKey: gymKeys.rounds(contractId ?? '', scope),
    enabled: !!contractId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('gym_rounds').select(ROUND_SELECT).eq('contract_id', contractId!)) as unknown as GymRound[];
      const now = Date.now() - 6 * 3600e3; // "upcoming" keeps rounds from the last 6 hours so the night shift stays visible
      const pick = rows.filter((r) => r.job && (scope === 'upcoming' ? new Date(r.job.scheduled_start).getTime() >= now : new Date(r.job.scheduled_start).getTime() < now));
      return pick.sort((a, b) => (scope === 'upcoming' ? 1 : -1) * (new Date(a.job!.scheduled_start).getTime() - new Date(b.job!.scheduled_start).getTime()));
    },
  });
}

export function useGymCallouts(contractId: string | undefined) {
  return useQuery({
    queryKey: gymKeys.callouts(contractId ?? ''),
    enabled: !!contractId,
    refetchInterval: 60_000,
    queryFn: async () => unwrap(await supabase.from('gym_callouts').select(CALLOUT_SELECT).eq('contract_id', contractId!).order('created_at', { ascending: false })) as unknown as GymCallout[],
  });
}

export function useGymInspections(contractId: string | undefined) {
  return useQuery({
    queryKey: gymKeys.inspections(contractId ?? ''),
    enabled: !!contractId,
    queryFn: async () => unwrap(await supabase.from('gym_inspections').select(INSPECTION_SELECT).eq('contract_id', contractId!).order('created_at', { ascending: false }).limit(200)) as unknown as GymInspection[],
  });
}

export function useGymReports(contractId: string | undefined) {
  return useQuery({
    queryKey: gymKeys.reports(contractId ?? ''),
    enabled: !!contractId,
    queryFn: async () => unwrap(await supabase.from('gym_reports').select('*').eq('contract_id', contractId!).order('period_end', { ascending: false })) as GymReport[],
  });
}

/** Field app: the gym round behind a job, if the job is one (RLS: only assigned workers and admins see it). */
export function useRoundForJob(jobId: string) {
  return useQuery({
    queryKey: gymKeys.roundForJob(jobId),
    queryFn: async () => {
      const r = unwrap(await supabase.from('gym_rounds').select('*, zone:gym_zones(id, name), contract:gym_contracts(id, name, address), gym_callouts(*)').eq('job_id', jobId).maybeSingle()) as unknown as (GymRound & { contract?: Pick<GymContract, 'id' | 'name' | 'address'> | null }) | null;
      return r ?? null;
    },
  });
}

/** Field app: my own site training record. */
export function useMyTraining() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: gymKeys.myTraining(ws.employeeId ?? ''),
    enabled: !!ws.employeeId,
    queryFn: async () => (unwrap(await supabase.from('gym_training').select('*').eq('employee_id', ws.employeeId!).maybeSingle()) as GymTraining | null) ?? null,
  });
}

/** Client portal: reports the cleaning company published for this facility. */
export function useMyGymReports() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: gymKeys.myReports(ws.clientId ?? ''),
    enabled: !!ws.clientId,
    queryFn: async () => unwrap(await supabase.from('gym_reports').select('*').eq('client_id', ws.clientId!).order('period_end', { ascending: false })) as GymReport[],
  });
}

export function useInvalidateGym() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: gymKeys.all });
    void qc.invalidateQueries({ queryKey: ['jobs'] });
    void qc.invalidateQueries({ queryKey: ['my-jobs'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
}

// ---- mutations (all business rules live in the database functions) ---------
export interface ZoneDraft { name: string; cadence: string; in_scope: boolean; tasks: string[]; instructions: string }

export async function gymSetup(orgId: string, zones: ZoneDraft[], readiness: string[], clientId?: string | null) {
  return unwrap(await supabase.rpc('gym_setup', { p_org: orgId, p_zones: zones, p_readiness: readiness, p_client: clientId ?? null })) as string;
}

export type GymAction =
  | { action: 'readiness'; data: { id: string; status: GymReadinessStatus; note: string } }
  | { action: 'phase'; data: { phase: GymPhase } }
  | { action: 'zone'; data: { id: string; cadence: string; in_scope: boolean; confirmed: boolean; tasks: string[]; instructions: string } }
  | { action: 'approve'; data?: undefined }
  | { action: 'training'; data: { employee_id: string; orientation: boolean; chemical: boolean; valid_until: string } }
  | { action: 'schedule'; data: { date: string; time: string; days: number; duration: number; required_staff: number; employee_ids: string[]; zone_id: string | null } }
  | { action: 'confirm_callout'; data: { id: string } }
  | { action: 'cover'; data: { id: string; employee_id: string; confirmed: true } }
  | { action: 'inspect'; data: { round_id: string; result: GymInspectionResult; finding: string; corrective_action: string; due_at: string | null } }
  | { action: 'resolve'; data: { id: string; rechecked: true; resolution: string } }
  | { action: 'publish'; data: { start: string; end: string } };

export async function gymAction(contractId: string, a: GymAction) {
  return unwrap(await supabase.rpc('gym_admin_action', { p_contract: contractId, p_action: a.action, p_data: a.data ?? {} })) as Record<string, unknown>;
}

export async function gymRequestCallout(roundId: string, employeeId: string) {
  return unwrap(await supabase.rpc('gym_request_callout', { p_round: roundId, p_employee: employeeId })) as string;
}

// ---- helpers ---------------------------------------------------------------
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Training is current when both modules are done and the review date hasn't passed. */
export function trainingState(t?: GymTraining | null): 'current' | 'expired' | 'incomplete' | 'none' {
  if (!t) return 'none';
  if (!t.orientation || !t.chemical) return 'incomplete';
  return t.valid_until >= todayIso() ? 'current' : 'expired';
}

export const TRAINING_META: Record<ReturnType<typeof trainingState>, { label: string; tone: 'green' | 'amber' | 'red' | 'gray' }> = {
  current: { label: 'Cleared for site', tone: 'green' },
  expired: { label: 'Review overdue', tone: 'red' },
  incomplete: { label: 'Training incomplete', tone: 'amber' },
  none: { label: 'Not trained', tone: 'gray' },
};

export const CALLOUT_META: Record<GymCallout['status'], { label: string; tone: 'amber' | 'red' | 'green' }> = {
  requested: { label: 'Needs review', tone: 'amber' },
  open: { label: 'Needs coverage', tone: 'red' },
  covered: { label: 'Covered', tone: 'green' },
};

export const RESULT_META: Record<GymInspectionResult, { label: string; tone: 'green' | 'amber' | 'red' }> = {
  pass: { label: 'Pass', tone: 'green' },
  rework: { label: 'Rework', tone: 'amber' },
  critical: { label: 'Critical', tone: 'red' },
};

export function parseTasks(text: string) {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Proposed operating plan for the EōS Fitness site. Every zone starts unconfirmed; the supervisor edits and confirms each one. */
export const STARTER_ZONES: ZoneDraft[] = [
  {
    name: 'Lobby, front desk & entry glass', cadence: 'Nightly, plus a midday touch-up on weekdays', in_scope: true,
    instructions: 'Lobby is first impression — finish before 5 AM opening. Keep wet-floor signs up until tile is dry.',
    tasks: ['Clean entry doors and glass inside and out', 'Dust and wipe front desk, counters and kiosks', 'Empty trash and replace liners', 'Vacuum entry mats and carpet', 'Damp mop hard floors', 'Spot clean walls, switches and door handles'],
  },
  {
    name: 'Cardio floor', cadence: 'Nightly', in_scope: true,
    instructions: 'Use the gym-approved disinfectant on machines only; no spray directly onto screens or consoles.',
    tasks: ['Wipe down every treadmill, bike, elliptical and stair climber (handles, consoles, seats)', 'Dust TVs, screens and overhead fixtures within reach', 'Clean mirrors and glass', 'Vacuum and dust mop between machines', 'Empty trash and refill wipe dispensers', 'Report broken or unsafe equipment to the manager on duty'],
  },
  {
    name: 'Strength & free-weight area', cadence: 'Nightly', in_scope: true,
    instructions: 'Do not move loaded bars or plates. Work around equipment left out and note it for the manager.',
    tasks: ['Wipe benches, pads, racks and handles with disinfectant', 'Wipe dumbbells, kettlebells and plates', 'Clean mirrors', 'Vacuum rubber flooring and dust mop', 'Clean chalk residue from floors and equipment', 'Empty trash and restock wipes'],
  },
  {
    name: 'Group fitness & cycle studios', cadence: 'Nightly; floors mopped after last class', in_scope: true,
    instructions: 'Check the class schedule board — studios must be dry and reset before the first morning class.',
    tasks: ['Wipe mats, steps, bikes and props', 'Clean mirrors and glass walls', 'Dust ledges, speakers and ballet bars', 'Dust mop and damp mop studio floors', 'Empty trash', 'Reset equipment to the posted layout'],
  },
  {
    name: 'Locker rooms & showers', cadence: 'Nightly deep clean, plus restroom checks every 2 hours while open', in_scope: true,
    instructions: 'Post the locker room as closed and knock before entering. Use the tile and grout product per label dilution; rinse fully to avoid slip hazards.',
    tasks: ['Scrub and disinfect showers, floors, walls and drains', 'Clean and disinfect toilets, urinals and partitions', 'Clean sinks, counters, mirrors and dispensers', 'Wipe locker fronts, benches and handles', 'Restock soap, paper and shower products', 'Empty trash and sanitary bins', 'Mop floors and leave wet-floor signs until dry'],
  },
  {
    name: 'Restrooms (main floor)', cadence: 'Checked every 2 hours while open; full clean nightly', in_scope: true,
    instructions: 'Initial the restroom log after every check.',
    tasks: ['Clean and disinfect toilets, urinals and sinks', 'Wipe mirrors, counters and dispensers', 'Restock paper, soap and sanitizer', 'Empty trash', 'Sweep and damp mop floor', 'Sign the restroom check log'],
  },
  {
    name: 'Turf, functional training & stretch area', cadence: 'Nightly', in_scope: true,
    instructions: 'Vacuum turf with the turf attachment only. Disinfect mats both sides.',
    tasks: ['Wipe sleds, ropes, balls and stretch equipment', 'Disinfect stretch mats and foam rollers', 'Vacuum turf and surrounding flooring', 'Empty trash and restock wipes'],
  },
  {
    name: 'Kids club', cadence: 'Nightly; toys sanitized twice weekly', in_scope: true,
    instructions: 'Use the gym-supplied, child-safe sanitizer in this room only.',
    tasks: ['Disinfect tables, chairs and high-touch surfaces', 'Sanitize toys and soft play equipment', 'Vacuum carpet and mop hard floors', 'Empty trash and diaper bin', 'Clean glass and door handles'],
  },
  {
    name: 'Recovery, sauna & tanning rooms', cadence: 'Nightly', in_scope: true,
    instructions: 'Follow the manufacturer card posted in each room; no chemicals on sauna wood beyond what the card allows.',
    tasks: ['Wipe tanning beds and massage chairs with the approved cleaner', 'Wipe sauna benches and sweep floors', 'Clean glass and mirrors', 'Mop floors', 'Empty trash'],
  },
  {
    name: 'Offices, break room & back of house', cadence: 'Three times a week', in_scope: true,
    instructions: 'Do not move papers on desks. Break-room fridge is the gym staff\'s responsibility.',
    tasks: ['Empty trash and recycling', 'Dust desks, shelves and surfaces', 'Clean break-room counters, sink and microwave exterior', 'Vacuum and mop floors'],
  },
  {
    name: 'Exterior entry & parking walk', cadence: 'Nightly', in_scope: false,
    instructions: 'Proposed add-on — confirm with the gym before including.',
    tasks: ['Sweep entry walkway and remove litter', 'Empty exterior trash cans', 'Wipe exterior door handles and glass', 'Report lighting or trip hazards'],
  },
  {
    name: 'Pool & spa deck', cadence: 'Nightly', in_scope: false,
    instructions: 'Proposed add-on — only if the site has an aquatics area. Deck chemicals must be pool-safe.',
    tasks: ['Hose and squeegee pool deck', 'Wipe deck furniture', 'Clean deck showers and drains', 'Empty trash'],
  },
];

/** Pre-opening checklist the supervisor completes before daily operations start. */
export const STARTER_READINESS: string[] = [
  'Walk the facility with the gym general manager and confirm every zone and its frequency',
  'Scope, schedule and price signed off by EōS management',
  'Certificate of insurance delivered to the gym',
  'Keys, alarm codes and after-hours access procedure received',
  'Emergency contacts exchanged (gym manager on duty, our supervisor)',
  'Chemical list approved by the gym; SDS binder placed in the janitor closet',
  'Dilution station and color-coded cloth / mop system set up',
  'Equipment delivered and tested (auto scrubber, vacuums, carts, wet-floor signs)',
  'Supply storage and janitor closet assigned',
  'Restroom check log and nightly sign-off sheet posted',
  'Every team member completed site orientation and chemical training',
  'First-night staffing plan confirmed',
];
