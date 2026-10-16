// Per-company theming: converts a single brand hex into the CSS variables the
// design system uses, and keeps text readable on top of it.

export const DEFAULT_BRAND = '#0E9F8E';

export const BRAND_PRESETS = [
  '#0E9F8E', // ScrubHub teal
  '#1E6FD9', // ocean blue
  '#2F9E44', // fresh green
  '#7048E8', // violet
  '#D6336C', // raspberry
  '#E8590C', // citrus
  '#0B7285', // deep cyan
  '#1F2937', // graphite
];

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function mix(hex: string, withHex: string, amount: number) {
  const a = hexToRgb(hex);
  const b = hexToRgb(withHex);
  return rgbToHex(a.r + (b.r - a.r) * amount, a.g + (b.g - a.g) * amount, a.b + (b.b - a.b) * amount);
}

function luminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function isValidHex(v: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(v);
}

/** Text color that reads on top of the brand color. */
export function contrastText(hex: string) {
  return luminance(hex) > 0.42 ? '#0F1A17' : '#FFFFFF';
}

// ---------------------------------------------------------------------------
// Brand kit: everything a company can customize about how the app looks.
// Stored on organizations.theme (validated by public.valid_theme in the DB).
// ---------------------------------------------------------------------------
export type FontKey = 'jakarta' | 'inter' | 'poppins' | 'nunito' | 'montserrat' | 'merriweather' | 'system';
export type Corners = 'rounded' | 'soft' | 'square';
export type ThemeMode = 'light' | 'dark' | 'auto';
export type SidebarStyle = 'light' | 'tinted' | 'brand' | 'dark';

export interface Theme {
  accent?: string | null;
  font?: FontKey;
  corners?: Corners;
  mode?: ThemeMode;
  sidebar?: SidebarStyle;
  app_name?: string | null;
  tagline?: string | null;
}

export const FONTS: Record<FontKey, { label: string; family: string; google?: string; note: string }> = {
  jakarta: { label: 'Jakarta', family: "'Plus Jakarta Sans'", google: 'Plus+Jakarta+Sans:wght@400;500;600;700;800', note: 'Friendly and modern (default)' },
  inter: { label: 'Inter', family: "'Inter'", google: 'Inter:wght@400;500;600;700;800', note: 'Clean and neutral' },
  poppins: { label: 'Poppins', family: "'Poppins'", google: 'Poppins:wght@400;500;600;700;800', note: 'Round and bold' },
  nunito: { label: 'Nunito', family: "'Nunito'", google: 'Nunito:wght@400;500;600;700;800', note: 'Soft and approachable' },
  montserrat: { label: 'Montserrat', family: "'Montserrat'", google: 'Montserrat:wght@400;500;600;700;800', note: 'Strong and confident' },
  merriweather: { label: 'Merriweather Sans', family: "'Merriweather Sans'", google: 'Merriweather+Sans:wght@400;500;600;700;800', note: 'Classic and trustworthy' },
  system: { label: 'System', family: 'system-ui', note: 'Your device’s own font — fastest' },
};

const CORNER_SCALE: Record<Corners, number> = { rounded: 1, soft: 0.55, square: 0.18 };
const DARK_SURFACE = '#151E1B';

let current: { brand: string; theme: Theme } = { brand: DEFAULT_BRAND, theme: {} };
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

