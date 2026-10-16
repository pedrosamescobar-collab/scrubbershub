// GET /.netlify/functions/billing-config — tells the app whether online card
// payments are switched on (no secrets returned).
import { json } from './_lib/http';
import { stripeEnabled } from './_lib/stripe';

export default async () => json({
  online_payments: stripeEnabled(),
  webhook_configured: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()),
});
