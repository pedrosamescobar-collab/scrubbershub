import { Wordmark } from '@/features/auth/AuthPages';

/** Shown when the Supabase environment variables are missing, instead of a blank screen. */
export function SetupScreen() {
  return (
    <div className="setup-screen stack" style={{ ['--gap' as string]: '18px' }}>
      <Wordmark />
      <div className="card card-pad stack">
        <h1>Connect your backend</h1>
        <p className="muted">ScrubHub needs a Supabase project. Add these environment variables, then rebuild:</p>
        <ul className="stack" style={{ paddingLeft: 18, margin: 0 }}>
          <li><code>VITE_SUPABASE_URL</code> — Supabase → Project Settings → API → Project URL</li>
          <li><code>VITE_SUPABASE_ANON_KEY</code> — the <em>anon public</em> key on the same page</li>
        </ul>
        <p className="muted small">Locally: copy <code>.env.example</code> to <code>.env</code>. On Netlify: Site configuration → Environment variables, then trigger a new deploy. Full steps are in the README.</p>
      </div>
    </div>
  );
}
