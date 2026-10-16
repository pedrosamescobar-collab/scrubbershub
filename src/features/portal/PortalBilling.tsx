import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CheckCircle2, ChevronRight, CreditCard, Download, FileText, Lock, Receipt, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { applyTheme } from '@/lib/brand';
import { useWorkspace } from '@/auth/AuthProvider';
import {
  cap, dueText, fmtDay, methodDisplay, money, round2,
  type ClientEstimate, type ClientInvoice, type ClientPayment, type MyBilling, type SavedMethod,
  type PublicOrg,
} from '@/lib/billing';
import { Button } from '@/components/ui/Button';
import { Switch, TextArea } from '@/components/ui/Form';
import { Alert, EmptyState, QueryState, SkeletonList } from '@/components/ui/Feedback';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { OrgLogo, PageHeader, Segmented } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { DocumentView, EstimateBadge, InvoiceBadge, PrintButton, ReceiptView, printElement, type DocData } from '@/features/billing/components';
import { callBillingFunction, useBillingConfig } from '@/features/billing/api';
import { useTrade } from '@/features/shared/useTrade';

function clientInvoiceDoc(inv: ClientInvoice): DocData {
  return {
    kind: 'invoice', org: inv.org, number: inv.number,
    billTo: inv.client ? { name: inv.client.full_name, email: inv.client.email, phone: inv.client.phone } : null,
    serviceAddress: inv.service_address,
    dates: [{ label: 'Invoice date', value: fmtDay(inv.issue_date) }, { label: 'Due date', value: fmtDay(inv.due_date) },
      ...(inv.job ? [{ label: 'Service date', value: fmtDay(inv.job.completed_at ?? inv.job.scheduled_start) }] : [])],
    items: inv.items, currency: inv.settings?.currency ?? 'USD', taxLabel: inv.settings?.tax_label ?? 'Tax', taxRate: Number(inv.tax_rate),
    subtotal: Number(inv.subtotal), discount: Number(inv.discount_total), tax: Number(inv.tax_total), credit: Number(inv.credit_amount),
    total: Number(inv.total), paid: Number(inv.amount_paid), tips: Number(inv.tip_total), refunded: Number(inv.amount_refunded),
    balance: Number(inv.balance_due), notes: inv.notes, terms: inv.terms, paymentInstructions: inv.settings?.payment_instructions, payments: inv.payments,
  };
}

// ---------------------------------------------------------------- shared invoice screen (portal + secure link)

