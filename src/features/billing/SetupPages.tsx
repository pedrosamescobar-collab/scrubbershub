import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CreditCard, Pause, Pencil, Play, Plus, Repeat, Tags, Trash2, XCircle, Zap, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useWorkspace } from '@/auth/AuthProvider';
import {
  FREQUENCY_LABEL, INVOICE_STATUS, METHOD_LABEL, MODE_LABEL, PRICING_LABEL, computeTotals, fmtDay, money, offsetLabel, todayIso,
  type BillingSettings, type Frequency, type LineItem, type PricingType, type RecurringRule, type RuleMode, type ServiceItem,
} from '@/lib/billing';
import type { Appointment } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { SelectField, Switch, TextArea, TextField } from '@/components/ui/Form';
import { Alert, EmptyState, QueryState } from '@/components/ui/Feedback';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Badge, PageHeader } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { useClients } from '@/features/shared/api';
import { BillingNav, LineItemsEditor, MoneyField } from './components';
import { useAutopayMethods, useBillingConfig, useBillingSettings, useCatalog, useInvalidateBilling, useRecurringRules } from './api';
import { useTrade } from '@/features/shared/useTrade';

// ---------------------------------------------------------------- recurring

export function RecurringPage() {
  const ws = useWorkspace();
  const q = useRecurringRules();
  const methods = useAutopayMethods();
  const currency = useBillingSettings().data?.currency ?? 'USD';
  const toast = useToast();
  const invalidate = useInvalidateBilling();
  const [edit, setEdit] = useState<RecurringRule | 'new' | null>(null);
  const [cancel, setCancel] = useState<RecurringRule | null>(null);
  const autopayClients = new Set((methods.data ?? []).filter((m) => m.autopay_enabled).map((m) => m.client_id));

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: RecurringRule['status'] }) =>
      unwrap(await supabase.from('recurring_billing_rules').update({ status }).eq('id', id)),
    onSuccess: (_d, v) => { invalidate(); setCancel(null); toast.success(v.status === 'paused' ? 'Paused' : v.status === 'active' ? 'Resumed' : 'Cancelled'); },
    onError: (e) => toast.error(e),
  });
  const runNow = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('run_recurring_billing', { p_org: ws.org.id })) as number,
    onSuccess: (n) => { invalidate(); toast.success(n ? `${n} invoice${n === 1 ? '' : 's'} generated` : 'Nothing is due today'); },
    onError: (e) => toast.error(e),
  });

  return (
    <>
      <PageHeader title="Recurring billing" sub="Bill repeat clients automatically"
        actions={<><Button variant="secondary" icon={<Zap />} loading={runNow.isPending} onClick={() => runNow.mutate()}>Run due now</Button><Button icon={<Plus />} onClick={() => setEdit('new')}>New rule</Button></>} />
      <BillingNav />
      <p className="muted small mt-16">Rules run automatically every hour once the site is deployed. Each run creates the invoice and, depending on the rule, sends it or charges the client’s saved card.</p>
      <div className="mt-16">
        <QueryState query={q}>
          {(rules) => rules.length === 0 ? (
            <div className="card"><EmptyState icon={<Repeat />} title="No recurring billing yet" action={<Button icon={<Plus />} onClick={() => setEdit('new')}>Create a rule</Button>}>
              For weekly or monthly clients: set the price once and ScrubHub invoices them on schedule.
            </EmptyState></div>
          ) : (
            <div className="grid-auto">
              {rules.map((r) => {
                const amount = computeTotals(r.items ?? [], { discount_type: 'amount', discount_value: 0, tax_rate: 0 }).total;
                return (
                  <div key={r.id} className="card card-pad stack" style={{ ['--gap' as string]: '8px', opacity: r.status === 'cancelled' ? 0.65 : 1 }}>
                    <div className="row-between"><span className="strong truncate">{r.client?.full_name}</span>
                      <Badge tone={r.status === 'active' ? 'green' : r.status === 'paused' ? 'amber' : 'gray'}>{r.status === 'active' ? 'Active' : r.status === 'paused' ? 'Paused' : 'Cancelled'}</Badge></div>
                    <p className="muted small">{r.name}</p>
                    <p className="big-money" style={{ fontSize: 24 }}>{money(amount, currency)} <span className="subtle" style={{ fontSize: 14, fontWeight: 600 }}>+ tax · {FREQUENCY_LABEL[r.frequency]}{r.frequency === 'custom' ? ` (${r.interval_days} days)` : ''}</span></p>
                    <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
                      <dt>Next invoice</dt><dd>{r.status === 'cancelled' ? '—' : fmtDay(r.next_run_date)}</dd>
                      <dt>When it runs</dt><dd>{MODE_LABEL[r.mode].label}</dd>
                      <dt>Auto-pay</dt><dd>{autopayClients.has(r.client_id) ? <span className="row" style={{ ['--gap' as string]: '4px', color: 'var(--green)' }}><CreditCard size={14} aria-hidden />Enabled</span> : <span className="muted">Disabled</span>}</dd>
                      <dt>Last invoice</dt><dd>{r.last_invoice ? <Link to={`/billing/invoices/${r.last_invoice.id}`}>{r.last_invoice.number} · {INVOICE_STATUS[r.last_invoice.status].label}</Link> : '—'}</dd>
                      <dt>Last payment</dt><dd>{r.last_invoice?.paid_at ? fmtDay(r.last_invoice.paid_at) : '—'}</dd>
                    </dl>
                    {r.mode === 'autocharge' && !autopayClients.has(r.client_id) && r.status === 'active' && (
                      <Alert tone="warn">This client hasn’t turned on auto-pay yet, so invoices will be sent but not charged.</Alert>
                    )}
                    {r.status !== 'cancelled' && (
                      <div className="row wrap" style={{ ['--gap' as string]: '6px' }}>
                        <Button size="sm" variant="secondary" icon={<Pencil />} onClick={() => setEdit(r)}>Edit</Button>
                        {r.status === 'active'
                          ? <Button size="sm" variant="secondary" icon={<Pause />} onClick={() => setStatus.mutate({ id: r.id, status: 'paused' })}>Pause</Button>
                          : <Button size="sm" variant="secondary" icon={<Play />} onClick={() => setStatus.mutate({ id: r.id, status: 'active' })}>Resume</Button>}
                        <Button size="sm" variant="danger-ghost" icon={<XCircle />} onClick={() => setCancel(r)}>Cancel</Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </QueryState>
      </div>
      {edit && <RuleEditor rule={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      <ConfirmDialog open={!!cancel} onClose={() => setCancel(null)} danger title="Cancel this recurring billing?" confirmLabel="Cancel rule"
        loading={setStatus.isPending} onConfirm={() => cancel && setStatus.mutate({ id: cancel.id, status: 'cancelled' })}>
        No more invoices will be generated. Invoices already created are not affected.
      </ConfirmDialog>
    </>
  );
}

function RuleEditor({ rule, onClose }: { rule: RecurringRule | null; onClose: () => void }) {
  const tp = useTrade();
  const ws = useWorkspace();
  const toast = useToast();
  const invalidate = useInvalidateBilling();
  const clients = useClients();
  const catalog = useCatalog();
  const currency = useBillingSettings().data?.currency ?? 'USD';
  const [f, setF] = useState({
    client_id: rule?.client_id ?? '', appointment_id: rule?.appointment_id ?? '', name: rule?.name ?? `Recurring ${tp.visit}`,
    frequency: (rule?.frequency ?? 'monthly') as Frequency, interval_days: rule?.interval_days ?? 30,
    next_run_date: rule?.next_run_date ?? todayIso(), end_date: rule?.end_date ?? '', mode: (rule?.mode ?? 'send') as RuleMode,
    items: (rule?.items ?? []) as LineItem[], notes: rule?.notes ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  const appts = useQuery({
    queryKey: ['billing', 'series', ws.org.id, f.client_id],
    enabled: !!f.client_id,
    queryFn: async () => unwrap(await supabase.from('appointments').select('*').eq('org_id', ws.org.id).eq('client_id', f.client_id)
      .neq('recurrence', 'none').order('starts_at', { ascending: false })) as Appointment[],
  });

  const pickAppointment = (id: string) => {
    const a = (appts.data ?? []).find((x) => x.id === id);
    const patch: Partial<typeof f> = { appointment_id: id };
    if (a) {
      const freq: Record<string, Frequency> = { weekly: 'weekly', biweekly: 'biweekly', monthly: 'monthly' };
      patch.frequency = freq[a.recurrence] ?? f.frequency;
      patch.name = a.service_name;
      if (!f.items.length) {
        const svc = (catalog.data ?? []).find((s) => s.name.toLowerCase() === a.service_name.toLowerCase());
        patch.items = [{ service_id: svc?.id ?? null, description: a.service_name, quantity: 1, unit_price: Number(svc?.default_price ?? 0), taxable: svc?.taxable ?? true }];
      }
    }
    setF({ ...f, ...patch });
  };

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        org_id: ws.org.id, client_id: f.client_id, appointment_id: f.appointment_id || null, name: f.name.trim() || `Recurring ${tp.visit}`,
        frequency: f.frequency, interval_days: f.frequency === 'custom' ? Number(f.interval_days) || 30 : null,
        next_run_date: f.next_run_date, end_date: f.end_date || null, mode: f.mode, notes: f.notes.trim() || null,
        items: f.items.filter((i) => i.description.trim()).map((i) => ({ service_id: i.service_id ?? null, description: i.description, quantity: Number(i.quantity) || 1, unit_price: Number(i.unit_price) || 0, taxable: i.taxable })),
      };
      if (rule) unwrap(await supabase.from('recurring_billing_rules').update(row).eq('id', rule.id));
      else unwrap(await supabase.from('recurring_billing_rules').insert(row));
    },
    onSuccess: () => { invalidate(); toast.success(rule ? 'Rule updated' : 'Recurring billing created'); onClose(); },
    onError: (e) => toast.error(e),
  });
  const submit = () => {
    if (!f.client_id) return setErr('Choose a client');
    if (!f.items.some((i) => i.description.trim())) return setErr('Add what to bill');
    if (f.end_date && f.end_date < f.next_run_date) return setErr('End date must be after the first invoice date');
    setErr(null);
    save.mutate();
  };

  return (
    <Modal open onClose={onClose} title={rule ? 'Edit recurring billing' : 'New recurring billing'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={submit}>Save</Button></>}>
      <div className="stack">
        <div className="form-grid two">
          <SelectField className="span-2" label="Client" value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value, appointment_id: '' })} disabled={!!rule}>
            <option value="">Choose a client…</option>
            {(clients.data ?? []).filter((c) => c.status === 'active' || c.id === f.client_id).map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </SelectField>
          {f.client_id && (
            <SelectField className="span-2" label={`Linked recurring ${tp.visit} (optional)`} value={f.appointment_id} onChange={(e) => pickAppointment(e.target.value)}
              hint={(appts.data ?? []).length ? 'Fills in the service and schedule' : `This client has no recurring ${tp.visits} scheduled`}>
              <option value="">Not linked</option>
              {(appts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.service_name} · {a.recurrence} from {fmtDay(a.starts_at.slice(0, 10))}</option>)}
            </SelectField>
          )}
          <TextField className="span-2" label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <SelectField label="How often" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Frequency })}>
            {Object.entries(FREQUENCY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectField>
          {f.frequency === 'custom'
            ? <TextField label="Every … days" type="number" min="1" max="365" value={f.interval_days} onChange={(e) => setF({ ...f, interval_days: Number(e.target.value) })} />
            : <span />}
          <TextField label="Next invoice date" type="date" value={f.next_run_date} onChange={(e) => setF({ ...f, next_run_date: e.target.value })} />
          <TextField label="End date (optional)" type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} />
        </div>
        <div className="stack" role="radiogroup" aria-label="What happens each time">
          <span className="label">Each time it runs</span>
          {(Object.keys(MODE_LABEL) as RuleMode[]).map((m) => (
            <button key={m} type="button" role="radio" className="option-card" aria-checked={f.mode === m} onClick={() => setF({ ...f, mode: m })}>
              <span><span className="strong">{MODE_LABEL[m].label}</span><span className="muted small" style={{ display: 'block' }}>{MODE_LABEL[m].hint}</span></span>
            </button>
          ))}
        </div>
        <span className="label">What to bill</span>
        <LineItemsEditor items={f.items} onChange={(items) => setF({ ...f, items })} catalog={catalog.data ?? []} currency={currency} />
        <TextArea label="Invoice note (optional)" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} style={{ minHeight: 60 }} />
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- catalog

export function CatalogPage() {
  const q = useCatalog();
  const currency = useBillingSettings().data?.currency ?? 'USD';
  const [edit, setEdit] = useState<ServiceItem | 'new' | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  return (
    <>
      <PageHeader title="Products & Services" sub="Your price list — tap to add to any invoice or estimate" actions={<Button icon={<Plus />} onClick={() => setEdit('new')}>New service</Button>} />
      <BillingNav />
      <div className="row-between mt-16"><span className="muted small">The starter services are just examples — rename, re-price or deactivate them.</span>
        <label className="row small" style={{ ['--gap' as string]: '6px' }}><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show inactive</label></div>
      <div className="mt-16">
        <QueryState query={q}>
          {(list) => {
            const rows = list.filter((s) => showInactive || s.is_active);
            return rows.length === 0 ? <div className="card"><EmptyState icon={<Tags />} title="No services yet" action={<Button icon={<Plus />} onClick={() => setEdit('new')}>Add a service</Button>} /></div> : (
              <div className="card list">
                {rows.map((s) => (
                  <button key={s.id} type="button" className="list-item" onClick={() => setEdit(s)} style={{ opacity: s.is_active ? 1 : 0.6 }}>
                    <span className="grow">
                      <span className="row" style={{ ['--gap' as string]: '8px' }}><span className="strong">{s.name}</span>{!s.is_active && <Badge tone="gray">Inactive</Badge>}</span>
                      <span className="muted small" style={{ display: 'block' }}>{PRICING_LABEL[s.pricing_type]}{s.unit_label ? ` · per ${s.unit_label}` : ''}{s.taxable ? '' : ' · not taxed'}{s.description ? ` · ${s.description}` : ''}</span>
                    </span>
                    <span className="strong">{money(s.default_price, currency)}</span>
                  </button>
                ))}
              </div>
            );
          }}
        </QueryState>
      </div>
      {edit && <ServiceEditor item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function ServiceEditor({ item, onClose }: { item: ServiceItem | null; onClose: () => void }) {
  const tp = useTrade();
  const ws = useWorkspace();
  const toast = useToast();
  const invalidate = useInvalidateBilling();
  const currency = useBillingSettings().data?.currency ?? 'USD';
  const [f, setF] = useState({
    name: item?.name ?? '', description: item?.description ?? '', default_price: String(item?.default_price ?? ''),
    pricing_type: (item?.pricing_type ?? 'flat') as PricingType, unit_label: item?.unit_label ?? '', taxable: item?.taxable ?? true, is_active: item?.is_active ?? true,
  });
  const [confirmDel, setConfirmDel] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      const row = { org_id: ws.org.id, name: f.name.trim(), description: f.description.trim() || null, default_price: Number(f.default_price) || 0,
        pricing_type: f.pricing_type, unit_label: f.unit_label.trim() || null, taxable: f.taxable, is_active: f.is_active };
      if (item) unwrap(await supabase.from('service_catalog').update(row).eq('id', item.id));
      else unwrap(await supabase.from('service_catalog').insert(row));
    },
    onSuccess: () => { invalidate(); toast.success('Saved'); onClose(); },
    onError: (e) => toast.error(e),
  });
  const del = useMutation({
    mutationFn: async () => unwrap(await supabase.from('service_catalog').delete().eq('id', item!.id)),
    onSuccess: () => { invalidate(); toast.success('Service deleted'); onClose(); },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open onClose={onClose} title={item ? 'Edit service' : 'New service'}
      footer={<>{item && <Button variant="danger-ghost" icon={<Trash2 />} onClick={() => setConfirmDel(true)}>Delete</Button>}<span className="grow" />
        <Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="form-grid two">
        <TextField className="span-2" label="Service name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={tp.catalogPlaceholder} />
        <TextArea className="span-2" label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={{ minHeight: 60 }} />
        <MoneyField label="Default price" currency={currency} value={f.default_price} onChange={(v) => setF({ ...f, default_price: v })} />
        <SelectField label="Pricing type" value={f.pricing_type} onChange={(e) => setF({ ...f, pricing_type: e.target.value as PricingType })}>
          {Object.entries(PRICING_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </SelectField>
        {f.pricing_type !== 'flat' && f.pricing_type !== 'custom' && (
          <TextField className="span-2" label="Unit" placeholder={f.pricing_type === 'hourly' ? 'hour' : f.pricing_type === 'per_room' ? 'room' : 'item'}
            value={f.unit_label} onChange={(e) => setF({ ...f, unit_label: e.target.value })} />
        )}
        <div className="span-2">
          <Switch label="Taxable" description="Apply sales tax when this is on an invoice" checked={f.taxable} onChange={(v) => setF({ ...f, taxable: v })} />
          <Switch label="Active" description="Inactive services are hidden when building invoices" checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} />
        </div>
      </div>
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} danger title="Delete this service?" confirmLabel="Delete" loading={del.isPending} onConfirm={() => del.mutate()}>
        Existing invoices keep their line items. To just hide it, turn off “Active” instead.
      </ConfirmDialog>
    </Modal>
  );
}

// ---------------------------------------------------------------- settings

const OFFSETS = [-7, -3, -1, 0, 1, 3, 7, 14, 30];
const CHANNELS: { k: string; label: string; hint?: string; disabled?: boolean }[] = [
  { k: 'email', label: 'Email' }, { k: 'sms', label: 'Text message', hint: 'needs Twilio keys' }, { k: 'in_app', label: 'In-app' }, { k: 'push', label: 'Push', hint: 'coming soon', disabled: true },
];

export function BillingSettingsPage() {
  const q = useBillingSettings();
  return <QueryState query={q}>{(s) => s ? <SettingsForm s={s} /> : <Alert tone="error">Billing isn’t set up for this company yet. Run the 0002_billing.sql migration in Supabase.</Alert>}</QueryState>;
}

function SettingsForm({ s }: { s: BillingSettings }) {
  const tp = useTrade();
  const toast = useToast();
  const invalidate = useInvalidateBilling();
  const config = useBillingConfig();
  const [f, setF] = useState(() => ({ ...s, tip_presets_text: (s.tip_presets ?? []).join(', ') }));
  useEffect(() => { setF({ ...s, tip_presets_text: (s.tip_presets ?? []).join(', ') }); }, [s]);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const toggle = (key: 'accepted_methods' | 'reminder_channels', v: string) =>
    set({ [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] } as Partial<typeof f>);
  const toggleOffset = (o: number) => set({ reminder_offsets: f.reminder_offsets.includes(o) ? f.reminder_offsets.filter((x) => x !== o) : [...f.reminder_offsets, o].sort((a, b) => a - b) });

  const save = useMutation({
    mutationFn: async () => {
      const tips = f.tip_presets_text.split(/[,\s]+/).map(Number).filter((n) => n > 0 && n <= 100).slice(0, 4);
      unwrap(await supabase.from('billing_settings').update({
        currency: f.currency.toUpperCase().slice(0, 3), tax_rate: Number(f.tax_rate) || 0, tax_label: f.tax_label.trim() || 'Tax',
        payment_terms_days: Number(f.payment_terms_days) || 0, invoice_prefix: f.invoice_prefix, next_invoice_number: Math.max(1, Number(f.next_invoice_number) || 1),
        estimate_prefix: f.estimate_prefix, next_estimate_number: Math.max(1, Number(f.next_estimate_number) || 1), estimate_valid_days: Number(f.estimate_valid_days) || 30,
        default_invoice_notes: f.default_invoice_notes?.trim() || null, default_terms: f.default_terms?.trim() || null,
        payment_instructions: f.payment_instructions?.trim() || null, accepted_methods: f.accepted_methods,
        tips_enabled: f.tips_enabled, tip_presets: tips.length ? tips : [15, 20, 25], autopay_enabled: f.autopay_enabled,
        reminders_enabled: f.reminders_enabled, reminder_offsets: f.reminder_offsets, reminder_channels: f.reminder_channels,
        send_receipts: f.send_receipts, receipt_message: f.receipt_message?.trim() || null,
        urgent_fee: Math.max(0, Number(f.urgent_fee) || 0), emergency_fee: Math.max(0, Number(f.emergency_fee) || 0),
      }).eq('org_id', s.org_id));
    },
    onSuccess: () => { invalidate(); toast.success('Billing settings saved'); },
    onError: (e) => toast.error(e),
  });

  const webhookUrl = `${window.location.origin}/.netlify/functions/stripe-webhook`;
  const preview = useMemo(() => `${f.invoice_prefix}${f.next_invoice_number}, ${f.invoice_prefix}${Number(f.next_invoice_number) + 1}, ${f.invoice_prefix}${Number(f.next_invoice_number) + 2}`, [f.invoice_prefix, f.next_invoice_number]);

  return (
    <>
      <PageHeader title="Billing settings" />
      <BillingNav />
      <form className="stack mt-16" style={{ ['--gap' as string]: '16px', maxWidth: 780 }} onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="card card-pad stack">
          <h2>Online payments</h2>
          {config.data?.online_payments ? (
            <Alert tone="success"><span className="row" style={{ ['--gap' as string]: '6px' }}><CheckCircle2 size={16} aria-hidden />Card &amp; bank payments are on (Stripe).</span>
              {!config.data.webhook_configured && <> Add <code>STRIPE_WEBHOOK_SECRET</code> so payments are recorded automatically.</>}</Alert>
          ) : (
            <Alert tone="warn"><span className="row" style={{ ['--gap' as string]: '6px' }}><AlertTriangle size={16} aria-hidden /><strong>Not connected yet.</strong></span>
              Clients can still see invoices and pay you by cash, check or bank transfer — you record those payments yourself.</Alert>
          )}
          <details>
            <summary className="strong" style={{ cursor: 'pointer' }}>How to turn on card payments (about 10 minutes)</summary>
            <ol className="small muted" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
              <li>Create a free account at <a href="https://dashboard.stripe.com/register" target="_blank" rel="noreferrer">stripe.com</a>.</li>
              <li>In Stripe → Developers → API keys, copy the <strong>Secret key</strong>.</li>
              <li>In Netlify → Site configuration → Environment variables, add <code>STRIPE_SECRET_KEY</code> with that key.</li>
              <li>In Stripe → Developers → Webhooks, add an endpoint: <code style={{ wordBreak: 'break-all' }}>{webhookUrl}</code> with events <code>payment_intent.succeeded</code>, <code>payment_intent.payment_failed</code>, <code>checkout.session.completed</code>, <code>charge.refunded</code>.</li>
              <li>Copy the webhook’s <strong>Signing secret</strong> into Netlify as <code>STRIPE_WEBHOOK_SECRET</code>, then redeploy.</li>
            </ol>
          </details>
          <p className="subtle">Card numbers never touch ScrubHub — clients pay on Stripe’s secure page. {s.stripe_account_id ? <>Payouts go to your connected Stripe account <code>{s.stripe_account_id}</code>.</> : 'Payouts go to the Stripe account whose key is configured.'}</p>
        </div>

        <div className="card card-pad stack">
          <h2>Invoices</h2>
          <div className="form-grid two">
            <TextField label="Currency" value={f.currency} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} hint="3-letter code, e.g. USD" />
            <SelectField label="Default payment terms" value={f.payment_terms_days} onChange={(e) => set({ payment_terms_days: Number(e.target.value) })}>
              {[0, 7, 10, 14, 15, 30, 45, 60].map((d) => <option key={d} value={d}>{d === 0 ? 'Due on receipt' : `Net ${d} (due in ${d} days)`}</option>)}
            </SelectField>
            <TextField label="Invoice prefix" value={f.invoice_prefix} maxLength={12} onChange={(e) => set({ invoice_prefix: e.target.value })} />
            <TextField label="Next invoice number" type="number" min="1" value={f.next_invoice_number} onChange={(e) => set({ next_invoice_number: Number(e.target.value) })} hint={`Next: ${preview}`} />
            <TextField label="Estimate prefix" value={f.estimate_prefix} maxLength={12} onChange={(e) => set({ estimate_prefix: e.target.value })} />
            <TextField label="Estimates valid for (days)" type="number" min="1" max="365" value={f.estimate_valid_days} onChange={(e) => set({ estimate_valid_days: Number(e.target.value) })} />
            <TextArea className="span-2" label="Default invoice notes" value={f.default_invoice_notes ?? ''} onChange={(e) => set({ default_invoice_notes: e.target.value })} style={{ minHeight: 60 }} />
            <TextArea className="span-2" label="Default terms" value={f.default_terms ?? ''} onChange={(e) => set({ default_terms: e.target.value })} style={{ minHeight: 60 }}
              placeholder="e.g. Payment due within 14 days. A $25 fee applies to lockouts." />
            <TextArea className="span-2" label="Payment instructions" value={f.payment_instructions ?? ''} onChange={(e) => set({ payment_instructions: e.target.value })} style={{ minHeight: 60 }}
              placeholder="e.g. Pay online with the button above, or Zelle 555-0100, or checks payable to Sparkle Co." hint="Printed on every invoice" />
          </div>
        </div>

        <div className="card card-pad stack">
          <h2>Tax</h2>
          <div className="form-grid two">
            <TextField label="Tax name" value={f.tax_label} onChange={(e) => set({ tax_label: e.target.value })} />
            <TextField label="Default tax rate %" type="number" min="0" max="100" step="0.001" value={f.tax_rate} onChange={(e) => set({ tax_rate: e.target.value as unknown as number })}
              hint="Use 0 if your services aren’t taxed. Each service can also be marked non-taxable." />
          </div>
        </div>

        {(tp.features.priority || Number(f.urgent_fee) > 0 || Number(f.emergency_fee) > 0) && (
          <div className="card card-pad stack">
            <h2>Urgent & emergency jobs</h2>
            <p className="muted small">Added as a line on the invoice when you create it from a job flagged urgent or emergency. Leave at 0 to skip.</p>
            <div className="form-grid two">
              <TextField label="Urgent fee ($)" type="number" min="0" step="0.01" value={f.urgent_fee ?? 0} onChange={(e) => set({ urgent_fee: e.target.value as unknown as number })} />
              <TextField label="Emergency / after-hours fee ($)" type="number" min="0" step="0.01" value={f.emergency_fee ?? 0} onChange={(e) => set({ emergency_fee: e.target.value as unknown as number })} />
            </div>
          </div>
        )}

        <div className="card card-pad stack">
          <h2>Payments</h2>
          <span className="label">Accepted payment methods</span>
          <div className="chips">{Object.entries(METHOD_LABEL).map(([k, v]) => <button key={k} type="button" className="chip" aria-pressed={f.accepted_methods.includes(k)} onClick={() => toggle('accepted_methods', k)}>{v}</button>)}</div>
          <Switch label="Allow tips" description="Clients can add a tip when paying online. Tips are kept separate from the service total." checked={f.tips_enabled} onChange={(v) => set({ tips_enabled: v })} />
          {f.tips_enabled && <TextField label="Suggested tip %" value={f.tip_presets_text} onChange={(e) => set({ tip_presets_text: e.target.value })} hint="Up to 4, comma separated — e.g. 15, 20, 25" />}
          <Switch label="Offer auto-pay" description="Clients can save a card to pay recurring invoices automatically" checked={f.autopay_enabled} onChange={(v) => set({ autopay_enabled: v })} />
          <Switch label="Send receipts automatically" checked={f.send_receipts} onChange={(v) => set({ send_receipts: v })} />
          {f.send_receipts && <TextField label="Receipt message" value={f.receipt_message ?? ''} onChange={(e) => set({ receipt_message: e.target.value })} />}
        </div>

        <div className="card card-pad stack">
          <h2>Payment reminders</h2>
          <Switch label="Send automatic reminders" description="For unpaid invoices that have been sent" checked={f.reminders_enabled} onChange={(v) => set({ reminders_enabled: v })} />
          {f.reminders_enabled && (
            <>
              <span className="label">When</span>
              <div className="chips">{OFFSETS.map((o) => <button key={o} type="button" className="chip" aria-pressed={f.reminder_offsets.includes(o)} onClick={() => toggleOffset(o)}>{offsetLabel(o)}</button>)}</div>
              <span className="label">How</span>
              <div className="chips">{CHANNELS.map((c) => <button key={c.k} type="button" className="chip" disabled={c.disabled} aria-pressed={f.reminder_channels.includes(c.k)} onClick={() => toggle('reminder_channels', c.k)}>{c.label}{c.hint ? ` (${c.hint})` : ''}</button>)}</div>
              <p className="subtle">Email and text delivery also follow the switches under <Link to="/settings">Company settings → Operations</Link>. The office is alerted once when an invoice becomes overdue.</p>
            </>
          )}
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="submit" size="lg" loading={save.isPending}>Save billing settings</Button></div>
      </form>
    </>
  );
}
