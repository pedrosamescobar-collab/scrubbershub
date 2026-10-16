// Billing types + helpers mirroring supabase/migrations/0002_billing.sql.
// Totals shown while editing are previews; the database recomputes the real ones.

export type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled' | 'refunded';
export type EstimateStatus = 'draft' | 'sent' | 'viewed' | 'approved' | 'declined' | 'expired';
export type PaymentMethod = 'card' | 'debit_card' | 'ach' | 'cash' | 'check' | 'other';
export type PricingType = 'flat' | 'hourly' | 'per_room' | 'per_unit' | 'custom';
export type Frequency = 'weekly' | 'biweekly' | 'every_4_weeks' | 'monthly' | 'custom';
export type RuleMode = 'draft' | 'send' | 'autocharge';
type Tone = 'blue' | 'amber' | 'green' | 'gray' | 'red' | 'brand';

export interface BillingSettings {
  org_id: string;
  urgent_fee?: number;
  emergency_fee?: number;
  currency: string;
  tax_rate: number;
  tax_label: string;
  payment_terms_days: number;
  invoice_prefix: string;
  next_invoice_number: number;
  estimate_prefix: string;
  next_estimate_number: number;
  estimate_valid_days: number;
  default_invoice_notes: string | null;
  default_terms: string | null;
  payment_instructions: string | null;
  accepted_methods: string[];
  tips_enabled: boolean;
  tip_presets: number[];
  autopay_enabled: boolean;
  reminders_enabled: boolean;
  reminder_offsets: number[];
  reminder_channels: string[];
  send_receipts: boolean;
  receipt_message: string | null;
  stripe_account_id: string | null;
}

export interface ServiceItem {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  default_price: number;
  pricing_type: PricingType;
  unit_label: string | null;
  taxable: boolean;
  is_active: boolean;
  position: number;
}

export interface LineItem {
  id?: string;
  service_id?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  taxable: boolean;
  is_optional?: boolean;
  is_selected?: boolean;
  line_total?: number;
}

interface DocBase {
  id: string;
  org_id: string;
  client_id: string;
  number: string;
  issue_date: string;
  service_address: string | null;
  notes: string | null;
  terms: string | null;
  internal_notes: string | null;
  discount_type: 'amount' | 'percent';
  discount_value: number;
  tax_rate: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  public_token: string;
  sent_at: string | null;
  viewed_at: string | null;
  created_at: string;
  client?: { id: string; full_name: string; email: string | null; phone: string | null } | null;
}

export interface Invoice extends DocBase {
  job_id: string | null;
  appointment_id: string | null;
  estimate_id: string | null;
  recurring_rule_id: string | null;
  status: InvoiceStatus;
  due_date: string;
  credit_amount: number;
  amount_paid: number;
  tip_total: number;
  amount_refunded: number;
  balance_due: number;
  paid_at: string | null;
  last_sent_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  autopay_requested_at: string | null;
  autopay_error: string | null;
  invoice_items?: LineItem[];
  job?: { id: string; service_name: string; scheduled_start: string; completed_at: string | null } | null;
}

export interface Estimate extends DocBase {
  status: EstimateStatus;
  title: string | null;
  valid_until: string | null;
  approved_at: string | null;
  declined_at: string | null;
  client_response: string | null;
  invoice_id: string | null;
  appointment_id: string | null;
  estimate_items?: LineItem[];
}

export interface Payment {
  id: string;
  org_id: string;
  invoice_id: string;
  client_id: string;
  amount: number;
  tip_amount: number;
  amount_refunded: number;
  method: PaymentMethod;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded';
  processor: 'manual' | 'stripe';
  processor_payment_id: string | null;
  card_brand: string | null;
  card_last4: string | null;
  reference: string | null;
  notes: string | null;
  receipt_number: string;
  paid_at: string;
  client?: { id: string; full_name: string } | null;
  invoice?: { id: string; number: string } | null;
}

export interface Refund {
  id: string;
  org_id: string;
  payment_id: string;
  invoice_id: string;
  amount: number;
  reason: string | null;
  status: string;
  processor_refund_id: string | null;
  created_at: string;
  invoice?: { id: string; number: string; client?: { full_name: string } | null } | null;
}

