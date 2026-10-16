-- =============================================================================
-- ScrubHub — Billing: invoices, estimates, payments, refunds, recurring billing,
-- service catalog, reminders and billing settings.
-- Run this once in the Supabase SQL editor AFTER 0001_scrubhub_schema.sql.
--
-- Security model
--   * Every billing row carries org_id and is isolated with RLS.
--   * Owners/admins manage billing. Employees see nothing unless an admin turns
--     on "billing access" for them (read-only).
--   * Clients never read billing tables directly. They go through SECURITY
--     DEFINER functions (my_billing, get_my_invoice, get_public_invoice …) that
--     return only client-safe fields — internal notes never leave the database.
--   * Money-changing actions (payments, refunds, sending, voiding) happen only
--     in the functions below; totals and status are always recomputed by
--     triggers, so the browser can never set an amount paid or a balance.
--   * Card data never touches this database. Online payments go through
--     Stripe Checkout; we store only Stripe ids, card brand and last 4.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Permissions helper + team billing access
-- ---------------------------------------------------------------------------
alter table public.employees add column if not exists billing_access boolean not null default false;

create or replace function public.can_view_billing(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_org_admin(p_org) or exists (
    select 1 from public.employees e
    where e.org_id = p_org and e.user_id = auth.uid() and e.status = 'active' and e.billing_access
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table public.billing_settings (
  org_id                  uuid primary key references public.organizations(id) on delete cascade,
  currency                text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  tax_rate                numeric(6,3) not null default 0 check (tax_rate between 0 and 100),
  tax_label               text not null default 'Sales tax' check (char_length(tax_label) <= 40),
  payment_terms_days      int  not null default 14 check (payment_terms_days between 0 and 365),
  invoice_prefix          text not null default 'INV-' check (char_length(invoice_prefix) <= 12),
  next_invoice_number     int  not null default 1001 check (next_invoice_number > 0),
  estimate_prefix         text not null default 'EST-' check (char_length(estimate_prefix) <= 12),
  next_estimate_number    int  not null default 1001 check (next_estimate_number > 0),
  estimate_valid_days     int  not null default 30 check (estimate_valid_days between 1 and 365),
  default_invoice_notes   text default 'Thank you for your business!',
  default_terms           text,
  payment_instructions    text,
  accepted_methods        text[] not null default '{card,ach,cash,check}',
  tips_enabled            boolean not null default true,
  tip_presets             int[] not null default '{15,20,25}',
  autopay_enabled         boolean not null default true,
  reminders_enabled       boolean not null default true,
  reminder_offsets        int[] not null default '{-3,0,3,7}',   -- days relative to due date
  reminder_channels       text[] not null default '{email,in_app}',
  send_receipts           boolean not null default true,
  receipt_message         text default 'Thank you! Your payment has been received.',
  -- Stripe Connect account that receives this company's payments (acct_…).
  -- Written only by the server (onboarding flow / platform admin), never the browser.
  stripe_account_id       text,
  updated_at              timestamptz not null default now()
);

create table public.service_catalog (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 120),
  description    text,
  default_price  numeric(12,2) not null default 0 check (default_price >= 0),
  pricing_type   text not null default 'flat' check (pricing_type in ('flat','hourly','per_room','per_unit','custom')),
  unit_label     text,
  taxable        boolean not null default true,
  is_active      boolean not null default true,
  position       int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on public.service_catalog (org_id);

create table public.estimates (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  number           text not null,
  status           text not null default 'draft'
                     check (status in ('draft','sent','viewed','approved','declined','expired')),
  issue_date       date not null default current_date,
  valid_until      date,
  service_address  text,
  title            text,
  notes            text,
  terms            text,
  internal_notes   text,
  discount_type    text not null default 'amount' check (discount_type in ('amount','percent')),
  discount_value   numeric(12,2) not null default 0 check (discount_value >= 0),
  tax_rate         numeric(6,3) not null default 0 check (tax_rate between 0 and 100),
  subtotal         numeric(12,2) not null default 0,
  discount_total   numeric(12,2) not null default 0,
  tax_total        numeric(12,2) not null default 0,
  total            numeric(12,2) not null default 0,
  public_token     text not null unique default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
  sent_at          timestamptz,
  viewed_at        timestamptz,
  approved_at      timestamptz,
  declined_at      timestamptz,
  client_response  text,
  invoice_id       uuid,
  appointment_id   uuid references public.appointments(id) on delete set null,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, number)
);
create index on public.estimates (org_id, created_at desc);
create index on public.estimates (client_id);

create table public.estimate_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  estimate_id   uuid not null references public.estimates(id) on delete cascade,
  service_id    uuid references public.service_catalog(id) on delete set null,
  description   text not null check (char_length(description) between 1 and 500),
  quantity      numeric(10,2) not null default 1 check (quantity > 0),
  unit_price    numeric(12,2) not null default 0 check (unit_price >= 0),
  taxable       boolean not null default true,
  is_optional   boolean not null default false,
  is_selected   boolean not null default true,
  position      int not null default 0,
  line_total    numeric(12,2) generated always as (round(quantity * unit_price, 2)) stored
);
create index on public.estimate_items (estimate_id);

create table public.recurring_billing_rules (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  client_id       uuid not null references public.clients(id) on delete cascade,
  appointment_id  uuid references public.appointments(id) on delete set null,
  name            text not null default 'Recurring cleaning' check (char_length(name) between 1 and 120),
  frequency       text not null default 'monthly' check (frequency in ('weekly','biweekly','every_4_weeks','monthly','custom')),
  interval_days   int check (interval_days between 1 and 365),
  next_run_date   date not null,
  end_date        date,
  mode            text not null default 'draft' check (mode in ('draft','send','autocharge')),
  status          text not null default 'active' check (status in ('active','paused','cancelled')),
  items           jsonb not null default '[]'::jsonb,   -- [{description, quantity, unit_price, taxable, service_id}]
  notes           text,
  last_run_at     timestamptz,
  last_invoice_id uuid,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (frequency <> 'custom' or interval_days is not null),
  check (jsonb_typeof(items) = 'array')
);
create index on public.recurring_billing_rules (org_id);
create index on public.recurring_billing_rules (next_run_date) where status = 'active';

create table public.invoices (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  client_id             uuid not null references public.clients(id) on delete restrict,
  job_id                uuid references public.jobs(id) on delete set null,
  appointment_id        uuid references public.appointments(id) on delete set null,
  estimate_id           uuid references public.estimates(id) on delete set null,
  recurring_rule_id     uuid references public.recurring_billing_rules(id) on delete set null,
  number                text not null,
  status                text not null default 'draft'
                          check (status in ('draft','sent','viewed','partially_paid','paid','overdue','cancelled','refunded')),
  issue_date            date not null default current_date,
  due_date              date not null default current_date,
  service_address       text,
  notes                 text,
  terms                 text,
  internal_notes        text,        -- admins only; never returned to clients
  discount_type         text not null default 'amount' check (discount_type in ('amount','percent')),
  discount_value        numeric(12,2) not null default 0 check (discount_value >= 0),
  tax_rate              numeric(6,3) not null default 0 check (tax_rate between 0 and 100),
  credit_amount         numeric(12,2) not null default 0 check (credit_amount >= 0),
  -- everything below is computed by invoice_compute(); writes are overwritten
  subtotal              numeric(12,2) not null default 0,
  discount_total        numeric(12,2) not null default 0,
  tax_total             numeric(12,2) not null default 0,
  total                 numeric(12,2) not null default 0,
  amount_paid           numeric(12,2) not null default 0,
  tip_total             numeric(12,2) not null default 0,
  amount_refunded       numeric(12,2) not null default 0,
  balance_due           numeric(12,2) not null default 0,
  paid_at               timestamptz,
  --
  public_token          text not null unique default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
  sent_at               timestamptz,
  last_sent_at          timestamptz,
  viewed_at             timestamptz,
  voided_at             timestamptz,
  void_reason           text,
  overdue_notified_at   timestamptz,
  autopay_requested_at  timestamptz,
  autopay_attempted_at  timestamptz,
  autopay_error         text,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id, number)
);
create index on public.invoices (org_id, issue_date desc);
create index on public.invoices (client_id);
create index on public.invoices (job_id);
create index on public.invoices (org_id, status);

alter table public.estimates add constraint estimates_invoice_fk foreign key (invoice_id) references public.invoices(id) on delete set null;
alter table public.recurring_billing_rules add constraint rbr_last_invoice_fk foreign key (last_invoice_id) references public.invoices(id) on delete set null;

create table public.invoice_items (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  invoice_id   uuid not null references public.invoices(id) on delete cascade,
  service_id   uuid references public.service_catalog(id) on delete set null,
  description  text not null check (char_length(description) between 1 and 500),
  quantity     numeric(10,2) not null default 1 check (quantity > 0),
  unit_price   numeric(12,2) not null default 0 check (unit_price >= 0),
  taxable      boolean not null default true,
  position     int not null default 0,
  line_total   numeric(12,2) generated always as (round(quantity * unit_price, 2)) stored
);
create index on public.invoice_items (invoice_id);

-- Stripe customer per client (server-only)
create table public.billing_customers (
  client_id           uuid primary key references public.clients(id) on delete cascade,
  org_id              uuid not null references public.organizations(id) on delete cascade,
  stripe_customer_id  text not null,
  created_at          timestamptz not null default now()
);

-- Saved payment methods: Stripe references + display info only. Never card numbers.
create table public.payment_methods (
  id                            uuid primary key default gen_random_uuid(),
  org_id                        uuid not null references public.organizations(id) on delete cascade,
  client_id                     uuid not null references public.clients(id) on delete cascade,
  processor                     text not null default 'stripe',
  processor_customer_id         text,
  processor_payment_method_id   text not null,
  kind                          text not null default 'card' check (kind in ('card','us_bank_account','other')),
  brand                         text,
  last4                         text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  exp_month                     int,
  exp_year                      int,
  is_default                    boolean not null default true,
  autopay_enabled               boolean not null default false,
  created_at                    timestamptz not null default now(),
  unique (processor, processor_payment_method_id)
);
create index on public.payment_methods (client_id);

