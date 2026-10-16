import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  Ban, Bell, Copy, CreditCard, Link2, Pencil, Plus, Receipt, RotateCcw, Send, Trash2, Wallet, CheckCircle2, ExternalLink,
} from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useWorkspace } from '@/auth/AuthProvider';
import {
  METHOD_LABEL, addDays, dueText, fmtDay, methodDisplay, money, todayIso,
  type BillingSettings, type Invoice, type InvoiceStatus, type LineItem, type Payment, type PublicOrg,
} from '@/lib/billing';
import { clientAddress, fmtDateTime } from '@/lib/format';
import { Button, ButtonLink } from '@/components/ui/Button';
import { SelectField, TextArea, TextField } from '@/components/ui/Form';
import { Alert, EmptyState, QueryState, SkeletonList } from '@/components/ui/Feedback';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { useClients } from '@/features/shared/api';
import {
  BillingNav, DocumentView, InvoiceBadge, LineItemsEditor, MoneyField, PaymentBadge, PrintButton, ReceiptView, SearchBox, TotalsPanel, printElement, type DocData,
} from './components';
import { ActivityList } from './OverviewPage';
import {
  callBillingFunction, useBillingSettings, useCatalog, useInvalidateBilling, useInvoice, useInvoicePayments, useInvoices,
} from './api';

export function orgOf(ws: ReturnType<typeof useWorkspace>): PublicOrg {
  const o = ws.org;
  return { id: o.id, name: o.name, logo_url: o.logo_url, brand_color: o.brand_color, phone: o.phone, email: o.email, website: o.website, address: o.address };
}

export function invoiceDoc(inv: Invoice, org: PublicOrg, s: BillingSettings | null | undefined, payments?: Payment[]): DocData {
  return {
    kind: 'invoice', org, number: inv.number,
    billTo: inv.client ? { name: inv.client.full_name, email: inv.client.email, phone: inv.client.phone } : null,
    serviceAddress: inv.service_address,
    dates: [
      { label: 'Invoice date', value: fmtDay(inv.issue_date) },
      { label: 'Due date', value: fmtDay(inv.due_date) },
      ...(inv.job ? [{ label: 'Service date', value: fmtDay(inv.job.completed_at ?? inv.job.scheduled_start) }] : []),
    ],
    items: inv.invoice_items ?? [], currency: s?.currency ?? 'USD', taxLabel: s?.tax_label ?? 'Tax', taxRate: Number(inv.tax_rate),
    subtotal: Number(inv.subtotal), discount: Number(inv.discount_total), tax: Number(inv.tax_total), credit: Number(inv.credit_amount),
    total: Number(inv.total), paid: Number(inv.amount_paid), tips: Number(inv.tip_total), refunded: Number(inv.amount_refunded),
    balance: Number(inv.balance_due), notes: inv.notes, terms: inv.terms, paymentInstructions: s?.payment_instructions,
    payments: payments?.filter((p) => p.status !== 'failed'),
  };
}

// ---------------------------------------------------------------- list

type Filter = 'all' | 'open' | InvoiceStatus;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'open', label: 'Unpaid' }, { value: 'draft', label: 'Draft' }, { value: 'overdue', label: 'Overdue' },
  { value: 'partially_paid', label: 'Partially paid' }, { value: 'paid', label: 'Paid' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'refunded', label: 'Refunded' },
];
type Sort = 'newest' | 'oldest' | 'due' | 'amount' | 'balance' | 'client';

