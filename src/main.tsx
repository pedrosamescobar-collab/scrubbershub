import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ToastProvider } from './components/ui/Toast';
import { isSupabaseConfigured } from './lib/supabase';
import { SetupScreen } from './SetupScreen';
import './styles/global.css';
import { applyTheme, cachedBranding } from './lib/brand';

// First paint in the last company's look (login screen, splash) — replaced once signed in.
const lastBrand = cachedBranding();
if (lastBrand) applyTheme(lastBrand.brand_color, lastBrand.theme);

registerSW({ immediate: true });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: true },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSupabaseConfigured ? (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    ) : (
      <SetupScreen />
    )}
  </StrictMode>,
);
