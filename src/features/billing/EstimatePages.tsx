import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { CalendarPlus, ExternalLink, FileText, Link2, Pencil, Plus, Receipt, Send, Trash2 } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useWorkspace } from '@/auth/AuthProvider';
import { ESTIMATE_STATUS, addDays, fmtDay, money, todayIso, type BillingSettings, type Estimate, type EstimateStatus, type LineItem } from '@/lib/billing';
import { clientAddress, fmtDateTime } from '@/lib/format';
import { Button, ButtonLink } from '@/components/ui/Button';
import { SelectField, TextArea, TextField } from '@/components/ui/Form';
import { Alert, EmptyState, QueryState } from '@/components/ui/Feedback';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { useClients } from '@/features/shared/api';
import { BillingNav, DocumentView, EstimateBadge, LineItemsEditor, PrintButton, SearchBox, TotalsPanel, type DocData } from './components';
import { ActivityList } from './OverviewPage';
import { orgOf } from './InvoicePages';
import { useBillingSettings, useCatalog, useEstimate, useEstimates, useInvalidateBilling } from './api';
import { useTrade } from '@/features/shared/useTrade';

export function estimateDoc(e: Estimate, org: DocData['org'], s: BillingSettings | null | undefined): DocData {
  return {
    kind: 'estimate', org, number: e.number, title: e.title,
    billTo: e.client ? { name: e.client.full_name, email: e.client.email, phone: e.client.phone } : null,
    serviceAddress: e.service_address,
    dates: [{ label: 'Estimate date', value: fmtDay(e.issue_date) }, ...(e.valid_until ? [{ label: 'Valid until', value: fmtDay(e.valid_until) }] : [])],
    items: e.estimate_items ?? [], currency: s?.currency ?? 'USD', taxLabel: s?.tax_label ?? 'Tax', taxRate: Number(e.tax_rate),
    subtotal: Number(e.subtotal), discount: Number(e.discount_total), tax: Number(e.tax_total), total: Number(e.total),
    notes: e.notes, terms: e.terms,
  };
}

type Filter = 'all' | EstimateStatus;