export interface RecurringRule {
  id: string;
  org_id: string;
  client_id: string;
  appointment_id: string | null;
  name: string;
  frequency: Frequency;
  interval_days: number | null;
  next_run_date: string;
  end_date: string | null;
  mode: RuleMode;
  status: 'active' | 'paused' | 'cancelled';
  items: LineItem[];
  notes: string | null;
  last_run_at: string | null;
  last_invoice_id: string | null;
  client?: { id: string; full_name: string } | null;
  last_invoice?: { id: string; number: string; status: InvoiceStatus; paid_at: string | null } | null;
}

export interface SavedMethod {
  id: string;
  client_id?: string;
  kind: 'card' | 'us_bank_account' | 'other';
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
  autopay_enabled: boolean;
}

export interface BillingActivity {
  id: string;
  type: string;
  message: string;
  amount: number | null;
  invoice_id: string | null;
  estimate_id: string | null;
  payment_id: string | null;
  client_id: string | null;
  created_at: string;
}

/** Client-safe document returned by get_my_invoice / get_public_invoice. */
export interface ClientInvoice {
  id: string;
  number: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  service_address: string | null;
  notes: string | null;
  terms: string | null;
  discount_type: 'amount' | 'percent';
  discount_value: number;
  tax_rate: number;
  credit_amount: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  amount_paid: number;
  tip_total: number;
  amount_refunded: number;
  balance_due: number;
  paid_at: string | null;
  sent_at: string | null;
  voided_at: string | null;
  public_token: string;
  org: PublicOrg;
  client: { id: string; full_name: string; email: string | null; phone: string | null } | null;
  job: { id: string; service_name: string; scheduled_start: string; completed_at: string | null } | null;
  settings: {
    currency: string; tax_label: string; payment_instructions: string | null; tips_enabled: boolean; tip_presets: number[];
    accepted_methods: string[]; receipt_message: string | null; autopay_enabled: boolean;
  } | null;
  items: LineItem[];
  payments: ClientPayment[];
}

export interface ClientPayment {
  id: string;
  invoice_id?: string;
  invoice_number?: string;
  amount: number;
  tip_amount: number;
  amount_refunded: number;
  method: PaymentMethod;
  status: string;
  processor?: string;
  processor_payment_id?: string | null;
  card_brand: string | null;
  card_last4: string | null;
  reference?: string | null;
  notes?: string | null;
  receipt_number: string;
  paid_at: string;
}

export interface ClientEstimate {
  id: string;
  number: string;
  status: EstimateStatus;
  title: string | null;
  issue_date: string;
  valid_until: string | null;
  service_address: string | null;
  notes: string | null;
  terms: string | null;
  discount_type: 'amount' | 'percent';
  discount_value: number;
  tax_rate: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  approved_at: string | null;
  declined_at: string | null;
  client_response: string | null;
  public_token: string;
  org: PublicOrg;
  client: { id: string; full_name: string } | null;
  settings: { currency: string; tax_label: string } | null;
  items: LineItem[];
}

export interface PublicOrg {
  id: string;
  name: string;
  logo_url: string | null;
  brand_color: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  theme?: import('./brand').Theme | null;
  trade?: string;
}

export interface MyBilling {
  invoices: { id: string; number: string; status: InvoiceStatus; issue_date: string; due_date: string; total: number; balance_due: number; amount_paid: number; tip_total: number; paid_at: string | null; service_name: string | null }[];
  estimates: { id: string; number: string; status: EstimateStatus; title: string | null; issue_date: string; valid_until: string | null; total: number }[];
  payments: ClientPayment[];
  payment_methods: SavedMethod[];
  settings: { currency: string; autopay_enabled: boolean; tips_enabled: boolean } | null;
  has_recurring: boolean;
}

// ---------------------------------------------------------------- formatting

export function money(value: number | string | null | undefined, currency = 'USD') {
  const n = Number(value ?? 0);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** Compact money for big dashboard numbers ($12.4k). */
export function moneyShort(value: number, currency = 'USD') {
  if (Math.abs(value) < 10000) return money(value, currency);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value);
  } catch {
    return money(value, currency);
  }
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'gray' },
  sent: { label: 'Sent', tone: 'blue' },
  viewed: { label: 'Viewed', tone: 'brand' },
  partially_paid: { label: 'Partially paid', tone: 'amber' },
  paid: { label: 'Paid', tone: 'green' },
  overdue: { label: 'Overdue', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
  refunded: { label: 'Refunded', tone: 'gray' },
};

