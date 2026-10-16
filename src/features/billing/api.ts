import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import { useWorkspace } from '@/auth/AuthProvider';
import type {
  BillingActivity, BillingSettings, Estimate, Invoice, Payment, RecurringRule, Refund, SavedMethod, ServiceItem,
} from '@/lib/billing';

export const INVOICE_LIST_SELECT = '*, client:clients(id, full_name, email, phone)';
export const INVOICE_DETAIL_SELECT = '*, client:clients(id, full_name, email, phone), invoice_items(*), job:jobs(id, service_name, scheduled_start, completed_at)';

export const bk = {
  all: ['billing'] as const,
  settings: (org: string) => ['billing', 'settings', org] as const,
  catalog: (org: string) => ['billing', 'catalog', org] as const,
  invoices: (org: string) => ['billing', 'invoices', org] as const,
  invoice: (id: string) => ['billing', 'invoice', id] as const,
  estimates: (org: string) => ['billing', 'estimates', org] as const,
  estimate: (id: string) => ['billing', 'estimate', id] as const,
  payments: (org: string) => ['billing', 'payments', org] as const,
  refunds: (org: string) => ['billing', 'refunds', org] as const,
  rules: (org: string) => ['billing', 'rules', org] as const,
  activity: (org: string, key?: string) => ['billing', 'activity', org, key ?? 'all'] as const,
  config: ['billing', 'config'] as const,
};

/** Refresh every billing screen after a change. */
export function useInvalidateBilling() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: bk.all });
    void qc.invalidateQueries({ queryKey: ['portal'] });
    void qc.invalidateQueries({ queryKey: ['job-invoice'] });
  };
}

export function useBillingSettings() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: bk.settings(ws.org.id),
    queryFn: async () => unwrap(await supabase.from('billing_settings').select('*').eq('org_id', ws.org.id).maybeSingle()) as BillingSettings | null,
  });
}

/** Currency for this workspace (defaults to USD while loading). */
export function useCurrency() {
  return useBillingSettings().data?.currency ?? 'USD';
}

export function useCatalog(opts?: { activeOnly?: boolean }) {
  const ws = useWorkspace();
  return useQuery({
    queryKey: [...bk.catalog(ws.org.id), opts?.activeOnly ?? false],
    queryFn: async () => {
      let q = supabase.from('service_catalog').select('*').eq('org_id', ws.org.id);
      if (opts?.activeOnly) q = q.eq('is_active', true);
      return unwrap(await q.order('position').order('name')) as ServiceItem[];
    },
  });
}

export function useInvoices() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: bk.invoices(ws.org.id),
    queryFn: async () => unwrap(await supabase.from('invoices').select(INVOICE_LIST_SELECT)
      .eq('org_id', ws.org.id).order('issue_date', { ascending: false }).order('created_at', { ascending: false }).limit(1000)) as unknown as Invoice[],
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: bk.invoice(id),
    queryFn: async () => {
      const inv = unwrap(await supabase.from('invoices').select(INVOICE_DETAIL_SELECT).eq('id', id).maybeSingle()) as unknown as Invoice | null;
      if (!inv) throw new Error('This invoice doesn’t exist or you don’t have access to it.');
      inv.invoice_items = [...(inv.invoice_items ?? [])].sort((a, b) => ((a as any).position ?? 0) - ((b as any).position ?? 0));
      return inv;
    },
  });
}

export function useInvoicePayments(invoiceId: string) {
  return useQuery({
    queryKey: [...bk.invoice(invoiceId), 'payments'],
    queryFn: async () => {
      const [p, r, a] = await Promise.all([
        supabase.from('payments').select('*').eq('invoice_id', invoiceId).order('paid_at'),
        supabase.from('refunds').select('*').eq('invoice_id', invoiceId).order('created_at'),
        supabase.from('billing_activity').select('*').eq('invoice_id', invoiceId).order('created_at'),
      ]);
      return { payments: unwrap(p) as Payment[], refunds: unwrap(r) as Refund[], activity: unwrap(a) as BillingActivity[] };
    },
  });
}

