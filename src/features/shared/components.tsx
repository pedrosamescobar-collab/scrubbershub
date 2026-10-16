import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Copy, Share2, X, Check, MessageSquareText } from 'lucide-react';
import type { Job, JobPhoto, PhotoKind } from '@/lib/types';
import { clientAddress, fmtTime } from '@/lib/format';
import { signedPhotoUrls } from '@/lib/storage';
import { Avatar, ProgressBar, StatusBadge, Stars } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { checklistProgress, crewOf } from './api';
import { PriorityBadge } from './priority';

export function CrewAvatars({ job, max = 3 }: { job: Job; max?: number }) {
  const crew = crewOf(job);
  if (!crew.length) return <span className="badge badge-red no-dot">Unassigned</span>;
  return (
    <span className="crew" title={crew.map((c) => c.name).join(', ')}>
      {crew.slice(0, max).map((c) => <Avatar key={c.id} name={c.name} color={c.color} size="sm" />)}
      {crew.length > max && <span className="avatar sm">+{crew.length - max}</span>}
    </span>
  );
}

/** A tappable row used in admin + employee job lists. */
export function JobRow({ job, to, showCrew = true, showDate = false }: { job: Job; to: string; showCrew?: boolean; showDate?: boolean }) {
  const p = checklistProgress(job.job_checklist_items);
  return (
    <Link to={to} className="job-row">
      <div className="job-time">
        {showDate && <div className="subtle" style={{ fontWeight: 700 }}>{new Date(job.scheduled_start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>}
        {fmtTime(job.scheduled_start)}
        <div className="end">{fmtTime(job.scheduled_end)}</div>
      </div>
      <div className={`job-bar ${job.status}`} aria-hidden />
      <div className="grow stack" style={{ ['--gap' as string]: '4px' }}>
        <div className="row-between">
          <span className="strong truncate">{job.client?.full_name ?? 'Client'}</span>
          <span className="row" style={{ ['--gap' as string]: '6px' }}><PriorityBadge priority={job.priority} /><StatusBadge status={job.status} /></span>
        </div>
        <span className="muted small truncate">{job.service_name}{job.client ? ` · ${clientAddress(job.client)}` : ''}</span>
        <div className="row-between" style={{ marginTop: 2 }}>
          {showCrew ? <CrewAvatars job={job} /> : <span />}
          {p.total > 0 && job.status !== 'cancelled' && (
            <span className="row" style={{ ['--gap' as string]: '8px', minWidth: 120 }}>
              <span style={{ width: 70 }}><ProgressBar value={p.done} total={p.total} /></span>
              <span className="subtle">{p.done}/{p.total}</span>
            </span>
          )}
          {job.reviews?.[0] && <Stars value={job.reviews[0].rating} />}
        </div>
      </div>
    </Link>
  );
}

export function usePhotoUrls(photos: JobPhoto[]) {
  const paths = photos.map((p) => p.storage_path);
  return useQuery({
    queryKey: ['photo-urls', paths.join('|')],
    enabled: paths.length > 0,
    staleTime: 50 * 60 * 1000,
    queryFn: () => signedPhotoUrls(paths),
  });
}

export function PhotoGallery({
  photos, kind, emptyText, onDelete,
}: { photos: JobPhoto[]; kind?: PhotoKind; emptyText?: string; onDelete?: (p: JobPhoto) => void }) {
  const list = kind ? photos.filter((p) => p.kind === kind) : photos;
  const urls = usePhotoUrls(list);
  const [open, setOpen] = useState<JobPhoto | null>(null);
  if (!list.length) return <p className="subtle">{emptyText ?? 'No photos yet.'}</p>;
  return (
    <>
      <div className="photo-grid">
        {list.map((p) => (
          <button key={p.id} className="photo-tile" onClick={() => setOpen(p)} aria-label={`Open ${p.kind} photo`}>
            {urls.data?.[p.storage_path] ? <img src={urls.data[p.storage_path]} alt={`${p.kind} photo`} loading="lazy" /> : <div className="skeleton" style={{ width: '100%', height: '100%' }} />}
          </button>
        ))}
      </div>
      {open && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setOpen(null)}>
          <button className="icon-btn close" aria-label="Close" onClick={() => setOpen(null)}><X /></button>
          {urls.data?.[open.storage_path] && <img src={urls.data[open.storage_path]} alt={`${open.kind} photo`} onClick={(e) => e.stopPropagation()} />}
          {onDelete && (
            <Button variant="danger" size="sm" style={{ position: 'absolute', bottom: 24 }} onClick={(e) => { e.stopPropagation(); onDelete(open); setOpen(null); }}>
              Delete photo
            </Button>
          )}
        </div>
      )}
    </>
  );
}

/** Shows a join link the admin can copy / share by text or email. */
export function InviteLinkModal({
  open, onClose, url, name, role, orgName,
}: { open: boolean; onClose: () => void; url: string | null; name: string; role: 'employee' | 'client'; orgName: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!open) setCopied(false); }, [open]);
  const message = role === 'employee'
    ? `Hi ${name.split(' ')[0]}! You’ve been added to the ${orgName} team on ScrubHub. Set up your account here to see your jobs: ${url}`
    : `Hi ${name.split(' ')[0]}! ${orgName} set up your client portal. View your appointments and leave notes for the team here: ${url}`;

  const copy = async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); toast.success('Link copied'); }
    catch { toast.error('Copy failed — press and hold the link to copy it.'); }
  };
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: orgName, text: message }); } catch { /* cancelled */ }
    } else copy();
  };

  return (
    <Modal open={open} onClose={onClose} title={role === 'employee' ? 'Invite to the team' : 'Invite to client portal'}>
      <div className="stack">
        <p className="muted">Send this private link to <strong>{name}</strong>. It works once and expires in 14 days.</p>
        <div className="input" style={{ wordBreak: 'break-all', fontSize: 14, background: 'var(--surface-2)' }}>{url ?? '…'}</div>
        <div className="grid-2">
          <Button variant="secondary" icon={copied ? <Check /> : <Copy />} onClick={copy}>{copied ? 'Copied' : 'Copy link'}</Button>
          <Button icon={<Share2 />} onClick={share}>Share</Button>
        </div>
        <a className="btn btn-ghost btn-sm" href={`sms:?&body=${encodeURIComponent(message)}`}><MessageSquareText aria-hidden /> Send as text message</a>
      </div>
    </Modal>
  );
}
