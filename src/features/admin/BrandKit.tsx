import { useState } from 'react';
import { Check, Copy, Link2, Moon, Sun, SunMoon } from 'lucide-react';
import { FONTS, type FontKey, type Theme } from '@/lib/brand';
import { useWorkspace } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Switch, TextField } from '@/components/ui/Form';
import { BrandColorPicker } from '@/components/ui/Branding';
import { OrgLogo, Segmented } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';

/** A small mock of the app so owners see their brand kit on sidebar, buttons, badges and cards. */
export function ThemePreview({ name, logoUrl, appName }: { name: string; logoUrl: string | null; appName?: string | null }) {
  return (
    <div className="theme-preview" aria-label="Preview of your brand kit" role="img">
      <div className="pv-side">
        <div className="row" style={{ ['--gap' as string]: '6px', padding: '0 4px 8px' }}>
          <OrgLogo name={name} url={logoUrl} />
          <span className="strong truncate" style={{ fontSize: 12, color: 'var(--sidebar-text-strong)' }}>{appName || name}</span>
        </div>
        <span className="on">Home</span><span>Calendar</span><span>Clients</span><span>Billing</span>
      </div>
      <div className="pv-main">
        <p className="strong" style={{ fontSize: 17 }}>Good morning</p>
        <div className="card card-pad stack" style={{ ['--gap' as string]: '8px', padding: 12 }}>
          <div className="row-between"><span className="strong small">Josh Abrams</span><span className="badge badge-accent no-dot">In progress</span></div>
          <div className="progress"><div style={{ width: '64%' }} /></div>
          <span className="subtle">Tue · 9:00 AM – 11:30 AM</span>
        </div>
        <div className="row wrap" style={{ ['--gap' as string]: '8px' }}>
          <span className="btn btn-primary btn-sm">New job</span>
          <span className="btn btn-secondary btn-sm">Add client</span>
          <span className="btn btn-accent btn-sm">Send invoice</span>
        </div>
      </div>
    </div>
  );
}

export function BrandKitEditor({
  theme, onChange, onSave, saving, name, logoUrl,
}: { theme: Theme; onChange: (t: Theme) => void; onSave: () => void; saving: boolean; name: string; logoUrl: string | null }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const set = (patch: Partial<Theme>) => onChange({ ...theme, ...patch });
  const link = `${window.location.origin}/c/${ws.org.slug}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { toast.error('Couldn’t copy — press and hold the link to copy it.'); }
  };

  return (
    <div className="card card-pad stack" style={{ ['--gap' as string]: '16px' }}>
      <div>
        <h2>Brand kit</h2>
        <p className="muted small">Changes show across the app as you make them. Your team and clients see them after you save.</p>
      </div>

      <ThemePreview name={name} logoUrl={logoUrl} appName={theme.app_name} />

      <div className="stack" style={{ ['--gap' as string]: '8px' }}>
        <Switch label="Second (accent) color" description="Used for highlights, progress bars and some buttons. Off = your brand color everywhere."
          checked={!!theme.accent} onChange={(v) => set({ accent: v ? '#E8590C' : null })} />
        {theme.accent && <BrandColorPicker value={theme.accent} onChange={(c) => set({ accent: c })} />}
      </div>

      <div className="stack" style={{ ['--gap' as string]: '8px' }}>
        <span className="label">Font</span>
        <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }} role="radiogroup" aria-label="Font">
          {(Object.keys(FONTS) as FontKey[]).map((k) => {
            const on = (theme.font ?? 'jakarta') === k;
            return (
              <button key={k} type="button" role="radio" aria-checked={on} className="option-card" onClick={() => set({ font: k })}
                style={{ flexDirection: 'column', gap: 2, borderColor: on ? 'var(--brand)' : undefined, boxShadow: on ? '0 0 0 3px var(--brand-ring)' : undefined }}>
                <span className="font-option strong" style={{ fontFamily: `${FONTS[k].family}, system-ui` }}>{FONTS[k].label} Aa</span>
                <span className="subtle">{FONTS[k].note}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="form-grid two">
        <div className="field">
          <span className="label">Corners</span>
          <Segmented block label="Corners" value={theme.corners ?? 'rounded'} onChange={(v) => set({ corners: v })}
            options={[{ value: 'rounded', label: 'Rounded' }, { value: 'soft', label: 'Soft' }, { value: 'square', label: 'Square' }]} />
        </div>
        <div className="field">
          <span className="label">Appearance</span>
          <Segmented block label="Appearance" value={theme.mode ?? 'light'} onChange={(v) => set({ mode: v })}
            options={[
              { value: 'light', label: <span className="row" style={{ ['--gap' as string]: '4px' }}><Sun size={14} aria-hidden />Light</span> },
              { value: 'dark', label: <span className="row" style={{ ['--gap' as string]: '4px' }}><Moon size={14} aria-hidden />Dark</span> },
              { value: 'auto', label: <span className="row" style={{ ['--gap' as string]: '4px' }}><SunMoon size={14} aria-hidden />Auto</span> },
            ]} />
        </div>
        <div className="field span-2">
          <span className="label">Side menu (computer screens)</span>
          <Segmented block label="Side menu" value={theme.sidebar ?? 'light'} onChange={(v) => set({ sidebar: v })}
            options={[{ value: 'light', label: 'Plain' }, { value: 'tinted', label: 'Tinted' }, { value: 'brand', label: 'Brand color' }, { value: 'dark', label: 'Dark' }]} />
        </div>
        <TextField label="App name" placeholder={name} maxLength={30} value={theme.app_name ?? ''}
          hint="Shown in the menu, browser tab and on phone home screens" onChange={(e) => set({ app_name: e.target.value || null })} />
        <TextField label="Tagline" placeholder="e.g. Spotless homes across Tampa Bay" maxLength={120} value={theme.tagline ?? ''}
          hint="Shown on your sign-in page" onChange={(e) => set({ tagline: e.target.value || null })} />
      </div>

      <div className="callout">
        <div className="label"><Link2 aria-hidden />Your sign-in link</div>
        <p className="small">Share this with your team and clients. It opens a sign-in page with your logo, colors and tagline.</p>
        <div className="row wrap mt-8">
          <code className="small" style={{ wordBreak: 'break-all' }}>{link}</code>
          <Button size="sm" variant="secondary" icon={copied ? <Check /> : <Copy />} onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={() => onChange({})}>Reset to default</Button>
        <Button onClick={onSave} loading={saving}>Save brand kit</Button>
      </div>
    </div>
  );
}