export function ClientInvoiceView({ inv, refetch, checkout }: {
  inv: ClientInvoice; refetch: () => unknown; checkout: (tip: number, saveCard: boolean) => Promise<{ url: string }>;
}) {
  const toast = useToast();
  const config = useBillingConfig();
  const [params, setParams] = useSearchParams();
  const docRef = useRef<HTMLDivElement>(null);
  const [tipMode, setTipMode] = useState<'none' | 'custom' | number>('none');
  const [customTip, setCustomTip] = useState('');
  const [saveCard, setSaveCard] = useState(false);
  const [receipt, setReceipt] = useState<ClientPayment | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const cur = inv.settings?.currency ?? 'USD';
  const balance = Number(inv.balance_due);
  const justPaid = params.get('paid') === '1';
  const isPaid = inv.status === 'paid' || (inv.status === 'refunded');
  const open = balance > 0 && inv.status !== 'cancelled';

  // After returning from Stripe, wait for the webhook to record the payment
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    if (!justPaid || !open) return;
    if (waited > 10) return;
    const t = setTimeout(() => { void refetch(); setWaited((w) => w + 1); }, 3000);
    return () => clearTimeout(t);
  }, [justPaid, open, waited, refetch]);
  useEffect(() => {
    if (justPaid && !open) { toast.success('Payment received — thank you!'); const p = new URLSearchParams(params); p.delete('paid'); setParams(p, { replace: true }); }
  }, [justPaid, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const tip = !inv.settings?.tips_enabled ? 0 : tipMode === 'none' ? 0 : tipMode === 'custom' ? Math.max(round2(Number(customTip) || 0), 0) : round2((balance * tipMode) / 100);
  const online = config.data?.online_payments ?? false;
  const lastPayment = inv.payments[inv.payments.length - 1];

  const pay = async () => {
    setRedirecting(true);
    try {
      const { url } = await checkout(tip, saveCard);
      window.location.assign(url);
    } catch (e) {
      setRedirecting(false);
      toast.error(e);
    }
  };

  return (
    <div className="stack pay-page" style={{ ['--gap' as string]: '16px' }}>
      <div className="card pay-hero">
        <div className="row"><OrgLogo name={inv.org.name} url={inv.org.logo_url} /><span className="strong">{inv.org.name}</span><span className="grow" /><InvoiceBadge status={inv.status} /></div>
        <div className="center stack" style={{ ['--gap' as string]: '4px', alignItems: 'center', padding: '14px 0 6px' }}>
          <span className="label">{isPaid ? 'Paid in full' : inv.status === 'cancelled' ? 'Cancelled' : 'Amount due'}</span>
          <span className="big-money xl" style={{ color: isPaid ? 'var(--green)' : inv.status === 'overdue' ? 'var(--red)' : undefined }}>
            {money(isPaid ? inv.total : balance, cur)}
          </span>
          <span className="muted small">Invoice {inv.number} · {inv.status === 'cancelled' ? 'No payment needed' : isPaid ? `Paid ${fmtDay(inv.paid_at ?? lastPayment?.paid_at ?? inv.issue_date)}` : dueText(inv)}</span>
          {inv.job && <span className="muted small row" style={{ ['--gap' as string]: '4px' }}><CalendarDays size={14} aria-hidden />{inv.job.service_name} · {fmtDay(inv.job.completed_at ?? inv.job.scheduled_start)}</span>}
        </div>

        {justPaid && open && (
          <Alert tone="info">{waited > 10 ? 'Your payment is processing. This page will show it as paid shortly — you’ll also get a receipt.' : 'Confirming your payment…'}</Alert>
        )}

        {open && !justPaid && (
          online ? (
            <div className="stack" style={{ ['--gap' as string]: '12px' }}>
              {inv.settings?.tips_enabled && (
                <div className="stack" style={{ ['--gap' as string]: '8px' }}>
                  <span className="label">Add a tip for your crew?</span>
                  <div className="tip-grid">
                    <button type="button" className="chip" aria-pressed={tipMode === 'none'} onClick={() => setTipMode('none')}>No tip</button>
                    {(inv.settings.tip_presets ?? []).map((p) => (
                      <button key={p} type="button" className="chip" aria-pressed={tipMode === p} onClick={() => setTipMode(p)}>
                        {p}%<span className="subtle"> {money(round2((balance * p) / 100), cur)}</span>
                      </button>
                    ))}
                    <button type="button" className="chip" aria-pressed={tipMode === 'custom'} onClick={() => setTipMode('custom')}>Custom</button>
                  </div>
                  {tipMode === 'custom' && (
                    <div className="money-input" style={{ maxWidth: 200 }}><span aria-hidden>{cur === 'USD' ? '$' : cur}</span>
                      <input className="input" type="number" inputMode="decimal" min="0" step="0.01" aria-label="Tip amount" value={customTip} onChange={(e) => setCustomTip(e.target.value)} autoFocus /></div>
                  )}
                </div>
              )}
              {tip > 0 && <div className="row-between small"><span className="muted">Invoice {money(balance, cur)} + tip {money(tip, cur)}</span><span className="strong">{money(balance + tip, cur)}</span></div>}
              <label className="row small" style={{ ['--gap' as string]: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--brand)' }} />
                Save my card for next time
              </label>
              <Button size="xl" block icon={<Lock />} loading={redirecting} onClick={pay}>Pay {money(balance + tip, cur)}</Button>
              <p className="subtle center row" style={{ justifyContent: 'center', ['--gap' as string]: '4px' }}><ShieldCheck size={14} aria-hidden />Secure checkout by Stripe — card details never touch {inv.org.name}’s systems.</p>
            </div>
          ) : (
            <Alert tone="info"><strong>How to pay:</strong> {inv.settings?.payment_instructions || `Contact ${inv.org.name}${inv.org.phone ? ` at ${inv.org.phone}` : ''} to arrange payment.`}</Alert>
          )
        )}

        <div className="grid-2">
          <Button variant="secondary" size="sm" icon={<Download />} onClick={() => printElement(docRef.current, `Invoice ${inv.number} — ${inv.org.name}`)}>Download invoice</Button>
          {lastPayment ? <Button variant="secondary" size="sm" icon={<Receipt />} onClick={() => setReceipt(lastPayment)}>Download receipt</Button> : <span />}
        </div>
      </div>

      <div className="card doc-card" ref={docRef}><DocumentView d={clientInvoiceDoc(inv)} /></div>

      {inv.payments.length > 0 && (
        <div className="card">
          <div className="card-header"><h2>Payment history</h2></div>
          <div className="list mt-8">
            {inv.payments.map((p) => (
              <button key={p.id} type="button" className="list-item" onClick={() => setReceipt(p)}>
                <span className="avatar sm"><CheckCircle2 size={15} aria-hidden /></span>
                <span className="grow"><span className="strong">{money(Number(p.amount) + Number(p.tip_amount), cur)}</span>
                  <span className="muted small" style={{ display: 'block' }}>{fmtDay(p.paid_at)} · {methodDisplay(p)}{Number(p.amount_refunded) > 0 ? ` · ${money(p.amount_refunded, cur)} refunded` : ''}</span></span>
                <span className="small strong" style={{ color: 'var(--brand-strong)' }}>Receipt</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {receipt && <ClientReceiptModal inv={inv} payment={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function ClientReceiptModal({ inv, payment, onClose }: { inv: ClientInvoice; payment: ClientPayment; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <Modal open onClose={onClose} title="Receipt" footer={<><Button variant="secondary" onClick={onClose}>Close</Button><PrintButton targetRef={ref} title={`Receipt ${payment.receipt_number}`} label="Download / print" variant="soft" /></>}>
      <div ref={ref}><ReceiptView org={inv.org} payment={payment} invoiceNumber={inv.number} clientName={inv.client?.full_name ?? ''}
        currency={inv.settings?.currency ?? 'USD'} message={inv.settings?.receipt_message} /></div>
    </Modal>
  );
}

// ---------------------------------------------------------------- shared estimate screen

export function ClientEstimateView({ est, respond }: {
  est: ClientEstimate; respond: (approve: boolean, note: string, selected: string[]) => Promise<unknown>;
}) {
  const toast = useToast();
  const docRef = useRef<HTMLDivElement>(null);
  const cur = est.settings?.currency ?? 'USD';
  const optional = est.items.filter((i) => i.is_optional);
  const [picked, setPicked] = useState<string[]>(() => optional.filter((i) => i.is_selected).map((i) => i.id!));
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<'approve' | 'decline' | null>(null);
  const [busy, setBusy] = useState(false);
  const open = est.status === 'sent' || est.status === 'viewed';
  const previewItems = est.items.map((i) => (i.is_optional ? { ...i, is_selected: picked.includes(i.id!) } : i));
  const liveTotal = useMemo(() => {
    const sub = previewItems.filter((i) => !i.is_optional || i.is_selected).reduce((a, i) => a + Number(i.line_total ?? 0), 0);
    const taxable = previewItems.filter((i) => (!i.is_optional || i.is_selected) && i.taxable).reduce((a, i) => a + Number(i.line_total ?? 0), 0);
    const disc = Math.min(est.discount_type === 'percent' ? round2((sub * Number(est.discount_value)) / 100) : Number(est.discount_value), sub);
    const base = sub > 0 ? taxable - disc * (taxable / sub) : 0;
    return Math.max(round2(sub - disc + round2((Math.max(base, 0) * Number(est.tax_rate)) / 100)), 0);
  }, [previewItems, est]);

  const doc: DocData = {
    kind: 'estimate', org: est.org, number: est.number, title: est.title,
    billTo: est.client ? { name: est.client.full_name } : null, serviceAddress: est.service_address,
    dates: [{ label: 'Estimate date', value: fmtDay(est.issue_date) }, ...(est.valid_until ? [{ label: 'Valid until', value: fmtDay(est.valid_until) }] : [])],
    items: open ? previewItems : est.items, currency: cur, taxLabel: est.settings?.tax_label ?? 'Tax', taxRate: Number(est.tax_rate),
    subtotal: Number(est.subtotal), discount: Number(est.discount_total), tax: Number(est.tax_total), total: Number(est.total), notes: est.notes, terms: est.terms,
  };

  const go = async (approve: boolean) => {
    setBusy(true);
    try { await respond(approve, note, picked); setConfirm(null); toast.success(approve ? 'Estimate approved — thank you!' : 'Response sent'); }
    catch (e) { toast.error(e); } finally { setBusy(false); }
  };

  return (
    <div className="stack pay-page" style={{ ['--gap' as string]: '16px' }}>
      <div className="card pay-hero">
        <div className="row"><OrgLogo name={est.org.name} url={est.org.logo_url} /><span className="strong">{est.org.name}</span><span className="grow" /><EstimateBadge status={est.status} /></div>
        <div className="center stack" style={{ ['--gap' as string]: '4px', alignItems: 'center', padding: '14px 0 6px' }}>
          <span className="label">{est.title ?? 'Estimate'}</span>
          <span className="big-money xl">{money(open ? liveTotal : est.total, cur)}</span>
          <span className="muted small">{est.number}{est.valid_until ? ` · valid until ${fmtDay(est.valid_until)}` : ''}</span>
        </div>
        {est.status === 'approved' && <Alert tone="success">You approved this estimate {fmtDay(est.approved_at!)}. {est.org.name} will be in touch to schedule.</Alert>}
        {est.status === 'declined' && <Alert tone="warn">You declined this estimate.</Alert>}
        {est.status === 'expired' && <Alert tone="warn">This estimate has expired. Contact {est.org.name} for an updated quote.</Alert>}
        {open && (
          <div className="stack" style={{ ['--gap' as string]: '10px' }}>
            {optional.length > 0 && (
              <div className="stack" style={{ ['--gap' as string]: '6px' }}>
                <span className="label">Optional add-ons</span>
                {optional.map((i) => (
                  <label key={i.id} className="check-row" style={{ padding: '6px 0' }}>
                    <input type="checkbox" checked={picked.includes(i.id!)} onChange={(e) => setPicked(e.target.checked ? [...picked, i.id!] : picked.filter((x) => x !== i.id))} />
                    <span className="grow">{i.description}</span><span className="strong">+{money(i.line_total ?? 0, cur)}</span>
                  </label>
                ))}
              </div>
            )}
            <TextArea label="Note (optional)" placeholder="Questions or preferred dates…" value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 60 }} />
            <div className="grid-2">
              <Button variant="secondary" icon={<XCircle />} onClick={() => setConfirm('decline')}>Decline</Button>
              <Button icon={<CheckCircle2 />} onClick={() => setConfirm('approve')}>Approve</Button>
            </div>
          </div>
        )}
        <Button variant="secondary" size="sm" icon={<Download />} onClick={() => printElement(docRef.current, `Estimate ${est.number}`)}>Download estimate</Button>
      </div>
      <div className="card doc-card" ref={docRef}><DocumentView d={doc} /></div>
      <ConfirmDialog open={confirm === 'approve'} onClose={() => setConfirm(null)} title="Approve this estimate?" confirmLabel={`Approve ${money(liveTotal, cur)}`} loading={busy} onConfirm={() => go(true)}>
        {est.org.name} will be notified and will contact you to schedule the work.
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'decline'} onClose={() => setConfirm(null)} title="Decline this estimate?" confirmLabel="Decline" danger loading={busy} onConfirm={() => go(false)}>
        You can add a note above to tell them why.
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------- portal pages

function useMyBilling() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: ['portal', 'billing', ws.org.id],
    enabled: !!ws.clientId,
    queryFn: async () => unwrap(await supabase.rpc('my_billing', { p_org: ws.org.id })) as MyBilling,
  });
}

export function PortalBilling() {
  const ws = useWorkspace();
  const q = useMyBilling();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'invoices' | 'estimates' | 'payments' | 'autopay'>(params.get('autopay') ? 'autopay' : 'invoices');
  if (!ws.clientId) return null;
  return (
    <>
      <PageHeader title="Billing" sub={`Invoices and payments with ${ws.org.name}`} />
      <QueryState query={q} skeleton={<SkeletonList rows={3} height={80} />}>
        {(b) => {
          const cur = b.settings?.currency ?? 'USD';
          const due = b.invoices.filter((i) => Number(i.balance_due) > 0 && i.status !== 'cancelled');
          const dueTotal = due.reduce((a, i) => a + Number(i.balance_due), 0);
          const pendingEst = b.estimates.filter((e) => e.status === 'sent' || e.status === 'viewed');
          return (
            <>
              <div className="card card-pad stack" style={{ marginBottom: 16 }}>
                <span className="label">{dueTotal > 0 ? 'You owe' : 'All paid up'}</span>
                <span className="big-money" style={{ color: dueTotal > 0 ? undefined : 'var(--green)' }}>{money(dueTotal, cur)}</span>
                {due.length === 1 && <Link className="btn btn-primary btn-lg" to={`/portal/billing/invoices/${due[0].id}`}>Pay now</Link>}
                {due.length > 1 && <p className="muted small">{due.length} invoices to pay — tap one below.</p>}
                {pendingEst.length > 0 && <Link to={`/portal/billing/estimates/${pendingEst[0].id}`} className="small strong">You have {pendingEst.length} estimate{pendingEst.length === 1 ? '' : 's'} waiting for your approval →</Link>}
              </div>
              <div className="scroll-x">
                <Segmented label="Billing" value={tab} onChange={setTab} options={[
                  { value: 'invoices', label: `Invoices${due.length ? ` (${due.length})` : ''}` }, { value: 'estimates', label: 'Estimates' },
                  { value: 'payments', label: 'Payments' }, ...(b.settings?.autopay_enabled ? [{ value: 'autopay' as const, label: 'Auto-pay' }] : []),
                ]} />
              </div>
              <div className="mt-16">
                {tab === 'invoices' && (b.invoices.length === 0 ? <div className="card"><EmptyState icon={<FileText />} title="No invoices yet" /></div> : (
                  <div className="card list">
                    {b.invoices.map((i) => (
                      <Link key={i.id} to={`/portal/billing/invoices/${i.id}`} className="list-item">
                        <span className="grow">
                          <span className="row-between"><span className="strong">{i.service_name ?? `Invoice ${i.number}`}</span><span className="strong">{money(Number(i.balance_due) > 0 && i.status !== 'cancelled' ? i.balance_due : i.total, cur)}</span></span>
                          <span className="row-between"><span className="muted small">{i.number} · {Number(i.balance_due) > 0 && i.status !== 'cancelled' ? dueText(i) : fmtDay(i.issue_date)}</span><InvoiceBadge status={i.status} /></span>
                        </span>
                        <ChevronRight size={18} color="var(--text-3)" aria-hidden />
                      </Link>
                    ))}
                  </div>
                ))}
                {tab === 'estimates' && (b.estimates.length === 0 ? <div className="card"><EmptyState icon={<FileText />} title="No estimates" /></div> : (
                  <div className="card list">
                    {b.estimates.map((e) => (
                      <Link key={e.id} to={`/portal/billing/estimates/${e.id}`} className="list-item">
                        <span className="grow">
                          <span className="row-between"><span className="strong">{e.title ?? `Estimate ${e.number}`}</span><span className="strong">{money(e.total, cur)}</span></span>
                          <span className="row-between"><span className="muted small">{e.number} · {fmtDay(e.issue_date)}</span><EstimateBadge status={e.status} /></span>
                        </span>
                        <ChevronRight size={18} color="var(--text-3)" aria-hidden />
                      </Link>
                    ))}
                  </div>
                ))}
                {tab === 'payments' && (b.payments.length === 0 ? <div className="card"><EmptyState icon={<Receipt />} title="No payments yet" /></div> : (
                  <div className="card list">
                    {b.payments.map((p) => (
                      <Link key={p.id} to={`/portal/billing/invoices/${p.invoice_id}`} className="list-item">
                        <span className="grow">
                          <span className="row-between"><span className="strong">{money(Number(p.amount) + Number(p.tip_amount), cur)}</span><span className="subtle">{fmtDay(p.paid_at)}</span></span>
                          <span className="muted small">{p.invoice_number} · {methodDisplay(p)} · Receipt {p.receipt_number}{Number(p.amount_refunded) > 0 ? ` · ${money(p.amount_refunded, cur)} refunded` : ''}</span>
                        </span>
                        <ChevronRight size={18} color="var(--text-3)" aria-hidden />
                      </Link>
                    ))}
                  </div>
                ))}
                {tab === 'autopay' && <AutopayPanel methods={b.payment_methods} hasRecurring={b.has_recurring} refetch={() => q.refetch()} justSaved={!!params.get('autopay')} />}
              </div>
            </>
          );
        }}
      </QueryState>
    </>
  );
}

function AutopayPanel({ methods, hasRecurring, refetch, justSaved }: { methods: SavedMethod[]; hasRecurring: boolean; refetch: () => unknown; justSaved: boolean }) {
  const tp = useTrade();
  const ws = useWorkspace();
  const toast = useToast();
  const config = useBillingConfig();
  const [remove, setRemove] = useState<SavedMethod | null>(null);
  const on = methods.some((m) => m.autopay_enabled);
  useEffect(() => { if (justSaved) { const t = setTimeout(() => void refetch(), 2500); return () => clearTimeout(t); } }, [justSaved, refetch]);

  const setup = useMutation({
    mutationFn: async () => callBillingFunction<{ url: string }>('billing-autopay', { action: 'setup', org_id: ws.org.id }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (e) => toast.error(e),
  });
  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => unwrap(await supabase.rpc('set_autopay', { p_method: id, p_enabled: enabled })),
    onSuccess: (_d, v) => { void refetch(); toast.success(v.enabled ? 'Auto-pay enabled' : 'Auto-pay disabled'); },
    onError: (e) => toast.error(e),
  });
  const del = useMutation({
    mutationFn: async (id: string) => callBillingFunction('billing-autopay', { action: 'remove', method_id: id }),
    onSuccess: () => { setRemove(null); void refetch(); toast.success('Card removed'); },
    onError: (e) => toast.error(e),
  });

  return (
    <div className="stack" style={{ ['--gap' as string]: '16px' }}>
      <div className="card card-pad stack">
        <div className="row-between"><h2>Auto-pay</h2><span className={`badge ${on ? 'badge-green' : 'badge-gray'}`}>{on ? 'Auto-pay enabled' : 'Auto-pay disabled'}</span></div>
        <p className="muted small">{hasRecurring
          ? `When auto-pay is on, ${ws.org.name} charges your saved card automatically for your recurring ${tp.visits}. You’ll get a receipt every time.`
          : `Save a card so future invoices from ${ws.org.name} can be paid automatically. You’ll get a receipt every time.`}</p>
        {justSaved && !methods.length && <Alert tone="info">Saving your card… this takes a few seconds.</Alert>}
        {methods.map((m) => (
          <div key={m.id} className="note stack" style={{ ['--gap' as string]: '4px' }}>
            <div className="row"><CreditCard size={18} aria-hidden /><span className="strong grow">{m.brand ? cap(m.brand) : m.kind === 'us_bank_account' ? 'Bank account' : 'Card'} •••• {m.last4}</span>
              {m.exp_month && <span className="subtle">exp {String(m.exp_month).padStart(2, '0')}/{String(m.exp_year).slice(-2)}</span>}</div>
            <Switch label="Use for auto-pay" checked={m.autopay_enabled} disabled={toggle.isPending} onChange={(v) => toggle.mutate({ id: m.id, enabled: v })} />
            <Button size="sm" variant="danger-ghost" icon={<Trash2 />} onClick={() => setRemove(m)}>Remove card</Button>
          </div>
        ))}
        {config.data?.online_payments
          ? <Button icon={<CreditCard />} variant={methods.length ? 'secondary' : 'primary'} loading={setup.isPending} onClick={() => setup.mutate()}>{methods.length ? 'Use a different card' : 'Add a card for auto-pay'}</Button>
          : <Alert tone="info">{ws.org.name} hasn’t turned on online payments yet.</Alert>}
        <p className="subtle row" style={{ ['--gap' as string]: '4px' }}><ShieldCheck size={14} aria-hidden />Your card is stored securely by Stripe. {ws.org.name} only sees the last 4 digits.</p>
      </div>
      <ConfirmDialog open={!!remove} onClose={() => setRemove(null)} danger title="Remove this card?" confirmLabel="Remove" loading={del.isPending} onConfirm={() => remove && del.mutate(remove.id)}>
        Auto-pay will stop using it. You can add a card again any time.
      </ConfirmDialog>
    </div>
  );
}

export function PortalInvoiceDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['portal', 'invoice', id],
    queryFn: async () => unwrap(await supabase.rpc('get_my_invoice', { p_invoice: id })) as ClientInvoice,
  });
  useMarkRead(`/portal/billing/invoices/${id}`);
  return (
    <div style={{ maxWidth: 720 }}>
      <PageHeader back={{ to: '/portal/billing', label: 'Billing' }} title={q.data ? `Invoice ${q.data.number}` : 'Invoice'} />
      <QueryState query={q}>
        {(inv) => <ClientInvoiceView inv={inv} refetch={() => { void q.refetch(); void qc.invalidateQueries({ queryKey: ['portal', 'billing'] }); }}
          checkout={(tip, save_card) => callBillingFunction<{ url: string }>('billing-checkout', { invoice_id: inv.id, tip, save_card, return_path: `/portal/billing/invoices/${inv.id}` })} />}
      </QueryState>
    </div>
  );
}

export function PortalEstimateDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['portal', 'estimate', id],
    queryFn: async () => unwrap(await supabase.rpc('get_my_estimate', { p_estimate: id })) as ClientEstimate,
  });
  useMarkRead(`/portal/billing/estimates/${id}`);
  return (
    <div style={{ maxWidth: 720 }}>
      <PageHeader back={{ to: '/portal/billing', label: 'Billing' }} title={q.data ? (q.data.title ?? `Estimate ${q.data.number}`) : 'Estimate'} />
      <QueryState query={q}>
        {(est) => <ClientEstimateView est={est} respond={async (approve, note, selected) => {
          unwrap(await supabase.rpc('respond_estimate', { p_estimate: est.id, p_approve: approve, p_note: note || null, p_selected: selected }));
          await q.refetch();
          void qc.invalidateQueries({ queryKey: ['portal', 'billing'] });
        }} />}
      </QueryState>
    </div>
  );
}

