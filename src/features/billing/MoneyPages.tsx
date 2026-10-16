import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Plus, Receipt, RotateCcw, Wallet } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useWorkspace } from '@/auth/AuthProvider';
import { METHOD_LABEL, PAYMENT_STATUS, dueText, fmtDay, methodDisplay, money, toIsoDate, type Invoice, type Payment } from '@/lib/billing';
import { fmtDateTime } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/Form';
import { EmptyState, QueryState, SkeletonList } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/Misc';
import { useClients } from '@/features/shared/api';
import { BillingNav, DateRangePicker, InvoiceBadge, PaymentBadge, SearchBox, downloadCsv, inRange, rangeFor, type DateRange } from './components';
import { ReceiptModal, RecordPaymentModal, RefundModal, orgOf } from './InvoicePages';
import { useBillingSettings, useInvoices, usePayments, useRefunds } from './api';

export function PaymentsPage() {
  const ws = useWorkspace();
  const q = usePayments();
  const invoices = useInvoices();
  const settings = useBillingSettings();
  const currency = settings.data?.currency ?? 'USD';
  const [range, setRange] = useState<DateRange>(rangeFor('all'));
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState('all');
  const [status, setStatus] = useState('all');
  const [pick, setPick] = useState(false);
  const [recordFor, setRecordFor] = useState<Invoice | null>(null);
  const [refundFor, setRefundFor] = useState<Payment | null>(null);
  const [receiptFor, setReceiptFor] = useState<Payment | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (q.data ?? []).filter((p) => inRange(p.paid_at, range) && (method === 'all' || p.method === method) && (status === 'all' || p.status === status)
      && (!term || `${p.client?.full_name ?? ''} ${p.invoice?.number ?? ''} ${p.processor_payment_id ?? ''} ${p.reference ?? ''} ${p.receipt_number}`.toLowerCase().includes(term)));
  }, [q.data, range, search, method, status]);
  const sum = rows.reduce((a, p) => a + Number(p.amount) + Number(p.tip_amount) - Number(p.amount_refunded), 0);
  const openInvoices = (invoices.data ?? []).filter((i) => Number(i.balance_due) > 0 && i.status !== 'cancelled');

  const exportCsv = () => downloadCsv(`payments-${toIsoDate(new Date())}.csv`, [
    ['Date', 'Client', 'Invoice', 'Amount', 'Tip', 'Refunded', 'Method', 'Status', 'Processor', 'Transaction ID', 'Receipt', 'Reference', 'Notes'],
    ...rows.map((p) => [fmtDay(p.paid_at), p.client?.full_name, p.invoice?.number, p.amount, p.tip_amount, p.amount_refunded,
      METHOD_LABEL[p.method], PAYMENT_STATUS[p.status]?.label, p.processor, p.processor_payment_id, p.receipt_number, p.reference, p.notes]),
  ]);

  return (
    <>
      <PageHeader title="Payments" actions={<><Button variant="secondary" icon={<Download />} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>
        <Button icon={<Plus />} onClick={() => setPick(true)}>Record payment</Button></>} />
      <BillingNav />
      <div className="stack mt-16" style={{ ['--gap' as string]: '10px' }}>
        <DateRangePicker value={range} onChange={setRange} />
        <div className="row wrap">
          <SearchBox value={search} onChange={setSearch} placeholder="Search client, invoice, transaction ID" />
          <SelectField aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)} className="sort-select">
            <option value="all">All methods</option>{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectField>
          <SelectField aria-label="Payment status" value={status} onChange={(e) => setStatus(e.target.value)} className="sort-select">
            <option value="all">All statuses</option>{Object.entries(PAYMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </SelectField>
        </div>
      </div>
      <div className="mt-16">
        <QueryState query={q}>
          {() => rows.length === 0 ? (
            <div className="card"><EmptyState icon={<Wallet />} title="No payments here">Payments appear when clients pay online or you record cash, check or bank payments.</EmptyState></div>
          ) : (
            <div className="card">
              <div className="list">
                {rows.map((p) => (
                  <div key={p.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                    <span className="grow stack" style={{ ['--gap' as string]: '3px' }}>
                      <span className="row-between"><span className="strong truncate">{p.client?.full_name}</span><span className="strong">{money(Number(p.amount) + Number(p.tip_amount), currency)}</span></span>
                      <span className="row-between wrap">
                        <span className="muted small">{fmtDateTime(p.paid_at)} · <Link to={`/billing/invoices/${p.invoice_id}`}>{p.invoice?.number}</Link> · {methodDisplay(p)}{Number(p.tip_amount) > 0 && ` · tip ${money(p.tip_amount, currency)}`}</span>
                        <PaymentBadge status={p.status} />
                      </span>
                      <span className="subtle truncate">{p.processor === 'stripe' ? 'Stripe' : 'Recorded manually'}{p.processor_payment_id ? ` · ${p.processor_payment_id}` : ''}{p.reference ? ` · Ref ${p.reference}` : ''}{p.notes ? ` · ${p.notes}` : ''}</span>
                      <span className="row" style={{ ['--gap' as string]: '4px' }}>
                        <Button size="sm" variant="ghost" icon={<Receipt />} onClick={() => setReceiptFor(p)}>Receipt</Button>
                        {Number(p.amount) + Number(p.tip_amount) - Number(p.amount_refunded) > 0 && <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => setRefundFor(p)}>Refund</Button>}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="rtable-foot"><span>{rows.length} payment{rows.length === 1 ? '' : 's'}</span><span>Net {money(sum, currency)}</span></div>
            </div>
          )}
        </QueryState>
      </div>

      <Modal open={pick} onClose={() => setPick(false)} title="Which invoice was paid?">
        {openInvoices.length === 0 ? <EmptyState title="No unpaid invoices">Create an invoice first, then record the payment on it.</EmptyState> : (
          <div className="list">
            {openInvoices.map((i) => (
              <button key={i.id} type="button" className="list-item" onClick={() => { setPick(false); setRecordFor(i); }}>
                <span className="grow"><span className="strong">{i.client?.full_name}</span><span className="muted small" style={{ display: 'block' }}>{i.number} · {dueText(i)}</span></span>
                <span className="strong">{money(i.balance_due, currency)}</span>
              </button>
            ))}
          </div>
        )}
      </Modal>
      {recordFor && <RecordPaymentModal open onClose={() => setRecordFor(null)} invoice={recordFor} settings={settings.data ?? null} />}
      {refundFor && <RefundModal payment={refundFor} currency={currency} onClose={() => setRefundFor(null)} />}
      {receiptFor && <ReceiptModal onClose={() => setReceiptFor(null)} org={orgOf(ws)} payment={receiptFor} invoiceNumber={receiptFor.invoice?.number ?? ''}
        clientName={receiptFor.client?.full_name ?? ''} currency={currency} message={settings.data?.receipt_message} />}
    </>
  );
}

// ---------------------------------------------------------------- reports

function useInvoiceLines() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: ['billing', 'lines', ws.org.id],
    queryFn: async () => unwrap(await supabase.from('invoice_items')
      .select('description, line_total, service_id, invoice:invoices!inner(id, org_id, issue_date, status, client_id, total, subtotal, discount_total)')
      .eq('invoice.org_id', ws.org.id).limit(5000)) as unknown as {
        description: string; line_total: number; service_id: string | null;
        invoice: { id: string; issue_date: string; status: string; client_id: string; total: number; subtotal: number; discount_total: number };
      }[],
  });
}

function Bars({ rows, currency }: { rows: { label: string; value: number }[]; currency: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (!rows.length) return <p className="subtle card-body">No data for these filters.</p>;
  return (
    <div className="bars card-body">
      {rows.map((r) => (
        <div key={r.label} className="bar-row">
          <span className="bar-label truncate" title={r.label}>{r.label}</span>
          <span className="bar-track"><span style={{ width: `${Math.max((r.value / max) * 100, 1.5)}%` }} /></span>
          <span className="bar-value">{money(r.value, currency)}</span>
        </div>
      ))}
    </div>
  );
}

export function ReportsPage() {
  const currency = useBillingSettings().data?.currency ?? 'USD';
  const invoices = useInvoices();
  const payments = usePayments();
  const refunds = useRefunds();
  const lines = useInvoiceLines();
  const clients = useClients();
  const [range, setRange] = useState<DateRange>(rangeFor('month'));
  const [clientId, setClientId] = useState('all');
  const [service, setService] = useState('all');
  const [payStatus, setPayStatus] = useState<'all' | 'paid' | 'unpaid' | 'overdue'>('all');

  const serviceName = (desc: string) => desc.split(' — ')[0].trim();
  const services = useMemo(() => [...new Set((lines.data ?? []).map((l) => serviceName(l.description)))].sort(), [lines.data]);

  const r = useMemo(() => {
    const byClient = (cid: string) => clientId === 'all' || cid === clientId;
    const invMatchesStatus = (i: { status: string; balance_due?: number }) =>
      payStatus === 'all' || (payStatus === 'paid' ? i.status === 'paid' : payStatus === 'overdue' ? i.status === 'overdue' : ['sent', 'viewed', 'partially_paid', 'overdue'].includes(i.status));
    const invById = new Map((invoices.data ?? []).map((i) => [i.id, i]));
    const serviceInvoices = service === 'all' ? null : new Set((lines.data ?? []).filter((l) => serviceName(l.description) === service).map((l) => l.invoice.id));
    const pays = (payments.data ?? []).filter((p) => p.status !== 'failed' && inRange(p.paid_at, range) && byClient(p.client_id)
      && (!serviceInvoices || serviceInvoices.has(p.invoice_id)) && (payStatus === 'all' || invMatchesStatus(invById.get(p.invoice_id) ?? { status: '' })));

    // revenue by date (day for short ranges, month otherwise)
    const spanDays = range.from && range.to ? (new Date(range.to).getTime() - new Date(range.from).getTime()) / 864e5 : 999;
    const keyOf = (iso: string) => (spanDays <= 45 ? toIsoDate(new Date(iso)) : toIsoDate(new Date(iso)).slice(0, 7));
    const byDate = new Map<string, number>();
    for (const p of pays) byDate.set(keyOf(p.paid_at), (byDate.get(keyOf(p.paid_at)) ?? 0) + Number(p.amount));
    const dateRows = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({
      label: k.length === 7 ? new Date(`${k}-01T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : fmtDay(k), value: v,
    }));

    const byClientMap = new Map<string, number>();
    for (const p of pays) byClientMap.set(p.client?.full_name ?? 'Client', (byClientMap.get(p.client?.full_name ?? 'Client') ?? 0) + Number(p.amount));
    const clientRows = [...byClientMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([label, value]) => ({ label, value }));

    const svcMap = new Map<string, number>();
    for (const l of lines.data ?? []) {
      const inv = l.invoice;
      if (inv.status === 'draft' || inv.status === 'cancelled' || !inRange(inv.issue_date, range) || !byClient(inv.client_id) || !invMatchesStatus(inv)) continue;
      const name = serviceName(l.description);
      if (service !== 'all' && name !== service) continue;
      const share = Number(inv.subtotal) > 0 ? Number(l.line_total) * (1 - Number(inv.discount_total) / Number(inv.subtotal)) : 0;
      svcMap.set(name, (svcMap.get(name) ?? 0) + share);
    }
    const serviceRows = [...svcMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([label, value]) => ({ label, value }));

    const openInv = (invoices.data ?? []).filter((i) => Number(i.balance_due) > 0 && !['draft', 'cancelled'].includes(i.status) && byClient(i.client_id)
      && (!serviceInvoices || serviceInvoices.has(i.id)));
    const refs = (refunds.data ?? []).filter((x) => x.status === 'succeeded' && inRange(x.created_at, range)
      && (clientId === 'all' || invById.get(x.invoice_id)?.client_id === clientId));
    return {
      pays, dateRows, clientRows, serviceRows, openInv, overdueInv: openInv.filter((i) => i.status === 'overdue'), refs,
      revenue: pays.reduce((a, p) => a + Number(p.amount), 0), tips: pays.reduce((a, p) => a + Number(p.tip_amount), 0),
      refunded: refs.reduce((a, x) => a + Number(x.amount), 0),
    };
  }, [invoices.data, payments.data, refunds.data, lines.data, range, clientId, service, payStatus]);

  const loading = invoices.isLoading || payments.isLoading || lines.isLoading;

  return (
    <>
      <PageHeader title="Reports" sub="Simple, accountant-friendly numbers" />
      <BillingNav />
      <div className="card card-pad stack mt-16">
        <DateRangePicker value={range} onChange={setRange} />
        <div className="form-grid two" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <SelectField label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="all">All clients</option>{(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </SelectField>
          <SelectField label="Service" value={service} onChange={(e) => setService(e.target.value)}>
            <option value="all">All services</option>{services.map((s) => <option key={s} value={s}>{s}</option>)}
          </SelectField>
          <SelectField label="Payment status" value={payStatus} onChange={(e) => setPayStatus(e.target.value as typeof payStatus)}>
            <option value="all">Any</option><option value="paid">Paid</option><option value="unpaid">Unpaid</option><option value="overdue">Overdue</option>
          </SelectField>
        </div>
      </div>

      {loading ? <div className="mt-16"><SkeletonList rows={3} height={120} /></div> : (
        <>
          <div className="stats mt-16">
            <div className="card stat"><div className="k">Revenue collected</div><div className="v">{money(r.revenue, currency)}</div><div className="subtle">{r.pays.length} payments, excl. tips</div></div>
            <div className="card stat"><div className="k">Tips received</div><div className="v">{money(r.tips, currency)}</div></div>
            <div className="card stat"><div className="k">Refunds</div><div className="v">{money(r.refunded, currency)}</div><div className="subtle">{r.refs.length} refund{r.refs.length === 1 ? '' : 's'}</div></div>
            <div className="card stat"><div className="k">Outstanding now</div><div className="v">{money(r.openInv.reduce((a, i) => a + Number(i.balance_due), 0), currency)}</div><div className="subtle">{r.overdueInv.length} overdue</div></div>
          </div>

          <div className="grid-2-lg mt-16">
            <div className="stack" style={{ ['--gap' as string]: '16px' }}>
              <div className="card"><div className="card-header"><h2>Revenue by date</h2>
                <Button size="sm" variant="ghost" icon={<Download />} onClick={() => downloadCsv('revenue-by-date.csv', [['Period', 'Revenue'], ...r.dateRows.map((x) => [x.label, x.value.toFixed(2)])])}>CSV</Button></div>
                <Bars rows={r.dateRows} currency={currency} /></div>
              <div className="card"><div className="card-header"><h2>Revenue by client</h2>
                <Button size="sm" variant="ghost" icon={<Download />} onClick={() => downloadCsv('revenue-by-client.csv', [['Client', 'Revenue'], ...r.clientRows.map((x) => [x.label, x.value.toFixed(2)])])}>CSV</Button></div>
                <Bars rows={r.clientRows} currency={currency} /></div>
              <div className="card"><div className="card-header"><h2>Invoiced by service</h2>
                <Button size="sm" variant="ghost" icon={<Download />} onClick={() => downloadCsv('revenue-by-service.csv', [['Service', 'Invoiced (after discounts, before tax)'], ...r.serviceRows.map((x) => [x.label, x.value.toFixed(2)])])}>CSV</Button></div>
                <Bars rows={r.serviceRows} currency={currency} /></div>
            </div>
            <div className="stack" style={{ ['--gap' as string]: '16px' }}>
              <div className="card">
                <div className="card-header"><h2>Outstanding invoices</h2>
                  <Button size="sm" variant="ghost" icon={<Download />} onClick={() => downloadCsv('outstanding.csv', [['Invoice', 'Client', 'Issued', 'Due', 'Status', 'Total', 'Balance'],
                    ...r.openInv.map((i) => [i.number, i.client?.full_name, i.issue_date, i.due_date, i.status, i.total, i.balance_due])])}>CSV</Button></div>
                {r.openInv.length === 0 ? <p className="subtle card-body">Nothing outstanding.</p> : (
                  <div className="list mt-8">{r.openInv.slice(0, 20).map((i) => (
                    <Link key={i.id} to={`/billing/invoices/${i.id}`} className="list-item">
                      <span className="grow"><span className="strong">{i.client?.full_name}</span><span className="muted small" style={{ display: 'block' }}>{i.number} · {dueText(i)}</span></span>
                      <span className="stack" style={{ alignItems: 'flex-end', ['--gap' as string]: '2px' }}><span className="strong">{money(i.balance_due, currency)}</span><InvoiceBadge status={i.status} /></span>
                    </Link>
                  ))}</div>
                )}
              </div>
              <div className="card">
                <div className="card-header"><h2>Payments received</h2>
                  <Button size="sm" variant="ghost" icon={<Download />} onClick={() => downloadCsv('payments.csv', [['Date', 'Client', 'Invoice', 'Amount', 'Tip', 'Method'],
                    ...r.pays.map((p) => [fmtDay(p.paid_at), p.client?.full_name, p.invoice?.number, p.amount, p.tip_amount, METHOD_LABEL[p.method]])])}>CSV</Button></div>
                {r.pays.length === 0 ? <p className="subtle card-body">No payments in this period.</p> : (
                  <div className="list mt-8">{r.pays.slice(0, 15).map((p) => (
                    <div key={p.id} className="list-item">
                      <span className="grow"><span className="strong">{p.client?.full_name}</span><span className="muted small" style={{ display: 'block' }}>{fmtDay(p.paid_at)} · {methodDisplay(p)}</span></span>
                      <span className="strong">{money(Number(p.amount) + Number(p.tip_amount), currency)}</span>
                    </div>
                  ))}</div>
                )}
              </div>
              <div className="card">
                <div className="card-header"><h2>Refunds</h2></div>
                {r.refs.length === 0 ? <p className="subtle card-body">No refunds in this period.</p> : (
                  <div className="list mt-8">{r.refs.map((x) => (
                    <Link key={x.id} to={`/billing/invoices/${x.invoice_id}`} className="list-item">
                      <span className="grow"><span className="strong">{x.invoice?.client?.full_name}</span><span className="muted small" style={{ display: 'block' }}>{x.invoice?.number} · {fmtDay(x.created_at)}{x.reason ? ` · ${x.reason}` : ''}</span></span>
                      <span className="strong">−{money(x.amount, currency)}</span>
                    </Link>
                  ))}</div>
                )}
              </div>
            </div>
          </div>
          <p className="muted small mt-16">Export any list as CSV for your accountant. “Revenue collected” is payments applied to invoices (tips shown separately); “Invoiced by service” is after discounts, before tax.</p>
        </>
      )}
    </>
  );
}

