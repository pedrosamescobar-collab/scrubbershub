// POST /.netlify/functions/billing-refund   (owner/admin)
// Body: { payment_id, amount, reason } — refunds a Stripe payment through Stripe,
// then records it. Offline (cash/check) refunds use the issue_refund RPC instead.
import { adminClient } from './_lib/admin';
import { fail, isOrgAdmin, json, requestUser } from './_lib/http';
import { stripe, StripeError, toMinor } from './_lib/stripe';

export default async (req: Request) => {
  if (req.method !== 'POST') return fail('Method not allowed', 405);
  const db = adminClient();
  const user = await requestUser(req, db);
  if (!user) return fail('Please sign in again', 401);
  const body = await req.json().catch(() => ({}));

  const { data: pay } = await db.from('payments')
    .select('id, org_id, processor, processor_payment_id, amount, tip_amount, amount_refunded')
    .eq('id', String(body.payment_id ?? '')).maybeSingle();
  if (!pay || !(await isOrgAdmin(db, pay.org_id, user.id))) return fail('Not allowed', 403);
  if (pay.processor !== 'stripe' || !pay.processor_payment_id) return fail('This payment was recorded manually — refund it from the payment screen');

  const amount = Math.round(Number(body.amount) * 100) / 100;
  const refundable = Number(pay.amount) + Number(pay.tip_amount) - Number(pay.amount_refunded);
  if (!(amount > 0) || amount > refundable + 0.001) return fail(`You can refund up to ${refundable.toFixed(2)}`);

  const { data: s } = await db.from('billing_settings').select('currency, stripe_account_id').eq('org_id', pay.org_id).single();
  try {
    const refund = await stripe('POST', 'refunds', {
      payment_intent: pay.processor_payment_id,
      amount: toMinor(amount, s?.currency ?? 'USD'),
      reason: 'requested_by_customer',
      metadata: { scrubhub_payment_id: pay.id, note: String(body.reason ?? '').slice(0, 200) },
    }, { account: s?.stripe_account_id, idempotencyKey: `refund-${pay.id}-${Number(pay.amount_refunded).toFixed(2)}-${amount.toFixed(2)}` });
    const { error } = await db.rpc('record_online_refund', { p: {
      processor_payment_id: pay.processor_payment_id, processor_refund_id: refund.id, amount,
      reason: String(body.reason ?? '').trim() || null, created_by: user.id,
    } });
    if (error) return fail(error.message, 500);
    return json({ ok: true, refund_id: refund.id });
  } catch (e) {
    return fail(e instanceof StripeError ? e.message : 'Refund failed. Please try again.', 502);
  }
};
