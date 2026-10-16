// POST /.netlify/functions/stripe-webhook
// Add this URL in Stripe → Developers → Webhooks (and "Connect" events if you use
// Stripe Connect). Events: payment_intent.succeeded, payment_intent.payment_failed,
// checkout.session.completed, charge.refunded.
// Every handler is idempotent, so Stripe retries are safe.
import { adminClient } from './_lib/admin';
import { describePaymentMethod, fromMinor, stripe, verifyWebhook } from './_lib/stripe';

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get('stripe-signature'))) return new Response('Invalid signature', { status: 400 });
  const event = JSON.parse(raw);
  const account: string | undefined = event.account; // set for Connect (connected account) events
  const db = adminClient();
  const obj = event.data?.object ?? {};

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const invoiceId = obj.metadata?.invoice_id;
        if (!invoiceId) break; // not a ScrubHub invoice payment
        const pi = await stripe('GET', `payment_intents/${obj.id}`, { expand: ['payment_method'] }, { account });
        const d = describePaymentMethod(pi.payment_method);
        const currency = String(pi.currency || 'usd');
        const { error } = await db.rpc('apply_online_payment', { p: {
          invoice_id: invoiceId,
          amount: fromMinor(pi.amount_received ?? pi.amount, currency),
          tip_amount: Number(pi.metadata?.tip ?? 0),
          processor_payment_id: pi.id,
          method: d.method, card_brand: d.brand, card_last4: d.last4,
          reference: typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null,
        } });
        if (error) throw new Error(error.message);
        // Client ticked "save this card" at checkout → keep it for next time
        if (pi.setup_future_usage && pi.payment_method?.id && pi.metadata?.client_id) {
          await db.rpc('save_payment_method', { p: {
            client_id: pi.metadata.client_id, customer_id: pi.customer, payment_method_id: pi.payment_method.id,
            kind: d.kind, brand: d.brand, last4: d.last4, exp_month: d.exp_month, exp_year: d.exp_year, autopay: false,
          } });
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const invoiceId = obj.metadata?.invoice_id;
        if (invoiceId) await db.rpc('online_payment_failed', { p_invoice: invoiceId, p_message: obj.last_payment_error?.message ?? 'Payment failed' });
        break;
      }
      case 'checkout.session.completed': {
        if (obj.mode !== 'setup' || obj.metadata?.purpose !== 'autopay') break;
        const si = await stripe('GET', `setup_intents/${obj.setup_intent}`, { expand: ['payment_method'] }, { account });
        const d = describePaymentMethod(si.payment_method);
        const { error } = await db.rpc('save_payment_method', { p: {
          client_id: obj.metadata.client_id, customer_id: si.customer ?? obj.customer, payment_method_id: si.payment_method?.id,
          kind: d.kind, brand: d.brand, last4: d.last4, exp_month: d.exp_month, exp_year: d.exp_year, autopay: true,
        } });
        if (error) throw new Error(error.message);
        break;
      }
      case 'charge.refunded': {
        // Covers refunds made directly in the Stripe dashboard
        if (!obj.payment_intent) break;
        const list = await stripe('GET', 'refunds', { charge: obj.id, limit: 100 }, { account });
        for (const r of list.data ?? []) {
          if (r.status !== 'succeeded') continue;
          const { error } = await db.rpc('record_online_refund', { p: {
            processor_payment_id: obj.payment_intent, processor_refund_id: r.id,
            amount: fromMinor(r.amount, String(r.currency || 'usd')), reason: r.metadata?.note || r.reason || 'Refunded in Stripe',
          } });
          if (error && !/Payment not found/.test(error.message)) throw new Error(error.message);
        }
        break;
      }
    }
  } catch (e) {
    console.error('stripe-webhook', event.type, e);
    return new Response(`Webhook error: ${(e as Error).message}`, { status: 500 }); // Stripe will retry
  }
  return Response.json({ received: true });
};
