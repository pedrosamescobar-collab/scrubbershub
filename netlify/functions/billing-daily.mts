// Scheduled: hourly. For every company:
//   1. marks invoices overdue + queues payment reminders (per company schedule)
//   2. generates invoices from recurring billing rules
//   3. charges saved cards for invoices set to auto-pay
// Delivery of the resulting messages happens in dispatch-notifications.
import type { Config } from '@netlify/functions';
import { adminClient } from './_lib/admin';
import { platformFee, stripe, stripeEnabled, StripeError, toMinor } from './_lib/stripe';

export default async () => {
  const db = adminClient();
  const reminders = await db.rpc('queue_invoice_reminders', { p_org: null });
  const recurring = await db.rpc('run_recurring_billing', { p_org: null });
  let charged = 0, failed = 0;

  if (stripeEnabled()) {
    const { data: due } = await db.from('invoices')
      .select('id, org_id, client_id, number, balance_due')
      .not('autopay_requested_at', 'is', null).is('autopay_attempted_at', null).is('voided_at', null).gt('balance_due', 0)
      .limit(50);
    for (const inv of due ?? []) {
      // claim first so a slow run can never charge twice
      const { data: claimed } = await db.from('invoices').update({ autopay_attempted_at: new Date().toISOString() })
        .eq('id', inv.id).is('autopay_attempted_at', null).select('id');
      if (!claimed?.length) continue;
      const [{ data: pm }, { data: s }] = await Promise.all([
        db.from('payment_methods').select('processor_customer_id, processor_payment_method_id')
          .eq('client_id', inv.client_id).eq('autopay_enabled', true).limit(1).maybeSingle(),
        db.from('billing_settings').select('currency, stripe_account_id').eq('org_id', inv.org_id).single(),
      ]);
      if (!pm?.processor_customer_id) {
        await db.rpc('online_payment_failed', { p_invoice: inv.id, p_message: 'No auto-pay card on file' });
        failed++;
        continue;
      }
      const currency = (s?.currency ?? 'USD').toLowerCase();
      const amount = toMinor(Number(inv.balance_due), currency);
      try {
        await stripe('POST', 'payment_intents', {
          amount, currency, customer: pm.processor_customer_id, payment_method: pm.processor_payment_method_id,
          off_session: true, confirm: true,
          description: `Auto-pay — invoice ${inv.number}`,
          metadata: { invoice_id: inv.id, org_id: inv.org_id, client_id: inv.client_id, tip: '0.00', autopay: 'true' },
          application_fee_amount: platformFee(amount, s?.stripe_account_id),
        }, { account: s?.stripe_account_id, idempotencyKey: `autopay-${inv.id}` });
        charged++; // the webhook records the payment when Stripe confirms it
      } catch (e) {
        await db.rpc('online_payment_failed', { p_invoice: inv.id, p_message: e instanceof StripeError ? e.message : 'Auto-pay charge failed' });
        failed++;
      }
    }
  }

  return Response.json({
    reminders: reminders.error ? reminders.error.message : reminders.data,
    recurring_invoices: recurring.error ? recurring.error.message : recurring.data,
    autopay_charged: charged, autopay_failed: failed,
  });
};

export const config: Config = { schedule: '@hourly' };
