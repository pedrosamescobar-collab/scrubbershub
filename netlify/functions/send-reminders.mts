// Scheduled: hourly. Queues appointment reminders (clients) and job reminders
// (assigned crew) for every company, using each company's "remind N hours
// before" setting. Delivery happens in dispatch-notifications.
import type { Config } from '@netlify/functions';
import { adminClient } from './_lib/admin';

export default async () => {
  const db = adminClient();
  const { data, error } = await db.rpc('queue_reminders', { p_org: null });
  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ queued: data });
};

export const config: Config = { schedule: '@hourly' };