create table public.payments (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  invoice_id             uuid not null references public.invoices(id) on delete restrict,
  client_id              uuid not null references public.clients(id) on delete restrict,
  amount                 numeric(12,2) not null check (amount >= 0),   -- applied to the invoice
  tip_amount             numeric(12,2) not null default 0 check (tip_amount >= 0),
  amount_refunded        numeric(12,2) not null default 0,
  method                 text not null check (method in ('card','debit_card','ach','cash','check','other')),
  status                 text not null default 'succeeded'
                           check (status in ('pending','succeeded','failed','refunded','partially_refunded')),
  processor              text not null default 'manual' check (processor in ('manual','stripe')),
  processor_payment_id   text unique,
  card_brand             text,
  card_last4             text,
  reference              text,        -- check number, transaction reference …
  notes                  text,        -- shown on the receipt
  receipt_number         text not null,
  is_deposit             boolean not null default false,
  paid_at                timestamptz not null default now(),
  recorded_by            uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  check (amount + tip_amount > 0)
);
create index on public.payments (org_id, paid_at desc);
create index on public.payments (invoice_id);
create index on public.payments (client_id);

create table public.refunds (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  payment_id           uuid not null references public.payments(id) on delete restrict,
  invoice_id           uuid not null references public.invoices(id) on delete restrict,
  amount               numeric(12,2) not null check (amount > 0),
  reason               text,
  status               text not null default 'succeeded' check (status in ('pending','succeeded','failed')),
  processor_refund_id  text unique,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now()
);
create index on public.refunds (org_id, created_at desc);
create index on public.refunds (payment_id);

create table public.invoice_reminders (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  invoice_id   uuid not null references public.invoices(id) on delete cascade,
  kind         text not null check (kind in ('before_due','on_due','overdue','manual')),
  days_offset  int,
  sent_at      timestamptz not null default now(),
  sent_by      uuid references auth.users(id) on delete set null
);
create index on public.invoice_reminders (invoice_id);
create unique index invoice_reminders_auto_uq on public.invoice_reminders (invoice_id, days_offset) where kind <> 'manual';

