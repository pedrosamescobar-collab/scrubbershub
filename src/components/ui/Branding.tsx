import { useRef, useState } from 'react';
import { Check, ImagePlus } from 'lucide-react';
import { BRAND_PRESETS, contrastText, isValidHex } from '@/lib/brand';
import { OrgLogo } from './Misc';
import { Button } from './Button';

export function BrandColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [custom, setCustom] = useState(value);
  return (
    <div className="stack">
      <div className="color-swatches" role="radiogroup" aria-label="Brand color">
        {BRAND_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value.toLowerCase() === c.toLowerCase()}
            aria-label={`Color ${c}`}
            className="swatch"
            style={{ background: c, color: contrastText(c) }}
            onClick={() => { onChange(c); setCustom(c); }}
          >
            {value.toLowerCase() === c.toLowerCase() && <Check aria-hidden />}
          </button>
        ))}
      </div>
      <div className="row">
        <input
          type="color"
          aria-label="Custom color"
          value={isValidHex(value) ? value : '#0E9F8E'}
          onChange={(e) => { onChange(e.target.value.toUpperCase()); setCustom(e.target.value.toUpperCase()); }}
          style={{ width: 46, height: 46, border: 0, padding: 0, background: 'none', cursor: 'pointer' }}
        />
        <input
          className="input"
          style={{ maxWidth: 140 }}
          aria-label="Hex color"
          value={custom}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
            setCustom(v);
            if (isValidHex(v)) onChange(v.toUpperCase());
          }}
        />
      </div>
    </div>
  );
}

export function LogoUploader({
  name, url, onFile, uploading,
}: { name: string; url: string | null; onFile: (f: File) => void; uploading?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      className={`dropzone ${drag ? 'drag' : ''}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      aria-label="Upload logo"
    >
      <OrgLogo name={name} url={url} size="lg" />
      <div className="grow">
        <p className="strong">{url ? 'Replace logo' : 'Upload your logo'}</p>
        <p className="subtle">PNG, JPG, SVG or WebP · up to 2 MB · square works best</p>
      </div>
      <Button variant="secondary" size="sm" icon={<ImagePlus />} loading={uploading} tabIndex={-1}>
        {uploading ? 'Uploading' : 'Choose'}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
      />
    </div>
  );
}
