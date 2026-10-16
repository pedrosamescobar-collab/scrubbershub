import { supabase, unwrap } from '@/lib/supabase';

// Optional starter content. Companies install the ones they want, then edit or delete freely.
export interface StarterTemplate {
  key: string;
  name: string;
  description: string;
  sections: { name: string; items: (string | [string, false])[] }[]; // [label, false] = optional task
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: 'standard',
    name: 'Standard clean',
    description: 'Recurring maintenance visit',
    sections: [
      { name: 'Kitchen', items: ['Wipe countertops & backsplash', 'Clean sink & faucet', 'Wipe appliance exteriors', 'Clean microwave inside & out', 'Empty trash & replace liner', 'Sweep & mop floor'] },
      { name: 'Bathrooms', items: ['Clean & disinfect toilet', 'Scrub shower / tub', 'Clean sink, counter & mirror', 'Restock toilet paper & towels', ['Wipe cabinet fronts', false], 'Mop floor'] },
      { name: 'Bedrooms', items: ['Make beds / change linens if left out', 'Dust surfaces & nightstands', 'Vacuum floors', ['Tidy closets', false]] },
      { name: 'Living areas', items: ['Dust surfaces & shelves', 'Wipe light switches & door handles', 'Fluff & straighten cushions', 'Vacuum rugs & floors'] },
      { name: 'Final walk-through', items: ['Lights off & doors locked', 'Photo of finished rooms'] },
    ],
  },
  {
    key: 'deep',
    name: 'Deep clean',
    description: 'First visit or seasonal top-to-bottom',
    sections: [
      { name: 'Kitchen', items: ['Degrease backsplash & stovetop', 'Clean inside microwave', ['Inside oven', false], ['Inside fridge', false], 'Wipe cabinet fronts & handles', 'Clean sink, faucet & disposal', 'Scrub floor edges & baseboards'] },
      { name: 'Bathrooms', items: ['Descale shower glass & fixtures', 'Scrub grout', 'Detail toilet base & behind', 'Clean vanity inside & out', 'Wipe baseboards & vents'] },
      { name: 'Whole home', items: ['Dust ceiling fans & light fixtures', 'Wipe all baseboards', 'Clean window sills & tracks', 'Wipe doors & frames', 'Vacuum under furniture', 'Mop all hard floors'] },
    ],
  },
  {
    key: 'move',
    name: 'Move-in / move-out',
    description: 'Empty home, inside everything',
    sections: [
      { name: 'Kitchen', items: ['Inside & outside all cabinets and drawers', 'Inside oven & range hood', 'Inside fridge & freezer', 'Inside dishwasher', 'Countertops & sink'] },
      { name: 'Bathrooms', items: ['Inside cabinets & drawers', 'Shower, tub & tile', 'Toilet inside & out', 'Mirrors & fixtures'] },
      { name: 'Rooms & closets', items: ['Closet shelves & rods', 'Baseboards & outlets', 'Window sills & blinds', 'Floors vacuumed & mopped'] },
    ],
  },
];

/** Work-order style checklists for plumbing companies. */
export const PLUMBING_TEMPLATES: StarterTemplate[] = [
  {
    key: 'service-call',
    name: 'Service call',
    description: 'Diagnose, get approval, repair, test',
    sections: [
      { name: 'Arrival', items: ['Confirm the problem with the customer', 'Lay floor protection / drop cloths', 'Photo of problem area'] },
      { name: 'Diagnosis', items: ['Inspect and find the cause', 'Check nearby shut-off valves work', 'Explain options & price — get approval before starting'] },
      { name: 'Repair', items: ['Complete the repair', 'Test under pressure — no leaks', 'Check flow / drainage'] },
      { name: 'Wrap-up', items: ['Clean work area & remove debris', 'Photo of finished work', 'Log parts used', 'Walk customer through the work', ['Recommend follow-up or maintenance', false]] },
    ],
  },
  {
    key: 'water-heater',
    name: 'Water heater replacement',
    description: 'Remove old unit, install and start up new one',
    sections: [
      { name: 'Prep', items: ['Shut off water and gas / power', 'Photo of old unit & data plate', 'Drain and disconnect old unit'] },
      { name: 'Install', items: ['Set new unit (pan / stand as required)', 'Connect water lines with new connectors', 'Install T&P valve and discharge line', 'Connect gas and leak-test, or wire electrical', 'Check venting / draft', ['Install expansion tank', false], ['Seismic straps', false]] },
      { name: 'Start-up', items: ['Fill tank and purge air at a hot tap', 'Light / power on and set temperature', 'Check every connection for leaks'] },
      { name: 'Wrap-up', items: ['Haul away old unit', 'Photo of installed unit & data plate', 'Record brand, model and serial under Equipment', 'Show customer operation and warranty info'] },
    ],
  },
  {
    key: 'drain',
    name: 'Drain cleaning',
    description: 'Clear a clogged line and confirm flow',
    sections: [
      { name: 'Setup', items: ['Confirm which fixtures are slow or backed up', 'Protect floors and finishes', 'Locate cleanout / remove trap'] },
      { name: 'Clear', items: ['Snake or jet the line', 'Run water to confirm full flow', ['Camera inspection', false]] },
      { name: 'Wrap-up', items: ['Reinstall trap / cap cleanout — no leaks', 'Clean up work area', 'Photo after', ['Recommend enzyme treatment / maintenance', false]] },
    ],
  },
];

export function starterTemplatesFor(trade: string | null | undefined): StarterTemplate[] {
  return trade === 'plumbing' ? PLUMBING_TEMPLATES : STARTER_TEMPLATES;
}

export async function installStarterTemplate(orgId: string, t: StarterTemplate): Promise<string> {
  const tpl = unwrap(
    await supabase.from('checklist_templates').insert({ org_id: orgId, name: t.name, description: t.description }).select('id').single(),
  ) as { id: string };
  const sections = unwrap(
    await supabase
      .from('checklist_sections')
      .insert(t.sections.map((s, i) => ({ org_id: orgId, template_id: tpl.id, name: s.name, position: i })))
      .select('id, position'),
  ) as { id: string; position: number }[];
  const rows = t.sections.flatMap((s, si) => {
    const sec = sections.find((x) => x.position === si)!;
    return s.items.map((it, ii) => ({
      org_id: orgId,
      template_id: tpl.id,
      section_id: sec.id,
      label: Array.isArray(it) ? it[0] : it,
      is_required: !Array.isArray(it),
      position: ii,
    }));
  });
  unwrap(await supabase.from('checklist_items').insert(rows));
  return tpl.id;
}