create table public.billing_activity (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  type         text not null,
  message      text not null,
  amount       numeric(12,2),
  invoice_id   uuid references public.invoices(id) on delete cascade,
  estimate_id  uuid references public.estimates(id) on delete cascade,
  payment_id   uuid references public.payments(id) on delete set null,
  client_id    uuid references public.clients(id) on delete set null,
  actor_id     uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index on public.billing_activity (org_id, created_at desc);
create index on public.billing_activity (invoice_id);
create index on public.billing_activity (estimate_id);

-- Email / SMS to clients who don't have a portal login yet (server-only)
create table public.billing_outbox (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  type             text not null,
  to_email         text,
  to_phone         text,
  subject          text not null,
  body             text,
  link             text,
  delivery_status  text not null default 'pending' check (delivery_status in ('pending','sent','skipped','failed')),
  delivery_log     jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index on public.billing_outbox (delivery_status) where delivery_status = 'pending';

-- updated_at + org_id guards
create trigger t_bset_upd  before update on public.billing_settings        for each row execute function public.set_updated_at();
create trigger t_svc_upd   before update on public.service_catalog         for each row execute function public.set_updated_at();
create trigger t_rbr_upd   before update on public.recurring_billing_rules for each row execute function public.set_updated_at();
do $$
declare t text;
begin
  foreach t in array array['service_catalog','estimates','estimate_items','recurring_billing_rules','invoices',
    'invoice_items','payment_methods','payments','refunds','invoice_reminders','billing_activity'] loop
    execute format('create trigger t_%s_orgguard before update on public.%I for each row execute function public.guard_org_id()', t, t);
  end loop;
end $$;

-- Stripe account id can only be set by the server
create or replace function public.guard_billing_settings()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated','anon') and new.stripe_account_id is distinct from old.stripe_account_id then
    raise exception 'The payment account is connected from the server, not edited here';
  end if;
  return new;
end $$;
create trigger t_bset_guard before update on public.billing_settings for each row execute function public.guard_billing_settings();

-- Recurring rules: client / appointment must belong to the same company
create or replace function public.guard_rule_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.clients where id = new.client_id and org_id = new.org_id) then
    raise exception 'Cross-organization reference rejected on recurring_billing_rules';
  end if;
  if new.appointment_id is not null and not exists (select 1 from public.appointments where id = new.appointment_id and org_id = new.org_id) then
    raise exception 'Cross-organization reference rejected on recurring_billing_rules';
  end if;
  return new;
end $$;
create trigger t_rbr_sameorg before insert or update on public.recurring_billing_rules for each row execute function public.guard_rule_org();

-- ---------------------------------------------------------------------------
-- 3. Totals + status (always computed server-side)
-- ---------------------------------------------------------------------------
create or replace function public.invoice_compute()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sub numeric; v_taxable numeric; v_disc numeric; v_base numeric;
        v_paid numeric; v_tips numeric; v_ref numeric;
begin
  select coalesce(sum(line_total), 0), coalesce(sum(line_total) filter (where taxable), 0)
    into v_sub, v_taxable from public.invoice_items where invoice_id = new.id;
  new.subtotal := v_sub;
  v_disc := case when new.discount_type = 'percent' then round(v_sub * least(new.discount_value, 100) / 100, 2)
                 else new.discount_value end;
  new.discount_total := least(v_disc, v_sub);
  -- discount is spread proportionally over taxable and non-taxable lines
  v_base := case when v_sub > 0 then v_taxable - new.discount_total * (v_taxable / v_sub) else 0 end;
  new.tax_total := round(greatest(v_base, 0) * new.tax_rate / 100, 2);
  new.total := greatest(v_sub - new.discount_total + new.tax_total - new.credit_amount, 0);

  select coalesce(sum(amount), 0), coalesce(sum(tip_amount), 0) into v_paid, v_tips
    from public.payments where invoice_id = new.id and status in ('succeeded','refunded','partially_refunded');
  select coalesce(sum(amount), 0) into v_ref from public.refunds where invoice_id = new.id and status = 'succeeded';
  new.amount_paid := v_paid;
  new.tip_total := v_tips;
  new.amount_refunded := v_ref;
  new.balance_due := greatest(new.total - v_paid, 0);

  new.status := case
    when new.voided_at is not null then 'cancelled'
    when v_ref > 0 and v_ref >= v_paid + v_tips then 'refunded'
    when new.sent_at is null and v_paid = 0 then 'draft'
    when new.balance_due = 0 and (v_paid > 0 or new.total = 0) then 'paid'
    when v_paid > 0 then 'partially_paid'
    when new.due_date < current_date then 'overdue'
    when new.viewed_at is not null then 'viewed'
    else 'sent' end;
  new.paid_at := case when new.status = 'paid' then coalesce(new.paid_at, now()) else null end;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;
create trigger t_invoice_compute before insert or update on public.invoices for each row execute function public.invoice_compute();

create or replace function public.estimate_compute()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sub numeric; v_taxable numeric; v_base numeric;
begin
  select coalesce(sum(line_total), 0), coalesce(sum(line_total) filter (where taxable), 0)
    into v_sub, v_taxable from public.estimate_items
   where estimate_id = new.id and (not is_optional or is_selected);
  new.subtotal := v_sub;
  new.discount_total := least(case when new.discount_type = 'percent' then round(v_sub * least(new.discount_value, 100) / 100, 2)
                                   else new.discount_value end, v_sub);
  v_base := case when v_sub > 0 then v_taxable - new.discount_total * (v_taxable / v_sub) else 0 end;
  new.tax_total := round(greatest(v_base, 0) * new.tax_rate / 100, 2);
  new.total := greatest(v_sub - new.discount_total + new.tax_total, 0);
  new.status := case
    when new.declined_at is not null then 'declined'
    when new.approved_at is not null then 'approved'
    when new.sent_at is null then 'draft'
    when new.valid_until is not null and new.valid_until < current_date then 'expired'
    when new.viewed_at is not null then 'viewed'
    else 'sent' end;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;
create trigger t_estimate_compute before insert or update on public.estimates for each row execute function public.estimate_compute();

-- Child changes re-run the parent's computation
create or replace function public.touch_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.invoices set updated_at = now()
   where id in (case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end,
                case when tg_op = 'UPDATE' then old.invoice_id end);
  return null;
end $$;
create trigger t_items_touch    after insert or update or delete on public.invoice_items for each row execute function public.touch_invoice();
create trigger t_payments_touch after insert or update or delete on public.payments      for each row execute function public.touch_invoice();
create trigger t_refunds_touch  after insert or update or delete on public.refunds       for each row execute function public.touch_invoice();

create or replace function public.touch_estimate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.estimates set updated_at = now()
   where id = case when tg_op = 'DELETE' then old.estimate_id else new.estimate_id end;
  return null;
end $$;
create trigger t_est_items_touch after insert or update or delete on public.estimate_items for each row execute function public.touch_estimate();

-- Keep payment refund totals in sync
create or replace function public.refund_sync_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pid uuid := case when tg_op = 'DELETE' then old.payment_id else new.payment_id end; v_ref numeric;
begin
  select coalesce(sum(amount), 0) into v_ref from public.refunds where payment_id = v_pid and status = 'succeeded';
  update public.payments set amount_refunded = v_ref,
    status = case when v_ref <= 0 then 'succeeded' when v_ref >= amount + tip_amount then 'refunded' else 'partially_refunded' end
   where id = v_pid;
  return null;
end $$;
create trigger t_refund_sync after insert or update or delete on public.refunds for each row execute function public.refund_sync_payment();

-- ---------------------------------------------------------------------------
-- 4. Row-level security (clients use the functions in section 6 instead)
-- ---------------------------------------------------------------------------
alter table public.billing_settings        enable row level security;
alter table public.service_catalog         enable row level security;
alter table public.estimates               enable row level security;
alter table public.estimate_items          enable row level security;
alter table public.recurring_billing_rules enable row level security;
alter table public.invoices                enable row level security;
alter table public.invoice_items           enable row level security;
alter table public.billing_customers       enable row level security;
alter table public.payment_methods         enable row level security;
alter table public.payments                enable row level security;
alter table public.refunds                 enable row level security;
alter table public.invoice_reminders       enable row level security;
alter table public.billing_activity        enable row level security;
alter table public.billing_outbox          enable row level security;

create policy bset_select on public.billing_settings for select to authenticated using (public.can_view_billing(org_id));
create policy bset_update on public.billing_settings for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

create policy svc_select on public.service_catalog for select to authenticated using (public.can_view_billing(org_id));
create policy svc_write  on public.service_catalog for all    to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

create policy est_select on public.estimates for select to authenticated using (public.can_view_billing(org_id));
create policy est_update on public.estimates for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy est_delete on public.estimates for delete to authenticated using (public.is_org_admin(org_id) and status = 'draft');
create policy esti_select on public.estimate_items for select to authenticated using (public.can_view_billing(org_id));

create policy rbr_select on public.recurring_billing_rules for select to authenticated using (public.can_view_billing(org_id));
create policy rbr_write  on public.recurring_billing_rules for all    to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

create policy inv_select on public.invoices for select to authenticated using (public.can_view_billing(org_id));
create policy inv_update on public.invoices for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy inv_delete on public.invoices for delete to authenticated using (public.is_org_admin(org_id) and status = 'draft');
create policy invi_select on public.invoice_items for select to authenticated using (public.can_view_billing(org_id));

create policy pm_select  on public.payment_methods   for select to authenticated using (public.can_view_billing(org_id));
create policy pay_select on public.payments          for select to authenticated using (public.can_view_billing(org_id));
create policy ref_select on public.refunds           for select to authenticated using (public.can_view_billing(org_id));
create policy rem_select on public.invoice_reminders for select to authenticated using (public.can_view_billing(org_id));
create policy act_select on public.billing_activity  for select to authenticated using (public.can_view_billing(org_id));
-- billing_customers + billing_outbox: no policies → server (service role) only

-- ---------------------------------------------------------------------------
-- 5. Internal helpers
-- ---------------------------------------------------------------------------
create or replace function public.log_billing(p_org uuid, p_type text, p_message text, p_amount numeric,
  p_invoice uuid, p_estimate uuid, p_payment uuid, p_client uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.billing_activity (org_id, type, message, amount, invoice_id, estimate_id, payment_id, client_id, actor_id)
  values (p_org, p_type, p_message, p_amount, p_invoice, p_estimate, p_payment, p_client, auth.uid());
end $$;

-- Tell a client about something: in-app (+ email via dispatcher) when they have a
-- portal login, otherwise an email with a secure public link.
create or replace function public.notify_client(p_org uuid, p_client uuid, p_type text, p_title text, p_body text,
  p_portal_link text, p_public_link text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.clients%rowtype;
begin
  select * into c from public.clients where id = p_client;
  if not found then return; end if;
  if c.user_id is not null then
    perform public.notify_user(p_org, c.user_id, p_type, p_title, p_body, p_portal_link);
  elsif c.email is not null or c.phone is not null then
    insert into public.billing_outbox (org_id, type, to_email, to_phone, subject, body, link)
    values (p_org, p_type, c.email, c.phone, p_title, p_body, p_public_link);
  end if;
end $$;

create or replace function public.ensure_billing_settings(p_org uuid)
returns public.billing_settings language plpgsql security definer set search_path = public as $$
declare s public.billing_settings%rowtype;
begin
  insert into public.billing_settings (org_id) values (p_org) on conflict (org_id) do nothing;
  select * into s from public.billing_settings where org_id = p_org;
  return s;
end $$;

-- Editable starter services every new company gets
create or replace function public.seed_service_catalog(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.service_catalog where org_id = p_org) then return; end if;
  insert into public.service_catalog (org_id, name, description, default_price, pricing_type, unit_label, position) values
    (p_org, 'Standard Cleaning', 'Kitchen, bathrooms, dusting, floors and trash', 150, 'flat', null, 0),
    (p_org, 'Deep Cleaning', 'Top-to-bottom clean incl. baseboards, inside appliances on request', 275, 'flat', null, 1),
    (p_org, 'Move-In Cleaning', 'Empty home, cabinets and appliances inside and out', 325, 'flat', null, 2),
    (p_org, 'Move-Out Cleaning', 'Empty home, cabinets and appliances inside and out', 325, 'flat', null, 3),
    (p_org, 'Add-On Service', 'Inside oven, fridge, windows, laundry…', 40, 'per_unit', 'item', 4),
    (p_org, 'Hourly Labor', 'Billed per cleaner hour', 50, 'hourly', 'hour', 5),
    (p_org, 'Custom Service', null, 0, 'custom', null, 6);
end $$;

create or replace function public.trg_org_billing_setup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_billing_settings(new.id);
  perform public.seed_service_catalog(new.id);
  return new;
end $$;
create trigger t_org_billing_setup after insert on public.organizations for each row execute function public.trg_org_billing_setup();

-- Existing companies
do $$
declare o uuid;
begin
  for o in select id from public.organizations loop
    perform public.ensure_billing_settings(o);
    perform public.seed_service_catalog(o);
  end loop;
end $$;

create or replace function public.next_document_number(p_org uuid, p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare v_num int; v_prefix text;
begin
  perform public.ensure_billing_settings(p_org);
  if p_kind = 'invoice' then
    update public.billing_settings set next_invoice_number = next_invoice_number + 1
     where org_id = p_org returning next_invoice_number - 1, invoice_prefix into v_num, v_prefix;
    while exists (select 1 from public.invoices where org_id = p_org and number = v_prefix || v_num) loop
      update public.billing_settings set next_invoice_number = next_invoice_number + 1
       where org_id = p_org returning next_invoice_number - 1 into v_num;
    end loop;
  else
    update public.billing_settings set next_estimate_number = next_estimate_number + 1
     where org_id = p_org returning next_estimate_number - 1, estimate_prefix into v_num, v_prefix;
    while exists (select 1 from public.estimates where org_id = p_org and number = v_prefix || v_num) loop
      update public.billing_settings set next_estimate_number = next_estimate_number + 1
       where org_id = p_org returning next_estimate_number - 1 into v_num;
    end loop;
  end if;
  return v_prefix || v_num;
end $$;

create or replace function public.client_service_address(p_client uuid)
returns text language sql stable security definer set search_path = public as $$
  select nullif(concat_ws(', ', nullif(concat_ws(', ', c.address_line1, c.address_line2), ''),
                nullif(concat_ws(' ', nullif(concat_ws(', ', c.city, c.state), ''), c.postal_code), '')), '')
  from public.clients c where c.id = p_client;
$$;

create or replace function public.fmt_money(p numeric, p_currency text default 'USD')
returns text language sql immutable as $$
  select case when p_currency = 'USD' then '$' else p_currency || ' ' end || to_char(coalesce(p, 0), 'FM999,999,990.00');
$$;

-- Replace an invoice's / estimate's items from a JSON array
create or replace function public.set_invoice_items(p_invoice uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; it jsonb; i int := 0;
begin
  select org_id into v_org from public.invoices where id = p_invoice;
  delete from public.invoice_items where invoice_id = p_invoice;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if coalesce(trim(it->>'description'), '') = '' then continue; end if;
    insert into public.invoice_items (org_id, invoice_id, service_id, description, quantity, unit_price, taxable, position)
    values (v_org, p_invoice,
      (select id from public.service_catalog where id = public.try_uuid(it->>'service_id') and org_id = v_org),
      left(trim(it->>'description'), 500),
      greatest(coalesce((it->>'quantity')::numeric, 1), 0.01),
      greatest(coalesce((it->>'unit_price')::numeric, 0), 0),
      coalesce((it->>'taxable')::boolean, true), i);
    i := i + 1;
  end loop;
end $$;

create or replace function public.set_estimate_items(p_estimate uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; it jsonb; i int := 0;
begin
  select org_id into v_org from public.estimates where id = p_estimate;
  delete from public.estimate_items where estimate_id = p_estimate;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if coalesce(trim(it->>'description'), '') = '' then continue; end if;
    insert into public.estimate_items (org_id, estimate_id, service_id, description, quantity, unit_price, taxable, is_optional, is_selected, position)
    values (v_org, p_estimate,
      (select id from public.service_catalog where id = public.try_uuid(it->>'service_id') and org_id = v_org),
      left(trim(it->>'description'), 500),
      greatest(coalesce((it->>'quantity')::numeric, 1), 0.01),
      greatest(coalesce((it->>'unit_price')::numeric, 0), 0),
      coalesce((it->>'taxable')::boolean, true),
      coalesce((it->>'is_optional')::boolean, false),
      coalesce((it->>'is_selected')::boolean, not coalesce((it->>'is_optional')::boolean, false)), i);
    i := i + 1;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Admin RPCs — invoices
-- ---------------------------------------------------------------------------

-- Create or update an invoice with its line items. Returns the invoice id.
create or replace function public.save_invoice(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := public.try_uuid(p->>'id');
  v_org uuid := (p->>'org_id')::uuid;
  v_client uuid := (p->>'client_id')::uuid;
  v_job uuid := public.try_uuid(p->>'job_id');
  v_appt uuid := public.try_uuid(p->>'appointment_id');
  inv public.invoices%rowtype; s public.billing_settings%rowtype;
  v_issue date; v_new boolean := false;
begin
  if not public.is_org_admin(v_org) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.clients where id = v_client and org_id = v_org) then raise exception 'Client not found'; end if;
  if v_job is not null and not exists (select 1 from public.jobs where id = v_job and org_id = v_org) then raise exception 'Job not found'; end if;
  if v_appt is not null and not exists (select 1 from public.appointments where id = v_appt and org_id = v_org) then raise exception 'Appointment not found'; end if;
  s := public.ensure_billing_settings(v_org);
  v_issue := coalesce((p->>'issue_date')::date, current_date);

  if v_id is null then
    insert into public.invoices (org_id, client_id, number, created_by, tax_rate, notes, terms, issue_date, due_date)
    values (v_org, v_client, public.next_document_number(v_org, 'invoice'), auth.uid(), s.tax_rate,
            s.default_invoice_notes, s.default_terms, v_issue, v_issue + s.payment_terms_days)
    returning * into inv;
    v_id := inv.id; v_new := true;
  else
    select * into inv from public.invoices where id = v_id and org_id = v_org for update;
    if not found then raise exception 'Invoice not found'; end if;
    if inv.voided_at is not null then raise exception 'This invoice was cancelled and can no longer be edited'; end if;
  end if;

  update public.invoices set
    client_id       = v_client,
    job_id          = v_job,
    appointment_id  = coalesce(v_appt, (select appointment_id from public.jobs where id = v_job)),
    issue_date      = v_issue,
    due_date        = coalesce((p->>'due_date')::date, v_issue + s.payment_terms_days),
    service_address = coalesce(nullif(trim(p->>'service_address'), ''), public.client_service_address(v_client)),
    notes           = case when p ? 'notes' then nullif(trim(p->>'notes'), '') else notes end,
    terms           = case when p ? 'terms' then nullif(trim(p->>'terms'), '') else terms end,
    internal_notes  = case when p ? 'internal_notes' then nullif(trim(p->>'internal_notes'), '') else internal_notes end,
    discount_type   = coalesce(p->>'discount_type', discount_type),
    discount_value  = greatest(coalesce((p->>'discount_value')::numeric, discount_value), 0),
    tax_rate        = coalesce((p->>'tax_rate')::numeric, tax_rate),
    credit_amount   = greatest(coalesce((p->>'credit_amount')::numeric, credit_amount), 0)
  where id = v_id;

  if p ? 'items' then perform public.set_invoice_items(v_id, p->'items'); end if;
  select * into inv from public.invoices where id = v_id;
  if inv.amount_paid > inv.total then raise exception 'The invoice total can’t be less than what has already been paid (%)', public.fmt_money(inv.amount_paid, s.currency); end if;
  perform public.log_billing(v_org, case when v_new then 'invoice_created' else 'invoice_updated' end,
    case when v_new then 'Invoice ' || inv.number || ' created' else 'Invoice ' || inv.number || ' updated' end,
    inv.total, v_id, null, null, v_client);
  return v_id;
end $$;

-- Draft an invoice from a job: client, address and services pre-filled.
-- Returns the existing invoice if the job already has one.
create or replace function public.create_invoice_from_job(p_job uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare j public.jobs%rowtype; v_existing uuid; svc public.service_catalog%rowtype; v_items jsonb;
        v_hours numeric; v_price numeric; v_prev jsonb;
begin
  select * into j from public.jobs where id = p_job;
  if not found or not public.is_org_admin(j.org_id) then raise exception 'Not allowed'; end if;
  if j.status = 'cancelled' then raise exception 'This job was cancelled'; end if;
  select id into v_existing from public.invoices where job_id = p_job and voided_at is null order by created_at desc limit 1;
  if v_existing is not null then return v_existing; end if;

  -- 1) same series invoiced before → reuse those lines (keeps agreed pricing)
  select jsonb_agg(jsonb_build_object('service_id', ii.service_id, 'description', ii.description, 'quantity', ii.quantity,
                                      'unit_price', ii.unit_price, 'taxable', ii.taxable) order by ii.position)
    into v_prev
    from public.invoice_items ii
   where ii.invoice_id = (select i.id from public.invoices i where i.appointment_id = j.appointment_id and j.appointment_id is not null
                            and i.voided_at is null order by i.created_at desc limit 1);

  if v_prev is not null then
    v_items := v_prev;
  else
    -- 2) match the job's service to the catalog
    select * into svc from public.service_catalog
     where org_id = j.org_id and is_active and lower(name) = lower(j.service_name) limit 1;
    select coalesce(sum(extract(epoch from (coalesce(clock_out_at, now()) - clock_in_at))) / 3600, 0) into v_hours
      from public.time_entries where job_id = p_job;
    if v_hours <= 0 then v_hours := extract(epoch from (j.scheduled_end - j.scheduled_start)) / 3600; end if;
    v_hours := greatest(round(v_hours * 4) / 4, 0.25);
    v_price := coalesce(svc.default_price, 0);
    v_items := jsonb_build_array(jsonb_build_object(
      'service_id', svc.id,
      'description', j.service_name || ' — ' || to_char(coalesce(j.completed_at, j.scheduled_start), 'Mon DD, YYYY'),
      'quantity', case when svc.pricing_type = 'hourly' then v_hours else 1 end,
      'unit_price', v_price,
      'taxable', coalesce(svc.taxable, true)));
  end if;

  return public.save_invoice(jsonb_build_object(
    'org_id', j.org_id, 'client_id', j.client_id, 'job_id', j.id, 'appointment_id', j.appointment_id,
    'issue_date', current_date, 'items', v_items));
end $$;

create or replace function public.send_invoice(p_invoice uuid)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare inv public.invoices%rowtype; o public.organizations%rowtype; s public.billing_settings%rowtype;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if not found or not public.is_org_admin(inv.org_id) then raise exception 'Not allowed'; end if;
  if inv.voided_at is not null then raise exception 'This invoice was cancelled'; end if;
  if not exists (select 1 from public.invoice_items where invoice_id = p_invoice) then raise exception 'Add at least one line item before sending'; end if;
  select * into o from public.organizations where id = inv.org_id;
  s := public.ensure_billing_settings(inv.org_id);
  update public.invoices set sent_at = coalesce(sent_at, now()), last_sent_at = now() where id = p_invoice returning * into inv;
  perform public.log_billing(inv.org_id, 'invoice_sent', 'Invoice ' || inv.number || ' sent', inv.total, inv.id, null, null, inv.client_id);
  perform public.notify_client(inv.org_id, inv.client_id, 'invoice_sent',
    'New invoice from ' || o.name,
    'Invoice ' || inv.number || ' for ' || public.fmt_money(inv.balance_due, s.currency) || ' is due ' || to_char(inv.due_date, 'Mon DD') || '. Tap to view and pay.',
    '/portal/billing/invoices/' || inv.id, '/pay/' || inv.public_token);
  return inv;
end $$;

create or replace function public.duplicate_invoice(p_invoice uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv public.invoices%rowtype;
begin
  select * into inv from public.invoices where id = p_invoice;
  if not found or not public.is_org_admin(inv.org_id) then raise exception 'Not allowed'; end if;
  return public.save_invoice(jsonb_build_object(
    'org_id', inv.org_id, 'client_id', inv.client_id, 'issue_date', current_date,
    'service_address', inv.service_address, 'notes', inv.notes, 'terms', inv.terms, 'internal_notes', inv.internal_notes,
    'discount_type', inv.discount_type, 'discount_value', inv.discount_value, 'tax_rate', inv.tax_rate,
    'items', (select jsonb_agg(jsonb_build_object('service_id', service_id, 'description', description, 'quantity', quantity,
               'unit_price', unit_price, 'taxable', taxable) order by position) from public.invoice_items where invoice_id = p_invoice)));
end $$;

create or replace function public.void_invoice(p_invoice uuid, p_reason text default null)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare inv public.invoices%rowtype;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if not found or not public.is_org_admin(inv.org_id) then raise exception 'Not allowed'; end if;
  if inv.amount_paid + inv.tip_total - inv.amount_refunded > 0 then
    raise exception 'Refund the payments on this invoice before cancelling it';
  end if;
  update public.invoices set voided_at = now(), void_reason = nullif(trim(p_reason), '') where id = p_invoice returning * into inv;
  perform public.log_billing(inv.org_id, 'invoice_cancelled', 'Invoice ' || inv.number || ' cancelled' || coalesce(' — ' || inv.void_reason, ''),
    inv.total, inv.id, null, null, inv.client_id);
  return inv;
end $$;

-- Internal: insert a payment and tell everyone about it
create or replace function public.insert_payment(p_invoice uuid, p_amount numeric, p_tip numeric, p_method text, p_processor text,
  p_processor_id text, p_brand text, p_last4 text, p_reference text, p_notes text, p_paid_at timestamptz)
returns public.payments language plpgsql security definer set search_path = public as $$
declare inv public.invoices%rowtype; pay public.payments%rowtype; s public.billing_settings%rowtype; v_n int;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  s := public.ensure_billing_settings(inv.org_id);
  select count(*) + 1 into v_n from public.payments where invoice_id = p_invoice;
  insert into public.payments (org_id, invoice_id, client_id, amount, tip_amount, method, processor, processor_payment_id,
                               card_brand, card_last4, reference, notes, receipt_number, paid_at, recorded_by, is_deposit)
  values (inv.org_id, inv.id, inv.client_id, round(p_amount, 2), round(coalesce(p_tip, 0), 2), p_method, p_processor, p_processor_id,
          p_brand, p_last4, nullif(trim(p_reference), ''), nullif(trim(p_notes), ''),
          'R-' || inv.number || '-' || v_n, coalesce(p_paid_at, now()), auth.uid(),
          inv.sent_at is null and inv.amount_paid = 0 and round(p_amount, 2) < inv.balance_due)
  returning * into pay;
  select * into inv from public.invoices where id = p_invoice;
  perform public.log_billing(inv.org_id, 'payment_received',
    'Payment of ' || public.fmt_money(pay.amount + pay.tip_amount, s.currency) || ' received for ' || inv.number
      || case when pay.tip_amount > 0 then ' (incl. ' || public.fmt_money(pay.tip_amount, s.currency) || ' tip)' else '' end,
    pay.amount + pay.tip_amount, inv.id, null, pay.id, inv.client_id);
  perform public.notify_admins(inv.org_id, 'payment_received', 'Payment received',
    public.fmt_money(pay.amount + pay.tip_amount, s.currency) || ' for ' || inv.number, '/billing/invoices/' || inv.id);
  if s.send_receipts then
    perform public.notify_client(inv.org_id, inv.client_id, 'payment_receipt', 'Payment received — thank you!',
      public.fmt_money(pay.amount + pay.tip_amount, s.currency) || ' paid on invoice ' || inv.number || '. Your receipt is ready.',
      '/portal/billing/invoices/' || inv.id, '/pay/' || inv.public_token);
  end if;
  return pay;
end $$;

-- Record an offline payment (cash, check, bank transfer, card taken in person …)
create or replace function public.record_payment(p_invoice uuid, p_amount numeric, p_method text,
  p_paid_at timestamptz default null, p_reference text default null, p_notes text default null, p_tip numeric default 0)
returns public.payments language plpgsql security definer set search_path = public as $$
declare inv public.invoices%rowtype;
begin
  select * into inv from public.invoices where id = p_invoice;
  if not found or not public.is_org_admin(inv.org_id) then raise exception 'Not allowed'; end if;
  if inv.voided_at is not null then raise exception 'This invoice was cancelled'; end if;
  if p_method not in ('card','debit_card','ach','cash','check','other') then raise exception 'Choose a payment method'; end if;
  if coalesce(p_amount, 0) < 0 or coalesce(p_tip, 0) < 0 then raise exception 'Amounts must be positive'; end if;
  if coalesce(p_amount, 0) + coalesce(p_tip, 0) <= 0 then raise exception 'Enter an amount'; end if;
  if round(p_amount, 2) > inv.balance_due then
    raise exception 'That’s more than the balance due (%)', public.fmt_money(inv.balance_due, (select currency from public.billing_settings where org_id = inv.org_id));
  end if;
  return public.insert_payment(p_invoice, p_amount, p_tip, p_method, 'manual', null, null, null, p_reference, p_notes, p_paid_at);
end $$;

create or replace function public.mark_invoice_paid(p_invoice uuid, p_method text default 'other')
returns public.payments language plpgsql security definer set search_path = public as $$
declare inv public.invoices%rowtype;
begin
  select * into inv from public.invoices where id = p_invoice;
  if not found or not public.is_org_admin(inv.org_id) then raise exception 'Not allowed'; end if;
  if inv.balance_due <= 0 then raise exception 'This invoice has no balance due'; end if;
  return public.record_payment(p_invoice, inv.balance_due, p_method, now(), null, 'Marked as paid', 0);
end $$;

-- Internal: insert a refund
create or replace function public.insert_refund(p_payment uuid, p_amount numeric, p_reason text, p_processor_refund_id text)
returns public.refunds language plpgsql security definer set search_path = public as $$
declare pay public.payments%rowtype; r public.refunds%rowtype; inv public.invoices%rowtype; s public.billing_settings%rowtype;
begin
  select * into pay from public.payments where id = p_payment for update;
  if round(p_amount, 2) <= 0 then raise exception 'Enter a refund amount'; end if;
  if round(p_amount, 2) > pay.amount + pay.tip_amount - pay.amount_refunded then
    raise exception 'You can refund up to %', public.fmt_money(pay.amount + pay.tip_amount - pay.amount_refunded);
  end if;
  insert into public.refunds (org_id, payment_id, invoice_id, amount, reason, processor_refund_id, created_by)
  values (pay.org_id, pay.id, pay.invoice_id, round(p_amount, 2), nullif(trim(p_reason), ''), p_processor_refund_id, auth.uid())
  returning * into r;
  select * into inv from public.invoices where id = pay.invoice_id;
  s := public.ensure_billing_settings(pay.org_id);
  perform public.log_billing(pay.org_id, 'refund_issued',
    'Refund of ' || public.fmt_money(r.amount, s.currency) || ' issued on ' || inv.number || coalesce(' — ' || r.reason, ''),
    r.amount, inv.id, null, pay.id, inv.client_id);
  perform public.notify_client(pay.org_id, inv.client_id, 'refund_issued', 'Refund issued',
    public.fmt_money(r.amount, s.currency) || ' was refunded on invoice ' || inv.number || '.',
    '/portal/billing/invoices/' || inv.id, '/pay/' || inv.public_token);
  return r;
end $$;

-- Refund a manual (offline) payment. Stripe payments are refunded through the
-- billing-refund server function so the money actually moves.
create or replace function public.issue_refund(p_payment uuid, p_amount numeric, p_reason text default null)
returns public.refunds language plpgsql security definer set search_path = public as $$
declare pay public.payments%rowtype;
begin
  select * into pay from public.payments where id = p_payment;
  if not found or not public.is_org_admin(pay.org_id) then raise exception 'Not allowed'; end if;
  if pay.processor <> 'manual' then raise exception 'Online payments are refunded through the payment processor'; end if;
  return public.insert_refund(p_payment, p_amount, p_reason, null);
end $$;

create or replace function public.send_invoice_reminder(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.invoices%rowtype; o public.organizations%rowtype; s public.billing_settings%rowtype;
begin
  select * into inv from public.invoices where id = p_invoice;
  if not found or not public.is_org_admin(inv.org_id) then raise exception 'Not allowed'; end if;
  if inv.sent_at is null then raise exception 'Send the invoice first'; end if;
  if inv.balance_due <= 0 or inv.voided_at is not null then raise exception 'Nothing is owed on this invoice'; end if;
  select * into o from public.organizations where id = inv.org_id;
  s := public.ensure_billing_settings(inv.org_id);
  perform public.notify_client(inv.org_id, inv.client_id, 'invoice_reminder', 'Payment reminder from ' || o.name,
    'Invoice ' || inv.number || ' has ' || public.fmt_money(inv.balance_due, s.currency) || ' due ' ||
      case when inv.due_date < current_date then '(was due ' || to_char(inv.due_date, 'Mon DD') || ')' else 'on ' || to_char(inv.due_date, 'Mon DD') end || '.',
    '/portal/billing/invoices/' || inv.id, '/pay/' || inv.public_token);
  insert into public.invoice_reminders (org_id, invoice_id, kind, sent_by) values (inv.org_id, inv.id, 'manual', auth.uid());
  perform public.log_billing(inv.org_id, 'reminder_sent', 'Payment reminder sent for ' || inv.number, inv.balance_due, inv.id, null, null, inv.client_id);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Admin RPCs — estimates
-- ---------------------------------------------------------------------------
create or replace function public.save_estimate(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := public.try_uuid(p->>'id');
  v_org uuid := (p->>'org_id')::uuid;
  v_client uuid := (p->>'client_id')::uuid;
  e public.estimates%rowtype; s public.billing_settings%rowtype; v_issue date; v_new boolean := false;
begin
  if not public.is_org_admin(v_org) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.clients where id = v_client and org_id = v_org) then raise exception 'Client not found'; end if;
  s := public.ensure_billing_settings(v_org);
  v_issue := coalesce((p->>'issue_date')::date, current_date);
  if v_id is null then
    insert into public.estimates (org_id, client_id, number, created_by, tax_rate, issue_date, valid_until, terms)
    values (v_org, v_client, public.next_document_number(v_org, 'estimate'), auth.uid(), s.tax_rate, v_issue,
            v_issue + s.estimate_valid_days, s.default_terms)
    returning * into e;
    v_id := e.id; v_new := true;
  else
    select * into e from public.estimates where id = v_id and org_id = v_org for update;
    if not found then raise exception 'Estimate not found'; end if;
    if e.approved_at is not null or e.declined_at is not null then raise exception 'This estimate was already answered by the client'; end if;
  end if;
  update public.estimates set
    client_id       = v_client,
    title           = case when p ? 'title' then nullif(trim(p->>'title'), '') else title end,
    issue_date      = v_issue,
    valid_until     = coalesce((p->>'valid_until')::date, valid_until),
    service_address = coalesce(nullif(trim(p->>'service_address'), ''), public.client_service_address(v_client)),
    notes           = case when p ? 'notes' then nullif(trim(p->>'notes'), '') else notes end,
    terms           = case when p ? 'terms' then nullif(trim(p->>'terms'), '') else terms end,
    internal_notes  = case when p ? 'internal_notes' then nullif(trim(p->>'internal_notes'), '') else internal_notes end,
    discount_type   = coalesce(p->>'discount_type', discount_type),
    discount_value  = greatest(coalesce((p->>'discount_value')::numeric, discount_value), 0),
    tax_rate        = coalesce((p->>'tax_rate')::numeric, tax_rate)
  where id = v_id;
  if p ? 'items' then perform public.set_estimate_items(v_id, p->'items'); end if;
  select * into e from public.estimates where id = v_id;
  perform public.log_billing(v_org, case when v_new then 'estimate_created' else 'estimate_updated' end,
    'Estimate ' || e.number || case when v_new then ' created' else ' updated' end, e.total, null, v_id, null, v_client);
  return v_id;
end $$;

create or replace function public.send_estimate(p_estimate uuid)
returns public.estimates language plpgsql security definer set search_path = public as $$
declare e public.estimates%rowtype; o public.organizations%rowtype; s public.billing_settings%rowtype;
begin
  select * into e from public.estimates where id = p_estimate for update;
  if not found or not public.is_org_admin(e.org_id) then raise exception 'Not allowed'; end if;
  if e.approved_at is not null or e.declined_at is not null then raise exception 'This estimate was already answered'; end if;
  if not exists (select 1 from public.estimate_items where estimate_id = p_estimate) then raise exception 'Add at least one service before sending'; end if;
  select * into o from public.organizations where id = e.org_id;
  s := public.ensure_billing_settings(e.org_id);
  update public.estimates set sent_at = now(),
    valid_until = greatest(coalesce(valid_until, current_date + s.estimate_valid_days), current_date)
   where id = p_estimate returning * into e;
  perform public.log_billing(e.org_id, 'estimate_sent', 'Estimate ' || e.number || ' sent', e.total, null, e.id, null, e.client_id);
  perform public.notify_client(e.org_id, e.client_id, 'estimate_sent', 'New estimate from ' || o.name,
    coalesce(e.title, 'Estimate ' || e.number) || ' — ' || public.fmt_money(e.total, s.currency) || '. Tap to review and approve.',
    '/portal/billing/estimates/' || e.id, '/estimate/' || e.public_token);
  return e;
end $$;

create or replace function public.convert_estimate_to_invoice(p_estimate uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare e public.estimates%rowtype; v_inv uuid;
begin
  select * into e from public.estimates where id = p_estimate for update;
  if not found or not public.is_org_admin(e.org_id) then raise exception 'Not allowed'; end if;
  if e.invoice_id is not null then return e.invoice_id; end if;
  if e.declined_at is not null then raise exception 'This estimate was declined'; end if;
  v_inv := public.save_invoice(jsonb_build_object(
    'org_id', e.org_id, 'client_id', e.client_id, 'issue_date', current_date, 'service_address', e.service_address,
    'notes', e.notes, 'terms', e.terms, 'discount_type', e.discount_type, 'discount_value', e.discount_value, 'tax_rate', e.tax_rate,
    'items', coalesce((select jsonb_agg(jsonb_build_object('service_id', service_id, 'description', description, 'quantity', quantity,
               'unit_price', unit_price, 'taxable', taxable) order by position)
             from public.estimate_items where estimate_id = p_estimate and (not is_optional or is_selected)), '[]'::jsonb)));
  update public.invoices set estimate_id = e.id, appointment_id = coalesce(appointment_id, e.appointment_id) where id = v_inv;
  update public.estimates set invoice_id = v_inv where id = e.id;
  perform public.log_billing(e.org_id, 'estimate_converted', 'Estimate ' || e.number || ' converted to an invoice', e.total, v_inv, e.id, null, e.client_id);
  return v_inv;
end $$;

-- Book the approved work: creates an appointment + job via schedule_appointment
create or replace function public.convert_estimate_to_job(p_estimate uuid, p_starts_at timestamptz, p_duration_minutes int default 120)
returns uuid language plpgsql security definer set search_path = public as $$
declare e public.estimates%rowtype; v_appt uuid; v_service text;
begin
  select * into e from public.estimates where id = p_estimate for update;
  if not found or not public.is_org_admin(e.org_id) then raise exception 'Not allowed'; end if;
  if e.declined_at is not null then raise exception 'This estimate was declined'; end if;
  select description into v_service from public.estimate_items where estimate_id = p_estimate and (not is_optional or is_selected) order by position limit 1;
  v_appt := public.schedule_appointment(jsonb_build_object(
    'org_id', e.org_id, 'client_id', e.client_id, 'service_name', left(coalesce(e.title, v_service, 'Cleaning'), 120),
    'starts_at', p_starts_at, 'duration_minutes', coalesce(p_duration_minutes, 120), 'recurrence', 'none',
    'internal_notes', 'From estimate ' || e.number || coalesce(E'\n' || e.internal_notes, '')));
  update public.estimates set appointment_id = v_appt where id = e.id;
  perform public.log_billing(e.org_id, 'estimate_converted', 'Estimate ' || e.number || ' booked as a job', e.total, null, e.id, null, e.client_id);
  return (select id from public.jobs where appointment_id = v_appt order by scheduled_start limit 1);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Client-safe views of billing data (portal + secure public links)
-- ---------------------------------------------------------------------------
create or replace function public.org_public_json(p_org uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'name', o.name, 'logo_url', o.logo_url, 'brand_color', o.brand_color,
    'phone', o.phone, 'email', o.email, 'website', o.website, 'address', o.address)
  from public.organizations o where o.id = p_org;
$$;

create or replace function public.invoice_client_json(p_invoice uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', i.id, 'number', i.number, 'status', i.status, 'issue_date', i.issue_date, 'due_date', i.due_date,
    'service_address', i.service_address, 'notes', i.notes, 'terms', i.terms,
    'discount_type', i.discount_type, 'discount_value', i.discount_value, 'tax_rate', i.tax_rate, 'credit_amount', i.credit_amount,
    'subtotal', i.subtotal, 'discount_total', i.discount_total, 'tax_total', i.tax_total, 'total', i.total,
    'amount_paid', i.amount_paid, 'tip_total', i.tip_total, 'amount_refunded', i.amount_refunded, 'balance_due', i.balance_due,
    'paid_at', i.paid_at, 'sent_at', i.sent_at, 'voided_at', i.voided_at, 'public_token', i.public_token,
    'org', public.org_public_json(i.org_id),
    'client', (select jsonb_build_object('id', c.id, 'full_name', c.full_name, 'email', c.email, 'phone', c.phone)
               from public.clients c where c.id = i.client_id),
    'job', (select jsonb_build_object('id', j.id, 'service_name', j.service_name, 'scheduled_start', j.scheduled_start, 'completed_at', j.completed_at)
            from public.jobs j where j.id = i.job_id),
    'settings', (select jsonb_build_object('currency', s.currency, 'tax_label', s.tax_label, 'payment_instructions', s.payment_instructions,
                   'tips_enabled', s.tips_enabled, 'tip_presets', s.tip_presets, 'accepted_methods', s.accepted_methods,
                   'receipt_message', s.receipt_message, 'autopay_enabled', s.autopay_enabled)
                 from public.billing_settings s where s.org_id = i.org_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', it.id, 'description', it.description, 'quantity', it.quantity,
                 'unit_price', it.unit_price, 'taxable', it.taxable, 'line_total', it.line_total) order by it.position)
               from public.invoice_items it where it.invoice_id = i.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'tip_amount', p.tip_amount,
                 'amount_refunded', p.amount_refunded, 'method', p.method, 'status', p.status, 'processor', p.processor,
                 'processor_payment_id', p.processor_payment_id, 'card_brand', p.card_brand, 'card_last4', p.card_last4,
                 'reference', p.reference, 'notes', p.notes, 'receipt_number', p.receipt_number, 'paid_at', p.paid_at) order by p.paid_at)
               from public.payments p where p.invoice_id = i.id and p.status <> 'failed'), '[]'::jsonb)
  )
  from public.invoices i where i.id = p_invoice;
$$;

create or replace function public.estimate_client_json(p_estimate uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'number', e.number, 'status', e.status, 'title', e.title, 'issue_date', e.issue_date, 'valid_until', e.valid_until,
    'service_address', e.service_address, 'notes', e.notes, 'terms', e.terms,
    'discount_type', e.discount_type, 'discount_value', e.discount_value, 'tax_rate', e.tax_rate,
    'subtotal', e.subtotal, 'discount_total', e.discount_total, 'tax_total', e.tax_total, 'total', e.total,
    'approved_at', e.approved_at, 'declined_at', e.declined_at, 'client_response', e.client_response, 'public_token', e.public_token,
    'org', public.org_public_json(e.org_id),
    'client', (select jsonb_build_object('id', c.id, 'full_name', c.full_name) from public.clients c where c.id = e.client_id),
    'settings', (select jsonb_build_object('currency', s.currency, 'tax_label', s.tax_label) from public.billing_settings s where s.org_id = e.org_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', it.id, 'description', it.description, 'quantity', it.quantity,
                 'unit_price', it.unit_price, 'taxable', it.taxable, 'is_optional', it.is_optional, 'is_selected', it.is_selected,
                 'line_total', it.line_total) order by it.position)
               from public.estimate_items it where it.estimate_id = e.id), '[]'::jsonb)
  )
  from public.estimates e where e.id = p_estimate;
