import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from './stripe';

/** Stripe customer for a ScrubHub client (created on first payment). */
export async function getOrCreateCustomer(db: SupabaseClient, clientId: string, orgId: string, account: string | null) {
  const { data: existing } = await db.from('billing_customers').select('stripe_customer_id').eq('client_id', clientId).maybeSingle();
  if (existing?.stripe_customer_id) return existing.stripe_customer_id as string;
  const { data: c } = await db.from('clients').select('full_name, email, phone').eq('id', clientId).single();
  const cust = await stripe('POST', 'customers', {
    name: c?.full_name ?? undefined, email: c?.email ?? undefined, phone: c?.phone ?? undefined,
    metadata: { scrubhub_client_id: clientId, scrubhub_org_id: orgId },
  }, { account, idempotencyKey: `customer-${clientId}` });
  await db.from('billing_customers').upsert({ client_id: clientId, org_id: orgId, stripe_customer_id: cust.id });
  return cust.id as string;
}
