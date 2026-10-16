import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { addDays, endOfDay, startOfDay, startOfWeek, subDays } from 'date-fns';
import { AlertTriangle, BellRing, CalendarPlus, CalendarDays, Clock, MessageSquare, Star, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth, useWorkspace } from '@/auth/AuthProvider';
import type { ClientNote, Employee, Job, Review, TimeEntry } from '@/lib/types';
import { firstName, fmtAgo, fmtDuration, fmtRelativeDay, fmtTime, greeting, minutesBetween } from '@/lib/format';
import { ButtonLink, Button } from '@/components/ui/Button';
import { EmptyState, QueryState, SkeletonList } from '@/components/ui/Feedback';
import { Avatar, SectionTitle, Stars } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { JobRow } from '@/features/shared/components';
import { JOB_LIST_SELECT } from '@/features/shared/api';
import { LowStockCard } from '@/features/inventory/LowStockCard';
import { useTrade } from '@/features/shared/useTrade';

interface DashboardData {
  today: Job[];
  upcoming: Job[];
  attention: { job: Job; reason: string }[];
  openEntries: TimeEntry[];
  employees: Employee[];
  reviews: Review[];
  notes: ClientNote[];
  metrics: { completedWeek: number; hoursWeek: number; avgRating: number | null; reviewCount: number; activeClients: number };
}

function useDashboard() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: ['dashboard', ws.org.id],
    refetchInterval: 60_000,
    queryFn: async (): Promise<DashboardData> => {
      const org = ws.org.id;
      const now = new Date();
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      const [jobsR, overdueR, entriesR, empR, reviewsR, notesR, clientsR, weekEntriesR, ratingR] = await Promise.all([
        supabase.from('jobs').select(JOB_LIST_SELECT).eq('org_id', org)
          .gte('scheduled_start', startOfDay(now).toISOString()).lt('scheduled_start', addDays(startOfDay(now), 8).toISOString())
          .order('scheduled_start'),
        supabase.from('jobs').select(JOB_LIST_SELECT).eq('org_id', org)
          .in('status', ['scheduled', 'in_progress']).lt('scheduled_end', now.toISOString())
          .gte('scheduled_start', subDays(now, 14).toISOString()).order('scheduled_start'),
        supabase.from('time_entries').select('*, employee:employees(id, full_name, color), job:jobs(id, service_name, client_id, client:clients(full_name))')
          .eq('org_id', org).is('clock_out_at', null),
        supabase.from('employees').select('*').eq('org_id', org).eq('status', 'active').order('full_name'),
        supabase.from('reviews').select('*, client:clients(id, full_name)').eq('org_id', org).order('created_at', { ascending: false }).limit(4),
        supabase.from('client_notes').select('*, client:clients(id, full_name)').eq('org_id', org).eq('from_client', true).order('created_at', { ascending: false }).limit(5),
        supabase.from('clients').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'active'),
        supabase.from('time_entries').select('clock_in_at, clock_out_at').eq('org_id', org).gte('clock_in_at', weekStart.toISOString()),
        supabase.from('reviews').select('rating').eq('org_id', org),
      ]);
      const jobs = unwrap(jobsR) as unknown as Job[];
      const overdue = unwrap(overdueR) as unknown as Job[];
      const endToday = endOfDay(now);
      const today = jobs.filter((j) => new Date(j.scheduled_start) <= endToday);
      const upcoming = jobs.filter((j) => new Date(j.scheduled_start) > endToday && j.status !== 'cancelled');

      const attention: { job: Job; reason: string }[] = [];
      for (const j of jobs) {
        if ((j.priority === 'emergency' || j.priority === 'urgent') && j.status !== 'completed' && j.status !== 'cancelled') {
          attention.push({ job: j, reason: j.priority === 'emergency' ? 'Emergency' : 'Urgent' });
        }
      }
      for (const j of overdue) if (!attention.some((a) => a.job.id === j.id)) attention.push({ job: j, reason: j.status === 'in_progress' ? 'Still in progress past end time' : 'Not started — past scheduled time' });
      for (const j of jobs) {
        if (j.status === 'scheduled' && !(j.job_assignments ?? []).length && !attention.some((a) => a.job.id === j.id)) {
          attention.push({ job: j, reason: 'No one assigned' });
        }
      }

      const { count: completedWeek } = await supabase.from('jobs').select('id', { count: 'exact', head: true })
        .eq('org_id', org).eq('status', 'completed').gte('completed_at', weekStart.toISOString());

      const ratings = (unwrap(ratingR) as { rating: number }[]).map((r) => r.rating);
      const weekEntries = unwrap(weekEntriesR) as { clock_in_at: string; clock_out_at: string | null }[];
      return {
        today,
        upcoming,
        attention,
        openEntries: unwrap(entriesR) as TimeEntry[],
        employees: unwrap(empR) as Employee[],
        reviews: unwrap(reviewsR) as Review[],
        notes: unwrap(notesR) as ClientNote[],
        metrics: {
          completedWeek: completedWeek ?? 0,
          hoursWeek: weekEntries.reduce((m, e) => m + minutesBetween(e.clock_in_at, e.clock_out_at), 0) / 60,
          avgRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
          reviewCount: ratings.length,
          activeClients: clientsR.count ?? 0,
        },
      };
    },
  });
}

