import { Siren, Zap } from 'lucide-react';
import type { JobPriority } from '@/lib/types';
import { Badge, Segmented } from '@/components/ui/Misc';

export const PRIORITY_META: Record<JobPriority, { label: string; tone: 'red' | 'amber' | 'gray' }> = {
  normal: { label: 'Normal', tone: 'gray' },
  urgent: { label: 'Urgent', tone: 'amber' },
  emergency: { label: 'Emergency', tone: 'red' },
};

export function PriorityBadge({ priority }: { priority?: JobPriority | null }) {
  if (!priority || priority === 'normal') return null;
  const m = PRIORITY_META[priority];
  return (
    <Badge tone={m.tone} dot={false}>
      {priority === 'emergency' ? <Siren size={12} aria-hidden /> : <Zap size={12} aria-hidden />} {m.label}
    </Badge>
  );
}

export function PriorityPicker({ value, onChange }: { value: JobPriority; onChange: (v: JobPriority) => void }) {
  return (
    <div className="field">
      <span className="label">Priority</span>
      <Segmented block label="Priority" value={value} onChange={onChange}
        options={[
          { value: 'normal', label: 'Normal' },
          { value: 'urgent', label: <span className="row" style={{ ['--gap' as string]: '4px' }}><Zap size={14} aria-hidden />Urgent</span> },
          { value: 'emergency', label: <span className="row" style={{ ['--gap' as string]: '4px' }}><Siren size={14} aria-hidden />Emergency</span> },
        ]} />
      <span className="hint">{value === 'normal' ? 'Regular scheduling' : 'The office and the assigned technician get an alert right away. Your urgent / emergency fee (Billing settings) is added to the invoice.'}</span>
    </div>
  );
}