function useMarkRead(link: string) {
  const qc = useQueryClient();
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      void supabase.from('notifications').update({ read_at: new Date().toISOString() })
        .eq('user_id', data.user.id).eq('link', link).is('read_at', null)
        .then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
    });
  }, [link, qc]);
}

// ---------------------------------------------------------------- secure links (no login)

function PublicShell({ children, org }: { children: React.ReactNode; org?: PublicOrg }) {
  useEffect(() => { if (org) applyTheme(org.brand_color, org.theme); }, [org]);
  return <div className="public-shell"><main className="public-main">{children}</main><p className="subtle center" style={{ padding: 20 }}>Powered by ScrubHub</p></div>;
}

export function PublicInvoicePage() {
  const { token = '' } = useParams();
  const q = useQuery({
    queryKey: ['public-invoice', token],
    retry: 0,
    queryFn: async () => unwrap(await supabase.rpc('get_public_invoice', { p_token: token })) as ClientInvoice,
  });
  useEffect(() => { if (q.data) document.title = `Invoice ${q.data.number} · ${q.data.org.name}`; }, [q.data]);
  return (
    <PublicShell org={q.data?.org}>
      <QueryState query={q} skeleton={<SkeletonList rows={2} height={200} />}>
        {(inv) => <ClientInvoiceView inv={inv} refetch={() => q.refetch()}
          checkout={(tip, save_card) => callBillingFunction<{ url: string }>('billing-checkout', { token, tip, save_card }, { auth: false })} />}
      </QueryState>
    </PublicShell>
  );
}

export function PublicEstimatePage() {
  const { token = '' } = useParams();
  const q = useQuery({
    queryKey: ['public-estimate', token],
    retry: 0,
    queryFn: async () => unwrap(await supabase.rpc('get_public_estimate', { p_token: token })) as ClientEstimate,
  });
  useEffect(() => { if (q.data) document.title = `Estimate ${q.data.number} · ${q.data.org.name}`; }, [q.data]);
  return (
    <PublicShell org={q.data?.org}>
      <QueryState query={q} skeleton={<SkeletonList rows={2} height={200} />}>
        {(est) => <ClientEstimateView est={est} respond={async (approve, note, selected) => {
          unwrap(await supabase.rpc('respond_public_estimate', { p_token: token, p_approve: approve, p_note: note || null, p_selected: selected }));
          await q.refetch();
        }} />}
      </QueryState>
    </PublicShell>
  );
}