export function InvoicesPage({ basePath = '/billing/invoices', readOnly = false }: { basePath?: string; readOnly?: boolean }) {
  const q = useInvoices();
  const s = useBillingSettings();
  const currency = s.data?.currency ?? 'USD';
  const [params, setParams] = useSearchParams();
  const filter = (params.get('status') as Filter) || 'all';
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('newest');

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = (q.data ?? []).filter((i) => {
      if (filter === 'open' && !(Number(i.balance_due) > 0 && i.status !== 'draft' && i.status !== 'cancelled')) return false;
      if (filter !== 'all' && filter !== 'open' && i.status !== filter) return false;
      if (term && !`${i.number} ${i.client?.full_name ?? ''} ${i.client?.email ?? ''}`.toLowerCase().includes(term)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'oldest': return a.issue_date.localeCompare(b.issue_date);
        case 'due': return a.due_date.localeCompare(b.due_date);
        case 'amount': return Number(b.total) - Number(a.total);
        case 'balance': return Number(b.balance_due) - Number(a.balance_due);
        case 'client': return (a.client?.full_name ?? '').localeCompare(b.client?.full_name ?? '');
        default: return b.issue_date.localeCompare(a.issue_date) || b.created_at.localeCompare(a.created_at);
      }
    });
    return list;
  }, [q.data, filter, search, sort]);

  const totals = rows.reduce((a, i) => ({ total: a.total + Number(i.total), balance: a.balance + (i.status === 'cancelled' ? 0 : Number(i.balance_due)) }), { total: 0, balance: 0 });

  return (
    <>
      <PageHeader title="Invoices" actions={!readOnly && <ButtonLink to="/billing/invoices/new" icon={<Plus />}>New invoice</ButtonLink>} />
      {!readOnly && <BillingNav />}
      <div className="row wrap mt-16">
        <SearchBox value={search} onChange={setSearch} placeholder="Search by client or invoice #" />
        <SelectField aria-label="Sort invoices" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="sort-select">
          <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="due">Due date</option>
          <option value="amount">Amount (high → low)</option><option value="balance">Balance due (high → low)</option><option value="client">Client A–Z</option>
        </SelectField>
      </div>
      <div className="chips mt-8" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" className="chip" aria-pressed={filter === f.value}
            onClick={() => { const p = new URLSearchParams(params); if (f.value === 'all') p.delete('status'); else p.set('status', f.value); setParams(p, { replace: true }); }}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="mt-16">
        <QueryState query={q}>
          {() => rows.length === 0 ? (
            <div className="card"><EmptyState icon={<Receipt />} title={q.data?.length ? 'No invoices match' : 'No invoices yet'}
              action={!readOnly && !q.data?.length && <ButtonLink to="/billing/invoices/new" icon={<Plus />}>Create your first invoice</ButtonLink>}>
              {q.data?.length ? 'Try a different filter or search.' : 'Create one here, or open a completed job and tap “Create invoice”.'}
            </EmptyState></div>
          ) : (
            <div className="card">
              <div className="rtable-head" aria-hidden><span>Client / invoice</span><span>Issued</span><span>Due</span><span className="num">Total</span><span className="num">Balance</span><span>Status</span></div>
              <div className="list">
                {rows.map((i) => (
                  <Link key={i.id} to={`${basePath}/${i.id}`} className="list-item rtable-row">
                    <span className="rt-main"><span className="strong truncate">{i.client?.full_name ?? 'Client'}</span><span className="muted small">{i.number}</span></span>
                    <span className="rt-cell muted small">{fmtDay(i.issue_date)}</span>
                    <span className={`rt-cell small ${i.status === 'overdue' ? 'text-red strong' : 'muted'}`}>{dueText(i)}</span>
                    <span className="rt-cell num">{money(i.total, currency)}</span>
                    <span className="rt-cell num strong">{i.status === 'cancelled' ? '—' : money(i.balance_due, currency)}</span>
                    <span className="rt-status"><InvoiceBadge status={i.status} /></span>
                  </Link>
                ))}
              </div>
              <div className="rtable-foot"><span>{rows.length} invoice{rows.length === 1 ? '' : 's'}</span><span>Total {money(totals.total, currency)} · Balance {money(totals.balance, currency)}</span></div>
            </div>
          )}
        </QueryState>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- editor

interface EditorState {
  client_id: string;
  job_id: string | null;
  appointment_id: string | null;
  issue_date: string;
  due_date: string;
  service_address: string;
  items: LineItem[];
  discount_type: 'amount' | 'percent';
  discount_value: number;
  tax_rate: number;
  credit_amount: number;
  notes: string;
  terms: string;
  internal_notes: string;
}

export function NewInvoicePage() {
  const s = useBillingSettings();
  const [params] = useSearchParams();
  return (
    <QueryState query={s}>
      {(settings) => {
        const issue = todayIso();
        return (
          <InvoiceEditor settings={settings} initial={{
            client_id: params.get('client') ?? '', job_id: null, appointment_id: null, issue_date: issue,
            due_date: addDays(issue, settings?.payment_terms_days ?? 14), service_address: '', items: [],
            discount_type: 'amount', discount_value: 0, tax_rate: Number(settings?.tax_rate ?? 0), credit_amount: 0,
            notes: settings?.default_invoice_notes ?? '', terms: settings?.default_terms ?? '', internal_notes: '',
          }} />
        );
      }}
    </QueryState>
  );
}

export function EditInvoicePage() {
  const { id = '' } = useParams();
  const inv = useInvoice(id);
  const s = useBillingSettings();
  return (
    <QueryState query={inv}>
      {(i) => i.status === 'cancelled' ? <Alert tone="warn">This invoice was cancelled and can’t be edited. <Link to={`/billing/invoices/${i.id}`}>Back to invoice</Link></Alert> : (
        <InvoiceEditor invoice={i} settings={s.data ?? null} initial={{
          client_id: i.client_id, job_id: i.job_id, appointment_id: i.appointment_id, issue_date: i.issue_date, due_date: i.due_date,
          service_address: i.service_address ?? '', items: (i.invoice_items ?? []).map((it) => ({ ...it, quantity: Number(it.quantity), unit_price: Number(it.unit_price) })),
          discount_type: i.discount_type, discount_value: Number(i.discount_value), tax_rate: Number(i.tax_rate), credit_amount: Number(i.credit_amount),
          notes: i.notes ?? '', terms: i.terms ?? '', internal_notes: i.internal_notes ?? '',
        }} />
      )}
    </QueryState>
  );
}

function InvoiceEditor({ invoice, initial, settings }: { invoice?: Invoice; initial: EditorState; settings: BillingSettings | null }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateBilling();
  const clients = useClients();
  const catalog = useCatalog();
  const [f, setF] = useState<EditorState>(initial);
  const [err, setErr] = useState<string | null>(null);
  const currency = settings?.currency ?? 'USD';
  const client = (clients.data ?? []).find((c) => c.id === f.client_id);
  const set = (patch: Partial<EditorState>) => setF((x) => ({ ...x, ...patch }));

  // Pull payment terms forward when the issue date changes on a new invoice
  const prevIssue = useRef(f.issue_date);
  useEffect(() => {
    if (!invoice && prevIssue.current !== f.issue_date && settings) set({ due_date: addDays(f.issue_date, settings.payment_terms_days) });
    prevIssue.current = f.issue_date;
  }, [f.issue_date, invoice, settings]);

  const save = useMutation({
    mutationFn: async (send: boolean) => {
      const id = unwrap(await supabase.rpc('save_invoice', { p: {
        id: invoice?.id ?? null, org_id: ws.org.id, client_id: f.client_id, job_id: f.job_id, appointment_id: f.appointment_id,
        issue_date: f.issue_date, due_date: f.due_date, service_address: f.service_address,
        notes: f.notes, terms: f.terms, internal_notes: f.internal_notes,
        discount_type: f.discount_type, discount_value: Number(f.discount_value) || 0, tax_rate: Number(f.tax_rate) || 0,
        credit_amount: Number(f.credit_amount) || 0,
        items: f.items.map((it) => ({ ...it, quantity: Number(it.quantity) || 1, unit_price: Number(it.unit_price) || 0 })),
      } })) as string;
      if (send) unwrap(await supabase.rpc('send_invoice', { p_invoice: id }));
      return { id, send };
    },
    onSuccess: ({ id, send }) => { invalidate(); toast.success(send ? 'Invoice sent to the client' : 'Invoice saved'); navigate(`/billing/invoices/${id}`, { replace: true }); },
    onError: (e) => toast.error(e),
  });

  const submit = (e: FormEvent, send = false) => {
    e.preventDefault();
    if (!f.client_id) return setErr('Choose a client');
    if (!f.items.some((i) => i.description.trim())) return setErr('Add at least one line item');
    if (f.due_date < f.issue_date) return setErr('The due date can’t be before the invoice date');
    if (f.items.some((i) => i.description.trim() && !(Number(i.quantity) > 0))) return setErr('Each line needs a quantity above 0');
    setErr(null);
    save.mutate(send);
  };

  const alreadySent = !!invoice?.sent_at;

  return (
    <form onSubmit={(e) => submit(e)} noValidate>
      <PageHeader back={{ to: invoice ? `/billing/invoices/${invoice.id}` : '/billing/invoices', label: invoice ? invoice.number : 'Invoices' }}
        title={invoice ? `Edit ${invoice.number}` : 'New invoice'}
        sub={invoice?.job_id ? <Link to={`/jobs/${invoice.job_id}`}>From a completed job</Link> : undefined} />

      <div className="grid-2-lg">
        <div className="stack" style={{ ['--gap' as string]: '16px' }}>
          <div className="card card-pad stack">
            <div className="row-between wrap" style={{ alignItems: 'flex-start' }}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                {ws.org.logo_url ? <span className="logo-box lg"><img src={ws.org.logo_url} alt={`${ws.org.name} logo`} /></span> : <span className="logo-box lg fallback">{ws.org.name.slice(0, 2).toUpperCase()}</span>}
                <div className="stack" style={{ ['--gap' as string]: '2px' }}>
                  <strong>{ws.org.name}</strong>
                  {[ws.org.phone, ws.org.email, ws.org.address].filter(Boolean).map((x) => <span key={x} className="small muted">{x}</span>)}
                  {!ws.org.phone && !ws.org.email && <Link to="/settings" className="small">Add contact info</Link>}
                </div>
              </div>
              <div className="doc-title"><p className="doc-kind">Invoice</p><p className="strong">{invoice?.number ?? `${settings?.invoice_prefix ?? 'INV-'}${settings?.next_invoice_number ?? ''}`}</p></div>
            </div>
            <hr className="divider" />
            <div className="form-grid two">
              <SelectField label="Bill to" value={f.client_id} onChange={(e) => set({ client_id: e.target.value, service_address: '' })} className="span-2">
                <option value="">Choose a client…</option>
                {(clients.data ?? []).filter((c) => c.status === 'active' || c.id === f.client_id).map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </SelectField>
              <TextField className="span-2" label="Service address" value={f.service_address} placeholder={clientAddress(client) || 'Client’s address'}
                hint="Leave blank to use the client’s address" onChange={(e) => set({ service_address: e.target.value })} />
              <TextField label="Invoice date" type="date" value={f.issue_date} onChange={(e) => set({ issue_date: e.target.value })} />
              <TextField label="Due date" type="date" value={f.due_date} min={f.issue_date} onChange={(e) => set({ due_date: e.target.value })}
                hint={settings ? `Default terms: ${settings.payment_terms_days === 0 ? 'due on receipt' : `net ${settings.payment_terms_days}`}` : undefined} />
            </div>
          </div>

          <div className="card card-pad stack">
            <h2>Services</h2>
            <LineItemsEditor items={f.items} onChange={(items) => set({ items })} catalog={catalog.data ?? []} currency={currency} />
          </div>

          <div className="card card-pad stack">
            <h2>Notes</h2>
            <TextArea label="Notes for the client" value={f.notes} onChange={(e) => set({ notes: e.target.value })} style={{ minHeight: 70 }} />
            <TextArea label="Terms" value={f.terms} onChange={(e) => set({ terms: e.target.value })} style={{ minHeight: 60 }} />
            <TextArea label="Internal notes" hint="Only your team sees this — never shown to the client" value={f.internal_notes}
              onChange={(e) => set({ internal_notes: e.target.value })} style={{ minHeight: 60 }} />
          </div>
        </div>

        <div className="stack sticky-col" style={{ ['--gap' as string]: '16px' }}>
          <div className="card card-pad stack">
            <h2>Totals</h2>
            <div className="form-grid two">
              <SelectField label="Discount" value={f.discount_type} onChange={(e) => set({ discount_type: e.target.value as 'amount' | 'percent' })}>
                <option value="amount">{currency === 'USD' ? '$' : currency} amount</option><option value="percent">% percent</option>
              </SelectField>
              <TextField label={f.discount_type === 'percent' ? 'Discount %' : 'Discount amount'} type="number" inputMode="decimal" min="0" step="0.01"
                value={f.discount_value} onChange={(e) => set({ discount_value: e.target.value as unknown as number })} />
              <TextField label={`${settings?.tax_label ?? 'Tax'} rate %`} type="number" inputMode="decimal" min="0" max="100" step="0.001"
                value={f.tax_rate} onChange={(e) => set({ tax_rate: e.target.value as unknown as number })} />
              <MoneyField label="Credit" currency={currency} value={String(f.credit_amount)} onChange={(v) => set({ credit_amount: v as unknown as number })}
                hint="Account credit / prepaid" />
            </div>
            <TotalsPanel items={f.items} discountType={f.discount_type} discountValue={Number(f.discount_value) || 0} taxRate={Number(f.tax_rate) || 0}
              taxLabel={settings?.tax_label ?? 'Tax'} credit={Number(f.credit_amount) || 0} currency={currency}
              paid={invoice ? Number(invoice.amount_paid) : undefined} />
            {invoice && Number(invoice.amount_paid) > 0 && <p className="subtle">Deposits and payments already received are subtracted automatically.</p>}
            {err && <Alert tone="error">{err}</Alert>}
            <div className="stack" style={{ ['--gap' as string]: '8px' }}>
              <Button type="button" size="lg" icon={<Send />} loading={save.isPending && save.variables === true} disabled={save.isPending} onClick={(e) => submit(e, true)}>
                {alreadySent ? 'Save & re-send' : 'Save & send to client'}
              </Button>
              <Button type="submit" variant="secondary" loading={save.isPending && save.variables === false} disabled={save.isPending}>{alreadySent ? 'Save changes' : 'Save as draft'}</Button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- detail

export function InvoiceDetailPage({ readOnly = false, backTo = '/billing/invoices' }: { readOnly?: boolean; backTo?: string }) {
  const { id = '' } = useParams();
  const inv = useInvoice(id);
  const extra = useInvoicePayments(id);
  const s = useBillingSettings();
  return (
    <QueryState query={inv}>
      {(i) => <InvoiceView inv={i} settings={s.data ?? null} payments={extra.data?.payments ?? []} refunds={extra.data?.refunds ?? []}
        activity={extra.data?.activity ?? []} loadingExtra={extra.isLoading} readOnly={readOnly} backTo={backTo} />}
    </QueryState>
  );
}

function InvoiceView({ inv, settings, payments, refunds, activity, loadingExtra, readOnly, backTo }: {
  inv: Invoice; settings: BillingSettings | null; payments: Payment[]; refunds: { id: string; amount: number; reason: string | null; created_at: string; payment_id: string }[];
  activity: import('@/lib/billing').BillingActivity[]; loadingExtra: boolean; readOnly: boolean; backTo: string;
}) {
  const ws = useWorkspace();
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidateBilling();
  const docRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<null | 'pay' | 'void' | 'delete' | 'markpaid'>(null);
  const [refundFor, setRefundFor] = useState<Payment | null>(null);
  const [receiptFor, setReceiptFor] = useState<Payment | null>(null);
  const currency = settings?.currency ?? 'USD';
  const org = orgOf(ws);
  const payLink = `${window.location.origin}/pay/${inv.public_token}`;
  const isOpen = inv.status !== 'cancelled' && Number(inv.balance_due) > 0;

  const rpc = useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown> }) => unwrap(await supabase.rpc(fn, args)),
    onSuccess: (_d, v) => {
      invalidate();
      const msg: Record<string, string> = {
        send_invoice: inv.sent_at ? 'Invoice re-sent' : 'Invoice sent to the client', send_invoice_reminder: 'Reminder sent',
        void_invoice: 'Invoice cancelled', mark_invoice_paid: 'Marked as paid',
      };
      if (msg[v.fn]) toast.success(msg[v.fn]);
      setModal(null);
    },
    onError: (e) => toast.error(e),
  });
  const duplicate = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('duplicate_invoice', { p_invoice: inv.id })) as string,
    onSuccess: (newId) => { invalidate(); toast.success('Copy created'); navigate(`/billing/invoices/${newId}/edit`); },
    onError: (e) => toast.error(e),
  });
  const del = useMutation({
    mutationFn: async () => unwrap(await supabase.from('invoices').delete().eq('id', inv.id)),
    onSuccess: () => { invalidate(); toast.success('Draft deleted'); navigate('/billing/invoices', { replace: true }); },
    onError: (e) => toast.error(e),
  });

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(payLink); toast.success('Payment link copied'); } catch { toast.info(payLink); }
  };

  return (
    <>
      <PageHeader back={{ to: backTo, label: 'Invoices' }} title={<span className="row wrap" style={{ ['--gap' as string]: '10px' }}>{inv.number}<InvoiceBadge status={inv.status} /></span>}
        sub={<>{inv.client?.full_name ?? 'Client'}{inv.job_id && <> · <Link to={`/jobs/${inv.job_id}`}>View job</Link></>}{inv.estimate_id && <> · <Link to={`/billing/estimates/${inv.estimate_id}`}>From estimate</Link></>}</>}
        actions={!readOnly && (
          <>
            {inv.status !== 'cancelled' && inv.status !== 'refunded' && <ButtonLink to={`/billing/invoices/${inv.id}/edit`} variant="secondary" icon={<Pencil />}>Edit</ButtonLink>}
            {inv.status !== 'cancelled' && (
              <Button variant={inv.sent_at ? 'secondary' : 'primary'} icon={<Send />} loading={rpc.isPending && rpc.variables?.fn === 'send_invoice'}
                onClick={() => rpc.mutate({ fn: 'send_invoice', args: { p_invoice: inv.id } })}>{inv.sent_at ? 'Resend' : 'Send invoice'}</Button>
            )}
          </>
        )} />

      {inv.status === 'cancelled' && <Alert tone="warn">Cancelled {inv.void_reason ? `— ${inv.void_reason}` : ''}. The client can still see it as cancelled.</Alert>}
      {inv.autopay_error && isOpen && <Alert tone="error">Auto-pay failed: {inv.autopay_error}</Alert>}

      <div className="grid-2-lg mt-16">
        <div className="stack" style={{ ['--gap' as string]: '16px' }}>
          <div className="card doc-card" ref={docRef}>
            <DocumentView d={invoiceDoc(inv, org, settings, payments)} />
          </div>
          {inv.internal_notes && <div className="callout"><div className="label">Internal notes (not shown to the client)</div><p className="pre small">{inv.internal_notes}</p></div>}
        </div>

        <div className="stack" style={{ ['--gap' as string]: '16px' }}>
          <div className="card card-pad stack">
            <div className="row-between">
              <span className="label">{inv.status === 'paid' ? 'Paid in full' : inv.status === 'cancelled' ? 'Cancelled' : 'Balance due'}</span>
              <InvoiceBadge status={inv.status} />
            </div>
            <p className="big-money" style={{ color: inv.status === 'overdue' ? 'var(--red)' : inv.status === 'paid' ? 'var(--green)' : undefined }}>
              {money(inv.status === 'paid' ? inv.total : inv.balance_due, currency)}
            </p>
            <p className="muted small">{inv.status === 'paid' && inv.paid_at ? `Paid ${fmtDateTime(inv.paid_at)}` : dueText(inv)} · Total {money(inv.total, currency)}
              {Number(inv.tip_total) > 0 && ` · Tips ${money(inv.tip_total, currency)}`}</p>
            {inv.sent_at && <p className="subtle">Sent {fmtDateTime(inv.last_sent_at ?? inv.sent_at)}{inv.viewed_at ? ` · Viewed ${fmtDateTime(inv.viewed_at)}` : ' · Not opened yet'}</p>}
            {!readOnly && (
              <div className="stack" style={{ ['--gap' as string]: '8px' }}>
                {isOpen && <Button icon={<Wallet />} onClick={() => setModal('pay')}>Record payment</Button>}
                <div className="grid-2">
                  {isOpen && <Button variant="secondary" size="sm" icon={<CheckCircle2 />} onClick={() => setModal('markpaid')}>Mark paid</Button>}
                  {isOpen && inv.sent_at && <Button variant="secondary" size="sm" icon={<Bell />} loading={rpc.isPending && rpc.variables?.fn === 'send_invoice_reminder'}
                    onClick={() => rpc.mutate({ fn: 'send_invoice_reminder', args: { p_invoice: inv.id } })}>Send reminder</Button>}
                  <PrintButton targetRef={docRef} title={`${inv.number} — ${ws.org.name}`} label="Download PDF" size="sm" />
                  <Button variant="secondary" size="sm" onClick={() => printElement(docRef.current, `${inv.number} — ${ws.org.name}`)}>Print</Button>
                  <Button variant="secondary" size="sm" icon={<Copy />} loading={duplicate.isPending} onClick={() => duplicate.mutate()}>Duplicate</Button>
                  {inv.sent_at && <Button variant="secondary" size="sm" icon={<Link2 />} onClick={copyLink}>Copy pay link</Button>}
                </div>
                {inv.sent_at && <a className="small strong row" style={{ ['--gap' as string]: '4px' }} href={payLink} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden />Preview what the client sees</a>}
                {inv.status === 'draft' && Number(inv.amount_paid) === 0
                  ? <Button variant="danger-ghost" size="sm" icon={<Trash2 />} onClick={() => setModal('delete')}>Delete draft</Button>
                  : inv.status !== 'cancelled' && <Button variant="danger-ghost" size="sm" icon={<Ban />} onClick={() => setModal('void')}>Cancel invoice</Button>}
              </div>
            )}
            {readOnly && <PrintButton targetRef={docRef} title={inv.number} size="sm" />}
          </div>

          <div className="card">
            <div className="card-header"><h2>Payments</h2><span className="subtle">{money(Number(inv.amount_paid) + Number(inv.tip_total), currency)} received</span></div>
            {loadingExtra ? <div className="card-body"><SkeletonList rows={1} height={50} /></div> : payments.length === 0 ? <p className="subtle card-body">No payments yet.</p> : (
              <div className="list mt-8">
                {payments.map((p) => (
                  <div key={p.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                    <span className="avatar sm"><CreditCard size={15} aria-hidden /></span>
                    <span className="grow stack" style={{ ['--gap' as string]: '2px' }}>
                      <span className="row-between"><span className="strong">{money(Number(p.amount) + Number(p.tip_amount), currency)}</span><PaymentBadge status={p.status} /></span>
                      <span className="muted small">{methodDisplay(p)} · {fmtDateTime(p.paid_at)}{Number(p.tip_amount) > 0 && ` · incl. ${money(p.tip_amount, currency)} tip`}</span>
                      {(p.reference || p.notes) && <span className="subtle">{[p.reference, p.notes].filter(Boolean).join(' · ')}</span>}
                      {refunds.filter((r) => r.payment_id === p.id).map((r) => <span key={r.id} className="subtle">↩ Refunded {money(r.amount, currency)} {fmtDay(r.created_at)}{r.reason ? ` — ${r.reason}` : ''}</span>)}
                      <span className="row wrap" style={{ ['--gap' as string]: '6px', marginTop: 4 }}>
                        <Button size="sm" variant="ghost" icon={<Receipt />} onClick={() => setReceiptFor(p)}>Receipt</Button>
                        {!readOnly && Number(p.amount) + Number(p.tip_amount) - Number(p.amount_refunded) > 0 &&
                          <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => setRefundFor(p)}>Refund</Button>}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header"><h2>Activity history</h2></div>
            <ActivityList items={[...activity].reverse()} currency={currency} />
          </div>
        </div>
      </div>

      <RecordPaymentModal open={modal === 'pay'} onClose={() => setModal(null)} invoice={inv} settings={settings} />
      <ConfirmDialog open={modal === 'markpaid'} onClose={() => setModal(null)} title="Mark as paid?" confirmLabel="Mark paid"
        loading={rpc.isPending} onConfirm={() => rpc.mutate({ fn: 'mark_invoice_paid', args: { p_invoice: inv.id, p_method: 'other' } })}>
        Records a payment of {money(inv.balance_due, currency)} (method “Other”). To note cash or check details, use Record payment instead.
      </ConfirmDialog>
      <VoidModal open={modal === 'void'} onClose={() => setModal(null)} loading={rpc.isPending}
        onConfirm={(reason) => rpc.mutate({ fn: 'void_invoice', args: { p_invoice: inv.id, p_reason: reason } })}
        hasPayments={Number(inv.amount_paid) + Number(inv.tip_total) - Number(inv.amount_refunded) > 0} />
      <ConfirmDialog open={modal === 'delete'} onClose={() => setModal(null)} title="Delete this draft?" danger confirmLabel="Delete" loading={del.isPending} onConfirm={() => del.mutate()}>
        The draft and its line items are removed. The invoice number isn’t reused.
      </ConfirmDialog>
      {refundFor && <RefundModal payment={refundFor} currency={currency} onClose={() => setRefundFor(null)} />}
      {receiptFor && (
        <ReceiptModal onClose={() => setReceiptFor(null)} org={org} payment={receiptFor} invoiceNumber={inv.number}
          clientName={inv.client?.full_name ?? ''} currency={currency} message={settings?.receipt_message} />
      )}
    </>
  );
}

export function ReceiptModal({ onClose, ...props }: Parameters<typeof ReceiptView>[0] & { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <Modal open onClose={onClose} title="Receipt" footer={<><Button variant="secondary" onClick={onClose}>Close</Button><PrintButton targetRef={ref} title={`Receipt ${props.payment.receipt_number}`} variant="soft" /></>}>
      <div ref={ref}><ReceiptView {...props} /></div>
    </Modal>
  );
}

function VoidModal({ open, onClose, onConfirm, loading, hasPayments }: { open: boolean; onClose: () => void; onConfirm: (r: string) => void; loading: boolean; hasPayments: boolean }) {
  const [reason, setReason] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Cancel invoice" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Keep invoice</Button><Button variant="danger" disabled={hasPayments} loading={loading} onClick={() => onConfirm(reason)}>Cancel invoice</Button></>}>
      <div className="stack">
        {hasPayments ? <Alert tone="warn">This invoice has payments. Refund them first, then cancel.</Alert>
          : <p className="muted">The invoice is voided and nothing more is owed. You can’t undo this, but you can duplicate it later.</p>}
        <TextArea label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ minHeight: 60 }} />
      </div>
    </Modal>
  );
}

export function RecordPaymentModal({ open, onClose, invoice, settings }: { open: boolean; onClose: () => void; invoice: Invoice; settings: BillingSettings | null }) {
  const toast = useToast();
  const invalidate = useInvalidateBilling();
  const currency = settings?.currency ?? 'USD';
  const [f, setF] = useState({ amount: String(invoice.balance_due), tip: '', method: 'cash', date: todayIso(), reference: '', notes: '' });
  useEffect(() => { if (open) setF({ amount: String(invoice.balance_due), tip: '', method: 'cash', date: todayIso(), reference: '', notes: '' }); }, [open, invoice.balance_due]);
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('record_payment', {
      p_invoice: invoice.id, p_amount: Number(f.amount) || 0, p_method: f.method,
      p_paid_at: new Date(`${f.date}T12:00:00`).toISOString(), p_reference: f.reference || null, p_notes: f.notes || null, p_tip: Number(f.tip) || 0,
    })),
    onSuccess: () => { invalidate(); toast.success('Payment recorded'); onClose(); },
    onError: (e) => toast.error(e),
  });
  const over = Number(f.amount) > Number(invoice.balance_due) + 0.001;
  return (
    <Modal open={open} onClose={onClose} title="Record a payment"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={over || !(Number(f.amount) + Number(f.tip) > 0)} onClick={() => save.mutate()}>Record {money((Number(f.amount) || 0) + (Number(f.tip) || 0), currency)}</Button></>}>
      <div className="stack">
        <p className="muted small">For money you received outside the app — cash, check, bank transfer, or a card you ran yourself. Nothing is charged.</p>
        <div className="form-grid two">
          <MoneyField label="Amount" currency={currency} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} hint={`Balance due ${money(invoice.balance_due, currency)}`} />
          <MoneyField label="Tip (optional)" currency={currency} value={f.tip} onChange={(v) => setF({ ...f, tip: v })} hint="Kept separate from the service total" />
          <SelectField label="Method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectField>
          <TextField label="Date received" type="date" value={f.date} max={todayIso()} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <TextField className="span-2" label={f.method === 'check' ? 'Check number' : 'Reference (optional)'} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          <TextField className="span-2" label="Note (shown on the receipt)" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </div>
        {over && <Alert tone="error">That’s more than the balance due.</Alert>}
      </div>
    </Modal>
  );
}

