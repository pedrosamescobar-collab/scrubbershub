import { format, formatDistanceToNowStrict, isToday, isTomorrow, isYesterday, differenceInMinutes } from 'date-fns';
import type { Client, JobStatus } from './types';

export const fmtTime = (d: string | Date) => format(new Date(d), 'h:mm a');
export const fmtDate = (d: string | Date) => format(new Date(d), 'EEE, MMM d');
export const fmtDateLong = (d: string | Date) => format(new Date(d), 'EEEE, MMMM d, yyyy');
export const fmtDateTime = (d: string | Date) => format(new Date(d), 'MMM d, h:mm a');
export const fmtAgo = (d: string | Date) => formatDistanceToNowStrict(new Date(d), { addSuffix: true });

export function fmtRelativeDay(d: string | Date) {
  const date = new Date(d);
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEE, MMM d');
}

export function fmtTimeRange(start: string, end: string) {
  return `${fmtTime(start)} – ${fmtTime(end)}`;
}

export function fmtDuration(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function minutesBetween(a: string, b?: string | null) {
  return differenceInMinutes(b ? new Date(b) : new Date(), new Date(a));
}

export function clientAddress(c?: Partial<Client> | null, multiline = false) {
  if (!c) return '';
  const line2 = [c.city, [c.state, c.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const parts = [[c.address_line1, c.address_line2].filter(Boolean).join(', '), line2].filter(Boolean);
  return parts.join(multiline ? '\n' : ', ');
}

export function mapsUrl(c?: Partial<Client> | null) {
  const a = clientAddress(c);
  return a ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}` : null;
}

export const STATUS_META: Record<JobStatus, { label: string; tone: 'blue' | 'amber' | 'green' | 'gray' }> = {
  scheduled: { label: 'Scheduled', tone: 'blue' },
  in_progress: { label: 'In progress', tone: 'amber' },
  completed: { label: 'Completed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
};

export function initials(name?: string | null) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

export function firstName(name?: string | null) {
  return (name || '').trim().split(/\s+/)[0] || '';
}

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Translate Postgres / Supabase error text into something friendly. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? 'Something went wrong');
  if (msg.includes('REQUIRED_ITEMS_INCOMPLETE')) return msg.split(':').slice(1).join(':').trim() || 'Finish the required checklist tasks first.';
  if (msg.includes('INSUFFICIENT_STOCK')) return `Not enough in stock — ${msg.split(':').slice(1).join(':').trim()}.`;
  if (msg.includes('NO_CHANGE')) return 'That count matches what’s already on record.';
  if (msg.includes('USE_STOCK_FUNCTIONS')) return 'Change stock with Restock, Use, or Count.';
  if (msg.includes('PHOTOS_REQUIRED')) return 'Add at least one after photo before completing.';
  if (msg.includes('row-level security')) return 'You don’t have permission to do that.';
  if (msg.includes('Invalid login credentials')) return 'That email and password don’t match.';
  if (msg.includes('Failed to fetch')) return 'Can’t reach the server. Check your connection and try again.';
  if (msg.includes('duplicate key') && msg.includes('reviews')) return 'You already reviewed this cleaning.';
  return msg;
}
