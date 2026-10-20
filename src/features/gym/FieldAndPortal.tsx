import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Dumbbell, FileBarChart, GraduationCap, UserRoundX } from 'lucide-react';
import { useWorkspace } from '@/auth/AuthProvider';
import type { Job } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { EmptyState, QueryState, SkeletonList } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Badge, PageHeader } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { CALLOUT_META, TRAINING_META, gymRequestCallout, trainingState, useInvalidateGym, useMyGymReports, useMyTraining, useRoundForJob } from './api';
import { ReportCard } from './GymOps';

/**
 * Field app: shown on a job that is a gym round. Lets the assigned worker ask off the round
 * (an availability request — no reason is collected) and shows their site-training status.
 */
export function GymRoundCard({ job }: { job: Job }) {
  const ws = useWorkspace();
  const toast = useToast();
  const invalidate = useInvalidateGym();
  const round = useRoundForJob(job.id);
  const training = useMyTraining();
  const [confirm, setConfirm] = useState(false);

  const request = useMutation({
    mutationFn: async () => gymRequestCallout(round.data!.id, ws.employeeId!),
    onSuccess: () => { setConfirm(false); invalidate(); toast.success('Request sent to your supervisor'); },
    onError: (e) => { setConfirm(false); toast.error(e); },
  });

  if (round.isLoading || !round.data) return null;
  const r = round.data;
  const mine = (r.gym_callouts ?? []).find((c) => c.employee_id === ws.employeeId && c.status !== 'covered');
  const covered = (r.gym_callouts ?? []).find((c) => c.employee_id === ws.employeeId && c.status === 'covered');
  const st = trainingState(training.data);
  const tm = TRAINING_META[st];

  return (
    <div className="card card-pad stack" style={{ ['--gap' as string]: '10px' }}>
      <div className="row" style={{ ['--gap' as string]: '10px' }}>
        <span className="avatar"><Dumbbell size={18} aria-hidden /></span>
        <div className="grow">
          <p className="strong">{r.contract?.name ?? 'Gym round'} · {r.zone?.name ?? 'Full facility'}</p>
          <p className="muted small">{r.required_staff} staff on this round</p>
        </div>
      </div>
      {training.data !== undefined && (
        <div className="row" style={{ ['--gap' as string]: '8px' }}>
          <GraduationCap size={16} aria-hidden />
          <span className="small grow">Site training{training.data ? ` · review by ${fmtDate(training.data.valid_until + 'T12:00:00')}` : ''}</span>
          <Badge tone={tm.tone}>{tm.label}</Badge>
        </div>
      )}
      {job.status === 'scheduled' && ws.employeeId && (
        mine ? (
          <div className="row" style={{ ['--gap' as string]: '8px' }}>
            <UserRoundX size={16} aria-hidden />
            <span className="small grow">You asked off this round</span>
            <Badge tone={CALLOUT_META[mine.status].tone}>{mine.status === 'requested' ? 'Waiting on supervisor' : 'Approved — cover being arranged'}</Badge>
          </div>
        ) : covered ? (
          <p className="subtle">Your earlier request was covered{covered.replacement_id ? ' by a teammate' : ''}.</p>
        ) : (
          <Button variant="ghost" size="sm" icon={<UserRoundX />} onClick={() => setConfirm(true)}>I can’t make this round</Button>
        )
      )}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => request.mutate()} loading={request.isPending}
        title="Ask off this round?" confirmLabel="Send request">
        Your supervisor is notified and will arrange cover. You stay on the round until they approve the request. No reason is required or recorded.
      </ConfirmDialog>
    </div>
  );
}

/** Client portal: the facility sees the service reports its cleaning company published. */
export function PortalReports() {
  const q = useMyGymReports();
  return (
    <>
      <PageHeader title="Service reports" sub="Published by your cleaning team for each period" />
      <QueryState query={q} skeleton={<SkeletonList rows={3} height={120} />}>
        {(list) => list.length === 0 ? (
          <div className="card"><EmptyState icon={<FileBarChart />} title="No reports yet">Reports appear here once your cleaning team publishes them.</EmptyState></div>
        ) : (
          <div className="stack" style={{ ['--gap' as string]: '10px' }}>
            {list.map((r) => <ReportCard key={r.id} report={r} />)}
          </div>
        )}
      </QueryState>
    </>
  );
}
