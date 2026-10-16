import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import { useWorkspace } from '@/auth/AuthProvider';
import type {
  ChecklistTemplate, Client, ClientNote, Employee, Invitation, Job, JobChecklistItem, JobNote, JobPhoto, Review, Team, TimeEntry,
} from '@/lib/types';

/** Columns for job lists (includes crew + progress so cards can render without extra calls). */
export const JOB_LIST_SELECT = `
  *,
  client:clients(id, full_name, address_line1, address_line2, city, state, postal_code, phone),
  job_assignments(id, employee_id, team_id, employee:employees(id, full_name, color, user_id), team:teams(id, name, color)),
  job_checklist_items(id, is_required, completed_at),
  reviews(id, rating)
`;

export const JOB_DETAIL_SELECT = `
  *,
  client:clients(*),
  appointment:appointments(id, recurrence, internal_notes, checklist_template_id),
  job_assignments(id, employee_id, team_id, employee:employees(id, full_name, color, user_id), team:teams(id, name, color)),
  reviews(id, rating)
`;

export const qk = {
  jobs: (org: string, range?: string) => ['jobs', org, range ?? 'all'] as const,
  job: (id: string) => ['job', id] as const,
  jobExtras: (id: string) => ['job-extras', id] as const,
  clients: (org: string) => ['clients', org] as const,
  client: (id: string) => ['client', id] as const,
  employees: (org: string) => ['employees', org] as const,
  teams: (org: string) => ['teams', org] as const,
  templates: (org: string) => ['templates', org] as const,
  template: (id: string) => ['template', id] as const,
  reviews: (org: string) => ['reviews', org] as const,
  invites: (org: string) => ['invites', org] as const,
};

export function useJobsInRange(fromIso: string, toIso: string, opts?: { enabled?: boolean }) {
  const ws = useWorkspace();
  return useQuery({
    queryKey: qk.jobs(ws.org.id, `${fromIso}|${toIso}`),
    enabled: opts?.enabled ?? true,
    queryFn: async () =>
      unwrap(
        await supabase.from('jobs').select(JOB_LIST_SELECT)
          .eq('org_id', ws.org.id)
          .gte('scheduled_start', fromIso).lt('scheduled_start', toIso)
          .order('scheduled_start'),
      ) as unknown as Job[],
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: qk.job(id),
    queryFn: async () => {
      const job = unwrap(await supabase.from('jobs').select(JOB_DETAIL_SELECT).eq('id', id).maybeSingle()) as unknown as Job | null;
      if (!job) throw new Error('This job doesn’t exist or you don’t have access to it.');
      return job;
    },
  });
}

export interface JobExtras {
  checklist: JobChecklistItem[];
  notes: JobNote[];
  clientNotes: ClientNote[];
  photos: JobPhoto[];
  time: TimeEntry[];
  review: Review | null;
}

/** Everything attached to a job. Each role only receives the rows RLS lets it see. */
export function useJobExtras(jobId: string, opts?: { includeTime?: boolean; includeNotes?: boolean }) {
  const includeTime = opts?.includeTime ?? true;
  const includeNotes = opts?.includeNotes ?? true;
  return useQuery({
    queryKey: [...qk.jobExtras(jobId), includeTime, includeNotes],
    queryFn: async (): Promise<JobExtras> => {
      const [checklist, notes, clientNotes, photos, time, review] = await Promise.all([
        supabase.from('job_checklist_items').select('*').eq('job_id', jobId).order('section_position').order('position'),
        includeNotes ? supabase.from('job_notes').select('*').eq('job_id', jobId).order('created_at') : Promise.resolve({ data: [], error: null }),
        supabase.from('client_notes').select('*').eq('job_id', jobId).order('created_at'),
        supabase.from('job_photos').select('*').eq('job_id', jobId).order('created_at'),
        includeTime
          ? supabase.from('time_entries').select('*, employee:employees(id, full_name, color)').eq('job_id', jobId).order('clock_in_at')
          : Promise.resolve({ data: [], error: null }),
        supabase.from('reviews').select('*').eq('job_id', jobId).maybeSingle(),
      ]);
      return {
        checklist: unwrap(checklist) as JobChecklistItem[],
        notes: unwrap(notes) as JobNote[],
        clientNotes: unwrap(clientNotes) as ClientNote[],
        photos: unwrap(photos) as JobPhoto[],
        time: unwrap(time) as TimeEntry[],
        review: unwrap(review) as Review | null,
      };
    },
  });
}

export function useClients() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: qk.clients(ws.org.id),
    queryFn: async () =>
      unwrap(await supabase.from('clients').select('*').eq('org_id', ws.org.id).order('full_name')) as Client[],
  });
}

export function useEmployees() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: qk.employees(ws.org.id),
    queryFn: async () =>
      unwrap(await supabase.from('employees').select('*').eq('org_id', ws.org.id).order('full_name')) as Employee[],
  });
}

export function useTeams() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: qk.teams(ws.org.id),
    queryFn: async () =>
      unwrap(await supabase.from('teams').select('*, team_members(employee_id)').eq('org_id', ws.org.id).order('name')) as Team[],
  });
}

export function useTemplates() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: qk.templates(ws.org.id),
    queryFn: async () =>
      unwrap(
        await supabase.from('checklist_templates')
          .select('*, checklist_sections(id, name, position, checklist_items(id))')
          .eq('org_id', ws.org.id).eq('is_archived', false).order('created_at'),
      ) as ChecklistTemplate[],
  });
}

export function useInvites() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: qk.invites(ws.org.id),
    enabled: ws.isAdmin,
    queryFn: async () =>
      unwrap(await supabase.from('invitations').select('*').eq('org_id', ws.org.id).order('created_at', { ascending: false })) as Invitation[],
  });
}

/** Invalidate everything job-related after a mutation. */
export function useInvalidateJobs() {
  const qc = useQueryClient();
  return (jobId?: string) => {
    void qc.invalidateQueries({ queryKey: ['jobs'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['my-jobs'] });
    void qc.invalidateQueries({ queryKey: ['portal'] });
    if (jobId) {
      void qc.invalidateQueries({ queryKey: qk.job(jobId) });
      void qc.invalidateQueries({ queryKey: qk.jobExtras(jobId) });
    }
  };
}

export function checklistProgress(items?: { is_required?: boolean; completed_at: string | null }[] | null) {
  const list = items ?? [];
  const done = list.filter((i) => i.completed_at).length;
  return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
}

export function crewOf(job: Job) {
  return (job.job_assignments ?? []).map((a) =>
    a.employee
      ? { id: a.employee.id, name: a.employee.full_name, color: a.employee.color, kind: 'employee' as const }
      : { id: a.team?.id ?? a.id, name: a.team?.name ?? 'Team', color: a.team?.color ?? null, kind: 'team' as const },
  );
}

export function inviteUrl(token: string) {
  return `${window.location.origin}/join/${token}`;
}