$$;

-- Everything a signed-in client needs for their Billing tab
create or replace function public.my_billing(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_client uuid;
begin
  select id into v_client from public.clients where org_id = p_org and user_id = auth.uid();
  if v_client is null then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'status', i.status,
        'issue_date', i.issue_date, 'due_date', i.due_date, 'total', i.total, 'balance_due', i.balance_due, 'amount_paid', i.amount_paid,
        'tip_total', i.tip_total, 'paid_at', i.paid_at,
        'service_name', (select service_name from public.jobs j where j.id = i.job_id)) order by i.issue_date desc, i.created_at desc)
      from public.invoices i where i.client_id = v_client and i.sent_at is not null), '[]'::jsonb),
    'estimates', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'number', e.number, 'status', e.status, 'title', e.title,
        'issue_date', e.issue_date, 'valid_until', e.valid_until, 'total', e.total) order by e.issue_date desc, e.created_at desc)
      from public.estimates e where e.client_id = v_client and e.sent_at is not null), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'invoice_id', p.invoice_id,
        'invoice_number', (select number from public.invoices where id = p.invoice_id),
        'amount', p.amount, 'tip_amount', p.tip_amount, 'amount_refunded', p.amount_refunded, 'method', p.method, 'status', p.status,
        'card_brand', p.card_brand, 'card_last4', p.card_last4, 'receipt_number', p.receipt_number, 'paid_at', p.paid_at) order by p.paid_at desc)
      from public.payments p where p.client_id = v_client and p.status <> 'failed'), '[]'::jsonb),
    'payment_methods', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'brand', m.brand, 'last4', m.last4,
        'exp_month', m.exp_month, 'exp_year', m.exp_year, 'is_default', m.is_default, 'autopay_enabled', m.autopay_enabled) order by m.created_at desc)
      from public.payment_methods m where m.client_id = v_client), '[]'::jsonb),
    'settings', (select jsonb_build_object('currency', s.currency, 'autopay_enabled', s.autopay_enabled, 'tips_enabled', s.tips_enabled)
                 from public.billing_settings s where s.org_id = p_org),
    'has_recurring', exists (select 1 from public.recurring_billing_rules r where r.client_id = v_client and r.status = 'active')
  );
