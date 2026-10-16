import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Sparkles, Wrench } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth, useWorkspace } from '@/auth/AuthProvider';
import { TRADES } from '@/lib/trades';
import type { Trade } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';

/** Starter price lists (prices start at $0 for plumbing so each company sets its own). */
const STARTER_SERVICES: Record<Trade, { name: string; description: string | null; default_price: number; pricing_type: string; unit_label: string | null }[]> = {
  plumbing: [
    { name: 'Service Call / Diagnostic', description: 'Trip charge and diagnosis', default_price: 0, pricing_type: 'flat', unit_label: null },
    { name: 'Drain Cleaning', description: 'Clear clogged sink, tub, shower or main line', default_price: 0, pricing_type: 'flat', unit_label: null },
    { name: 'Leak Repair', description: 'Locate and repair a supply or drain leak', default_price: 0, pricing_type: 'flat', unit_label: null },
    { name: 'Toilet Repair / Replace', description: 'Flapper, fill valve, wax ring or full replacement', default_price: 0, pricing_type: 'flat', unit_label: null },
    { name: 'Faucet / Fixture Install', description: 'Install customer- or company-supplied fixture', default_price: 0, pricing_type: 'flat', unit_label: null },
    { name: 'Water Heater Repair', description: 'Diagnose and repair tank or tankless unit', default_price: 0, pricing_type: 'flat', unit_label: null },
    { name: 'Water Heater Replacement', description: 'Remove old unit, install and test new unit', default_price: 0, pricing_type: 'flat', unit_label: null },
    { name: 'Sewer Camera Inspection', description: 'Video inspection of drain / sewer line', default_price: 0, pricing_type: 'flat', unit_label: null },
    { name: 'Hourly Labor', description: 'Billed per technician hour', default_price: 0, pricing_type: 'hourly', unit_label: 'hour' },
  ],
  cleaning: [
    { name: 'Standard Cleaning', description: 'Kitchen, bathrooms, dusting, floors and trash', default_price: 0, pricing_type: 'flat', unit_label: null },
    { name: 'Deep Cleaning', description: 'Top-to-bottom clean incl. baseboards', default_price: 0, pricing_type: 'flat', unit_label: null },
    { name: 'Move-In / Move-Out Cleaning', description: 'Empty home, cabinets and appliances inside and out', default_price: 0, pricing_type: 'flat', unit_label: null },
  ],
};

export function TradeSettingsCard() {
  const ws = useWorkspace();
  const { refresh } = useAuth();
  const toast = useToast();
  const current = (ws.org.trade ?? 'cleaning') as Trade;
  const [trade, setTrade] = useState<Trade>(current);
  const [addServices, setAddServices] = useState(true);

  const save = useMutation({
    mutationFn: async () => {
      unwrap(await supabase.from('organizations').update({ trade }).eq('id', ws.org.id));
      if (addServices) {
        const existing = unwrap(await supabase.from('service_catalog').select('name, position').eq('org_id', ws.org.id)) as { name: string; position: number }[];
        const names = new Set(existing.map((s) => s.name.toLowerCase()));
        let pos = existing.reduce((m, s) => Math.max(m, s.position), -1) + 1;
        const rows = STARTER_SERVICES[trade].filter((s) => !names.has(s.name.toLowerCase())).map((s) => ({ ...s, org_id: ws.org.id, position: pos++ }));
        if (rows.length) unwrap(await supabase.from('service_catalog').insert(rows));
      }
    },
    onSuccess: async () => { await refresh(); toast.success(`Switched to ${TRADES[trade].label.toLowerCase()}`); },
    onError: (e) => toast.error(e),
  });

  return (
    <div className="card card-pad stack">
      <div>
        <h2>Type of business</h2>
        <p className="muted small">Changes the app’s wording, starter checklists and inventory lists, and the tools your team sees. Your jobs, clients and invoices stay the same.</p>
      </div>
      <div className="form-grid two" role="radiogroup" aria-label="Type of business">
        {Object.values(TRADES).map((t) => (
          <button key={t.key} type="button" role="radio" aria-checked={trade === t.key} className="option-card" onClick={() => setTrade(t.key)}
            style={trade === t.key ? { borderColor: 'var(--brand)', boxShadow: '0 0 0 3px var(--brand-ring)' } : undefined}>
            <span className="avatar">{t.key === 'plumbing' ? <Wrench size={18} aria-hidden /> : <Sparkles size={18} aria-hidden />}</span>
            <span className="grow">
              <span className="strong">{t.label}{t.key === current ? ' (current)' : ''}</span>
              <span className="subtle" style={{ display: 'block' }}>{t.key === 'plumbing' ? 'Service calls, parts billing, equipment records, emergency jobs' : 'Recurring visits, room-by-room checklists, crews'}</span>
            </span>
            {trade === t.key && <Check aria-hidden color="var(--brand-strong)" />}
          </button>
        ))}
      </div>
      {trade !== current && (
        <Switch label={`Add the ${TRADES[trade].label.toLowerCase()} starter price list`} description="Adds any missing services to Billing → Services at $0 so you can set your prices. Existing services are kept."
          checked={addServices} onChange={setAddServices} />
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={() => save.mutate()} disabled={trade === current} loading={save.isPending}>Save type of business</Button>
      </div>
    </div>
  );
}
