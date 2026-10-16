import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCopy, Minus, PackagePlus, Plus, Share2, Undo2 } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth, useWorkspace } from '@/auth/AuthProvider';
import type { InventoryItem, InventoryMovement, Job } from '@/lib/types';
import { fmtAgo, fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { SelectField, Switch, TextArea, TextField } from '@/components/ui/Form';
import { Alert, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import { Badge, Segmented } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { useEmployees } from '@/features/shared/api';
import {
  categoriesFor, MOVEMENT_META, UNITS, fmtQty, fmtStock, money, recordMovement, setCount, stockLevel, suggestedOrder,
  undoMovement, unitLabel, useInvalidateInventory, useInventoryItems, useJobSupplies,
} from './api';

// ---------------------------------------------------------------------------
export function StockBadge({ item }: { item: Pick<InventoryItem, 'quantity' | 'reorder_level'> }) {
  const s = stockLevel(item);
  if (s === 'out') return <Badge tone="red">Out</Badge>;
  if (s === 'low') return <Badge tone="amber">Low</Badge>;
  return null;
}

function QtyStepper({ value, onChange, label, hint, error }: { value: string; onChange: (v: string) => void; label: string; hint?: string; error?: string | null }) {
  const n = Number(value) || 0;
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="row" style={{ ['--gap' as string]: '8px' }}>
        <Button variant="secondary" iconOnly aria-label="Less" icon={<Minus />} onClick={() => onChange(String(Math.max(0, n - 1)))} />
        <input className="input center" style={{ maxWidth: 120, fontSize: 18, fontWeight: 700 }} inputMode="decimal" aria-label={label}
          value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))} />
        <Button variant="secondary" iconOnly aria-label="More" icon={<Plus />} onClick={() => onChange(String(n + 1))} />
      </div>
      {error ? <span className="error-text" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
/** Add / edit an item. */
export function ItemModal({ open, onClose, item, onSaved }: { open: boolean; onClose: () => void; item?: InventoryItem | null; onSaved?: (it: InventoryItem) => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const invalidate = useInvalidateInventory();
  const employees = useEmployees();
  const cats = categoriesFor(ws.org.trade);
  const blank = { name: '', category: cats[0], unit: ws.org.trade === 'plumbing' ? 'each' : 'bottle', billable: ws.org.trade === 'plumbing', sell_price: '', quantity: '0', reorder_level: '0', reorder_quantity: '', unit_cost: '', supplier: '', sku: '', location: '', assigned_employee_id: '', notes: '' };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF(item ? {
      name: item.name, category: item.category, unit: item.unit, quantity: fmtQty(item.quantity), reorder_level: fmtQty(item.reorder_level),
      reorder_quantity: item.reorder_quantity ? fmtQty(item.reorder_quantity) : '', unit_cost: item.unit_cost != null ? String(item.unit_cost) : '',
      supplier: item.supplier ?? '', sku: item.sku ?? '', location: item.location ?? '', assigned_employee_id: item.assigned_employee_id ?? '', notes: item.notes ?? '',
      billable: !!item.billable, sell_price: item.sell_price != null ? String(item.sell_price) : '',
    } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);
  const set = (k: Exclude<keyof typeof f, 'billable'>) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        name: f.name.trim(), category: f.category.trim() || 'Other', unit: f.unit.trim() || 'each',
        reorder_level: Number(f.reorder_level) || 0,
        reorder_quantity: f.reorder_quantity ? Number(f.reorder_quantity) : null,
        unit_cost: f.unit_cost !== '' ? Number(f.unit_cost) : null,
        supplier: f.supplier.trim() || null, sku: f.sku.trim() || null, location: f.location.trim() || null,
        assigned_employee_id: f.assigned_employee_id || null, notes: f.notes.trim() || null,
        billable: f.billable, sell_price: f.sell_price !== '' ? Number(f.sell_price) : null,
      };
      if (item) return unwrap(await supabase.from('inventory_items').update(row).eq('id', item.id).select().single()) as InventoryItem;
      return unwrap(await supabase.from('inventory_items').insert({ ...row, org_id: ws.org.id, quantity: Number(f.quantity) || 0 }).select().single()) as InventoryItem;
    },
    onSuccess: (it) => { invalidate(); toast.success(item ? 'Item updated' : 'Item added'); onSaved?.(it); onClose(); },
    onError: (e) => toast.error(e),
  });

  const submit = () => {
    if (!f.name.trim()) return setErr('Name is required');
    if (f.unit_cost !== '' && Number.isNaN(Number(f.unit_cost))) return setErr('Unit cost must be a number');
    if (f.sell_price !== '' && Number.isNaN(Number(f.sell_price))) return setErr('Client price must be a number');
    setErr(null);
    save.mutate();
  };

  return (
    <Modal open={open} onClose={onClose} title={item ? 'Edit item' : 'Add item'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={save.isPending}>{item ? 'Save' : 'Add item'}</Button></>}>
      <form className="form-grid two" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <TextField className="span-2" label="Item name" placeholder={ws.org.trade === 'plumbing' ? 'e.g. 1/2" PEX elbow' : 'e.g. All-purpose cleaner'} value={f.name} onChange={set('name')} error={err} autoFocus />
        <TextField label="Category" list="inv-cats" value={f.category} onChange={set('category')} />
        <TextField label="Counted in" list="inv-units" hint="bottle, box, roll, each…" value={f.unit} onChange={set('unit')} />
        {!item && <TextField label="On hand now" inputMode="decimal" value={f.quantity} onChange={set('quantity')} />}
        <TextField label="Reorder when at or below" inputMode="decimal" hint="0 = don’t alert" value={f.reorder_level} onChange={set('reorder_level')} />
        <TextField label="Usually order" inputMode="decimal" placeholder="Optional" value={f.reorder_quantity} onChange={set('reorder_quantity')} />
        <TextField label="Cost per unit ($)" inputMode="decimal" placeholder="Optional" value={f.unit_cost} onChange={set('unit_cost')} />
        <div className="span-2">
          <Switch label="Charge the client when used on a job" description="Added to the job’s invoice at the client price"
            checked={f.billable} onChange={(v) => setF((x) => ({ ...x, billable: v }))} />
        </div>
        {f.billable && <TextField label="Client price per unit ($)" inputMode="decimal" placeholder="What you charge" value={f.sell_price} onChange={set('sell_price')}
          hint={f.unit_cost && f.sell_price ? `Markup ${Math.round(((Number(f.sell_price) - Number(f.unit_cost)) / Math.max(Number(f.unit_cost), 0.01)) * 100)}%` : undefined} />}
        <TextField label="Supplier" placeholder="Optional" value={f.supplier} onChange={set('supplier')} />
        <TextField label="SKU / product #" placeholder="Optional" value={f.sku} onChange={set('sku')} />
        <TextField label="Stored at" placeholder="Garage shelf, van 1…" value={f.location} onChange={set('location')} />
        <SelectField label="Assigned to" hint="For equipment a crew member keeps" value={f.assigned_employee_id} onChange={set('assigned_employee_id')}>
          <option value="">No one</option>
          {(employees.data ?? []).filter((e) => e.status === 'active' || e.id === f.assigned_employee_id).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </SelectField>
        <TextArea className="span-2" label="Notes" value={f.notes} onChange={set('notes')} style={{ minHeight: 70 }} />
        <button type="submit" hidden />
      </form>
      <datalist id="inv-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="inv-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
type Kind = 'restock' | 'use' | 'waste';

/** Restock / use / waste. Pass `item` to lock the item, `job` to attach it to a job. */
export function MovementModal({
  open, onClose, item, kind: initialKind = 'use', job, allowed = ['restock', 'use', 'waste'],
}: { open: boolean; onClose: () => void; item?: InventoryItem | null; kind?: Kind; job?: Pick<Job, 'id' | 'service_name'> | null; allowed?: Kind[] }) {
  const ws = useWorkspace();
  const toast = useToast();
  const invalidate = useInvalidateInventory();
  const items = useInventoryItems();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('1');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind(allowed.includes(initialKind) ? initialKind : allowed[0]);
    setItemId(item?.id ?? '');
    setQty(initialKind === 'restock' && item ? String(suggestedOrder(item)) : '1');
    setCost(item?.unit_cost != null ? String(item.unit_cost) : '');
    setNote('');
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item, initialKind]);

  const selected = item ?? (items.data ?? []).find((i) => i.id === itemId) ?? null;
  useEffect(() => { if (!item && selected) setCost(selected.unit_cost != null ? String(selected.unit_cost) : ''); }, [item, selected]);

  const save = useMutation({
    mutationFn: async () => recordMovement({
      item: selected!.id, kind, quantity: Number(qty), job: job?.id ?? null, note,
      unitCost: kind === 'restock' && cost !== '' ? Number(cost) : null,
    }),
    onSuccess: () => {
      invalidate();
      toast.success(kind === 'restock' ? `Restocked ${fmtStock(qty, selected!.unit)}` : `Logged ${fmtStock(qty, selected!.unit)} of ${selected!.name}`);
      onClose();
    },
    onError: (e) => toast.error(e),
  });

  const submit = () => {
    if (!selected) return setErr('Choose an item');
    if (!(Number(qty) > 0)) return setErr('Enter a quantity greater than zero');
    setErr(null);
    save.mutate();
  };

  const title = job ? (ws.org.trade === 'plumbing' ? 'Log parts used' : 'Log supplies used') : kind === 'restock' ? 'Restock' : kind === 'use' ? 'Use supplies' : 'Record waste or damage';
  const grouped = useMemo(() => {
    const m = new Map<string, InventoryItem[]>();
    for (const i of items.data ?? []) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items.data]);

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={save.isPending}>Save</Button></>}>
      <form className="stack" style={{ ['--gap' as string]: '14px' }} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {job && <p className="muted small">For {job.service_name}. This comes out of stock right away.</p>}
        {allowed.length > 1 && (
          <Segmented block label="Action" value={kind} onChange={setKind}
            options={allowed.map((k) => ({ value: k, label: k === 'restock' ? 'Restock' : k === 'use' ? 'Used' : 'Waste' }))} />
        )}
        {item ? (
          <div className="row-between"><span className="strong">{item.name}</span><span className="muted small">{fmtStock(item.quantity, item.unit)} on hand</span></div>
        ) : (
          <SelectField label="Item" value={itemId} onChange={(e) => setItemId(e.target.value)} error={!selected && err ? err : null}>
            <option value="">Choose…</option>
            {grouped.map(([cat, list]) => (
              <optgroup key={cat} label={cat}>
                {list.map((i) => <option key={i.id} value={i.id}>{i.name} ({fmtStock(i.quantity, i.unit)})</option>)}
              </optgroup>
            ))}
          </SelectField>
        )}
        <QtyStepper label={selected ? `How many ${unitLabel(selected.unit, 2)}?` : 'Quantity'} value={qty} onChange={setQty}
          error={selected && err ? err : null}
          hint={selected && kind !== 'restock' ? `${fmtStock(selected.quantity, selected.unit)} on hand` : undefined} />
        {kind === 'restock' && <TextField label="Cost per unit ($)" inputMode="decimal" placeholder="Optional" value={cost} onChange={(e) => setCost(e.target.value)}
          hint={cost && Number(qty) > 0 ? `Total ${money(Number(cost) * Number(qty))}` : undefined} />}
        <TextField label="Note" placeholder={kind === 'restock' ? 'Where you bought it, order #…' : kind === 'waste' ? 'What happened?' : 'Optional'} value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