end $$;

create or replace function public.get_my_invoice(p_invoice uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inv public.invoices%rowtype;
begin
  select * into inv from public.invoices where id = p_invoice;
  if not found or inv.sent_at is null or inv.client_id not in (select public.my_client_ids()) then raise exception 'Invoice not found'; end if;
  if inv.viewed_at is null then
    update public.invoices set viewed_at = now() where id = p_invoice;
    perform public.log_billing(inv.org_id, 'invoice_viewed', 'Invoice ' || inv.number || ' viewed by the client', null, inv.id, null, null, inv.client_id);
  end if;
  return public.invoice_client_json(p_invoice);
end $$;

create or replace function public.get_my_estimate(p_estimate uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.estimates%rowtype;
begin
  select * into e from public.estimates where id = p_estimate;
  if not found or e.sent_at is null or e.client_id not in (select public.my_client_ids()) then raise exception 'Estimate not found'; end if;
  if e.viewed_at is null then
    update public.estimates set viewed_at = now() where id = p_estimate;
    perform public.log_billing(e.org_id, 'estimate_viewed', 'Estimate ' || e.number || ' viewed by the client', null, null, e.id, null, e.client_id);
  end if;
  return public.estimate_client_json(p_estimate);
end $$;

-- Secure links for clients without a portal login (token = 64 random hex chars)
create or replace function public.get_public_invoice(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inv public.invoices%rowtype;
begin
  select * into inv from public.invoices where public_token = p_token and char_length(p_token) >= 32;
  if not found or inv.sent_at is null then raise exception 'Invoice not found'; end if;
  if inv.viewed_at is null then
    update public.invoices set viewed_at = now() where id = inv.id;
    perform public.log_billing(inv.org_id, 'invoice_viewed', 'Invoice ' || inv.number || ' viewed by the client', null, inv.id, null, null, inv.client_id);
  end if;
  return public.invoice_client_json(inv.id);
end $$;

create or replace function public.get_public_estimate(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.estimates%rowtype;
begin
  select * into e from public.estimates where public_token = p_token and char_length(p_token) >= 32;
  if not found or e.sent_at is null then raise exception 'Estimate not found'; end if;
  if e.viewed_at is null then
    update public.estimates set viewed_at = now() where id = e.id;
    perform public.log_billing(e.org_id, 'estimate_viewed', 'Estimate ' || e.number || ' viewed by the client', null, null, e.id, null, e.client_id);
  end if;
  return public.estimate_client_json(e.id);
end $$;

-- Internal: apply a client's approve / decline
create or replace function public.apply_estimate_response(p_estimate uuid, p_approve boolean, p_note text, p_selected uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.estimates%rowtype; c text; s public.billing_settings%rowtype;
begin
  select * into e from public.estimates where id = p_estimate for update;
  if e.sent_at is null then raise exception 'Estimate not found'; end if;
  if e.approved_at is not null or e.declined_at is not null then raise exception 'You already responded to this estimate'; end if;
  if e.status = 'expired' then raise exception 'This estimate has expired — please ask for an updated one'; end if;
  if p_approve and p_selected is not null then
    update public.estimate_items set is_selected = (id = any (p_selected)) where estimate_id = p_estimate and is_optional;
  end if;
  update public.estimates set
    approved_at = case when p_approve then now() end,
    declined_at = case when not p_approve then now() end,
    client_response = nullif(trim(p_note), '')
  where id = p_estimate returning * into e;
  select full_name into c from public.clients where id = e.client_id;
  s := public.ensure_billing_settings(e.org_id);
  perform public.log_billing(e.org_id, case when p_approve then 'estimate_approved' else 'estimate_declined' end,
    'Estimate ' || e.number || case when p_approve then ' approved' else ' declined' end || ' by ' || c || coalesce(' — “' || e.client_response || '”', ''),
    e.total, null, e.id, null, e.client_id);
  perform public.notify_admins(e.org_id, 'estimate_' || case when p_approve then 'approved' else 'declined' end,
    'Estimate ' || case when p_approve then 'approved' else 'declined' end,
    c || ' ' || case when p_approve then 'approved' else 'declined' end || ' ' || e.number || ' (' || public.fmt_money(e.total, s.currency) || ')',
    '/billing/estimates/' || e.id);
  return public.estimate_client_json(e.id);
end $$;

create or replace function public.respond_estimate(p_estimate uuid, p_approve boolean, p_note text default null, p_selected uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.estimates where id = p_estimate and client_id in (select public.my_client_ids())) then
    raise exception 'Estimate not found';
  end if;
  return public.apply_estimate_response(p_estimate, p_approve, p_note, p_selected);
end $$;

create or replace function public.respond_public_estimate(p_token text, p_approve boolean, p_note text default null, p_selected uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.estimates where public_token = p_token and char_length(p_token) >= 32;
  if v_id is null then raise exception 'Estimate not found'; end if;
  return public.apply_estimate_response(v_id, p_approve, p_note, p_selected);
end $$;

-- Client turns auto-pay on/off for one of their saved methods
create or replace function public.set_autopay(p_method uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare m public.payment_methods%rowtype; c text;
begin
  select * into m from public.payment_methods where id = p_method and client_id in (select public.my_client_ids());
  if not found then raise exception 'Payment method not found'; end if;
  if p_enabled and not coalesce((select autopay_enabled from public.billing_settings where org_id = m.org_id), false) then
    raise exception 'Auto-pay isn’t offered by this company';
  end if;
  if p_enabled then update public.payment_methods set autopay_enabled = false, is_default = false where client_id = m.client_id; end if;
  update public.payment_methods set autopay_enabled = p_enabled, is_default = case when p_enabled then true else is_default end where id = p_method;
  select full_name into c from public.clients where id = m.client_id;
  perform public.log_billing(m.org_id, case when p_enabled then 'autopay_enabled' else 'autopay_disabled' end,
    c || case when p_enabled then ' turned on auto-pay' else ' turned off auto-pay' end, null, null, null, null, m.client_id);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Server-only RPCs (called by Netlify functions with the service role)
-- ---------------------------------------------------------------------------
create or replace function public.require_server()
returns void language plpgsql as $$
begin
  if current_user in ('authenticated','anon') then raise exception 'Not allowed'; end if;
end $$;

-- Stripe payment succeeded (idempotent on the PaymentIntent id)
create or replace function public.apply_online_payment(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_existing uuid; v_inv uuid := (p->>'invoice_id')::uuid; inv public.invoices%rowtype; pay public.payments%rowtype;
        v_total numeric := (p->>'amount')::numeric; v_tip numeric := greatest(coalesce((p->>'tip_amount')::numeric, 0), 0); v_apply numeric;
begin
  perform public.require_server();
  select id into v_existing from public.payments where processor_payment_id = p->>'processor_payment_id';
  if v_existing is not null then return v_existing; end if;
  select * into inv from public.invoices where id = v_inv;
  if not found then raise exception 'Invoice not found'; end if;
  v_tip := least(v_tip, v_total);
  v_apply := least(v_total - v_tip, inv.balance_due);
  v_tip := v_total - v_apply;        -- anything above the balance is kept as tip, never lost
  pay := public.insert_payment(v_inv, v_apply, v_tip, coalesce(p->>'method', 'card'), 'stripe', p->>'processor_payment_id',
    p->>'card_brand', p->>'card_last4', p->>'reference', null, now());
  if inv.sent_at is null then update public.invoices set sent_at = now() where id = v_inv; end if;
  return pay.id;
end $$;

create or replace function public.record_online_refund(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_existing uuid; v_pay uuid; r public.refunds%rowtype;
begin
  perform public.require_server();
  select id into v_existing from public.refunds where processor_refund_id = p->>'processor_refund_id';
  if v_existing is not null then return v_existing; end if;
  select id into v_pay from public.payments where processor_payment_id = p->>'processor_payment_id';
  if v_pay is null then raise exception 'Payment not found'; end if;
  r := public.insert_refund(v_pay, (p->>'amount')::numeric, p->>'reason', p->>'processor_refund_id');
  update public.refunds set created_by = public.try_uuid(p->>'created_by') where id = r.id and p ? 'created_by';
  return r.id;
end $$;

create or replace function public.online_payment_failed(p_invoice uuid, p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.invoices%rowtype;
begin
  perform public.require_server();
  select * into inv from public.invoices where id = p_invoice;
  if not found then return; end if;
  update public.invoices set autopay_error = left(p_message, 300) where id = p_invoice and autopay_requested_at is not null;
  perform public.log_billing(inv.org_id, 'payment_failed', 'Payment failed for ' || inv.number || ' — ' || left(p_message, 200), inv.balance_due, inv.id, null, null, inv.client_id);
  perform public.notify_admins(inv.org_id, 'payment_failed', 'Payment failed', inv.number || ': ' || left(p_message, 140), '/billing/invoices/' || inv.id);
end $$;

create or replace function public.save_payment_method(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_client uuid := (p->>'client_id')::uuid; v_org uuid; v_id uuid; v_autopay boolean := coalesce((p->>'autopay')::boolean, false);
begin
  perform public.require_server();
  select org_id into v_org from public.clients where id = v_client;
  if v_org is null then raise exception 'Client not found'; end if;
  if v_autopay then update public.payment_methods set autopay_enabled = false, is_default = false where client_id = v_client; end if;
  insert into public.payment_methods (org_id, client_id, processor_customer_id, processor_payment_method_id, kind, brand, last4, exp_month, exp_year, is_default, autopay_enabled)
  values (v_org, v_client, p->>'customer_id', p->>'payment_method_id', coalesce(p->>'kind', 'card'), p->>'brand', p->>'last4',
          (p->>'exp_month')::int, (p->>'exp_year')::int, true, v_autopay)
  on conflict (processor, processor_payment_method_id) do update
    set autopay_enabled = excluded.autopay_enabled or public.payment_methods.autopay_enabled, is_default = true
  returning id into v_id;
  if v_autopay then
    perform public.log_billing(v_org, 'autopay_enabled', (select full_name from public.clients where id = v_client) || ' saved a card for auto-pay',
      null, null, null, null, v_client);
  end if;
  return v_id;
end $$;

-- Payment reminders (+ overdue alerts). p_org = null → every company (server only).
create or replace function public.queue_invoice_reminders(p_org uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_offset int; n int := 0; v_kind text;
begin
  if p_org is not null and not public.is_org_admin(p_org) then raise exception 'Not allowed'; end if;
  if p_org is null then perform public.require_server(); end if;

  -- refresh date-based statuses (sent → overdue, estimates → expired)
  update public.invoices set updated_at = now()
   where (p_org is null or org_id = p_org) and status in ('sent','viewed') and due_date < current_date;
  update public.estimates set updated_at = now()
   where (p_org is null or org_id = p_org) and status in ('sent','viewed') and valid_until < current_date;

  for r in
    select i.*, o.name as org_name, s.reminder_offsets, s.currency
    from public.invoices i
    join public.organizations o on o.id = i.org_id
    join public.billing_settings s on s.org_id = i.org_id
    where (p_org is null or i.org_id = p_org)
      and s.reminders_enabled and i.sent_at is not null and i.voided_at is null and i.balance_due > 0
  loop
    -- newest reminder point that has arrived (and came after the invoice was sent)
    select max(o) into v_offset from unnest(r.reminder_offsets) o
     where r.due_date + o <= current_date and r.due_date + o >= r.sent_at::date;
    if v_offset is null or exists (select 1 from public.invoice_reminders where invoice_id = r.id and days_offset = v_offset and kind <> 'manual') then
      continue;
    end if;
    v_kind := case when v_offset < 0 then 'before_due' when v_offset = 0 then 'on_due' else 'overdue' end;
    insert into public.invoice_reminders (org_id, invoice_id, kind, days_offset) values (r.org_id, r.id, v_kind, v_offset);
    perform public.notify_client(r.org_id, r.client_id, 'invoice_reminder',
      case v_kind when 'before_due' then 'Invoice due soon' when 'on_due' then 'Invoice due today' else 'Invoice overdue' end,
      r.org_name || ': invoice ' || r.number || ' has ' || public.fmt_money(r.balance_due, r.currency) ||
        case v_kind when 'before_due' then ' due on ' || to_char(r.due_date, 'Mon DD') when 'on_due' then ' due today'
                    else ' past due (was due ' || to_char(r.due_date, 'Mon DD') || ')' end || '.',
      '/portal/billing/invoices/' || r.id, '/pay/' || r.public_token);
    perform public.log_billing(r.org_id, 'reminder_sent', 'Automatic reminder sent for ' || r.number, r.balance_due, r.id, null, null, r.client_id);
    n := n + 1;
  end loop;

  -- tell the office once when an invoice becomes overdue
  for r in select i.* from public.invoices i
            where (p_org is null or i.org_id = p_org) and i.status = 'overdue' and i.overdue_notified_at is null loop
    update public.invoices set overdue_notified_at = now() where id = r.id;
    perform public.log_billing(r.org_id, 'invoice_overdue', 'Invoice ' || r.number || ' is overdue', r.balance_due, r.id, null, null, r.client_id);
    perform public.notify_admins(r.org_id, 'invoice_overdue', 'Invoice overdue',
      r.number || ' — ' || public.fmt_money(r.balance_due, (select currency from public.billing_settings where org_id = r.org_id)) || ' outstanding', '/billing/invoices/' || r.id);
  end loop;
  return n;
end $$;

-- Recurring billing: generate due invoices. p_org = null → every company (server only).
create or replace function public.run_recurring_billing(p_org uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare r public.recurring_billing_rules%rowtype; v_inv uuid; n int := 0; v_next date; v_has_autopay boolean;
begin
  if p_org is not null and not public.is_org_admin(p_org) then raise exception 'Not allowed'; end if;
  if p_org is null then perform public.require_server(); end if;
  for r in select * from public.recurring_billing_rules
            where status = 'active' and next_run_date <= current_date and (p_org is null or org_id = p_org)
            for update skip locked loop
    if r.end_date is not null and r.next_run_date > r.end_date then
      update public.recurring_billing_rules set status = 'cancelled' where id = r.id;
      continue;
    end if;
    perform public.ensure_billing_settings(r.org_id);
    insert into public.invoices (org_id, client_id, number, recurring_rule_id, appointment_id, issue_date, due_date, tax_rate, notes, terms, service_address, created_by)
    select r.org_id, r.client_id, public.next_document_number(r.org_id, 'invoice'), r.id, r.appointment_id, current_date,
           current_date + s.payment_terms_days, s.tax_rate, coalesce(r.notes, s.default_invoice_notes), s.default_terms,
           public.client_service_address(r.client_id), r.created_by
      from public.billing_settings s where s.org_id = r.org_id
    returning id into v_inv;
    perform public.set_invoice_items(v_inv, r.items);
    perform public.log_billing(r.org_id, 'recurring_invoice_generated',
      'Recurring invoice ' || (select number from public.invoices where id = v_inv) || ' generated from “' || r.name || '”',
      (select total from public.invoices where id = v_inv), v_inv, null, null, r.client_id);

    if r.mode in ('send','autocharge') then
      update public.invoices set sent_at = now(), last_sent_at = now() where id = v_inv;
      perform public.notify_client(r.org_id, r.client_id, 'invoice_sent', 'New invoice from ' || (select name from public.organizations where id = r.org_id),
        'Invoice ' || (select number from public.invoices where id = v_inv) || ' for ' || public.fmt_money((select balance_due from public.invoices where id = v_inv)) || ' is ready.',
        '/portal/billing/invoices/' || v_inv, '/pay/' || (select public_token from public.invoices where id = v_inv));
    end if;
    if r.mode = 'autocharge' then
      select exists (select 1 from public.payment_methods where client_id = r.client_id and autopay_enabled) into v_has_autopay;
      if v_has_autopay then update public.invoices set autopay_requested_at = now() where id = v_inv; end if;
    end if;

    v_next := case r.frequency
      when 'weekly' then r.next_run_date + 7
      when 'biweekly' then r.next_run_date + 14
      when 'every_4_weeks' then r.next_run_date + 28
      when 'monthly' then (r.next_run_date + interval '1 month')::date
      else r.next_run_date + coalesce(r.interval_days, 30) end;
    update public.recurring_billing_rules set last_run_at = now(), last_invoice_id = v_inv, next_run_date = v_next,
      status = case when r.end_date is not null and v_next > r.end_date then 'cancelled' else status end
     where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Function privileges
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'can_view_billing(uuid)','save_invoice(jsonb)','create_invoice_from_job(uuid)','send_invoice(uuid)','duplicate_invoice(uuid)',
    'void_invoice(uuid, text)','record_payment(uuid, numeric, text, timestamptz, text, text, numeric)','mark_invoice_paid(uuid, text)',
    'issue_refund(uuid, numeric, text)','send_invoice_reminder(uuid)','save_estimate(jsonb)','send_estimate(uuid)',
    'convert_estimate_to_invoice(uuid)','convert_estimate_to_job(uuid, timestamptz, int)','my_billing(uuid)','get_my_invoice(uuid)',
    'get_my_estimate(uuid)','respond_estimate(uuid, boolean, text, uuid[])','set_autopay(uuid, boolean)',
    'queue_invoice_reminders(uuid)','run_recurring_billing(uuid)','fmt_money(numeric, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- internal helpers + server-only entry points: never callable from the browser
  foreach f in array array[
    'log_billing(uuid, text, text, numeric, uuid, uuid, uuid, uuid)','notify_client(uuid, uuid, text, text, text, text, text)',
    'ensure_billing_settings(uuid)','seed_service_catalog(uuid)','next_document_number(uuid, text)','client_service_address(uuid)',
    'set_invoice_items(uuid, jsonb)','set_estimate_items(uuid, jsonb)',
    'insert_payment(uuid, numeric, numeric, text, text, text, text, text, text, text, timestamptz)',
    'insert_refund(uuid, numeric, text, text)','org_public_json(uuid)','invoice_client_json(uuid)','estimate_client_json(uuid)',
    'apply_estimate_response(uuid, boolean, text, uuid[])','apply_online_payment(jsonb)','record_online_refund(jsonb)',
    'online_payment_failed(uuid, text)','save_payment_method(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- secure-link pages work without signing in
  foreach f in array array['get_public_invoice(text)','get_public_estimate(text)','respond_public_estimate(text, boolean, text, uuid[])'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.invoices, public.payments;
  end if;
end $$;
