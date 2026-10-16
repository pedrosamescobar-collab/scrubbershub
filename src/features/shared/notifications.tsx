import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, CalendarCheck, CheckCircle2, MessageSquare, Star, UserPlus, Package } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import type { AppNotification } from '@/lib/types';
import { fmtAgo } from '@/lib/format';
import { EmptyState, QueryState } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';

const KEY = (orgId?: string) => ['notifications', orgId];

function useNotificationsQuery() {
  const { user, workspace } = useAuth();
  const orgId = workspace?.org.id;

  const q = useQuery({
    queryKey: KEY(orgId),
    enabled: !!user && !!orgId,
    queryFn: async () =>
      unwrap(
        await supabase.from('notifications').select('*')
          .eq('user_id', user!.id).eq('org_id', orgId!)
          .order('created_at', { ascending: false }).limit(60),
      ) as AppNotification[],
  });

  return q;
}

/** Mount once (in the app shell): streams new notifications into the cache. */
export function useNotificationsRealtime() {
  const { user, workspace } = useAuth();
  const qc = useQueryClient();
  const orgId = workspace?.org.id;
  useEffect(() => {
    if (!user || !orgId) return;
    const ch = supabase
      .channel(`notif-${user.id}-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: KEY(orgId) }))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [user, orgId, qc]);
}

export function useUnreadCount() {
  const q = useNotificationsQuery();
  return (q.data ?? []).filter((n) => !n.read_at).length;
}

const ICONS: Record<string, typeof Bell> = {
  job_assigned: UserPlus,
  job_reminder: BellRing,
  appointment_reminder: CalendarCheck,
  job_completed: CheckCircle2,
  review_request: Star,
  review_received: Star,
  client_note: MessageSquare,
  low_stock: Package,
};

/** Admin links are stored as /jobs/..; for other roles the link already points into their area. */
export function NotificationsPage({ title = 'Notifications' }: { title?: string }) {
  const q = useNotificationsQuery();
  const { workspace } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const markAll = useMutation({
    mutationFn: async () => {
      unwrap(await supabase.from('notifications').update({ read_at: new Date().toISOString() })
        .is('read_at', null).eq('org_id', workspace!.org.id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY(workspace?.org.id) }),
  });

  const open = async (n: AppNotification) => {
    if (!n.read_at) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
      void qc.invalidateQueries({ queryKey: KEY(workspace?.org.id) });
    }
    if (n.link) navigate(n.link);
  };

  const unread = (q.data ?? []).filter((n) => !n.read_at).length;

  return (
    <>
      <PageHeader
        title={title}
        sub={unread ? `${unread} unread` : 'You’re all caught up'}
        actions={unread > 0 && <Button variant="secondary" size="sm" onClick={() => markAll.mutate()} loading={markAll.isPending}>Mark all read</Button>}
      />
      <QueryState query={q}>
        {(items) =>
          items.length === 0 ? (
            <div className="card"><EmptyState icon={<Bell />} title="No notifications yet">Reminders, new assignments and reviews will show up here.</EmptyState></div>
          ) : (
            <div className="card list">
              {items.map((n) => {
                const Icon = ICONS[n.type] ?? Bell;
                return (
                  <button key={n.id} className="list-item" onClick={() => open(n)}>
                    <span className="avatar" style={!n.read_at ? undefined : { background: 'var(--gray-soft)', color: 'var(--text-3)' }}><Icon size={18} aria-hidden /></span>
                    <span className="grow">
                      <span className="row-between">
                        <span className={n.read_at ? '' : 'strong'}>{n.title}</span>
                        <span className="subtle" style={{ flexShrink: 0 }}>{fmtAgo(n.created_at)}</span>
                      </span>
                      {n.body && <span className="muted small" style={{ display: 'block' }}>{n.body}</span>}
                    </span>
                    {!n.read_at && <span className="dot" style={{ background: 'var(--brand)' }} aria-label="Unread" />}
                  </button>
                );
              })}
            </div>
          )
        }
      </QueryState>
    </>
  );
}
