import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Archive, ArchiveRestore, ChevronRight, ClipboardList, History, Minus, Package, PackagePlus, Pencil, Plus, Scale, Search, ShoppingCart, Sparkles, Trash2,
} from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useWorkspace } from '@/auth/AuthProvider';
import type { InventoryItem } from '@/lib/types';
import { tradePack } from '@/lib/trades';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/Form';
import { Alert, EmptyState, QueryState, SkeletonList } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Avatar, Badge, PageHeader, SectionTitle, Segmented } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import {
  starterItemsFor, fmtQty, fmtStock, money, stockLevel, undoMovement, useInvalidateInventory, useInventoryItem, useInventoryItems, useItemHistory, useUsage30,
} from './api';
import { CountModal, ItemModal, MovementModal, MovementRow, ReorderModal, StockBadge } from './components';

type Filter = 'all' | 'low' | 'archived';

export function InventoryPage() {
  const ws = useWorkspace();
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidateInventory();
  const [params, setParams] = useSearchParams();
  const q = useInventoryItems({ includeArchived: true });
  const usage = useUsage30();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>(params.get('filter') === 'low' ? 'low' : 'all');
  const [category, setCategory] = useState('');
  const [adding, setAdding] = useState(params.get('new') === '1');
  const [reorder, setReorder] = useState(false);
  const [move, setMove] = useState<{ item: InventoryItem; kind: 'restock' | 'use' } | null>(null);

  const all = q.data ?? [];
  const active = all.filter((i) => !i.is_archived);
  const lowCount = active.filter((i) => stockLevel(i) !== 'ok' && (Number(i.reorder_level) > 0 || Number(i.quantity) <= 0)).length;
  const value = active.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_cost ?? 0), 0);
  const categories = [...new Set(active.map((i) => i.category))].sort();

  const groups = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = all.filter((i) =>
      (filter === 'archived' ? i.is_archived : !i.is_archived)
      && (filter !== 'low' || stockLevel(i) !== 'ok')
      && (!category || i.category === category)
      && (!s || [i.name, i.category, i.supplier, i.sku, i.location, i.assigned_employee?.full_name].some((v) => v?.toLowerCase().includes(s))));
    const m = new Map<string, InventoryItem[]>();
    for (const i of list) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [all, search, filter, category]);

  const seed = useMutation({
    mutationFn: async () => unwrap(await supabase.from('inventory_items').insert(starterItemsFor(ws.org.trade).map((s) => ({ billable: false, ...s, org_id: ws.org.id, quantity: 0 })))),
    onSuccess: () => { invalidate(); toast.success(`${starterItemsFor(ws.org.trade).length} common items added — now enter what you have on hand`); },
    onError: (e) => toast.error(e),
  });

  return (
    <div className="inv-page">
      <PageHeader title="Inventory" sub={ws.org.trade === 'plumbing' ? 'Parts, materials and tools' : 'Supplies and equipment'}
        actions={<>
          <Button variant="secondary" icon={<ShoppingCart />} onClick={() => setReorder(true)}>Reorder list{lowCount ? ` (${lowCount})` : ''}</Button>
          <Button icon={<Plus />} onClick={() => setAdding(true)}>Add item</Button>
        </>} />

      <QueryState query={q} skeleton={<SkeletonList rows={5} height={64} />}>
        {() => active.length === 0 && filter !== 'archived' ? (
          <div className="card">
            <EmptyState icon={<Package />} title={ws.org.trade === 'plumbing' ? 'Track your parts and materials' : 'Track your supplies'}
              action={<div className="row wrap" style={{ justifyContent: 'center' }}>
                <Button icon={<Sparkles />} onClick={() => seed.mutate()} loading={seed.isPending}>{ws.org.trade === 'plumbing' ? 'Add common plumbing parts' : 'Add common cleaning supplies'}</Button>
                <Button variant="secondary" icon={<Plus />} onClick={() => setAdding(true)}>Add an item</Button>
              </div>}>
              {tradePack(ws.org.trade).inventoryPitch}
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="stats">
              <div className="card stat"><div className="k">Items tracked</div><div className="v">{active.length}</div></div>
              <button className="card stat" style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer' }} onClick={() => setFilter('low')}>
                <div className="k">Low or out</div>
                <div className="v" style={lowCount ? { color: 'var(--amber)' } : undefined}>{lowCount}</div>
              </button>
              <div className="card stat"><div className="k">Value on hand</div><div className="v">{money(value)}</div></div>
              <div className="card stat"><div className="k">Used last 30 days</div><div className="v">{usage.data != null ? money(usage.data) : '—'}</div></div>
            </div>

            <div className="row wrap mt-16" style={{ marginBottom: 14 }}>
              <div className="search grow" style={{ minWidth: 220 }}>
                <Search aria-hidden />
                <input className="input" type="search" placeholder="Search items, supplier, location…" aria-label="Search inventory" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              {categories.length > 1 && (
                <SelectField aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} style={{ minWidth: 180 }}>
                  <option value="">All categories</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </SelectField>
              )}
              <Segmented label="Show" value={filter} onChange={(v) => { setFilter(v); if (params.get('filter')) setParams({}); }}
                options={[{ value: 'all', label: 'All' }, { value: 'low', label: 'Low' }, { value: 'archived', label: 'Archived' }]} />
            </div>

            {groups.length === 0 ? (
              <div className="card"><EmptyState icon={<Search />} title={filter === 'low' ? 'Nothing is running low' : 'No matches'}>
                {filter === 'low' ? 'Everything is above its reorder level.' : 'Try a different search or filter.'}
              </EmptyState></div>
            ) : groups.map(([cat, items]) => (
              <div key={cat}>
                <SectionTitle>{cat} <span className="subtle" style={{ fontWeight: 600 }}>· {items.length}</span></SectionTitle>
                <div className="card list">
                  {items.map((it) => (
                    <div key={it.id} className="list-item" style={{ paddingRight: 10 }}>
                      <Link to={`/inventory/${it.id}`} className="grow row" style={{ color: 'inherit', textDecoration: 'none', minWidth: 0 }}>
                        <span className="grow" style={{ minWidth: 0 }}>
                          <span className="row" style={{ ['--gap' as string]: '8px' }}><span className="strong truncate">{it.name}</span><StockBadge item={it} /></span>
                          <span className="muted small truncate" style={{ display: 'block' }}>
                            {[it.assigned_employee ? `With ${it.assigned_employee.full_name}` : null, it.location, it.supplier].filter(Boolean).join(' · ')
                              || (Number(it.reorder_level) > 0 ? `Reorder at ${fmtQty(it.reorder_level)}` : 'No reorder alert')}
                          </span>
                        </span>
                        <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <span className="strong" style={{ fontSize: 17, display: 'block' }}>{fmtQty(it.quantity)}</span>
                          <span className="subtle">{fmtStock(it.quantity, it.unit).split(' ').slice(1).join(' ')}</span>
                        </span>
                      </Link>
                      {!it.is_archived && (
                        <span className="row" style={{ ['--gap' as string]: '4px' }}>
                          <Button size="sm" variant="secondary" iconOnly aria-label={`Use ${it.name}`} icon={<Minus />} disabled={Number(it.quantity) <= 0}
                            onClick={() => setMove({ item: it, kind: 'use' })} />
                          <Button size="sm" variant="soft" iconOnly aria-label={`Restock ${it.name}`} icon={<Plus />} onClick={() => setMove({ item: it, kind: 'restock' })} />
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </QueryState>

      <ItemModal open={adding} onClose={() => { setAdding(false); if (params.get('new')) setParams({}); }} onSaved={(it) => navigate(`/inventory/${it.id}`)} />
      <ReorderModal open={reorder} onClose={() => setReorder(false)} items={active} />
      <MovementModal open={!!move} onClose={() => setMove(null)} item={move?.item} kind={move?.kind} />
    </div>
  );
}

// ---------------------------------------------------------------------------
export function InventoryItemPage() {
  const { id = '' } = useParams();
  const q = useInventoryItem(id);
  return (
    <QueryState query={q} skeleton={<SkeletonList rows={3} height={120} />}>
      {(it) => <ItemView item={it} />}
    </QueryState>
  );
}

function ItemView({ item }: { item: InventoryItem }) {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const invalidate = useInvalidateInventory();
  const history = useItemHistory(item.id);
  const [edit, setEdit] = useState(false);
  const [count, setCount] = useState(false);
  const [move, setMove] = useState<'restock' | 'use' | 'waste' | null>(null);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);

  const archive = useMutation({
    mutationFn: async (v: boolean) => unwrap(await supabase.from('inventory_items').update({ is_archived: v }).eq('id', item.id)),
    onSuccess: (_d, v) => { invalidate(); setConfirm(null); toast.success(v ? 'Item archived' : 'Item restored'); },
    onError: (e) => toast.error(e),
  });
  const del = useMutation({
    mutationFn: async () => unwrap(await supabase.from('inventory_items').delete().eq('id', item.id)),
    onSuccess: () => { invalidate(); toast.success('Item deleted'); navigate('/inventory'); },
    onError: (e) => toast.error(e),
  });
  const undo = useMutation({
    mutationFn: undoMovement,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['inventory'] }); toast.success('Entry undone'); },
    onError: (e) => toast.error(e),
  });

  const rows = history.data ?? [];
  const since30 = Date.now() - 30 * 864e5;
  const used30 = rows.filter((m) => (m.kind === 'use' || m.kind === 'waste') && !m.undone_at && !m.reverses_id && new Date(m.created_at).getTime() > since30)
    .reduce((s, m) => s + Math.abs(Number(m.quantity_change)), 0);
  const level = stockLevel(item);
  const detail = (label: string, v: ReactNode) => v ? <div className="row-between" style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}><span className="muted">{label}</span><span className="strong" style={{ textAlign: 'right' }}>{v}</span></div> : null;

  return (
    <div className="inv-page">
      <PageHeader back={{ to: '/inventory', label: 'Inventory' }} title={item.name}
        sub={<span className="row wrap" style={{ ['--gap' as string]: '8px' }}>{item.category}<StockBadge item={item} />{item.is_archived && <Badge tone="gray">Archived</Badge>}</span>}
        actions={<>
          <Button variant="secondary" icon={<Pencil />} onClick={() => setEdit(true)}>Edit</Button>
          {item.is_archived
            ? <Button variant="secondary" icon={<ArchiveRestore />} onClick={() => archive.mutate(false)} loading={archive.isPending}>Restore</Button>
            : <Button variant="ghost" icon={<Archive />} onClick={() => setConfirm('archive')}>Archive</Button>}
        </>} />

      <div className="grid-2-lg">
        <div className="stack" style={{ ['--gap' as string]: '16px' }}>
          <div className="card card-pad stack">
            <div className="row-between">
              <div>
                <p className="subtle">On hand</p>
                <p style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em', color: level === 'out' ? 'var(--red)' : level === 'low' ? 'var(--amber)' : undefined }}>
                  {fmtStock(item.quantity, item.unit)}
                </p>
              </div>
              {item.unit_cost != null && <div style={{ textAlign: 'right' }}><p className="subtle">Value</p><p className="strong">{money(Number(item.quantity) * Number(item.unit_cost))}</p></div>}
            </div>
            {level !== 'ok' && Number(item.reorder_level) > 0 && <Alert tone="warn">At or below the reorder level of {fmtQty(item.reorder_level)}. Time to buy more.</Alert>}
            {!item.is_archived && (
              <div className="row wrap">
                <Button icon={<PackagePlus />} onClick={() => setMove('restock')}>Restock</Button>
                <Button variant="secondary" icon={<Minus />} onClick={() => setMove('use')} disabled={Number(item.quantity) <= 0}>Use</Button>
                <Button variant="secondary" icon={<Scale />} onClick={() => setCount(true)}>Count</Button>
                <Button variant="ghost" icon={<Trash2 />} onClick={() => setMove('waste')} disabled={Number(item.quantity) <= 0}>Waste</Button>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header"><h2 className="row" style={{ ['--gap' as string]: '8px' }}><History size={18} aria-hidden />History</h2><span className="subtle">{fmtStock(used30, item.unit)} used in 30 days</span></div>
            <div className="list mt-8">
              {history.isLoading && <div className="card-body"><SkeletonList rows={3} height={48} /></div>}
              {!history.isLoading && rows.length === 0 && <p className="subtle card-body">No changes yet.</p>}
              {rows.map((m) => (
                <MovementRow key={m.id} m={{ ...m, item: m.item ?? { id: item.id, name: item.name, unit: item.unit, category: item.category } }} showJob
                  canUndo onUndo={() => undo.mutate(m.id)} undoing={undo.isPending && undo.variables === m.id} />
              ))}
            </div>
          </div>
        </div>

        <div className="stack" style={{ ['--gap' as string]: '16px' }}>
          <div className="card card-pad">
            <h2 style={{ marginBottom: 8 }}>Details</h2>
            {detail('Counted in', item.unit)}
            {detail('Reorder at', Number(item.reorder_level) > 0 ? fmtStock(item.reorder_level, item.unit) : 'No alert')}
            {detail('Usually order', item.reorder_quantity ? fmtStock(item.reorder_quantity, item.unit) : null)}
            {detail('Cost per unit', item.unit_cost != null ? money(Number(item.unit_cost)) : null)}
            {detail('Charge to client', item.billable ? (item.sell_price != null ? `${money(Number(item.sell_price))} each` : 'Yes — set a price') : 'No')}
            {detail('Supplier', item.supplier)}
            {detail('SKU / product #', item.sku)}
            {detail('Stored at', item.location)}
            {detail('Assigned to', item.assigned_employee ? <span className="row" style={{ ['--gap' as string]: '6px' }}><Avatar name={item.assigned_employee.full_name} color={item.assigned_employee.color} size="sm" />{item.assigned_employee.full_name}</span> : null)}
            {item.notes && <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}><p className="label">Notes</p><p className="pre small">{item.notes}</p></div>}
          </div>
          {item.is_archived && (
            <div className="card card-pad stack">
              <p className="muted small">Archived items are hidden from the crew and the reorder list. Delete removes the item and its history for good.</p>
              <Button variant="danger-ghost" icon={<Trash2 />} onClick={() => setConfirm('delete')}>Delete permanently</Button>
            </div>
          )}
          <Link to="/inventory" className="card card-pad card-link row"><ClipboardList size={18} aria-hidden /><span className="grow strong">All inventory</span><ChevronRight size={18} aria-hidden /></Link>
        </div>
      </div>

      <ItemModal open={edit} onClose={() => setEdit(false)} item={item} />
      <CountModal open={count} onClose={() => setCount(false)} item={item} />
      <MovementModal open={!!move} onClose={() => setMove(null)} item={item} kind={move ?? 'use'} />
      <ConfirmDialog open={confirm === 'archive'} onClose={() => setConfirm(null)} onConfirm={() => archive.mutate(true)} loading={archive.isPending}
        title="Archive this item?" confirmLabel="Archive">It stays in past job records but disappears from the list, the crew app, and reorder alerts. You can restore it any time.</ConfirmDialog>
      <ConfirmDialog open={confirm === 'delete'} onClose={() => setConfirm(null)} onConfirm={() => del.mutate()} loading={del.isPending} danger
        title="Delete permanently?" confirmLabel="Delete">This removes {item.name} and all of its history, including what was logged on jobs. This can’t be undone.</ConfirmDialog>
    </div>
  );
}