export function RefundModal({ payment, currency, onClose }: { payment: Payment; currency: string; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateBilling();
  const max = Number(payment.amount) + Number(payment.tip_amount) - Number(payment.amount_refunded);
  const [amount, setAmount] = useState(String(max.toFixed(2)));
  const [reason, setReason] = useState('');
  const refund = useMutation({
    mutationFn: async () => {
      if (payment.processor === 'stripe') {
        await callBillingFunction('billing-refund', { payment_id: payment.id, amount: Number(amount), reason });
      } else {
        unwrap(await supabase.rpc('issue_refund', { p_payment: payment.id, p_amount: Number(amount), p_reason: reason || null }));
      }
    },
    onSuccess: () => { invalidate(); toast.success('Refund issued'); onClose(); },
    onError: (e) => toast.error(e),
  });
  const n = Number(amount);
  return (
    <Modal open onClose={onClose} title="Issue a refund" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={refund.isPending} disabled={!(n > 0) || n > max + 0.001} onClick={() => refund.mutate()}>Refund {money(n || 0, currency)}</Button></>}>
      <div className="stack">
        <div className="segmented block" role="tablist" aria-label="Refund type">
          <button type="button" role="tab" aria-selected={Math.abs(n - max) < 0.005} onClick={() => setAmount(max.toFixed(2))}>Full refund</button>
          <button type="button" role="tab" aria-selected={Math.abs(n - max) >= 0.005} onClick={() => setAmount('')}>Partial</button>
        </div>
        <MoneyField label="Refund amount" currency={currency} value={amount} onChange={setAmount} hint={`Up to ${money(max, currency)}`} />
        <TextArea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} style={{ minHeight: 60 }} />
        <p className="subtle">{payment.processor === 'stripe' ? 'The money goes back to the client’s card or bank through Stripe (usually 5–10 business days).' : 'This payment was recorded manually, so return the money yourself (cash, check…). This just records it.'}</p>
      </div>
    </Modal>
  );
}
