// POST /.netlify/functions/billing-checkout
// Starts a Stripe-hosted checkout for an invoice's balance (+ optional tip).
// Body: { invoice_id } with the client's Supabase token, or { token } from a
// secure pay link. Card details are entered on Stripe's page — never ours.
import { adminClient } from './_lib/admin';
import { appUrl, fail, json, requestUser, safePath } from './_lib/http';
import { platformFee, stripe, stripeEnabled, StripeError, toMinor } from './_lib/stripe';
import { getOrCreateCustomer } from './_lib/customers';

export default async (req: Request) => {
  if (req.method !== 'POST') return fail('Method not allowed', 405);
  if (!stripeEnabled()) return fail('Online payments aren’t set up yet. Please contact the company to pay another way.', 503);
  const db = adminClient();
  const body = await req.json().catch(() => ({}));

  const q = db.from('invoices').select('id, org_id, client_id, number, balance_due, status, public_token, sent_at, voided_at');
  const { data: inv } = body.token
    ? await q.eq('public_token', String(body.token)).maybeSingle()
    : await q.eq('id', String(body.invoice_id ?? '')).maybeSingle();
  if (!inv || !inv.sent_at) return fail('Invoice not found', 404);

  let returnPath = `/pay/${inv.public_token}`;
  if (!body.token) {
    const user = await requestUser(req, db);
    if (!user) return fail('Please sign in again', 401);
    const { data: client } = await db.from('clients').select('user_id').eq('id', inv.client_id).maybeSingle();
    if (client?.user_id !== user.id) return fail('Invoice not found', 404);
    returnPath = safePath(body.return_path, `/portal/billing/invoices/${inv.id}`);
  }
  if (inv.voided_at) return fail('This invoice was cancelled');
  const balance = Number(inv.balance_due);
  if (balance <= 0) return fail('This invoice is already paid');

  const [{ data: settings }, { data: org }] = await Promise.all([
    db.from('billing_settings').select('currency, tips_enabled, stripe_account_id').eq('org_id', inv.org_id).single(),
    db.from('organizations').select('name').eq('id', inv.org_id).single(),
  ]);
  const currency = (settings?.currency ?? 'USD').toLowerCase();
  const account = settings?.stripe_account_id ?? null;
  const rawTip = Number(body.tip ?? 0);
  const tip = settings?.tips_enabled && Number.isFinite(rawTip) ? Math.min(Math.max(Math.round(rawTip * 100) / 100, 0), Math.max(balance, 500)) : 0;

  try {
    const customer = await getOrCreateCustomer(db, inv.client_id, inv.org_id, account);
    const amountMinor = toMinor(balance, currency) + toMinor(tip, currency);
    const base = appUrl(req);
    const sep = returnPath.includes('?') ? '&' : '?';
    const session = await stripe('POST', 'checkout/sessions', {
      mode: 'payment',
      customer,
      client_reference_id: inv.id,
      line_items: [
        { quantity: 1, price_data: { currency, unit_amount: toMinor(balance, currency), product_data: { name: `Invoice ${inv.number}`, description: org?.name ?? undefined } } },
        ...(tip > 0 ? [{ quantity: 1, price_data: { currency, unit_amount: toMinor(tip, currency), product_data: { name: 'Tip for your crew' } } }] : []),
      ],
      payment_intent_data: {
        description: `${org?.name ?? 'Cleaning'} — invoice ${inv.number}`,
        metadata: { invoice_id: inv.id, org_id: inv.org_id, client_id: inv.client_id, tip: tip.toFixed(2) },
        setup_future_usage: body.save_card ? 'off_session' : undefined,
        application_fee_amount: platformFee(amountMinor, account),
      },
      metadata: { invoice_id: inv.id, org_id: inv.org_id, purpose: 'invoice' },
      success_url: `${base}${returnPath}${sep}paid=1`,
      cancel_url: `${base}${returnPath}`,
    }, { account });
    return json({ url: session.url });
  } catch (e) {
    const msg = e instanceof StripeError ? e.message : 'Couldn’t start the payment. Please try again.';
    return fail(msg, e instanceof StripeError && e.status < 500 ? 400 : 502);
  }
};
