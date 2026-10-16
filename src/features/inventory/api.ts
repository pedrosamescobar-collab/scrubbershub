import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import { useWorkspace } from '@/auth/AuthProvider';
import type { InventoryItem, InventoryMovement, InventoryMovementKind } from '@/lib/types';

export const invKeys = {
  items: (org: string) => ['inventory', org, 'items'] as const,
  item: (id: string) => ['inventory', 'item', id] as const,
  history: (itemId: string) => ['inventory', 'history', itemId] as const,
  job: (jobId: string) => ['inventory', 'job', jobId] as const,
  usage: (org: string) => ['inventory', org, 'usage'] as const,
};

export const CATEGORIES_BY_TRADE: Record<string, string[]> = {
  cleaning: ['Cleaning products', 'Paper & disposables', 'Tools & cloths', 'Equipment', 'Laundry & linens', 'Other'],
  plumbing: ['Pipe & fittings', 'Valves', 'Fixtures & repair parts', 'Water heater parts', 'Sealants & consumables', 'Tools & equipment', 'Other'],
};
export const CATEGORIES = CATEGORIES_BY_TRADE.cleaning;
export const categoriesFor = (trade?: string | null) => CATEGORIES_BY_TRADE[trade ?? 'cleaning'] ?? CATEGORIES;
export const UNITS = ['each', 'bottle', 'gallon', 'jug', 'box', 'pack', 'case', 'roll', 'bag', 'pad', 'can', 'tub', 'ft', 'tube'];

const ITEM_SELECT = '*, assigned_employee:employees(id, full_name, color)';
const MOVEMENT_SELECT = '*, item:inventory_items(id, name, unit, category), job:jobs(id, service_name, scheduled_start, client:clients(full_name))';

export function useInventoryItems(opts?: { includeArchived?: boolean }) {
  const ws = useWorkspace();
  return useQuery({
    queryKey: [...invKeys.items(ws.org.id), !!opts?.includeArchived],
    queryFn: async () => {
      let q = supabase.from('inventory_items').select(ITEM_SELECT).eq('org_id', ws.org.id).order('name');
      if (!opts?.includeArchived) q = q.eq('is_archived', false);
      return unwrap(await q) as unknown as InventoryItem[];
    },
  });
}

export function useInventoryItem(id: string) {
  return useQuery({
    queryKey: invKeys.item(id),
    queryFn: async () => {
      const it = unwrap(await supabase.from('inventory_items').select(ITEM_SELECT).eq('id', id).maybeSingle()) as unknown as InventoryItem | null;
      if (!it) throw new Error('This item doesn’t exist or you don’t have access to it.');
      return it;
    },
  });
}

export function useItemHistory(itemId: string) {
  return useQuery({
    queryKey: invKeys.history(itemId),
    queryFn: async () =>
      unwrap(await supabase.from('inventory_movements').select(MOVEMENT_SELECT).eq('item_id', itemId)
        .order('created_at', { ascending: false }).limit(200)) as unknown as InventoryMovement[],
  });
}

export function useJobSupplies(jobId: string) {
  return useQuery({
    queryKey: invKeys.job(jobId),
    queryFn: async () =>
      unwrap(await supabase.from('inventory_movements').select(MOVEMENT_SELECT).eq('job_id', jobId)
        .order('created_at')) as unknown as InventoryMovement[],
  });
}

/** Cost of supplies used or wasted in the last 30 days (admin only via RLS). */
export function useUsage30() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: invKeys.usage(ws.org.id),
    enabled: ws.isAdmin,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 864e5).toISOString();
      const rows = unwrap(await supabase.from('inventory_movements').select('kind, quantity_change, unit_cost')
        .eq('org_id', ws.org.id).in('kind', ['use', 'waste']).gte('created_at', since)) as Pick<InventoryMovement, 'kind' | 'quantity_change' | 'unit_cost'>[];
      return rows.reduce((sum, r) => sum + -Number(r.quantity_change) * Number(r.unit_cost ?? 0), 0);
    },
  });
}

export function useInvalidateInventory() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['inventory'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
}

export async function recordMovement(p: { item: string; kind: Exclude<InventoryMovementKind, 'adjust'>; quantity: number; job?: string | null; note?: string; unitCost?: number | null }) {
  return unwrap(await supabase.rpc('record_inventory_movement', {
    p_item: p.item, p_kind: p.kind, p_quantity: p.quantity, p_job: p.job ?? null, p_note: p.note ?? null, p_unit_cost: p.unitCost ?? null,
  }));
}