export function EstimatesPage() {
  const q = useEstimates();
  const currency = useBillingSettings().data?.currency ?? 'USD';
  const [params, setParams] = useSearchParams();
  const filter = (params.get('status') as Filter) || 'all';
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (q.data ?? []).filter((e) => (filter === 'all' || e.status === filter)
      && (!term || `${e.number} ${e.title ?? ''} ${e.client?.full_name ?? ''}`.toLowerCase().includes(term)));
  }, [q.data, filter, search]);

  return (
    <>
      <PageHeader title="Estimates" actions={<ButtonLink to="/billing/estimates/new" icon={<Plus />}>New estimate</ButtonLink>} />
      <BillingNav />
      <div className="row wrap mt-16"><SearchBox value={search} onChange={setSearch} placeholder="Search by client, title or number" /></div>
      <div className="chips mt-8" role="group" aria-label="Filter by status">
        {(['all', 'draft', 'sent', 'viewed', 'approved', 'declined', 'expired'] as Filter[]).map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={filter === f}
            onClick={() => { const p = new URLSearchParams(params); if (f === 'all') p.delete('status'); else p.set('status', f); setParams(p, { replace: true }); }}>
            {f === 'all' ? 'All' : ESTIMATE_STATUS[f].label}
          </button>
        ))}
      </div>
      <div className="mt-16">
        <QueryState query={q}>
          {() => rows.length === 0 ? (
            <div className="card"><EmptyState icon={<FileText />} title={q.data?.length ? 'No estimates match' : 'No estimates yet'}
              action={!q.data?.length && <ButtonLink to="/billing/estimates/new" icon={<Plus />}>Create an estimate</ButtonLink>}>
              Send a quote, let the client approve it online, then turn it into a job and an invoice in one tap.
            </EmptyState></div>
          ) : (
            <div className="card list">
              {rows.map((e) => (
                <Link key={e.id} to={`/billing/estimates/${e.id}`} className="list-item">
                  <span className="grow">
                    <span className="row-between"><span className="strong truncate">{e.client?.full_name}</span><span className="strong">{money(e.total, currency)}</span></span>
                    <span className="row-between"><span className="muted small truncate">{e.number}{e.title ? ` · ${e.title}` : ''} · {fmtDay(e.issue_date)}</span><EstimateBadge status={e.status} /></span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </QueryState>
      </div>
    </>
  );
}

interface EstState {
  client_id: string; title: string; issue_date: string; valid_until: string; service_address: string; items: LineItem[];
  discount_type: 'amount' | 'percent'; discount_value: number; tax_rate: number; notes: string; terms: string; internal_notes: string;
}

export function NewEstimatePage() {
  const s = useBillingSettings();
  const [params] = useSearchParams();
  return (
    <QueryState query={s}>
      {(settings) => (
        <EstimateEditor settings={settings} initial={{
          client_id: params.get('client') ?? '', title: '', issue_date: todayIso(), valid_until: addDays(todayIso(), settings?.estimate_valid_days ?? 30),
          service_address: '', items: [], discount_type: 'amount', discount_value: 0, tax_rate: Number(settings?.tax_rate ?? 0),
          notes: '', terms: settings?.default_terms ?? '', internal_notes: '',
        }} />
      )}
    </QueryState>
  );
}

export function EditEstimatePage() {
  const { id = '' } = useParams();
  const q = useEstimate(id);
  const s = useBillingSettings();
  return (
    <QueryState query={q}>
      {({ estimate: e }) => e.approved_at || e.declined_at ? <Alert tone="warn">The client already answered this estimate, so it can’t be changed. <Link to={`/billing/estimates/${e.id}`}>Back</Link></Alert> : (
        <EstimateEditor estimate={e} settings={s.data ?? null} initial={{
          client_id: e.client_id, title: e.title ?? '', issue_date: e.issue_date, valid_until: e.valid_until ?? '', service_address: e.service_address ?? '',
          items: (e.estimate_items ?? []).map((it) => ({ ...it, quantity: Number(it.quantity), unit_price: Number(it.unit_price) })),
          discount_type: e.discount_type, discount_value: Number(e.discount_value), tax_rate: Number(e.tax_rate),
          notes: e.notes ?? '', terms: e.terms ?? '', internal_notes: e.internal_notes ?? '',
        }} />
      )}
    </QueryState>
  );
}

function EstimateEditor({ estimate, initial, settings }: { estimate?: Estimate; initial: EstState; settings: BillingSettings | null }) {
  const tp = useTrade();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateBilling();
  const clients = useClients();
  const catalog = useCatalog();
  const [f, setF] = useState<EstState>(initial);
  const [err, setErr] = useState<string | null>(null);
  const currency = settings?.currency ?? 'USD';
  const client = (clients.data ?? []).find((c) => c.id === f.client_id);
  const set = (p: Partial<EstState>) => setF((x) => ({ ...x, ...p }));

  const save = useMutation({
    mutationFn: async (send: boolean) => {
      const id = unwrap(await supabase.rpc('save_estimate', { p: {
        id: estimate?.id ?? null, org_id: ws.org.id, client_id: f.client_id, title: f.title, issue_date: f.issue_date,
        valid_until: f.valid_until || null, service_address: f.service_address, notes: f.notes, terms: f.terms, internal_notes: f.internal_notes,
        discount_type: f.discount_type, discount_value: Number(f.discount_value) || 0, tax_rate: Number(f.tax_rate) || 0,
        items: f.items.map((it) => ({ ...it, quantity: Number(it.quantity) || 1, unit_price: Number(it.unit_price) || 0 })),
      } })) as string;
      if (send) unwrap(await supabase.rpc('send_estimate', { p_estimate: id }));
      return { id, send };
    },
    onSuccess: ({ id, send }) => { invalidate(); toast.success(send ? 'Estimate sent to the client' : 'Estimate saved'); navigate(`/billing/estimates/${id}`, { replace: true }); },
    onError: (e) => toast.error(e),
  });
  const submit = (e: FormEvent, send = false) => {
    e.preventDefault();
    if (!f.client_id) return setErr('Choose a client');
    if (!f.items.some((i) => i.description.trim())) return setErr('Add at least one service');
    setErr(null);
    save.mutate(send);
  };

  return (
    <form onSubmit={(e) => submit(e)} noValidate>
      <PageHeader back={{ to: estimate ? `/billing/estimates/${estimate.id}` : '/billing/estimates', label: estimate ? estimate.number : 'Estimates' }}
        title={estimate ? `Edit ${estimate.number}` : 'New estimate'} />
      <div className="grid-2-lg">
        <div className="stack" style={{ ['--gap' as string]: '16px' }}>
          <div className="card card-pad stack">
            <div className="form-grid two">
              <SelectField className="span-2" label="Client" value={f.client_id} onChange={(e) => set({ client_id: e.target.value })}>
                <option value="">Choose a client…</option>
                {(clients.data ?? []).filter((c) => c.status === 'active' || c.id === f.client_id).map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </SelectField>
              <TextField className="span-2" label="Title (optional)" placeholder={tp.estimatePlaceholder} value={f.title} onChange={(e) => set({ title: e.target.value })} />
              <TextField className="span-2" label="Service address" placeholder={clientAddress(client) || 'Client’s address'} value={f.service_address} onChange={(e) => set({ service_address: e.target.value })} />
              <TextField label="Estimate date" type="date" value={f.issue_date} onChange={(e) => set({ issue_date: e.target.value })} />
              <TextField label="Valid until" type="date" value={f.valid_until} min={f.issue_date} onChange={(e) => set({ valid_until: e.target.value })} />
            </div>
          </div>
          <div className="card card-pad stack">
            <h2>Services</h2>
            <p className="subtle">Mark extras as <strong>optional</strong> — the client can tick them when approving.</p>
            <LineItemsEditor items={f.items} onChange={(items) => set({ items })} catalog={catalog.data ?? []} currency={currency} allowOptional />
          </div>
          <div className="card card-pad stack">
            <TextArea label="Notes for the client" value={f.notes} onChange={(e) => set({ notes: e.target.value })} style={{ minHeight: 70 }} />
            <TextArea label="Terms" value={f.terms} onChange={(e) => set({ terms: e.target.value })} style={{ minHeight: 60 }} />
            <TextArea label="Internal notes" hint="Only your team sees this" value={f.internal_notes} onChange={(e) => set({ internal_notes: e.target.value })} style={{ minHeight: 60 }} />
          </div>
        </div>
        <div className="stack sticky-col" style={{ ['--gap' as string]: '16px' }}>
          <div className="card card-pad stack">
            <h2>Totals</h2>
            <div className="form-grid two">
              <SelectField label="Discount" value={f.discount_type} onChange={(e) => set({ discount_type: e.target.value as 'amount' | 'percent' })}>
                <option value="amount">Amount</option><option value="percent">Percent</option>
              </SelectField>
              <TextField label={f.discount_type === 'percent' ? 'Discount %' : 'Discount amount'} type="number" min="0" step="0.01" value={f.discount_value}
                onChange={(e) => set({ discount_value: e.target.value as unknown as number })} />
              <TextField className="span-2" label={`${settings?.tax_label ?? 'Tax'} rate %`} type="number" min="0" max="100" step="0.001" value={f.tax_rate}
                onChange={(e) => set({ tax_rate: e.target.value as unknown as number })} />
            </div>
            <TotalsPanel items={f.items} discountType={f.discount_type} discountValue={Number(f.discount_value) || 0} taxRate={Number(f.tax_rate) || 0}
              taxLabel={settings?.tax_label ?? 'Tax'} currency={currency} />
            {f.items.some((i) => i.is_optional) && <p className="subtle">Optional add-ons aren’t in the total until the client picks them.</p>}
            {err && <Alert tone="error">{err}</Alert>}
            <Button type="button" size="lg" icon={<Send />} loading={save.isPending && save.variables === true} disabled={save.isPending} onClick={(e) => submit(e, true)}>Save & send to client</Button>
            <Button type="submit" variant="secondary" loading={save.isPending && save.variables === false} disabled={save.isPending}>Save as draft</Button>
          </div>
        </div>
      </div>
    </form>
  );
}

export function EstimateDetailPage() {
  const { id = '' } = useParams();
  const q = useEstimate(id);
  const s = useBillingSettings();
  const ws = useWorkspace();
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidateBilling();
  const docRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<null | 'job' | 'delete'>(null);
  const [when, setWhen] = useState(() => `${addDays(todayIso(), 1)}T09:00`);
  const [duration, setDuration] = useState(180);

  const send = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('send_estimate', { p_estimate: id })),
    onSuccess: () => { invalidate(); toast.success('Estimate sent'); },
    onError: (e) => toast.error(e),
  });
  const toInvoice = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('convert_estimate_to_invoice', { p_estimate: id })) as string,
    onSuccess: (invId) => { invalidate(); toast.success('Invoice created from estimate'); navigate(`/billing/invoices/${invId}`); },
    onError: (e) => toast.error(e),
  });
  const toJob = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('convert_estimate_to_job', { p_estimate: id, p_starts_at: new Date(when).toISOString(), p_duration_minutes: duration })) as string,
    onSuccess: (jobId) => { invalidate(); toast.success('Job booked on the calendar'); navigate(`/jobs/${jobId}`); },
    onError: (e) => toast.error(e),
  });
  const del = useMutation({
    mutationFn: async () => unwrap(await supabase.from('estimates').delete().eq('id', id)),
    onSuccess: () => { invalidate(); navigate('/billing/estimates', { replace: true }); },
    onError: (e) => toast.error(e),
  });

  return (
    <QueryState query={q}>
      {({ estimate: e, activity }) => {
        const currency = s.data?.currency ?? 'USD';
        const answered = !!(e.approved_at || e.declined_at);
        const link = `${window.location.origin}/estimate/${e.public_token}`;
        return (
          <>
            <PageHeader back={{ to: '/billing/estimates', label: 'Estimates' }}
              title={<span className="row wrap" style={{ ['--gap' as string]: '10px' }}>{e.number}<EstimateBadge status={e.status} /></span>}
              sub={e.client?.full_name}
              actions={!answered && (
                <>
                  <ButtonLink to={`/billing/estimates/${e.id}/edit`} variant="secondary" icon={<Pencil />}>Edit</ButtonLink>
                  <Button icon={<Send />} variant={e.sent_at ? 'secondary' : 'primary'} loading={send.isPending} onClick={() => send.mutate()}>{e.sent_at ? 'Resend' : 'Send estimate'}</Button>
                </>
              )} />
            <div className="grid-2-lg">
              <div className="stack" style={{ ['--gap' as string]: '16px' }}>
                <div className="card doc-card" ref={docRef}><DocumentView d={estimateDoc(e, orgOf(ws), s.data)} /></div>
                {e.internal_notes && <div className="callout"><div className="label">Internal notes</div><p className="pre small">{e.internal_notes}</p></div>}
              </div>
              <div className="stack" style={{ ['--gap' as string]: '16px' }}>
                <div className="card card-pad stack">
                  <span className="label">Estimate total</span>
                  <p className="big-money">{money(e.total, currency)}</p>
                  {e.status === 'approved' && <Alert tone="success">Approved {fmtDateTime(e.approved_at!)}{e.client_response ? ` — “${e.client_response}”` : ''}</Alert>}
                  {e.status === 'declined' && <Alert tone="error">Declined {fmtDateTime(e.declined_at!)}{e.client_response ? ` — “${e.client_response}”` : ''}</Alert>}
                  {e.status === 'expired' && <Alert tone="warn">Expired {fmtDay(e.valid_until)}. Edit the valid-until date and resend.</Alert>}
                  {e.sent_at && !answered && <p className="subtle">Sent {fmtDateTime(e.sent_at)}{e.viewed_at ? ` · Viewed ${fmtDateTime(e.viewed_at)}` : ' · Not opened yet'}</p>}
                  {e.status !== 'declined' && (
                    <div className="stack" style={{ ['--gap' as string]: '8px' }}>
                      {e.invoice_id ? <ButtonLink to={`/billing/invoices/${e.invoice_id}`} variant="soft" icon={<Receipt />}>View invoice</ButtonLink>
                        : <Button variant={e.status === 'approved' ? 'primary' : 'secondary'} icon={<Receipt />} loading={toInvoice.isPending} onClick={() => toInvoice.mutate()}>Convert to invoice</Button>}
                      {e.appointment_id ? <ButtonLink to="/calendar" variant="soft" icon={<CalendarPlus />}>Booked — see calendar</ButtonLink>
                        : <Button variant={e.status === 'approved' ? 'primary' : 'secondary'} icon={<CalendarPlus />} onClick={() => setModal('job')}>Convert to job</Button>}
                    </div>
                  )}
                  <div className="grid-2">
                    <PrintButton targetRef={docRef} title={`${e.number} — ${ws.org.name}`} label="Download PDF" size="sm" />
                    {e.sent_at && <Button size="sm" variant="secondary" icon={<Link2 />} onClick={async () => { try { await navigator.clipboard.writeText(link); toast.success('Link copied'); } catch { toast.info(link); } }}>Copy link</Button>}
                  </div>
                  {e.sent_at && <a className="small strong row" style={{ ['--gap' as string]: '4px' }} href={link} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden />Preview what the client sees</a>}
                  {e.status === 'draft' && <Button variant="danger-ghost" size="sm" icon={<Trash2 />} onClick={() => setModal('delete')}>Delete draft</Button>}
                </div>
                <div className="card"><div className="card-header"><h2>Activity</h2></div><ActivityList items={[...activity].reverse()} currency={currency} /></div>
              </div>
            </div>
            <Modal open={modal === 'job'} onClose={() => setModal(null)} title="Book this work" size="sm"
              footer={<><Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button loading={toJob.isPending} onClick={() => toJob.mutate()}>Add to calendar</Button></>}>
              <div className="stack">
                <TextField label="Start" type="datetime-local" value={when} onChange={(ev) => setWhen(ev.target.value)} />
                <SelectField label="Duration" value={duration} onChange={(ev) => setDuration(Number(ev.target.value))}>
                  {[60, 90, 120, 150, 180, 240, 300, 360, 480].map((m) => <option key={m} value={m}>{m / 60} hours</option>)}
                </SelectField>
                <p className="subtle">You can assign the crew and a checklist on the job afterwards.</p>
              </div>
            </Modal>
            <ConfirmDialog open={modal === 'delete'} onClose={() => setModal(null)} danger title="Delete this draft?" confirmLabel="Delete" loading={del.isPending} onConfirm={() => del.mutate()} />
          </>
        );
      }}
    </QueryState>
  );
}
