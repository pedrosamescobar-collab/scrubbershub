import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, CircleDollarSign, FilePlus2, FileText, Mail, Eye, Repeat, RotateCcw, Send, ThumbsDown, ThumbsUp, Receipt, Sparkles,
} from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useWorkspace } from '@/auth/AuthProvider';
import { addDays, dueText, fmtDay, money, moneyShort, todayIso, FREQUENCY_LABEL, type BillingActivity } from '@/lib/billing';
import { fmtAgo, fmtDate } from '@/lib/format';
import { ButtonLink, Button } from '@/components/ui/Button';
import { EmptyState, QueryState, SkeletonList, Alert } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import type { Job } from '@/lib/types';
import { BillingNav, DateRangePicker, InvoiceBadge, Stat, inRange, rangeFor, type DateRange } from './components';
import {
  useBillingActivity, useBillingConfig, useCurrency, useInvalidateBilling, useInvoices, usePayments, useRecurringRules, useRefunds,
} from './api';

const ACTIVITY_ICON: Record<string, typeof FileText> = {
  invoice_created: FilePlus2, invoice_updated: FileText, invoice_sent: Send, invoice_viewed: Eye, payment_received: CircleDollarSign,
  invoice_overdue: AlertTriangle, refund_issued: RotateCcw, estimate_approved: ThumbsUp, estimate_declined: ThumbsDown,
  recurring_invoice_generated: Repeat, reminder_sent: Mail, estimate_sent: Send, estimate_created: FilePlus2, invoice_cancelled: FileText,
  payment_failed: AlertTriangle,
};

export function activityLink(a: BillingActivity) {
  if (a.invoice_id) return `/billing/invoices/${a.invoice_id}`;
  if (a.estimate_id) return `/billing/estimates/${a.estimate_id}`;
  if (a.client_id) return `/clients/${a.client_id}`;
  return null;
}

