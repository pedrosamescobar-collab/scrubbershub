import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { friendlyError } from '@/lib/format';

type Tone = 'success' | 'error' | 'info';
interface ToastItem { id: number; tone: Tone; message: string }
interface ToastApi {
  success: (m: string) => void;
  error: (e: unknown) => void;
  info: (m: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);
let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: Tone, message: string) => {
    const id = seq++;
    setItems((x) => [...x.slice(-2), { id, tone, message }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'error' ? 5200 : 3200);
  }, []);
  const api: ToastApi = {
    success: (m) => push('success', m),
    info: (m) => push('info', m),
    error: (e) => push('error', friendlyError(e)),
  };
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            {t.tone === 'success' ? <CheckCircle2 /> : t.tone === 'error' ? <AlertCircle /> : <Info />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast outside ToastProvider');
  return c;
}
