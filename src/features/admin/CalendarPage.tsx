import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addDays, addMonths, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfDay, startOfMonth, startOfWeek, subMonths,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { Job, JobStatus } from '@/lib/types';
import { fmtRelativeDay, fmtTime } from '@/lib/format';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState, QueryState } from '@/components/ui/Feedback';
import { PageHeader, Segmented } from '@/components/ui/Misc';
import { JobRow } from '@/features/shared/components';
import { useEmployees, useJobsInRange } from '@/features/shared/api';

type View = 'month' | 'list';

export function CalendarPage() {
  const [view, setView] = useState<View>(() => (window.innerWidth < 640 ? 'list' : 'month'));
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [status, setStatus] = useState<'all' | JobStatus>('all');
  const [employee, setEmployee] = useState('all');
  const employees = useEmployees();

  const gridStart = startOfWeek(startOfMonth(cursor));
  const gridEnd = endOfWeek(endOfMonth(cursor));
  const range = view === 'month'
    ? { from: gridStart, to: addDays(gridEnd, 1) }
    : { from: startOfDay(new Date()), to: addDays(startOfDay(new Date()), 60) };
  const q = useJobsInRange(range.from.toISOString(), range.to.toISOString());

  const jobs = useMemo(() => (q.data ?? []).filter((j) =>
    (status === 'all' || j.status === status) &&
    (employee === 'all' || (j.job_assignments ?? []).some((a) => a.employee_id === employee))), [q.data, status, employee]);

  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
  const byDay = (d: Date) => jobs.filter((j) => isSameDay(new Date(j.scheduled_start), d));
  const selectedJobs = byDay(selected);

  const grouped = useMemo(() => {
    const m = new Map<string, Job[]>();
    for (const j of jobs) {
      const k = format(new Date(j.scheduled_start), 'yyyy-MM-dd');
      m.set(k, [...(m.get(k) ?? []), j]);
    }
    return [...m.entries()];
  }, [jobs]);

  return (
    <>
      <PageHeader title="Schedule" actions={<ButtonLink to={`/jobs/new?date=${format(selected, 'yyyy-MM-dd')}`} icon={<Plus />}>New job</ButtonLink>} />
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <Segmented label="Calendar view" value={view} onChange={setView} options={[{ value: 'month', label: 'Month' }, { value: 'list', label: 'List' }]} />
        <select className="select" style={{ width: 'auto', minHeight: 40 }} aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">All statuses</option><option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
        </select>
        <select className="select" style={{ width: 'auto', minHeight: 40 }} aria-label="Filter by employee" value={employee} onChange={(e) => setEmployee(e.target.value)}>
          <option value="all">Everyone</option>
          {(employees.data ?? []).filter((e) => e.status === 'active').map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
      </div>

      {view === 'month' ? (
        <>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="row-between" style={{ padding: '12px 14px' }}>
              <Button variant="ghost" size="sm" iconOnly aria-label="Previous month" icon={<ChevronLeft />} onClick={() => setCursor(subMonths(cursor, 1))} />
              <div className="row">
                <h2>{format(cursor, 'MMMM yyyy')}</h2>
                <Button variant="secondary" size="sm" onClick={() => { setCursor(startOfMonth(new Date())); setSelected(startOfDay(new Date())); }}>Today</Button>
              </div>
              <Button variant="ghost" size="sm" iconOnly aria-label="Next month" icon={<ChevronRight />} onClick={() => setCursor(addMonths(cursor, 1))} />
            </div>
            <div className="cal-grid" role="grid" aria-label={format(cursor, 'MMMM yyyy')}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="cal-dow" role="columnheader">{d}</div>)}
              {days.map((d) => {
                const dj = byDay(d);
                return (
                  <button
                    key={d.toISOString()}
                    role="gridcell"
                    aria-selected={isSameDay(d, selected)}
                    aria-label={`${format(d, 'EEEE MMMM d')}, ${dj.length} job${dj.length === 1 ? '' : 's'}`}
                    className={['cal-cell', !isSameMonth(d, cursor) && 'other', isSameDay(d, new Date()) && 'today', isSameDay(d, selected) && 'selected'].filter(Boolean).join(' ')}
                    onClick={() => setSelected(d)}
                  >
                    <span className="num">{format(d, 'd')}</span>
                    <span className="cal-dots">{dj.slice(0, 4).map((j) => <i key={j.id} style={{ background: j.job_assignments?.[0]?.employee?.color ?? undefined }} />)}</span>
                    {dj.slice(0, 3).map((j) => (
                      <span key={j.id} className={`cal-event ${j.status}`}>{fmtTime(j.scheduled_start)} {j.client?.full_name}</span>
                    ))}
                    {dj.length > 3 && <span className="subtle cal-event" style={{ background: 'none' }}>+{dj.length - 3} more</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="section-title"><h2>{fmtRelativeDay(selected)}{!['Today', 'Tomorrow', 'Yesterday'].includes(fmtRelativeDay(selected)) ? '' : ` · ${format(selected, 'MMM d')}`}</h2></div>
          <QueryState query={q}>
            {() => (
              <div className="card list">
                {selectedJobs.length ? selectedJobs.map((j) => <JobRow key={j.id} job={j} to={`/jobs/${j.id}`} />) : (
                  <EmptyState icon={<CalendarDays />} title="No jobs this day"
                    action={<Link className="btn btn-soft btn-sm" to={`/jobs/new?date=${format(selected, 'yyyy-MM-dd')}`}><Plus /> Schedule</Link>} />
                )}
              </div>
            )}
          </QueryState>
        </>
      ) : (
        <QueryState query={q}>
          {() => grouped.length === 0 ? (
            <div className="card"><EmptyState icon={<CalendarDays />} title="Nothing scheduled in the next 60 days" action={<ButtonLink to="/jobs/new" icon={<Plus />}>Schedule a job</ButtonLink>} /></div>
          ) : (
            <div className="stack" style={{ ['--gap' as string]: '0px' }}>
              {grouped.map(([day, list]) => (
                <div key={day}>
                  <div className="section-title"><h2>{fmtRelativeDay(`${day}T12:00:00`)} <span className="subtle">· {list.length} job{list.length === 1 ? '' : 's'}</span></h2></div>
                  <div className="card list">{list.map((j) => <JobRow key={j.id} job={j} to={`/jobs/${j.id}`} />)}</div>
                </div>
              ))}
            </div>
          )}
        </QueryState>
      )}
      <Link className="fab" aria-label="New job" to={`/jobs/new?date=${format(selected, 'yyyy-MM-dd')}`}><Plus /></Link>
    </>
  );
}
