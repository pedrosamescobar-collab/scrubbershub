// POST /.netlify/functions/billing-autopay   (signed-in client)
//   { action: 'setup', org_id }            → Stripe-hosted page to save a card for auto-pay
//   { action: 'remove', method_id }        → detach a saved card and forget it
import { adminClient } from './_lib/admin';
import { appUrl, fail, json, requestUser } from './_lib/http';
import { stripe, stripeEnabled, StripeError } from './_lib/stripe';
import { getOrCreateCustomer } from './_lib/customers';

export default async (req: Request) => {
  if (req.method !== 'POST') return fail('Method not allowed', 405);
  const db = adminClient();
  const user = await requestUser(req, db);
  if (!user) return fail('Please sign in again', 401);
  const body = await req.json().catch(() => ({}));

  try {
    if (body.action === 'setup') {
      if (!stripeEnabled()) return fail('Online payments aren’t set up yet.', 503);
      const { data: client } = await db.from('clients').select('id, org_id').eq('org_id', String(body.org_id ?? '')).eq('user_id', user.id).maybeSingle();
      if (!client) return fail('Not allowed', 403);
      const { data: s } = await db.from('billing_settings').select('currency, autopay_enabled, stripe_account_id').eq('org_id', client.org_id).single();
      if (!s?.autopay_enabled) return fail('Auto-pay isn’t offered by this company');
      const customer = await getOrCreateCustomer(db, client.id, client.org_id, s.stripe_account_id);
      const base = appUrl(req);
      const session = await stripe('POST', 'checkout/sessions', {
        mode: 'setup',
        customer,
        currency: (s.currency ?? 'USD').toLowerCase(),
        setup_intent_data: { metadata: { org_id: client.org_id, client_id: client.id, purpose: 'autopay' } },
        metadata: { org_id: client.org_id, client_id: client.id, purpose: 'autopay' },
        success_url: `${base}/portal/billing?autopay=1`,
        cancel_url: `${base}/portal/billing`,
      }, { account: s.stripe_account_id });
      return json({ url: session.url });
    }

    if (body.action === 'remove') {
      const { data: m } = await db.from('payment_methods').select('id, org_id, client_id, processor_payment_method_id').eq('id', String(body.method_id ?? '')).maybeSingle();
      if (!m) return fail('Payment method not found', 404);
      const { data: client } = await db.from('clients').select('user_id').eq('id', m.client_id).single();
      if (client?.user_id !== user.id) return fail('Payment method not found', 404);
      if (stripeEnabled()) {
        const { data: s } = await db.from('billing_settings').select('stripe_account_id').eq('org_id', m.org_id).single();
        try { await stripe('POST', `payment_methods/${m.processor_payment_method_id}/detach`, {}, { account: s?.stripe_account_id }); }
        catch (e) { if (!(e instanceof StripeError && e.status === 400)) throw e; /* already detached */ }
      }
      await db.from('payment_methods').delete().eq('id', m.id);
      await db.from('billing_activity').insert({ org_id: m.org_id, type: 'autopay_disabled', message: 'Client removed a saved payment method', client_id: m.client_id, actor_id: user.id });
      return json({ ok: true });
    }
    return fail('Unknown action');
  } catch (e) {
    return fail(e instanceof StripeError ? e.message : 'Something went wrong. Please try again.', 502);
  }
};