export function CountModal({ open, onClose, item }: { open: boolean; onClose: () => void; item: InventoryItem }) {
  const toast = useToast();
  const invalidate = useInvalidateInventory();
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setQty(fmtQty(item.quantity)); setNote(''); } }, [open, item]);
  const diff = Number(qty) - Number(item.quantity);
  const save = useMutation({
    mutationFn: async () => setCount(item.id, Number(qty), note),
    onSuccess: () => { invalidate(); toast.success('Count saved'); onClose(); },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open={open} onClose={onClose} title={`Count ${item.name}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} disabled={qty === '' || diff === 0} loading={save.isPending}>Save count</Button></>}>
      <div className="stack" style={{ ['--gap' as string]: '14px' }}>
        <p className="muted small">Enter what’s actually on the shelf. The difference is recorded in the history.</p>
        <QtyStepper label={`${unitLabel(item.unit, 2)} counted`} value={qty} onChange={setQty}
          hint={qty !== '' && diff !== 0 ? `${diff > 0 ? '+' : ''}${fmtQty(diff)} vs. the ${fmtQty(item.quantity)} on record` : 'Matches what’s on record'} />
        <TextField label="Note" placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
export function ReorderModal({ open, onClose, items }: { open: boolean; onClose: () => void; items: InventoryItem[] }) {
  const ws = useWorkspace();
  const toast = useToast();
  const list = items.filter((i) => !i.is_archived && stockLevel(i) !== 'ok' && (Number(i.reorder_level) > 0 || Number(i.quantity) <= 0));
  const total = list.reduce((s, i) => s + suggestedOrder(i) * Number(i.unit_cost ?? 0), 0);
  const missingCost = list.some((i) => i.unit_cost == null);
  const text = [
    `${ws.org.name} — supply order (${fmtDate(new Date())})`,
    '',
    ...list.map((i) => `• ${i.name}: ${fmtStock(suggestedOrder(i), i.unit)}${i.supplier ? ` (${i.supplier})` : ''}${i.sku ? ` #${i.sku}` : ''}`),
    ...(total > 0 ? ['', `Estimated total: ${money(total)}`] : []),
  ].join('\n');
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.success('Shopping list copied'); } catch { toast.error('Couldn’t copy — select the list and copy it manually.'); }
  };
  const share = async () => { try { await navigator.share({ title: 'Supply order', text }); } catch { /* cancelled */ } };
  return (
    <Modal open={open} onClose={onClose} title="Reorder list"
      footer={list.length ? <>
        {typeof navigator !== 'undefined' && 'share' in navigator && <Button variant="secondary" icon={<Share2 />} onClick={share}>Share</Button>}
        <Button icon={<ClipboardCopy />} onClick={copy}>Copy list</Button>
      </> : undefined}>
      {list.length === 0 ? (
        <EmptyState icon={<PackagePlus />} title="Nothing to reorder">Items show up here when they drop to their reorder level.</EmptyState>
      ) : (
        <div className="stack">
          <div className="card list">
            {list.map((i) => (
              <div key={i.id} className="list-item" style={{ minHeight: 56 }}>
                <span className="grow">
                  <span className="strong">{i.name}</span>
                  <span className="muted small" style={{ display: 'block' }}>{fmtStock(i.quantity, i.unit)} left{i.supplier ? ` · ${i.supplier}` : ''}</span>
                </span>
                <span className="center">
                  <span className="strong" style={{ display: 'block' }}>Order {fmtStock(suggestedOrder(i), i.unit)}</span>
                  {i.unit_cost != null && <span className="subtle">{money(suggestedOrder(i) * Number(i.unit_cost))}</span>}
                </span>
              </div>
            ))}
          </div>
          {total > 0 && <p className="row-between strong"><span>Estimated total</span><span>{money(total)}{missingCost ? '+' : ''}</span></p>}
          {missingCost && <p className="subtle">Add a cost per unit to items to include them in the estimate.</p>}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
export function MovementRow({ m, showItem, showJob, canUndo, onUndo, undoing }: {
  m: InventoryMovement; showItem?: boolean; showJob?: boolean; canUndo?: boolean; onUndo?: () => void; undoing?: boolean;
}) {
  const meta = MOVEMENT_META[m.kind];
  const change = Number(m.quantity_change);
  const unit = m.item?.unit ?? '';
  const cost = m.unit_cost != null ? Math.abs(change) * Number(m.unit_cost) : null;
  return (
    <div className="list-item" style={{ alignItems: 'flex-start', opacity: m.undone_at ? 0.55 : 1 }}>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="row wrap" style={{ ['--gap' as string]: '8px' }}>
          <span className="strong">{showItem && m.item ? m.item.name : m.reverses_id ? 'Undo' : meta.label}</span>
          {showItem && <Badge tone={meta.tone} dot={false}>{m.reverses_id ? 'Undo' : meta.label}</Badge>}
          {m.undone_at && <Badge tone="gray" dot={false}>Undone</Badge>}
        </span>
        <span className="muted small" style={{ display: 'block' }}>
          {m.created_by_name ?? 'Someone'} · {fmtAgo(m.created_at)}
          {showJob && m.job && <> · <Link to={`/jobs/${m.job.id}`}>{m.job.client?.full_name ?? m.job.service_name}, {fmtDate(m.job.scheduled_start)}</Link></>}
        </span>
        {m.note && <span className="small pre" style={{ display: 'block', marginTop: 2 }}>{m.note}</span>}
      </span>
      <span style={{ textAlign: 'right' }}>
        <span className="strong" style={{ display: 'block', color: change > 0 ? 'var(--green)' : 'var(--text)' }}>
          {change > 0 ? '+' : '−'}{fmtQty(Math.abs(change))}{unit ? ` ${unitLabel(unit, Math.abs(change))}` : ''}
        </span>
        <span className="subtle">{cost ? money(cost) : `→ ${fmtQty(m.quantity_after)}`}</span>
        {canUndo && !m.undone_at && !m.reverses_id && (
          <Button size="sm" variant="ghost" icon={<Undo2 />} onClick={onUndo} loading={undoing} style={{ marginTop: 4 }}>Undo</Button>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
/** Supplies used on a job — shown in the admin job page and the employee field app. */
export function JobSuppliesCard({ job, mode }: { job: Pick<Job, 'id' | 'service_name' | 'status'>; mode: 'admin' | 'employee' }) {
  const { user, workspace } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useJobSupplies(job.id);
  const items = useInventoryItems();
  const [open, setOpen] = useState(false);
  const undo = useMutation({
    mutationFn: undoMovement,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['inventory'] }); toast.success('Entry undone'); },
    onError: (e) => toast.error(e),
  });
  const rows = (q.data ?? []).filter((m) => !m.reverses_id && !m.undone_at);
  const total = rows.reduce((s, m) => s + Math.abs(Number(m.quantity_change)) * Number(m.unit_cost ?? 0), 0);
  const plumbing = workspace?.org.trade === 'plumbing';
  const itemById = new Map((items.data ?? []).map((i) => [i.id, i]));
  const billable = rows.filter((m) => m.kind === 'use' && itemById.get(m.item_id)?.billable)
    .reduce((s, m) => s + Math.abs(Number(m.quantity_change)) * Number(itemById.get(m.item_id)?.sell_price ?? 0), 0);
  const invoice = useQuery({
    queryKey: ['job-invoice', job.id],
    enabled: mode === 'admin',
    queryFn: async () => unwrap(await supabase.from('invoices').select('id, number, status, total, balance_due')
      .eq('job_id', job.id).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(1).maybeSingle()) as { id: string; number: string; status: string } | null,
  });
  const addToInvoice = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('add_job_parts_to_invoice', { p_invoice: id })) as number,
    onSuccess: (n) => { void qc.invalidateQueries({ queryKey: ['job-invoice', job.id] }); void qc.invalidateQueries({ queryKey: ['billing'] }); toast.success(n ? 'Invoice updated with parts' : 'No billable parts to add'); },
    onError: (e) => toast.error(e),
  });
  const noItems = items.data && items.data.length === 0;
  const canLog = job.status !== 'cancelled' && !noItems;
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2>{plumbing ? 'Parts used' : 'Supplies used'}</h2>
          {mode === 'admin' && (total > 0 || billable > 0) && (
            <p className="subtle">{[total > 0 && `${money(total)} cost`, billable > 0 && `${money(billable)} billable to client`].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        {canLog && <Button size="sm" variant="soft" icon={<Plus />} onClick={() => setOpen(true)}>{plumbing ? 'Log parts' : 'Log supplies'}</Button>}
      </div>
      <div className="list mt-8">
        {q.isLoading && <div className="card-body"><div className="skeleton" style={{ height: 48 }} /></div>}
        {q.error && <div className="card-body"><Alert tone="error">Couldn’t load supplies. If inventory was just added, run the 0002_inventory.sql migration.</Alert></div>}
        {!q.isLoading && !q.error && rows.length === 0 && (
          <p className="subtle card-body">{noItems
            ? (mode === 'admin' ? <>No inventory yet. <Link to="/inventory">Set up inventory</Link></> : 'Your company hasn’t set up inventory yet.')
            : mode === 'employee' ? 'Used up a bottle or opened a new pack? Log it so the office knows what to reorder.' : 'Nothing logged for this job.'}</p>
        )}
        {rows.map((m) => (
          <MovementRow key={m.id} m={m} showItem
            canUndo={mode === 'admin' || (m.created_by === user?.id && Date.now() - new Date(m.created_at).getTime() < 864e5)}
            onUndo={() => undo.mutate(m.id)} undoing={undo.isPending && undo.variables === m.id} />
        ))}
      </div>
      {mode === 'admin' && billable > 0 && (
        <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
          {invoice.data?.status === 'draft' ? (
            <div className="row-between wrap">
              <span className="muted small">Billable parts go on invoice {invoice.data.number}.</span>
              <Button size="sm" variant="secondary" loading={addToInvoice.isPending} onClick={() => addToInvoice.mutate(invoice.data!.id)}>Update invoice</Button>
            </div>
          ) : invoice.data ? (
            <span className="muted small">Invoice {invoice.data.number} was already sent — add any new parts to it by hand.</span>
          ) : (
            <span className="muted small">Billable parts are added automatically when you create this job’s invoice.</span>
          )}
        </div>
      )}
      <MovementModal open={open} onClose={() => setOpen(false)} job={job} kind="use" allowed={['use', 'waste']} />
    </div>
  );
}