export async function setCount(item: string, counted: number, note?: string) {
  return unwrap(await supabase.rpc('set_inventory_count', { p_item: item, p_counted: counted, p_note: note ?? null }));
}

export async function undoMovement(id: string) {
  return unwrap(await supabase.rpc('undo_inventory_movement', { p_movement: id }));
}

// ---- helpers ---------------------------------------------------------------
export function stockLevel(it: Pick<InventoryItem, 'quantity' | 'reorder_level'>): 'out' | 'low' | 'ok' {
  const q = Number(it.quantity);
  if (q <= 0) return 'out';
  if (Number(it.reorder_level) > 0 && q <= Number(it.reorder_level)) return 'low';
  return 'ok';
}

export function fmtQty(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

const NO_PLURAL = new Set(['each', 'oz', 'lb', 'lbs', 'gal', 'ml', 'l', 'kg', 'g', 'ft']);
export function unitLabel(unit: string, qty: number | string) {
  const u = unit.trim();
  if (Math.abs(Number(qty)) === 1 || NO_PLURAL.has(u.toLowerCase()) || /s$/i.test(u)) return u;
  if (/(x|ch|sh)$/i.test(u)) return `${u}es`;
  return `${u}s`;
}

export function fmtStock(qty: number | string, unit: string) {
  return `${fmtQty(qty)} ${unitLabel(unit, qty)}`;
}

export const money = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function suggestedOrder(it: Pick<InventoryItem, 'quantity' | 'reorder_level' | 'reorder_quantity'>) {
  if (it.reorder_quantity) return Number(it.reorder_quantity);
  return Math.max(1, Math.ceil(Number(it.reorder_level) * 2 - Number(it.quantity)));
}

export const MOVEMENT_META: Record<InventoryMovementKind, { label: string; tone: 'green' | 'blue' | 'red' | 'gray' }> = {
  restock: { label: 'Restocked', tone: 'green' },
  use: { label: 'Used', tone: 'blue' },
  waste: { label: 'Wasted / damaged', tone: 'red' },
  adjust: { label: 'Count', tone: 'gray' },
};

export interface StarterItem { name: string; category: string; unit: string; reorder_level: number; reorder_quantity: number; billable?: boolean }

/** A starting list most residential cleaning companies stock. Quantities start at 0. */
export const STARTER_ITEMS: StarterItem[] = [
  { name: 'All-purpose cleaner', category: 'Cleaning products', unit: 'bottle', reorder_level: 4, reorder_quantity: 12 },
  { name: 'Glass cleaner', category: 'Cleaning products', unit: 'bottle', reorder_level: 3, reorder_quantity: 6 },
  { name: 'Disinfectant spray', category: 'Cleaning products', unit: 'can', reorder_level: 3, reorder_quantity: 6 },
  { name: 'Toilet bowl cleaner', category: 'Cleaning products', unit: 'bottle', reorder_level: 3, reorder_quantity: 6 },
  { name: 'Tub & tile / soap scum remover', category: 'Cleaning products', unit: 'bottle', reorder_level: 2, reorder_quantity: 6 },
  { name: 'Degreaser', category: 'Cleaning products', unit: 'bottle', reorder_level: 2, reorder_quantity: 4 },
  { name: 'Stainless steel polish', category: 'Cleaning products', unit: 'can', reorder_level: 2, reorder_quantity: 4 },
  { name: 'Floor cleaner concentrate', category: 'Cleaning products', unit: 'gallon', reorder_level: 1, reorder_quantity: 2 },
  { name: 'Trash bags', category: 'Paper & disposables', unit: 'box', reorder_level: 2, reorder_quantity: 4 },
  { name: 'Paper towels', category: 'Paper & disposables', unit: 'roll', reorder_level: 6, reorder_quantity: 12 },
  { name: 'Nitrile gloves', category: 'Paper & disposables', unit: 'box', reorder_level: 2, reorder_quantity: 4 },
  { name: 'Microfiber cloths', category: 'Tools & cloths', unit: 'pack', reorder_level: 2, reorder_quantity: 3 },
  { name: 'Scrub sponges', category: 'Tools & cloths', unit: 'pack', reorder_level: 2, reorder_quantity: 4 },
  { name: 'Magic erasers', category: 'Tools & cloths', unit: 'pack', reorder_level: 2, reorder_quantity: 4 },
  { name: 'Mop pads', category: 'Tools & cloths', unit: 'pad', reorder_level: 4, reorder_quantity: 8 },
  { name: 'Vacuum', category: 'Equipment', unit: 'each', reorder_level: 0, reorder_quantity: 1 },
  { name: 'Vacuum bags / filters', category: 'Equipment', unit: 'pack', reorder_level: 1, reorder_quantity: 2 },
  { name: 'Mop & bucket', category: 'Equipment', unit: 'each', reorder_level: 0, reorder_quantity: 1 },
  { name: 'Supply caddy', category: 'Equipment', unit: 'each', reorder_level: 0, reorder_quantity: 1 },
];

/** Common parts and materials a residential plumbing company stocks. Parts are billable; set your own prices. */
export const PLUMBING_STARTER_ITEMS: StarterItem[] = [
  { name: '1/2" PEX pipe', category: 'Pipe & fittings', unit: 'ft', reorder_level: 50, reorder_quantity: 100, billable: true },
  { name: '1/2" PEX elbows', category: 'Pipe & fittings', unit: 'each', reorder_level: 10, reorder_quantity: 25, billable: true },
  { name: '1/2" PEX tees', category: 'Pipe & fittings', unit: 'each', reorder_level: 10, reorder_quantity: 25, billable: true },
  { name: 'PEX crimp rings 1/2"', category: 'Pipe & fittings', unit: 'bag', reorder_level: 1, reorder_quantity: 2 },
  { name: '1/2" push-to-connect couplings', category: 'Pipe & fittings', unit: 'each', reorder_level: 6, reorder_quantity: 12, billable: true },
  { name: '1-1/2" P-trap kit', category: 'Pipe & fittings', unit: 'each', reorder_level: 3, reorder_quantity: 6, billable: true },
  { name: '1/4-turn angle stop valves', category: 'Valves', unit: 'each', reorder_level: 6, reorder_quantity: 12, billable: true },
  { name: '3/4" ball valves', category: 'Valves', unit: 'each', reorder_level: 3, reorder_quantity: 6, billable: true },
  { name: 'T&P relief valves', category: 'Water heater parts', unit: 'each', reorder_level: 2, reorder_quantity: 4, billable: true },
  { name: 'Water heater connectors 18"', category: 'Water heater parts', unit: 'each', reorder_level: 4, reorder_quantity: 8, billable: true },
  { name: 'Anode rods', category: 'Water heater parts', unit: 'each', reorder_level: 2, reorder_quantity: 4, billable: true },
  { name: 'Toilet flappers', category: 'Fixtures & repair parts', unit: 'each', reorder_level: 4, reorder_quantity: 10, billable: true },
  { name: 'Toilet fill valves', category: 'Fixtures & repair parts', unit: 'each', reorder_level: 4, reorder_quantity: 8, billable: true },
  { name: 'Wax rings', category: 'Fixtures & repair parts', unit: 'each', reorder_level: 4, reorder_quantity: 10, billable: true },
  { name: 'Faucet supply lines', category: 'Fixtures & repair parts', unit: 'each', reorder_level: 6, reorder_quantity: 12, billable: true },
  { name: 'Thread seal tape', category: 'Sealants & consumables', unit: 'roll', reorder_level: 5, reorder_quantity: 10 },
  { name: 'Pipe thread sealant', category: 'Sealants & consumables', unit: 'can', reorder_level: 2, reorder_quantity: 4 },
  { name: 'PVC primer & cement', category: 'Sealants & consumables', unit: 'can', reorder_level: 2, reorder_quantity: 4 },
  { name: 'Solder & flux kit', category: 'Sealants & consumables', unit: 'each', reorder_level: 1, reorder_quantity: 2 },
  { name: 'Drop cloths', category: 'Sealants & consumables', unit: 'each', reorder_level: 2, reorder_quantity: 4 },
  { name: 'Drain snake / auger', category: 'Tools & equipment', unit: 'each', reorder_level: 0, reorder_quantity: 1 },
  { name: 'PEX crimp tool', category: 'Tools & equipment', unit: 'each', reorder_level: 0, reorder_quantity: 1 },
  { name: 'Sewer inspection camera', category: 'Tools & equipment', unit: 'each', reorder_level: 0, reorder_quantity: 1 },
];

export const starterItemsFor = (trade?: string | null) => (trade === 'plumbing' ? PLUMBING_STARTER_ITEMS : STARTER_ITEMS);
