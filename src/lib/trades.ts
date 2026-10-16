// Trade packs: the words, starter content and tools each kind of business sees.
// Add a trade here (and to the organizations.trade check in the database) to support it.
import type { Trade } from './types';

export interface TradePack {
  key: Trade;
  label: string;              // "Cleaning"
  business: string;           // "cleaning business"
  visit: string;              // "cleaning" / "service visit"
  visits: string;
  worker: string;             // "cleaner" / "technician"
  workers: string;
  crewNoun: string;           // "crew" / "technician"
  serviceDefault: string;     // default service name on new jobs
  servicePlaceholder: string;
  estimatePlaceholder: string;
  invoiceLinePlaceholder: string;
  catalogPlaceholder: string;
  prefsLabel: string;         // client preferences field
  prefsPlaceholder: string;
  roleTitlePlaceholder: string;
  selfWorkLabel: string;
  selfWorkHint: string;
  whoDoesWork: string;
  checklistTitle: string;
  checklistSub: string;
  checklistTemplatesSub: string;
  clockInToast: string;
  inProgressLong: string;     // client portal banner
  inProgressShort: string;
  bizPlaceholder: string;
  inventoryPitch: string;
  /** Tools switched on for this trade */
  features: { equipment: boolean; priority: boolean };
}

export const TRADES: Record<Trade, TradePack> = {
  cleaning: {
    key: 'cleaning',
    label: 'Cleaning',
    business: 'cleaning business',
    visit: 'cleaning',
    visits: 'cleanings',
    worker: 'cleaner',
    workers: 'cleaners',
    crewNoun: 'crew',
    serviceDefault: 'Cleaning',
    servicePlaceholder: 'e.g. Standard clean',
    estimatePlaceholder: 'e.g. Move-out clean — 4 bed / 3 bath',
    invoiceLinePlaceholder: 'Description (e.g. Standard Cleaning — 3 bed / 2 bath)',
    catalogPlaceholder: 'e.g. Standard Cleaning',
    prefsLabel: 'Cleaning preferences',
    prefsPlaceholder: 'Products to use or avoid, rooms to skip…',
    roleTitlePlaceholder: 'e.g. Lead cleaner',
    selfWorkLabel: 'I clean jobs myself too',
    selfWorkHint: 'Do you clean jobs yourself? Add yourself so you can be assigned and use the field app.',
    whoDoesWork: 'Who does the cleaning?',
    checklistTitle: 'Set up your cleaning checklists',
    checklistSub: 'Pick starter checklists to customize, room by room. Edit or delete anything later.',
    checklistTemplatesSub: 'Room-by-room templates',
    clockInToast: 'Clocked in — have a great clean!',
    inProgressLong: 'Your crew is cleaning now',
    inProgressShort: 'Cleaning in progress',
    bizPlaceholder: 'e.g. Top Shelf Cleaning Co.',
    inventoryPitch: 'Know what’s on the shelf, see what each job uses, and get a shopping list when things run low.',
    features: { equipment: false, priority: false },
  },
  plumbing: {
    key: 'plumbing',
    label: 'Plumbing',
    business: 'plumbing business',
    visit: 'service visit',
    visits: 'service visits',
    worker: 'technician',
    workers: 'technicians',
    crewNoun: 'technician',
    serviceDefault: 'Service call',
    servicePlaceholder: 'e.g. Water heater replacement',
    estimatePlaceholder: 'e.g. Replace 50-gal gas water heater',
    invoiceLinePlaceholder: 'Description (e.g. Drain cleaning — kitchen sink)',
    catalogPlaceholder: 'e.g. Drain Cleaning',
    prefsLabel: 'Notes & preferences',
    prefsPlaceholder: 'Preferred brands, shut-off location, parking, anything the tech should know…',
    roleTitlePlaceholder: 'e.g. Lead plumber',
    selfWorkLabel: 'I work jobs myself too',
    selfWorkHint: 'Do you work jobs yourself? Add yourself so you can be assigned and use the field app.',
    whoDoesWork: 'Who does the work?',
    checklistTitle: 'Set up your job checklists',
    checklistSub: 'Pick starter work-order checklists. Edit or delete anything later.',
    checklistTemplatesSub: 'Step-by-step work orders',
    clockInToast: 'Clocked in — good luck out there!',
    inProgressLong: 'Your technician is working now',
    inProgressShort: 'Work in progress',
    bizPlaceholder: 'e.g. Bay Area Plumbing Co.',
    inventoryPitch: 'Track parts and materials in the shop and on each truck, bill parts used on a job, and get a reorder list when stock runs low.',
    features: { equipment: true, priority: true },
  },
};

export function tradePack(trade: Trade | string | null | undefined): TradePack {
  return TRADES[(trade as Trade) in TRADES ? (trade as Trade) : 'cleaning'];
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Common equipment types to pick from (free text is allowed too). */
export const EQUIPMENT_KINDS: Record<Trade, string[]> = {
  plumbing: ['Water heater (tank)', 'Water heater (tankless)', 'Water softener', 'Water filtration / RO', 'Sump pump', 'Sewage ejector pump',
    'Well pump', 'Pressure regulator (PRV)', 'Backflow preventer', 'Garbage disposal', 'Toilet', 'Main shut-off valve', 'Gas line / meter', 'Recirculation pump'],
  cleaning: ['Vacuum system', 'Washer', 'Dryer', 'Dishwasher', 'Refrigerator', 'Range / oven'],
};