export function useEstimates() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: bk.estimates(ws.org.id),
    queryFn: async () => unwrap(await supabase.from('estimates').select('*, client:clients(id, full_name, email, phone)')
      .eq('org_id', ws.org.id).order('issue_date', { ascending: false }).order('created_at', { ascending: false }).limit(500)) as unknown as Estimate[],
  });
}

export function useEstimate(id: string) {
  return useQuery({
    queryKey: bk.estimate(id),
    queryFn: async () => {
      const [e, a] = await Promise.all([
        supabase.from('estimates').select('*, client:clients(id, full_name, email, phone), estimate_items(*)').eq('id', id).maybeSingle(),
        supabase.from('billing_activity').select('*').eq('estimate_id', id).order('created_at'),
      ]);
      const est = unwrap(e) as unknown as Estimate | null;
      if (!est) throw new Error('This estimate doesn’t exist or you don’t have access to it.');
      est.estimate_items = [...(est.estimate_items ?? [])].sort((x, y) => ((x as any).position ?? 0) - ((y as any).position ?? 0));
      return { estimate: est, activity: unwrap(a) as BillingActivity[] };
    },
  });
}

export function usePayments() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: bk.payments(ws.org.id),
    queryFn: async () => unwrap(await supabase.from('payments').select('*, client:clients(id, full_name), invoice:invoices(id, number)')
      .eq('org_id', ws.org.id).order('paid_at', { ascending: false }).limit(1000)) as unknown as Payment[],
  });
}

export function useRefunds() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: bk.refunds(ws.org.id),
    queryFn: async () => unwrap(await supabase.from('refunds').select('*, invoice:invoices(id, number, client:clients(full_name))')
      .eq('org_id', ws.org.id).order('created_at', { ascending: false }).limit(1000)) as unknown as Refund[],
  });
}

export function useRecurringRules() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: bk.rules(ws.org.id),
    queryFn: async () => unwrap(await supabase.from('recurring_billing_rules')
      .select('*, client:clients(id, full_name), last_invoice:invoices!rbr_last_invoice_fk(id, number, status, paid_at)')
      .eq('org_id', ws.org.id).order('next_run_date')) as unknown as RecurringRule[],
  });
}

export function useAutopayMethods() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: ['billing', 'methods', ws.org.id],
    queryFn: async () => unwrap(await supabase.from('payment_methods').select('*').eq('org_id', ws.org.id)) as (SavedMethod & { client_id: string })[],
  });
}

export function useBillingActivity(limit = 30) {
  const ws = useWorkspace();
  return useQuery({
    queryKey: bk.activity(ws.org.id, String(limit)),
    queryFn: async () => unwrap(await supabase.from('billing_activity').select('*').eq('org_id', ws.org.id)
      .order('created_at', { ascending: false }).limit(limit)) as BillingActivity[],
  });
}

/** Is Stripe switched on for this deployment? (checked via a server function) */
export function useBillingConfig() {
  return useQuery({
    queryKey: bk.config,
    staleTime: 10 * 60 * 1000,
    retry: 0,
    queryFn: async () => {
      try {
        const res = await fetch('/.netlify/functions/billing-config');
        if (!res.ok) return { online_payments: false, webhook_configured: false };
        return (await res.json()) as { online_payments: boolean; webhook_configured: boolean };
      } catch {
        return { online_payments: false, webhook_configured: false };
      }
    },
  });
}

/** Call one of our Netlify billing functions with the user's session token. */
export async function callBillingFunction<T = unknown>(name: string, body: unknown, opts?: { auth?: boolean }): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts?.auth !== false) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  let res: Response;
  try {
    res = await fetch(`/.netlify/functions/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new Error('Can’t reach the payment server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 404 && !(data as any).error) throw new Error('Online payments are available on the live site once it’s deployed.');
  if (!res.ok) throw new Error((data as any).error || `Request failed (${res.status})`);
  return data as T;
}
