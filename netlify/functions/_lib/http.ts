import type { SupabaseClient, User } from '@supabase/supabase-js';

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const fail = (message: string, status = 400) => json({ error: message }, status);

/** The signed-in Supabase user behind the request's Bearer token, or null. */
export async function requestUser(req: Request, db: SupabaseClient): Promise<User | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error) return null;
  return data.user ?? null;
}

/** Is this user an active owner/admin of the org? */
export async function isOrgAdmin(db: SupabaseClient, orgId: string, userId: string) {
  const { data } = await db.from('memberships').select('id')
    .eq('org_id', orgId).eq('user_id', userId).eq('status', 'active').in('role', ['owner', 'admin']).limit(1);
  return (data ?? []).length > 0;
}

/** Public site URL for redirects/links (never trust a client-sent origin). */
export function appUrl(req: Request) {
  const configured = (process.env.APP_URL || process.env.URL || '').replace(/\/$/, '');
  return configured || new URL(req.url).origin;
}

/** Only allow in-app relative return paths. */
export function safePath(p: unknown, fallback: string) {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && p.length < 300 ? p : fallback;
}