export function DashboardPage() {
  const tp = useTrade();
  const ws = useWorkspace();
  const { profile } = useAuth();
  const q = useDashboard();
  const toast = useToast();
  const [sending, setSending] = useState(false);

  const sendReminders = async () => {
    setSending(true);
    const { data, error } = await supabase.rpc('queue_reminders', { p_org: ws.org.id });
    setSending(false);
    if (error) return toast.error(error);
    toast.success(data ? `Reminders sent for ${data} upcoming job${data === 1 ? '' : 's'}` : 'No upcoming jobs need a reminder right now');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greeting()}{profile?.full_name ? `, ${firstName(profile.full_name)}` : ''}</h1>
          <p className="sub">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
      </div>

      <div className="row wrap" style={{ marginBottom: 18 }}>
        <ButtonLink to="/jobs/new" icon={<CalendarPlus />}>New job</ButtonLink>
        <ButtonLink to="/clients?new=1" variant="secondary" icon={<UserPlus />}>Add client</ButtonLink>
        <ButtonLink to="/team?new=1" variant="secondary" icon={<Users />}>Add employee</ButtonLink>
        <Button variant="secondary" icon={<BellRing />} onClick={sendReminders} loading={sending}>Send reminders</Button>
      </div>

      <QueryState query={q} skeleton={<SkeletonList rows={4} height={90} />}>
        {(d) => (
          <>
            <div className="stats">
              <div className="card stat"><div className="k">Jobs today</div><div className="v">{d.today.filter((j) => j.status !== 'cancelled').length}</div></div>
              <div className="card stat"><div className="k">Completed this week</div><div className="v">{d.metrics.completedWeek}</div></div>
              <div className="card stat"><div className="k">Hours logged this week</div><div className="v">{d.metrics.hoursWeek.toFixed(1)}</div></div>
              <div className="card stat">
                <div className="k">Average rating</div>
                <div className="v row" style={{ ['--gap' as string]: '6px' }}>
                  {d.metrics.avgRating ? d.metrics.avgRating.toFixed(1) : '—'}
                  {d.metrics.avgRating && <Star size={20} fill="#F5A524" color="#F5A524" aria-hidden />}
                </div>
                <div className="subtle">{d.metrics.reviewCount} review{d.metrics.reviewCount === 1 ? '' : 's'} · {d.metrics.activeClients} active clients</div>
              </div>
            </div>

            <div className="grid-2-lg mt-16">
              <div className="stack" style={{ ['--gap' as string]: '0px' }}>
                {d.attention.length > 0 && (
                  <>
                    <SectionTitle><span className="row" style={{ ['--gap' as string]: '8px' }}><AlertTriangle size={18} color="var(--amber)" aria-hidden />Needs attention</span></SectionTitle>
                    <div className="card list">
                      {d.attention.slice(0, 6).map(({ job, reason }) => (
                        <Link key={job.id} to={`/jobs/${job.id}`} className="list-item">
                          <span className="grow">
                            <span className="strong">{job.client?.full_name}</span>
                            <span className="muted small" style={{ display: 'block' }}>{fmtRelativeDay(job.scheduled_start)} · {fmtTime(job.scheduled_start)} · {job.service_name}</span>
                          </span>
                          <span className={`badge no-dot ${reason === 'Emergency' ? 'badge-red' : 'badge-amber'}`}>{reason}</span>
                        </Link>
                      ))}
                    </div>
                  </>
                )}

                <SectionTitle action={<Link to="/calendar" className="small strong">Calendar</Link>}>Today’s jobs</SectionTitle>
                <div className="card list">
                  {d.today.length ? d.today.map((j) => <JobRow key={j.id} job={j} to={`/jobs/${j.id}`} />) : (
                    <EmptyState icon={<CalendarDays />} title="Nothing scheduled today" action={<ButtonLink to="/jobs/new" size="sm" variant="soft">Schedule a job</ButtonLink>} />
                  )}
                </div>

                <SectionTitle>Upcoming this week</SectionTitle>
                <div className="card list">
                  {d.upcoming.length ? d.upcoming.slice(0, 8).map((j) => <JobRow key={j.id} job={j} to={`/jobs/${j.id}`} showDate />) : (
                    <EmptyState title="No upcoming jobs">Book recurring {tp.visits} so your week fills itself.</EmptyState>
                  )}
                </div>
              </div>

              <div className="stack" style={{ ['--gap' as string]: '0px' }}>
                <LowStockCard />
                <SectionTitle action={<Link to="/team" className="small strong">Team</Link>}>Employee status</SectionTitle>
                <div className="card list">
                  {d.employees.length === 0 && <EmptyState icon={<Users />} title="No team members yet" action={<ButtonLink to="/team?new=1" size="sm" variant="soft">Add employee</ButtonLink>} />}
                  {d.employees.map((e) => {
                    const open = d.openEntries.find((t) => t.employee_id === e.id);
                    return (
                      <div key={e.id} className="list-item">
                        <Avatar name={e.full_name} color={e.color} />
                        <span className="grow">
                          <span className="strong">{e.full_name}</span>
                          <span className="muted small truncate" style={{ display: 'block' }}>
                            {open ? `At ${open.job?.client?.full_name ?? 'a job'} · ${fmtDuration(minutesBetween(open.clock_in_at))}` : e.user_id ? 'Off the clock' : 'Hasn’t joined yet'}
                          </span>
                        </span>
                        {open ? <span className="badge badge-green">On the clock</span> : <span className="badge badge-gray">{e.user_id ? 'Off' : 'Invited'}</span>}
                      </div>
                    );
                  })}
                </div>

                <SectionTitle action={<Link to="/reviews" className="small strong">All reviews</Link>}>Recent reviews</SectionTitle>
                <div className="card list">
                  {d.reviews.length === 0 && <EmptyState icon={<Star />} title="No reviews yet">Clients are asked for a review when a job is completed.</EmptyState>}
                  {d.reviews.map((r) => (
                    <Link key={r.id} to={`/jobs/${r.job_id}`} className="list-item" style={{ alignItems: 'flex-start' }}>
                      <span className="grow">
                        <span className="row-between"><span className="strong">{r.client?.full_name}</span><Stars value={r.rating} /></span>
                        {r.body && <span className="muted small" style={{ display: 'block' }}>“{r.body}”</span>}
                        <span className="subtle">{fmtAgo(r.created_at)}</span>
                      </span>
                    </Link>
                  ))}
                </div>

                <SectionTitle>Recent client activity</SectionTitle>
                <div className="card list">
                  {d.notes.length === 0 && <EmptyState icon={<MessageSquare />} title="No client notes yet">Notes clients add in their portal appear here.</EmptyState>}
                  {d.notes.map((n) => (
                    <Link key={n.id} to={n.job_id ? `/jobs/${n.job_id}` : `/clients/${n.client_id}`} className="list-item" style={{ alignItems: 'flex-start' }}>
                      <span className="avatar sm"><MessageSquare size={14} aria-hidden /></span>
                      <span className="grow">
                        <span className="strong">{n.client?.full_name}</span>
                        <span className="muted small" style={{ display: 'block' }}>{n.body}</span>
                        <span className="subtle"><Clock size={12} aria-hidden style={{ display: 'inline', verticalAlign: '-1px' }} /> {fmtAgo(n.created_at)}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </QueryState>
    </>
  );
}
