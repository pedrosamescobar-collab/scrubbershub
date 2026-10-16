// Minimal Stripe REST client (no SDK needed). Server-side only.
//
// Env:
//   STRIPE_SECRET_KEY              sk_live_… / sk_test_…   (required for online payments)
//   STRIPE_WEBHOOK_SECRET          whsec_…                 (required for the webhook)
//   STRIPE_PLATFORM_FEE_PERCENT    optional, e.g. 1.5 — ScrubHub's cut when a company
//                                  uses its own connected Stripe account (Stripe Connect)
import { createHmac, timingSafeEqual } from 'node:crypto';

const env = (k: string) => process.env[k]?.trim() || '';

export const stripeEnabled = () => Boolean(env('STRIPE_SECRET_KEY'));

type Params = Record<string, unknown>;

/** Stripe wants nested form fields: a[b][0][c]=1 */
function encode(params: Params, prefix = '', out: string[] = []): string[] {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') encode(item as Params, `${key}[${i}]`, out);
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === 'object') encode(v as Params, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export class StripeError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

/**
 * Call the Stripe API. `account` = connected account id (acct_…) for Stripe
 * Connect direct charges; omit to use the platform account.
 */
export async function stripe<T = any>(
  method: 'GET' | 'POST' | 'DELETE', path: string, params: Params = {},
  opts: { account?: string | null; idempotencyKey?: string } = {},
): Promise<T> {
  const key = env('STRIPE_SECRET_KEY');
  if (!key) throw new StripeError('Online payments are not set up yet (missing STRIPE_SECRET_KEY).', 503);
  const qs = encode(params).join('&');
  const url = `https://api.stripe.com/v1/${path}${method === 'GET' && qs ? `?${qs}` : ''}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': '2024-06-20',
  };
  if (opts.account) headers['Stripe-Account'] = opts.account;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(url, { method, headers, body: method === 'GET' ? undefined : qs });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as any)?.error ?? {};
    throw new StripeError(err.message || `Stripe error ${res.status}`, res.status, err.code || err.decline_code);
  }
  return data as T;
}

/** Amount in the smallest currency unit (cents). */
export const toMinor = (amount: number, currency: string) =>
  ZERO_DECIMAL.has(currency.toLowerCase()) ? Math.round(amount) : Math.round(amount * 100);
export const fromMinor = (minor: number, currency: string) =>
  ZERO_DECIMAL.has(currency.toLowerCase()) ? minor : minor / 100;
const ZERO_DECIMAL = new Set(['jpy', 'krw', 'vnd', 'clp', 'pyg', 'xaf', 'xof', 'ugx', 'rwf', 'kmf', 'gnf', 'djf', 'bif', 'mga', 'vuv', 'xpf']);

/** ScrubHub's platform fee for Connect accounts, in minor units. */
export function platformFee(amountMinor: number, account: string | null | undefined) {
  const pct = Number(env('STRIPE_PLATFORM_FEE_PERCENT') || 0);
  if (!account || !pct || pct <= 0) return undefined;
  return Math.floor((amountMinor * pct) / 100);
}

/** Verify the Stripe-Signature header (HMAC-SHA256, 5 minute tolerance). */
export function verifyWebhook(rawBody: string, header: string | null): boolean {
  const secret = env('STRIPE_WEBHOOK_SECRET');
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]).filter((p) => p.length === 2)) as Record<string, string>;
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

/** Map a Stripe payment method to ScrubHub's method + display fields. */
export function describePaymentMethod(pm: any) {
  if (!pm) return { method: 'card', brand: null, last4: null, kind: 'card', exp_month: null, exp_year: null };
  if (pm.type === 'us_bank_account') {
    return { method: 'ach', kind: 'us_bank_account', brand: pm.us_bank_account?.bank_name ?? 'Bank', last4: pm.us_bank_account?.last4 ?? null, exp_month: null, exp_year: null };
  }
  const card = pm.card ?? {};
  return {
    method: card.funding === 'debit' ? 'debit_card' : 'card', kind: 'card',
    brand: card.brand ?? null, last4: card.last4 ?? null, exp_month: card.exp_month ?? null, exp_year: card.exp_year ?? null,
  };
}
