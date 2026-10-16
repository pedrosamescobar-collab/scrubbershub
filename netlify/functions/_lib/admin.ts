import { createClient } from '@supabase/supabase-js';

/** Service-role client. Server-side only — never import this from src/. */
export function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Netlify environment variables.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