export const ESTIMATE_STATUS: Record<EstimateStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'gray' },
  sent: { label: 'Sent', tone: 'blue' },
  viewed: { label: 'Viewed', tone: 'brand' },
  approved: { label: 'Approved', tone: 'green' },
  declined: { label: 'Declined', tone: 'red' },
  expired: { label: 'Expired', tone: 'amber' },
};

export const PAYMENT_STATUS: Record<Payment['status'], { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'amber' },
  succeeded: { label: 'Succeeded', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  refunded: { label: 'Refunded', tone: 'gray' },
  partially_refunded: { label: 'Partly refunded', tone: 'amber' },
};

export const METHOD_LABEL: Record<string, string> = {
  card: 'Credit card', debit_card: 'Debit card', ach: 'ACH / bank', cash: 'Cash', check: 'Check', other: 'Other',
};

export const PRICING_LABEL: Record<PricingType, string> = {
  flat: 'Flat rate', hourly: 'Hourly', per_room: 'Per room', per_unit: 'Per unit', custom: 'Custom',
};

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: 'Weekly', biweekly: 'Every 2 weeks', every_4_weeks: 'Every 4 weeks', monthly: 'Monthly', custom: 'Custom',
};

export const MODE_LABEL: Record<RuleMode, { label: string; hint: string }> = {
  draft: { label: 'Create a draft for review', hint: 'You check it, then send it' },
  send: { label: 'Create and send automatically', hint: 'Client gets the invoice right away' },
  autocharge: { label: 'Send and auto-charge saved card', hint: 'Charged when the client has auto-pay on; otherwise just sent' },
};

export function methodDisplay(p: { method: string; card_brand?: string | null; card_last4?: string | null }) {
  const base = METHOD_LABEL[p.method] ?? p.method;
  return p.card_last4 ? `${p.card_brand ? cap(p.card_brand) : base} •••• ${p.card_last4}` : base;
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Mirror of invoice_compute() for live previews in the editor. */
export function computeTotals(items: LineItem[], opts: { discount_type: 'amount' | 'percent'; discount_value: number; tax_rate: number; credit_amount?: number }) {
  const included = items.filter((i) => !i.is_optional || i.is_selected);
  const lines = included.map((i) => round2((Number(i.quantity) || 0) * (Number(i.unit_price) || 0)));
  const subtotal = round2(lines.reduce((a, b) => a + b, 0));
  const taxable = round2(included.reduce((a, it, idx) => a + (it.taxable ? lines[idx] : 0), 0));
  const rawDisc = opts.discount_type === 'percent' ? round2((subtotal * Math.min(Number(opts.discount_value) || 0, 100)) / 100) : Number(opts.discount_value) || 0;
  const discount = Math.min(rawDisc, subtotal);
  const base = subtotal > 0 ? taxable - discount * (taxable / subtotal) : 0;
  const tax = round2((Math.max(base, 0) * (Number(opts.tax_rate) || 0)) / 100);
  const total = Math.max(round2(subtotal - discount + tax - (Number(opts.credit_amount) || 0)), 0);
  return { subtotal, discount, tax, total };
}

export const todayIso = () => toIsoDate(new Date());
export function toIsoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(iso: string, days: number) {
  const d = parseDate(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}
/** Parse a YYYY-MM-DD date as a local calendar date (no timezone shift). */
export function parseDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function fmtDay(iso: string | null | undefined) {
  if (!iso) return '—';
  return parseDate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
export function daysUntil(iso: string) {
  const a = parseDate(iso).getTime();
  const b = parseDate(todayIso()).getTime();
  return Math.round((a - b) / 864e5);
}
export function dueText(inv: { due_date: string; status: InvoiceStatus; balance_due: number }) {
  if (inv.status === 'paid' || inv.status === 'refunded' || inv.status === 'cancelled' || inv.status === 'draft') return `Due ${fmtDay(inv.due_date)}`;
  const d = daysUntil(inv.due_date);
  if (d < 0) return `${-d} day${d === -1 ? '' : 's'} overdue`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  return `Due in ${d} days`;
}

export function offsetLabel(o: number) {
  if (o < 0) return `${-o} day${o === -1 ? '' : 's'} before due`;
  if (o === 0) return 'On the due date';
  return `${o} day${o === 1 ? '' : 's'} overdue`;
}
