import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Plus, Trash2, ArrowUp, Search } from 'lucide-react';
import {
  ESTIMATE_STATUS, INVOICE_STATUS, PAYMENT_STATUS, PRICING_LABEL, computeTotals, fmtDay, methodDisplay, money, round2, todayIso, toIsoDate,
  type ClientPayment, type EstimateStatus, type InvoiceStatus, type LineItem, type Payment, type PublicOrg, type ServiceItem,
} from '@/lib/billing';
import { Badge, OrgLogo, Segmented } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { useTrade } from '@/features/shared/useTrade';

export function InvoiceBadge({ status }: { status: InvoiceStatus }) {
  const m = INVOICE_STATUS[status] ?? { label: status, tone: 'gray' as const };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
export function EstimateBadge({ status }: { status: EstimateStatus }) {
  const m = ESTIMATE_STATUS[status] ?? { label: status, tone: 'gray' as const };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
export function PaymentBadge({ status }: { status: Payment['status'] }) {
  const m = PAYMENT_STATUS[status] ?? { label: status, tone: 'gray' as const };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

const TABS = [
  { to: '/billing', label: 'Overview', end: true },
  { to: '/billing/invoices', label: 'Invoices' },
  { to: '/billing/estimates', label: 'Estimates' },
  { to: '/billing/payments', label: 'Payments' },
  { to: '/billing/recurring', label: 'Recurring' },
  { to: '/billing/services', label: 'Products & Services' },
  { to: '/billing/reports', label: 'Reports' },
  { to: '/billing/settings', label: 'Settings' },
];

/** Section tabs shown at the top of every Billing screen. */
export function BillingNav() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('a.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, []);
  return (
    <nav className="subnav" aria-label="Billing sections" ref={ref}>
      {TABS.map((t) => <NavLink key={t.to} to={t.to} end={t.end}>{t.label}</NavLink>)}
    </nav>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="search grow" style={{ minWidth: 200 }}>
      <Search aria-hidden />
      <span className="sr-only">{placeholder}</span>
      <input className="input" type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function MoneyField({ label, value, onChange, hint, currency = 'USD', id, disabled, max }: {
  label: ReactNode; value: string; onChange: (v: string) => void; hint?: ReactNode; currency?: string; id?: string; disabled?: boolean; max?: number;
}) {
  const fid = id ?? `m-${String(label).replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <div className="money-input">
        <span aria-hidden>{currency === 'USD' ? '$' : currency}</span>
        <input id={fid} className="input" inputMode="decimal" type="number" step="0.01" min="0" max={max} value={value} disabled={disabled}
          onChange={(e) => onChange(e.target.value)} />
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- date range

export type RangeKey = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';
export interface DateRange { key: RangeKey; from: string | null; to: string | null }

export function rangeFor(key: RangeKey, custom?: { from: string; to: string }): DateRange {
  const now = new Date();
  const today = todayIso();
  if (key === 'today') return { key, from: today, to: today };
  if (key === 'week') {
    const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return { key, from: toIsoDate(d), to: today };
  }
  if (key === 'month') return { key, from: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  if (key === 'year') return { key, from: toIsoDate(new Date(now.getFullYear(), 0, 1)), to: today };
  if (key === 'custom') return { key, from: custom?.from || null, to: custom?.to || null };
  return { key, from: null, to: null };
}

export function inRange(dateOrIso: string | null | undefined, r: DateRange) {
  if (!dateOrIso) return false;
  const d = dateOrIso.length > 10 ? toIsoDate(new Date(dateOrIso)) : dateOrIso;
  return (!r.from || d >= r.from) && (!r.to || d <= r.to);
}

export function DateRangePicker({ value, onChange, options = ['today', 'week', 'month', 'year', 'all', 'custom'] }: {
  value: DateRange; onChange: (r: DateRange) => void; options?: RangeKey[];
}) {
  const [custom, setCustom] = useState({ from: value.from ?? todayIso(), to: value.to ?? todayIso() });
  const labels: Record<RangeKey, string> = { today: 'Today', week: 'This week', month: 'This month', year: 'This year', all: 'All time', custom: 'Custom' };
  return (
    <div className="stack" style={{ ['--gap' as string]: '8px' }}>
      <div className="scroll-x">
        <Segmented label="Date range" value={value.key} onChange={(k) => onChange(rangeFor(k, custom))}
          options={options.map((o) => ({ value: o, label: labels[o] }))} />
      </div>
      {value.key === 'custom' && (
        <div className="row wrap">
          <label className="field" style={{ minWidth: 150 }}><span className="label">From</span>
            <input className="input" type="date" value={custom.from} onChange={(e) => { const c = { ...custom, from: e.target.value }; setCustom(c); onChange(rangeFor('custom', c)); }} />
          </label>
          <label className="field" style={{ minWidth: 150 }}><span className="label">To</span>
            <input className="input" type="date" value={custom.to} onChange={(e) => { const c = { ...custom, to: e.target.value }; setCustom(c); onChange(rangeFor('custom', c)); }} />
          </label>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- line items editor

export function LineItemsEditor({ items, onChange, catalog, currency, allowOptional }: {
  items: LineItem[]; onChange: (items: LineItem[]) => void; catalog: ServiceItem[]; currency: string; allowOptional?: boolean;
}) {
  const tp = useTrade();
  const [picker, setPicker] = useState(false);
  const set = (i: number, patch: Partial<LineItem>) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const addService = (s: ServiceItem) => {
    onChange([...items, {
      service_id: s.id, description: s.description ? `${s.name} — ${s.description}` : s.name,
      quantity: 1, unit_price: Number(s.default_price), taxable: s.taxable, is_optional: false, is_selected: true,
    }]);
    setPicker(false);
  };
  const addBlank = () => onChange([...items, { description: '', quantity: 1, unit_price: 0, taxable: true, is_optional: false, is_selected: true }]);
  const active = catalog.filter((c) => c.is_active);

  return (
    <div className="stack">
      {items.length === 0 && <p className="subtle">No line items yet — add a service from your catalog or a custom line.</p>}
      {items.map((it, i) => (
        <div key={i} className="line-edit">
          <div className="line-edit-order">
            <button type="button" className="icon-btn sm" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp aria-hidden /></button>
          </div>
          <div className="grow stack" style={{ ['--gap' as string]: '8px' }}>
            <input className="input" aria-label={`Line ${i + 1} description`} placeholder={tp.invoiceLinePlaceholder}
              value={it.description} onChange={(e) => set(i, { description: e.target.value })} />
            <div className="line-edit-nums">
              <label className="field"><span className="label">Qty</span>
                <input className="input" type="number" inputMode="decimal" min="0.01" step="0.25" value={it.quantity}
                  onChange={(e) => set(i, { quantity: e.target.value === '' ? ('' as unknown as number) : Number(e.target.value) })} />
              </label>
              <label className="field"><span className="label">Unit price</span>
                <div className="money-input"><span aria-hidden>{currency === 'USD' ? '$' : currency}</span>
                  <input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={it.unit_price}
                    onChange={(e) => set(i, { unit_price: e.target.value === '' ? ('' as unknown as number) : Number(e.target.value) })} />
                </div>
              </label>
              <div className="field"><span className="label">Total</span>
                <span className="line-total">{money(round2((Number(it.quantity) || 0) * (Number(it.unit_price) || 0)), currency)}</span>
              </div>
            </div>
            <div className="row wrap" style={{ ['--gap' as string]: '14px' }}>
              <label className="row small" style={{ ['--gap' as string]: '6px', cursor: 'pointer' }}>
                <input type="checkbox" checked={it.taxable} onChange={(e) => set(i, { taxable: e.target.checked })} style={{ accentColor: 'var(--brand)', width: 18, height: 18 }} />
                Taxable
              </label>
              {allowOptional && (
                <label className="row small" style={{ ['--gap' as string]: '6px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!it.is_optional} onChange={(e) => set(i, { is_optional: e.target.checked, is_selected: !e.target.checked })} style={{ accentColor: 'var(--brand)', width: 18, height: 18 }} />
                  Optional add-on (client chooses)
                </label>
              )}
              <span className="grow" />
              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => remove(i)}><Trash2 aria-hidden />Remove</button>
            </div>
          </div>
        </div>
      ))}
      <div className="row wrap">
        <Button type="button" variant="soft" size="sm" icon={<Plus />} onClick={() => setPicker((v) => !v)} aria-expanded={picker}>Add service</Button>
        <Button type="button" variant="ghost" size="sm" icon={<Plus />} onClick={addBlank}>Custom line</Button>
      </div>
      {picker && (
        <div className="card list" role="listbox" aria-label="Services">
          {active.length === 0 && <p className="subtle card-body">Your catalog is empty. Add services under Products &amp; Services.</p>}
          {active.map((s) => (
            <button key={s.id} type="button" className="list-item" role="option" aria-selected={false} onClick={() => addService(s)} style={{ minHeight: 56 }}>
              <span className="grow"><span className="strong">{s.name}</span>
                <span className="muted small" style={{ display: 'block' }}>{PRICING_LABEL[s.pricing_type]}{s.unit_label ? ` · per ${s.unit_label}` : ''}{!s.taxable ? ' · not taxed' : ''}</span></span>
              <span className="strong">{money(s.default_price, currency)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TotalsPanel({ items, discountType, discountValue, taxRate, taxLabel, credit, currency, paid, tips, refunded }: {
  items: LineItem[]; discountType: 'amount' | 'percent'; discountValue: number; taxRate: number; taxLabel: string; credit?: number; currency: string;
  paid?: number; tips?: number; refunded?: number;
}) {
  const t = useMemo(() => computeTotals(items, { discount_type: discountType, discount_value: discountValue, tax_rate: taxRate, credit_amount: credit }),
    [items, discountType, discountValue, taxRate, credit]);
  return (
    <dl className="totals">
      <div><dt>Subtotal</dt><dd>{money(t.subtotal, currency)}</dd></div>
      {t.discount > 0 && <div><dt>Discount{discountType === 'percent' ? ` (${discountValue}%)` : ''}</dt><dd>−{money(t.discount, currency)}</dd></div>}
      {taxRate > 0 && <div><dt>{taxLabel} ({taxRate}%)</dt><dd>{money(t.tax, currency)}</dd></div>}
      {!!credit && credit > 0 && <div><dt>Credit</dt><dd>−{money(credit, currency)}</dd></div>}
      <div className="grand"><dt>Total</dt><dd>{money(t.total, currency)}</dd></div>
      {paid !== undefined && paid > 0 && <div><dt>Paid</dt><dd>−{money(paid, currency)}</dd></div>}
      {paid !== undefined && <div className="grand"><dt>Balance due</dt><dd>{money(Math.max(t.total - paid, 0), currency)}</dd></div>}
      {!!tips && tips > 0 && <div className="muted"><dt>Tips received (separate)</dt><dd>{money(tips, currency)}</dd></div>}
      {!!refunded && refunded > 0 && <div className="muted"><dt>Refunded</dt><dd>{money(refunded, currency)}</dd></div>}
    </dl>
  );
}

// ---------------------------------------------------------------- branded documents

export interface DocData {
  kind: 'invoice' | 'estimate';
  org: PublicOrg;
  number: string;
  title?: string | null;
  status?: ReactNode;
  billTo: { name: string; email?: string | null; phone?: string | null } | null;
  serviceAddress: string | null;
  dates: { label: string; value: string }[];
  items: LineItem[];
  currency: string;
  taxLabel: string;
  taxRate: number;
  subtotal: number;
  discount: number;
  tax: number;
  credit?: number;
  total: number;
  paid?: number;
  tips?: number;
  refunded?: number;
  balance?: number;
  notes?: string | null;
  terms?: string | null;
  paymentInstructions?: string | null;
  payments?: ClientPayment[];
}

/** Printable, company-branded invoice / estimate. */
export function DocumentView({ d }: { d: DocData }) {
  const cur = d.currency;
  return (
    <article className="doc" style={{ ['--doc-brand' as string]: d.org.brand_color }}>
      <header className="doc-head">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <OrgLogo name={d.org.name} url={d.org.logo_url} size="lg" />
          <div className="stack" style={{ ['--gap' as string]: '2px' }}>
            <strong style={{ fontSize: 18 }}>{d.org.name}</strong>
            {d.org.address && <span className="small muted pre">{d.org.address}</span>}
            {d.org.phone && <span className="small muted">{d.org.phone}</span>}
            {d.org.email && <span className="small muted">{d.org.email}</span>}
            {d.org.website && <span className="small muted">{d.org.website.replace(/^https?:\/\//, '')}</span>}
          </div>
        </div>
        <div className="doc-title">
          <p className="doc-kind">{d.kind === 'invoice' ? 'Invoice' : 'Estimate'}</p>
          <p className="strong">{d.number}</p>
          {d.status && <div className="no-print-badge">{d.status}</div>}
        </div>
      </header>

      <section className="doc-meta">
        <div>
          <p className="label">Bill to</p>
          <p className="strong">{d.billTo?.name ?? '—'}</p>
          {d.billTo?.email && <p className="small muted">{d.billTo.email}</p>}
          {d.billTo?.phone && <p className="small muted">{d.billTo.phone}</p>}
        </div>
        <div>
          <p className="label">Service address</p>
          <p className="small pre">{d.serviceAddress || '—'}</p>
        </div>
        <dl className="doc-dates">
          {d.dates.map((x) => <div key={x.label}><dt>{x.label}</dt><dd>{x.value}</dd></div>)}
        </dl>
      </section>

      {d.title && <p className="strong" style={{ fontSize: 16 }}>{d.title}</p>}

      <table className="doc-table">
        <thead>
          <tr><th>Description</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr>
        </thead>
        <tbody>
          {d.items.map((it, i) => {
            const excluded = it.is_optional && !it.is_selected;
            return (
              <tr key={it.id ?? i} className={excluded ? 'excluded' : ''}>
                <td>
                  <span className="pre">{it.description}</span>
                  {it.is_optional && <span className="subtle" style={{ display: 'block' }}>Optional add-on{excluded ? ' — not included' : ' — included'}</span>}
                  {!it.taxable && d.taxRate > 0 && <span className="subtle" style={{ display: 'block' }}>Not taxed</span>}
                </td>
                <td className="num">{Number(it.quantity)}</td>
                <td className="num">{money(it.unit_price, cur)}</td>
                <td className="num">{money(it.line_total ?? round2(Number(it.quantity) * Number(it.unit_price)), cur)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="doc-bottom">
        <div className="stack" style={{ ['--gap' as string]: '12px' }}>
          {d.notes && <div><p className="label">Notes</p><p className="small pre">{d.notes}</p></div>}
          {d.paymentInstructions && d.kind === 'invoice' && <div><p className="label">How to pay</p><p className="small pre">{d.paymentInstructions}</p></div>}
          {d.terms && <div><p className="label">Terms</p><p className="small pre muted">{d.terms}</p></div>}
        </div>
        <dl className="totals">
          <div><dt>Subtotal</dt><dd>{money(d.subtotal, cur)}</dd></div>
          {d.discount > 0 && <div><dt>Discount</dt><dd>−{money(d.discount, cur)}</dd></div>}
          {d.taxRate > 0 && <div><dt>{d.taxLabel} ({Number(d.taxRate)}%)</dt><dd>{money(d.tax, cur)}</dd></div>}
          {!!d.credit && d.credit > 0 && <div><dt>Credit</dt><dd>−{money(d.credit, cur)}</dd></div>}
          <div className="grand"><dt>Total</dt><dd>{money(d.total, cur)}</dd></div>
          {d.kind === 'invoice' && (
            <>
              {!!d.paid && d.paid > 0 && <div><dt>Payments</dt><dd>−{money(d.paid, cur)}</dd></div>}
              <div className="grand balance"><dt>Balance due</dt><dd>{money(d.balance ?? 0, cur)}</dd></div>
              {!!d.tips && d.tips > 0 && <div className="muted"><dt>Tips (thank you!)</dt><dd>{money(d.tips, cur)}</dd></div>}
              {!!d.refunded && d.refunded > 0 && <div className="muted"><dt>Refunded</dt><dd>{money(d.refunded, cur)}</dd></div>}
            </>
          )}
        </dl>
      </div>

      {d.payments && d.payments.length > 0 && (
        <section>
          <p className="label" style={{ marginBottom: 6 }}>Payment history</p>
          <table className="doc-table compact">
            <tbody>
              {d.payments.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDay(p.paid_at)} · {methodDisplay(p)}<span className="subtle" style={{ display: 'block' }}>Receipt {p.receipt_number}</span></td>
                  <td className="num">{money(Number(p.amount) + Number(p.tip_amount), cur)}{Number(p.amount_refunded) > 0 && <span className="subtle" style={{ display: 'block' }}>{money(p.amount_refunded, cur)} refunded</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <footer className="doc-foot">Thank you for choosing {d.org.name}.</footer>
    </article>
  );
}

export function ReceiptView({ org, payment, invoiceNumber, clientName, currency, message }: {
  org: PublicOrg; payment: ClientPayment; invoiceNumber: string; clientName: string; currency: string; message?: string | null;
}) {
  const total = Number(payment.amount) + Number(payment.tip_amount);
  return (
    <article className="doc receipt" style={{ ['--doc-brand' as string]: org.brand_color }}>
      <div className="center stack" style={{ alignItems: 'center', ['--gap' as string]: '6px' }}>
        <OrgLogo name={org.name} url={org.logo_url} size="lg" />
        <strong style={{ fontSize: 18 }}>{org.name}</strong>
        {org.phone && <span className="small muted">{org.phone}</span>}
        <p className="doc-kind" style={{ marginTop: 8 }}>Payment receipt</p>
        <p className="receipt-amount">{money(total, currency)}</p>
        <p className="small muted">Paid {new Date(payment.paid_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
      </div>
      <dl className="kv receipt-kv">
        <dt>Receipt #</dt><dd>{payment.receipt_number}</dd>
        <dt>Client</dt><dd>{clientName}</dd>
        <dt>Invoice</dt><dd>{invoiceNumber}</dd>
        <dt>Payment method</dt><dd>{methodDisplay(payment)}</dd>
        <dt>Amount applied</dt><dd>{money(payment.amount, currency)}</dd>
        {Number(payment.tip_amount) > 0 && <><dt>Tip</dt><dd>{money(payment.tip_amount, currency)}</dd></>}
        {Number(payment.amount_refunded) > 0 && <><dt>Refunded</dt><dd>{money(payment.amount_refunded, currency)}</dd></>}
        {(payment.processor_payment_id || payment.reference) && <><dt>Transaction ref.</dt><dd style={{ wordBreak: 'break-all' }}>{payment.reference || payment.processor_payment_id}</dd></>}
        {payment.notes && <><dt>Note</dt><dd>{payment.notes}</dd></>}
      </dl>
      <footer className="doc-foot">{message || 'Thank you! Your payment has been received.'}</footer>
    </article>
  );
}

/**
 * Print (or "Save as PDF") just one element, using the app's own styles.
 * Opens a clean window so the app shell never ends up on paper.
 */
export function printElement(el: HTMLElement | null, title: string) {
  if (!el) return;
  const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.outerHTML).join('\n');
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) { window.print(); return; }
  w.document.open();
  w.document.write(`<!doctype html><html style="${document.documentElement.getAttribute('style') ?? ''}"><head><meta charset="utf-8"><title>${title.replace(/</g, '')}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">${styles}</head><body class="print-body">${el.outerHTML}</body></html>`);
  w.document.close();
  const go = () => { w.focus(); w.print(); };
  if (w.document.readyState === 'complete') setTimeout(go, 350); else w.addEventListener('load', () => setTimeout(go, 200));
}

export function PrintButton({ targetRef, title, label = 'Download PDF / Print', variant = 'secondary', size }: {
  targetRef: React.RefObject<HTMLElement>; title: string; label?: string; variant?: 'secondary' | 'ghost' | 'soft'; size?: 'sm';
}) {
  return <Button variant={variant} size={size} onClick={() => printElement(targetRef.current, title)}>{label}</Button>;
}

export function Stat({ label, value, tone, sub, to }: { label: string; value: string; tone?: 'green' | 'red' | 'amber'; sub?: string; to?: string }) {
  const body = (
    <>
      <div className="k">{label}</div>
      <div className="v" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
      {sub && <div className="subtle">{sub}</div>}
    </>
  );
  return to ? <NavLink to={to} className="card stat card-link">{body}</NavLink> : <div className="card stat">{body}</div>;
}

/** Plain text export for reports. */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map((v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