export function ActivityList({ items, currency, empty = 'Nothing yet.' }: { items: BillingActivity[]; currency: string; empty?: string }) {
  if (!items.length) return <p className="subtle card-body">{empty}</p>;
  return (
    <div className="card-body timeline">
      {items.map((a) => {
        const Icon = ACTIVITY_ICON[a.type] ?? Receipt;
        const link = activityLink(a);
        const text = <span className="small strong">{a.message}</span>;
        return (
          <div key={a.id} className="ev">
            <span className={`ic ${a.type === 'payment_received' ? 'ic-green' : a.type.includes('overdue') || a.type.includes('failed') ? 'ic-red' : ''}`}><Icon aria-hidden /></span>
            <span className="grow">
              {link ? <Link to={link} style={{ color: 'inherit' }}>{text}</Link> : text}
              <span className="subtle" style={{ display: 'block' }}>{fmtAgo(a.created_at)}{a.amount !== null && a.type === 'payment_received' ? ` · ${money(a.amount, currency)}` : ''}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Completed jobs that don't have an invoice yet (last 60 days). */
function useReadyToInvoice() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: ['billing', 'ready', ws.org.id],
    queryFn: async () => {
      const since = new Date(Date.now() - 60 * 864e5).toISOString();
      const [jobs, invs] = await Promise.all([
        supabase.from('jobs').select('id, service_name, scheduled_start, completed_at, client:clients(id, full_name)')
          .eq('org_id', ws.org.id).eq('status', 'completed').gte('completed_at', since).order('completed_at', { ascending: false }).limit(200),
        supabase.from('invoices').select('job_id').eq('org_id', ws.org.id).not('job_id', 'is', null).is('voided_at', null).limit(2000),
      ]);
      const billed = new Set((unwrap(invs) as { job_id: string }[]).map((i) => i.job_id));
      return (unwrap(jobs) as unknown as Job[]).filter((j) => !billed.has(j.id));
    },
  });
}

export function BillingOverviewPage() {
  const ws = useWorkspace();
  const currency = useCurrency();
  const [range, setRange] = useState<DateRange>(rangeFor('month'));
  const invoices = useInvoices();
  const payments = usePayments();
  const refunds = useRefunds();
  const rules = useRecurringRules();
  const activity = useBillingActivity(100);
  const ready = useReadyToInvoice();
  const config = useBillingConfig();
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidateBilling();

  const createFromJob = useMutation({
    mutationFn: async (jobId: string) => unwrap(await supabase.rpc('create_invoice_from_job', { p_job: jobId })) as string,
    onSuccess: (id) => { invalidate(); navigate(`/billing/invoices/${id}/edit`); },
    onError: (e) => toast.error(e),
  });

  const stats = useMemo(() => {
    const inv = invoices.data ?? [];
    const pays = payments.data ?? [];
    const refs = refunds.data ?? [];
    const live = inv.filter((i) => i.status !== 'draft' && i.status !== 'cancelled');
    const invoiced = live.filter((i) => inRange(i.issue_date, range)).reduce((a, i) => a + Number(i.total), 0);
    const collected = pays.filter((p) => p.status !== 'failed' && inRange(p.paid_at, range)).reduce((a, p) => a + Number(p.amount) + Number(p.tip_amount), 0)
      - refs.filter((r) => r.status === 'succeeded' && inRange(r.created_at, range)).reduce((a, r) => a + Number(r.amount), 0);
    const open = live.filter((i) => Number(i.balance_due) > 0);
    const overdue = open.filter((i) => i.status === 'overdue');
    const month = rangeFor('month');
    const thisMonth = pays.filter((p) => p.status !== 'failed' && inRange(p.paid_at, month));
    const upcomingEnd = addDays(todayIso(), 14);
    const upcoming = (rules.data ?? []).filter((r) => r.status === 'active' && r.next_run_date <= upcomingEnd);
    return {
      invoiced, collected,
      outstanding: open.reduce((a, i) => a + Number(i.balance_due), 0),
      overdueAmt: overdue.reduce((a, i) => a + Number(i.balance_due), 0),
      monthAmt: thisMonth.reduce((a, p) => a + Number(p.amount) + Number(p.tip_amount), 0),
      monthCount: thisMonth.length,
      open, overdue, upcoming,
    };
  }, [invoices.data, payments.data, refunds.data, rules.data, range]);

  const loading = invoices.isLoading || payments.isLoading;
  const shownActivity = (activity.data ?? []).filter((a) => inRange(a.created_at, range)).slice(0, 25);

  return (
    <>
      <PageHeader title="Billing" sub={`Money in and out for ${ws.org.name}`}
        actions={<><ButtonLink to="/billing/estimates/new" variant="secondary" icon={<FileText />}>New estimate</ButtonLink><ButtonLink to="/billing/invoices/new" icon={<FilePlus2 />}>New invoice</ButtonLink></>} />
      <BillingNav />

      {config.data && !config.data.online_payments && (
        <Alert tone="info">
          <strong>Online card payments aren’t switched on yet.</strong> Everything else works: create and send invoices, and record cash, check or bank payments.
          To let clients pay online, add your Stripe keys (see <Link to="/billing/settings">Billing settings → Online payments</Link>).
        </Alert>
      )}

      <div className="row-between wrap mt-16">
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {loading ? <div className="mt-16"><SkeletonList rows={2} height={90} /></div> : (
        <>
          <div className="stats mt-16">
            <Stat label="Total invoiced" value={moneyShort(stats.invoiced, currency)} sub="in this period" />
            <Stat label="Total collected" value={moneyShort(stats.collected, currency)} tone="green" sub="incl. tips, after refunds" />
            <Stat label="Outstanding" value={moneyShort(stats.outstanding, currency)} sub={`${stats.open.length} open invoice${stats.open.length === 1 ? '' : 's'}`} to="/billing/invoices?status=open" />
            <Stat label="Overdue" value={moneyShort(stats.overdueAmt, currency)} tone={stats.overdueAmt > 0 ? 'red' : undefined} sub={`${stats.overdue.length} overdue`} to="/billing/invoices?status=overdue" />
          </div>
          <div className="stats mt-8">
            <Stat label="Received this month" value={moneyShort(stats.monthAmt, currency)} sub={`${stats.monthCount} payment${stats.monthCount === 1 ? '' : 's'}`} to="/billing/payments" />
            <Stat label="Open invoices" value={String(stats.open.length)} to="/billing/invoices?status=open" />
            <Stat label="Overdue invoices" value={String(stats.overdue.length)} tone={stats.overdue.length ? 'red' : undefined} to="/billing/invoices?status=overdue" />
            <Stat label="Upcoming recurring" value={String(stats.upcoming.length)} sub="next 14 days" to="/billing/recurring" />
          </div>
        </>
      )}

      <div className="grid-2-lg mt-16">
        <div className="stack" style={{ ['--gap' as string]: '16px' }}>
          <div className="card">
            <div className="card-header"><h2>Ready to invoice</h2><span className="subtle">Completed jobs without an invoice</span></div>
            <QueryState query={ready} skeleton={<div className="card-body"><SkeletonList rows={2} height={50} /></div>}>
              {(jobs) => jobs.length === 0 ? (
                <div className="card-body row"><CheckCircle2 size={18} color="var(--green)" aria-hidden /><span className="muted small">All completed jobs are invoiced.</span></div>
              ) : (
                <div className="list mt-8">
                  {jobs.slice(0, 8).map((j) => (
                    <div key={j.id} className="list-item">
                      <span className="grow">
                        <Link to={`/jobs/${j.id}`} className="strong" style={{ color: 'inherit' }}>{(j.client as any)?.full_name ?? 'Client'}</Link>
                        <span className="muted small" style={{ display: 'block' }}>{j.service_name} · done {fmtDate(j.completed_at ?? j.scheduled_start)}</span>
                      </span>
                      <Button size="sm" icon={<FilePlus2 />} loading={createFromJob.isPending && createFromJob.variables === j.id} onClick={() => createFromJob.mutate(j.id)}>Create invoice</Button>
                    </div>
                  ))}
                  {jobs.length > 8 && <p className="subtle card-body">+ {jobs.length - 8} more</p>}
                </div>
              )}
            </QueryState>
          </div>

          <div className="card">
            <div className="card-header"><h2>Needs attention</h2><Link to="/billing/invoices?status=open" className="small strong">All open →</Link></div>
            {stats.open.length === 0 ? <EmptyState icon={<Sparkles />} title="Nothing outstanding">Every sent invoice is paid.</EmptyState> : (
              <div className="list mt-8">
                {[...stats.open].sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 6).map((i) => (
                  <Link key={i.id} to={`/billing/invoices/${i.id}`} className="list-item">
                    <span className="grow">
                      <span className="row-between"><span className="strong truncate">{i.client?.full_name}</span><span className="strong">{money(i.balance_due, currency)}</span></span>
                      <span className="row-between"><span className="muted small">{i.number} · {dueText(i)}</span><InvoiceBadge status={i.status} /></span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {stats.upcoming.length > 0 && (
            <div className="card">
              <div className="card-header"><h2>Upcoming recurring invoices</h2><Link to="/billing/recurring" className="small strong">Manage →</Link></div>
              <div className="list mt-8">
                {stats.upcoming.map((r) => (
                  <div key={r.id} className="list-item">
                    <span className="grow"><span className="strong">{r.client?.full_name}</span><span className="muted small" style={{ display: 'block' }}>{r.name} · {FREQUENCY_LABEL[r.frequency]}</span></span>
                    <span className="subtle">{fmtDay(r.next_run_date)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header"><h2>Recent activity</h2></div>
          <QueryState query={activity} skeleton={<div className="card-body"><SkeletonList rows={4} height={40} /></div>}>
            {() => <ActivityList items={shownActivity} currency={currency} empty="No billing activity in this period." />}
          </QueryState>
        </div>
      </div>
    </>
  );
}
