// Scheduled: every 5 minutes. Reads pending in-app notifications and delivers
// them by email / SMS where the company has that channel enabled and the
// provider keys are configured. Rows are marked sent / skipped / failed.
import type { Config } from '@netlify/functions';
import { adminClient } from './_lib/admin';
import { emailChannel, smsChannel, pushChannel } from './_lib/channels';

// Which notification types go out beyond the app.
const OUTBOUND_TYPES = new Set(['appointment_reminder', 'job_reminder', 'job_assigned', 'review_request', 'job_completed',
  'invoice_sent', 'invoice_reminder', 'payment_receipt', 'refund_issued', 'estimate_sent',
  'payment_received', 'payment_failed', 'invoice_overdue', 'estimate_approved', 'estimate_declined', 'low_stock']);
const SMS_TYPES = new Set(['appointment_reminder', 'job_reminder', 'job_assigned', 'invoice_reminder', 'invoice_sent']);

export default async () => {
  const db = adminClient();
  const appUrl = (process.env.APP_URL || process.env.URL || '').replace(/\/$/, '');

  const { data: rows, error } = await db
    .from('notifications')
    .select('id, org_id, user_id, type, title, body, link, organization:organizations(name, organization_settings(email_notifications, sms_notifications))')
    .eq('delivery_status', 'pending')
    .order('created_at')
    .limit(100);
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0, skipped = 0, failed = 0;
  for (const n of rows ?? []) {
    const log: Record<string, string> = {};
    const org = (n as any).organization;
    const rawSettings = org?.organization_settings;
    const settings = Array.isArray(rawSettings) ? rawSettings[0] : rawSettings;
    const orgName = org?.name ?? 'ScrubHub';
    if (!OUTBOUND_TYPES.has(n.type)) {
      await db.from('notifications').update({ delivery_status: 'skipped', delivery_log: { reason: 'in-app only' } }).eq('id', n.id);
      skipped++;
      continue;
    }
    const { data: profile } = await db.from('profiles').select('email, phone').eq('id', n.user_id).maybeSingle();
    const msg = { subject: n.title, text: n.body ?? '', link: n.link ? `${appUrl}${n.link}` : null, orgName };

    if (settings?.email_notifications && emailChannel.enabled && profile?.email) {
      try { await emailChannel.send({ ...msg, to: profile.email }); log.email = 'sent'; } catch (e) { log.email = String(e); }
    } else log.email = 'skipped';

    if (settings?.sms_notifications && SMS_TYPES.has(n.type) && smsChannel.enabled && profile?.phone) {
      try { await smsChannel.send({ ...msg, to: profile.phone }); log.sms = 'sent'; } catch (e) { log.sms = String(e); }
    } else log.sms = 'skipped';

    log.push = pushChannel.enabled ? 'not-implemented' : 'skipped';

    const anySent = Object.values(log).includes('sent');
    const anyFailed = Object.values(log).some((v) => v !== 'sent' && v !== 'skipped' && v !== 'not-implemented');
    const status = anySent ? 'sent' : anyFailed ? 'failed' : 'skipped';
    await db.from('notifications').update({ delivery_status: status, delivery_log: log }).eq('id', n.id);
    if (status === 'sent') sent++; else if (status === 'failed') failed++; else skipped++;
  }

  // Billing messages for clients who don't have a portal login (secure pay links)
  const { data: outbox } = await db
    .from('billing_outbox')
    .select('id, org_id, type, to_email, to_phone, subject, body, link, organization:organizations(name, organization_settings(email_notifications, sms_notifications))')
    .eq('delivery_status', 'pending').order('created_at').limit(100);
  for (const m of outbox ?? []) {
    const log: Record<string, string> = {};
    const org = (m as any).organization;
    const rawSettings = org?.organization_settings;
    const settings = Array.isArray(rawSettings) ? rawSettings[0] : rawSettings;
    const msg = { subject: m.subject, text: m.body ?? '', link: m.link ? `${appUrl}${m.link}` : null, orgName: org?.name ?? 'ScrubHub' };
    if (settings?.email_notifications !== false && emailChannel.enabled && m.to_email) {
      try { await emailChannel.send({ ...msg, to: m.to_email }); log.email = 'sent'; } catch (e) { log.email = String(e); }
    } else log.email = 'skipped';
    if (settings?.sms_notifications && SMS_TYPES.has(m.type) && smsChannel.enabled && m.to_phone) {
      try { await smsChannel.send({ ...msg, to: m.to_phone }); log.sms = 'sent'; } catch (e) { log.sms = String(e); }
    } else log.sms = 'skipped';
    const anySent = Object.values(log).includes('sent');
    const anyFailed = Object.values(log).some((v) => v !== 'sent' && v !== 'skipped');
    const status = anySent ? 'sent' : anyFailed ? 'failed' : 'skipped';
    await db.from('billing_outbox').update({ delivery_status: status, delivery_log: log }).eq('id', m.id);
    if (status === 'sent') sent++; else if (status === 'failed') failed++; else skipped++;
  }

  return Response.json({ processed: (rows?.length ?? 0) + (outbox?.length ?? 0), sent, skipped, failed });
};

export const config: Config = { schedule: '*/5 * * * *' };