function loadFont(font: FontKey) {
  const f = FONTS[font];
  if (!f?.google) return;
  const id = `font-${font}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
  document.head.appendChild(link);
}

function resolveMode(mode: ThemeMode | undefined): 'light' | 'dark' {
  if (mode === 'dark') return 'dark';
  if (mode === 'auto' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

/** Applies a brand color + brand kit to the whole app (CSS variables on <html>). */
export function applyTheme(hex: string | null | undefined, theme: Theme | null | undefined) {
  const brand = hex && isValidHex(hex) ? hex : DEFAULT_BRAND;
  const t: Theme = theme ?? {};
  current = { brand, theme: t };
  const html = document.documentElement;
  const root = html.style;
  const dark = resolveMode(t.mode) === 'dark';
  const base = dark ? DARK_SURFACE : '#FFFFFF';

  // Brand
  const strong = dark
    ? (luminance(brand) < 0.18 ? mix(brand, '#FFFFFF', 0.45) : brand)
    : (luminance(brand) > 0.42 ? mix(brand, '#000000', 0.45) : brand);
  root.setProperty('--brand', brand);
  root.setProperty('--brand-strong', strong);
  root.setProperty('--brand-hover', mix(brand, '#000000', 0.12));
  root.setProperty('--brand-soft', mix(brand, base, dark ? 0.78 : 0.88));
  root.setProperty('--brand-softer', mix(brand, base, dark ? 0.88 : 0.94));
  root.setProperty('--brand-ring', mix(brand, base, 0.6));
  root.setProperty('--on-brand', contrastText(brand));

  // Accent (defaults to the brand color)
  const accent = t.accent && isValidHex(t.accent) ? t.accent : brand;
  const accentStrong = dark
    ? (luminance(accent) < 0.18 ? mix(accent, '#FFFFFF', 0.45) : accent)
    : (luminance(accent) > 0.42 ? mix(accent, '#000000', 0.45) : accent);
  root.setProperty('--accent', accent);
  root.setProperty('--accent-strong', accentStrong);
  root.setProperty('--accent-soft', mix(accent, base, dark ? 0.78 : 0.88));
  root.setProperty('--on-accent', contrastText(accent));

  // Font
  const font = t.font && FONTS[t.font] ? t.font : 'jakarta';
  loadFont(font);
  root.setProperty('--font', `${FONTS[font].family}, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`);

  // Corners, mode, sidebar
  root.setProperty('--r', String(CORNER_SCALE[t.corners ?? 'rounded'] ?? 1));
  html.dataset.theme = dark ? 'dark' : 'light';
  html.dataset.sidebar = t.sidebar ?? 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0D1412' : brand);

  // Follow the device when the company picked "auto"
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (mq && mediaListener) mq.removeEventListener?.('change', mediaListener);
  mediaListener = null;
  if (mq && t.mode === 'auto') {
    mediaListener = () => applyTheme(current.brand, current.theme);
    mq.addEventListener?.('change', mediaListener);
  }
}

/** Brand color only (keeps the rest of the current brand kit). Pass null to reset everything. */
export function applyBrand(hex: string | null | undefined) {
  if (hex == null) return applyTheme(null, {});
  applyTheme(hex, current.theme);
}

/** Current theme being shown (used by previews). */
export function currentTheme() { return current; }

/** App name / icon shown in the browser tab and when installed on a phone. */
export function applyAppIdentity(name: string, logoUrl?: string | null) {
  document.title = name;
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', name);
  if (logoUrl) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'apple-touch-icon'; document.head.appendChild(link); }
    link.href = logoUrl;
    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"][data-org]');
    if (!icon) { icon = document.createElement('link'); icon.rel = 'icon'; icon.dataset.org = '1'; document.head.appendChild(icon); }
    icon.href = logoUrl;
  }
}

// ---------------------------------------------------------------------------
// Remember the last company's look on this device, so the login screen and the
// first paint after opening the app already look like that company.
// ---------------------------------------------------------------------------
export interface PublicBranding {
  name: string;
  slug?: string;
  logo_url: string | null;
  brand_color: string;
  theme: Theme | null;
  trade?: string;
}
const CACHE_KEY = 'scrubhub.branding';

export function cacheBranding(b: PublicBranding | null) {
  try {
    if (b) localStorage.setItem(CACHE_KEY, JSON.stringify(b));
    else localStorage.removeItem(CACHE_KEY);
  } catch { /* storage unavailable */ }
}

export function cachedBranding(): PublicBranding | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as PublicBranding) : null;
  } catch { return null; }
}
