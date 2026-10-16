-- =============================================================================
-- ScrubHub — core schema, row-level security, storage and server-side logic
-- Run this once in the Supabase SQL editor (or `supabase db push`).
-- Every tenant-owned row carries org_id; RLS enforces tenant separation.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Utility
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.try_uuid(p text)
returns uuid language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- Parent tenant: one row per cleaning company
create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 120),
  slug          text not null unique,
  logo_url      text,
  brand_color   text not null default '#0E9F8E' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  phone         text,
  email         text,
  website       text,
  address       text,
  timezone      text not null default 'America/New_York',
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.organization_settings (
  org_id                   uuid primary key references public.organizations(id) on delete cascade,
  onboarding_step          int  not null default 2,
  onboarding_completed_at  timestamptz,
  reminder_hours_before    int  not null default 24 check (reminder_hours_before between 1 and 168),
  review_requests_enabled  boolean not null default true,
  email_notifications      boolean not null default true,
  sms_notifications        boolean not null default false,
  require_photos_to_complete boolean not null default false,
  updated_at               timestamptz not null default now()
);

-- Subscription-ready: written only by the backend (service role / billing webhook)
create table public.subscriptions (
  org_id                    uuid primary key references public.organizations(id) on delete cascade,
  plan                      text not null default 'trial',
  status                    text not null default 'trialing'
                              check (status in ('trialing','active','past_due','cancelled','paused')),
  seats                     int,
  trial_ends_at             timestamptz default (now() + interval '14 days'),
  current_period_end        timestamptz,
  provider                  text,          -- e.g. 'stripe'
  provider_customer_id      text,
  provider_subscription_id  text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- App-level user profile (1:1 with auth.users)
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  phone       text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- A user's role inside an organization
create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner','admin','employee','client')),
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  unique (org_id, user_id, role)
);
create index on public.memberships (user_id);

create table public.employees (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  full_name   text not null check (char_length(full_name) between 1 and 120),
  email       text,
  phone       text,
  role_title  text,
  color       text not null default '#0E9F8E',
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.employees (org_id);
create index on public.employees (user_id);

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  color       text not null default '#3B82F6',
  created_at  timestamptz not null default now()
);
create index on public.teams (org_id);

create table public.team_members (
  team_id      uuid not null references public.teams(id) on delete cascade,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  primary key (team_id, employee_id)
);

create table public.clients (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  user_id               uuid references auth.users(id) on delete set null,
  full_name             text not null check (char_length(full_name) between 1 and 120),
  email                 text,
  phone                 text,
  address_line1         text,
  address_line2         text,
  city                  text,
  state                 text,
  postal_code           text,
  access_instructions   text,
  cleaning_preferences  text,
  pets                  text,
  special_notes         text,
  status                text not null default 'active' check (status in ('active','inactive')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on public.clients (org_id);
create index on public.clients (user_id);

-- Invite links for employees and clients
create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  token        text not null unique default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
  role         text not null check (role in ('admin','employee','client')),
  employee_id  uuid references public.employees(id) on delete cascade,
  client_id    uuid references public.clients(id) on delete cascade,
  email        text,
  created_by   uuid references auth.users(id) on delete set null,
  accepted_by  uuid references auth.users(id) on delete set null,
  accepted_at  timestamptz,
  expires_at   timestamptz not null default (now() + interval '14 days'),
  created_at   timestamptz not null default now(),
  check ((role = 'employee') = (employee_id is not null)),
  check ((role = 'client')   = (client_id is not null))
);
create index on public.invitations (org_id);

-- Checklist templates
create table public.checklist_templates (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  description   text,
  is_archived   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.checklist_templates (org_id);

create table public.checklist_sections (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  template_id  uuid not null references public.checklist_templates(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  position     int  not null default 0
);
create index on public.checklist_sections (template_id);

create table public.checklist_items (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  template_id  uuid not null references public.checklist_templates(id) on delete cascade,
  section_id   uuid not null references public.checklist_sections(id) on delete cascade,
  label        text not null check (char_length(label) between 1 and 200),
  is_required  boolean not null default true,
  position     int  not null default 0
);
create index on public.checklist_items (section_id);

-- An appointment is a booking (one-time or a recurring series); jobs are the visits
create table public.appointments (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  client_id              uuid not null references public.clients(id) on delete cascade,
  service_name           text not null default 'Cleaning',
  checklist_template_id  uuid references public.checklist_templates(id) on delete set null,
  starts_at              timestamptz not null,
  duration_minutes       int not null default 120 check (duration_minutes between 15 and 1440),
  recurrence             text not null default 'none' check (recurrence in ('none','weekly','biweekly','monthly')),
  occurrences            int not null default 1 check (occurrences between 1 and 52),
  internal_notes         text,           -- visible to admins + assigned crew, never to the client
  created_by             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index on public.appointments (org_id);

-- Status is a text value (not an enum) so new statuses can be added with one ALTER
create table public.jobs (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  appointment_id        uuid references public.appointments(id) on delete cascade,
  client_id             uuid not null references public.clients(id) on delete cascade,
  service_name          text not null default 'Cleaning',
  scheduled_start       timestamptz not null,
  scheduled_end         timestamptz not null,
  status                text not null default 'scheduled'
                          check (status in ('scheduled','in_progress','completed','cancelled')),
  started_at            timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  cancel_reason         text,
  reminder_sent_at      timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (scheduled_end > scheduled_start)
);
create index on public.jobs (org_id, scheduled_start);
create index on public.jobs (client_id);
create index on public.jobs (appointment_id);

create table public.job_assignments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  job_id       uuid not null references public.jobs(id) on delete cascade,
  employee_id  uuid references public.employees(id) on delete cascade,
  team_id      uuid references public.teams(id) on delete cascade,
  created_at   timestamptz not null default now(),
  check ((employee_id is null) <> (team_id is null))
);
create index on public.job_assignments (job_id);
create index on public.job_assignments (employee_id);
create index on public.job_assignments (team_id);
create unique index job_assignments_emp_uq  on public.job_assignments (job_id, employee_id) where employee_id is not null;
create unique index job_assignments_team_uq on public.job_assignments (job_id, team_id) where team_id is not null;

-- Snapshot of a checklist for one job (template edits never rewrite history)
create table public.job_checklist_items (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  job_id            uuid not null references public.jobs(id) on delete cascade,
  section_name      text not null,
  section_position  int  not null default 0,
  label             text not null,
  is_required       boolean not null default true,
  position          int  not null default 0,
  completed_at      timestamptz,
  completed_by      uuid references auth.users(id) on delete set null
);
create index on public.job_checklist_items (job_id);

create table public.job_notes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  job_id      uuid not null references public.jobs(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  author_name text,
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index on public.job_notes (job_id);

create table public.client_notes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  job_id      uuid references public.jobs(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  author_name text,
  from_client boolean not null default false,
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index on public.client_notes (client_id);
create index on public.client_notes (job_id);

create table public.time_entries (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  job_id        uuid not null references public.jobs(id) on delete cascade,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  clock_in_at   timestamptz not null default now(),
  clock_out_at  timestamptz,
  created_at    timestamptz not null default now(),
  check (clock_out_at is null or clock_out_at >= clock_in_at)
);
create index on public.time_entries (job_id);
create index on public.time_entries (employee_id);
create unique index time_entries_one_open on public.time_entries (job_id, employee_id) where clock_out_at is null;

create table public.job_photos (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  job_id        uuid not null references public.jobs(id) on delete cascade,
  kind          text not null check (kind in ('before','after','other')),
  storage_path  text not null,
  caption       text,
  uploaded_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index on public.job_photos (job_id);

create table public.reviews (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  job_id            uuid not null unique references public.jobs(id) on delete cascade,
  client_id         uuid not null references public.clients(id) on delete cascade,
  rating            int  not null check (rating between 1 and 5),
  body              text,
  private_feedback  text,
  admin_response    text,
  is_hidden         boolean not null default false,
  created_at        timestamptz not null default now()
);
create index on public.reviews (org_id, created_at desc);

-- In-app notifications + outbox for email / SMS / push dispatch
create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  type             text not null,   -- job_assigned | job_reminder | appointment_reminder | job_completed | review_request | review_received | client_note
  title            text not null,
  body             text,
  link             text,
  read_at          timestamptz,
  delivery_status  text not null default 'pending' check (delivery_status in ('pending','sent','skipped','failed')),
  delivery_log     jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);
create index on public.notifications (delivery_status) where delivery_status = 'pending';

-- updated_at triggers
create trigger t_org_upd      before update on public.organizations        for each row execute function public.set_updated_at();
create trigger t_orgset_upd   before update on public.organization_settings for each row execute function public.set_updated_at();
create trigger t_sub_upd      before update on public.subscriptions        for each row execute function public.set_updated_at();
create trigger t_prof_upd     before update on public.profiles             for each row execute function public.set_updated_at();
create trigger t_emp_upd      before update on public.employees            for each row execute function public.set_updated_at();
create trigger t_cli_upd      before update on public.clients              for each row execute function public.set_updated_at();
create trigger t_tpl_upd      before update on public.checklist_templates  for each row execute function public.set_updated_at();
create trigger t_appt_upd     before update on public.appointments         for each row execute function public.set_updated_at();
create trigger t_job_upd      before update on public.jobs                 for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Authorization helpers (SECURITY DEFINER so they can be used inside RLS
--    without recursive policy evaluation)
-- ---------------------------------------------------------------------------
create or replace function public.has_org_role(p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid()
      and m.status = 'active' and m.role = any (p_roles)
  );
$$;

create or replace function public.is_org_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_org_role(p_org, array['owner','admin']);
$$;

create or replace function public.is_org_staff(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_org_role(p_org, array['owner','admin','employee']);
$$;

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_org_role(p_org, array['owner','admin','employee','client']);
$$;

-- Employee records (any org) that belong to the signed-in user and are active
create or replace function public.my_employee_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select e.id from public.employees e
  where e.user_id = auth.uid() and e.status = 'active';
$$;

create or replace function public.my_client_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select c.id from public.clients c where c.user_id = auth.uid();
$$;

create or replace function public.is_assigned_to_job(p_job uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.job_assignments ja
    where ja.job_id = p_job
      and (
        ja.employee_id in (select public.my_employee_ids())
        or ja.team_id in (
          select tm.team_id from public.team_members tm
          where tm.employee_id in (select public.my_employee_ids())
        )
      )
  );
$$;

create or replace function public.is_client_of_job(p_job uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.jobs j
    where j.id = p_job and j.client_id in (select public.my_client_ids())
  );
$$;

create or replace function public.job_org(p_job uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.jobs where id = p_job;
$$;

create or replace function public.can_view_job(p_job uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_org_admin(public.job_org(p_job))
      or public.is_assigned_to_job(p_job)
      or public.is_client_of_job(p_job);
$$;

-- Prevent anyone except SECURITY DEFINER code from linking an employee/client
-- record to a *different* user account (accounts are linked by invitation only)
create or replace function public.guard_user_link()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated','anon')
     and new.user_id is not null
     and new.user_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id) then
    raise exception 'Accounts can only be linked through an invitation';
  end if;
  return new;
end $$;
create trigger t_emp_guard before insert or update on public.employees for each row execute function public.guard_user_link();
create trigger t_cli_guard before insert or update on public.clients   for each row execute function public.guard_user_link();

-- org_id must never change after insert
create or replace function public.guard_org_id()
returns trigger language plpgsql as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'org_id is immutable';
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['employees','teams','clients','checklist_templates','checklist_sections',
    'checklist_items','appointments','jobs','job_assignments','job_checklist_items','job_notes',
    'client_notes','time_entries','job_photos','reviews','invitations','memberships'] loop
    execute format('create trigger t_%s_orgguard before update on public.%I for each row execute function public.guard_org_id()', t, t);
  end loop;
end $$;

-- Child rows must belong to the same org as their parent (defense in depth)
create or replace function public.guard_same_org()
returns trigger language plpgsql security definer set search_path = public as $$
declare parent_org uuid;
begin
  if tg_table_name in ('job_assignments','job_checklist_items','job_notes','time_entries','job_photos') then
    select org_id into parent_org from public.jobs where id = new.job_id;
  elsif tg_table_name = 'jobs' or tg_table_name = 'appointments' then
    select org_id into parent_org from public.clients where id = new.client_id;
  elsif tg_table_name = 'client_notes' then
    select org_id into parent_org from public.clients where id = new.client_id;
  elsif tg_table_name = 'checklist_sections' then
    select org_id into parent_org from public.checklist_templates where id = new.template_id;
  elsif tg_table_name = 'checklist_items' then
    select org_id into parent_org from public.checklist_sections where id = new.section_id;
  elsif tg_table_name = 'team_members' then
    select org_id into parent_org from public.teams where id = new.team_id;
  end if;
  if parent_org is null or parent_org <> new.org_id then
    raise exception 'Cross-organization reference rejected on %', tg_table_name;
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['job_assignments','job_checklist_items','job_notes','time_entries','job_photos',
    'jobs','appointments','client_notes','checklist_sections','checklist_items','team_members'] loop
    execute format('create trigger t_%s_sameorg before insert or update on public.%I for each row execute function public.guard_same_org()', t, t);
  end loop;
end $$;

-- Assigned employee / team must be in the same org as the job
create or replace function public.guard_assignment_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.employee_id is not null and not exists (select 1 from public.employees where id = new.employee_id and org_id = new.org_id) then
    raise exception 'Employee belongs to another organization';
  end if;
  if new.team_id is not null and not exists (select 1 from public.teams where id = new.team_id and org_id = new.org_id) then
    raise exception 'Team belongs to another organization';
  end if;
  return new;
end $$;
create trigger t_assign_org before insert or update on public.job_assignments for each row execute function public.guard_assignment_org();

create or replace function public.guard_team_member_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.employees where id = new.employee_id and org_id = new.org_id) then
    raise exception 'Employee belongs to another organization';
  end if;
  return new;
end $$;
create trigger t_tm_org before insert or update on public.team_members for each row execute function public.guard_team_member_org();

-- ---------------------------------------------------------------------------
-- 3. Row-level security
-- ---------------------------------------------------------------------------
alter table public.organizations          enable row level security;
alter table public.organization_settings  enable row level security;
alter table public.subscriptions          enable row level security;
alter table public.profiles               enable row level security;
alter table public.memberships            enable row level security;
alter table public.invitations            enable row level security;
alter table public.employees              enable row level security;
alter table public.teams                  enable row level security;
alter table public.team_members           enable row level security;
alter table public.clients                enable row level security;
alter table public.checklist_templates    enable row level security;
alter table public.checklist_sections     enable row level security;
alter table public.checklist_items        enable row level security;
alter table public.appointments           enable row level security;
alter table public.jobs                   enable row level security;
alter table public.job_assignments        enable row level security;
alter table public.job_checklist_items    enable row level security;
alter table public.job_notes              enable row level security;
alter table public.client_notes           enable row level security;
alter table public.time_entries           enable row level security;
alter table public.job_photos             enable row level security;
alter table public.reviews                enable row level security;
alter table public.notifications          enable row level security;

-- organizations: created only via create_organization()
create policy org_select on public.organizations for select to authenticated using (public.is_org_member(id));
create policy org_update on public.organizations for update to authenticated using (public.is_org_admin(id)) with check (public.is_org_admin(id));

create policy orgset_select on public.organization_settings for select to authenticated using (public.is_org_member(org_id));
create policy orgset_update on public.organization_settings for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

create policy sub_select on public.subscriptions for select to authenticated using (public.is_org_admin(org_id));

create policy prof_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or exists (
    select 1 from public.memberships them
    where them.user_id = profiles.id and public.is_org_admin(them.org_id)
  )
);
create policy prof_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy mem_select on public.memberships for select to authenticated using (user_id = auth.uid() or public.is_org_admin(org_id));
create policy mem_update on public.memberships for update to authenticated
  using (public.is_org_admin(org_id) and role <> 'owner' and user_id <> auth.uid())
  with check (public.is_org_admin(org_id) and role <> 'owner');

create policy inv_all on public.invitations for all to authenticated
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id) and created_by = auth.uid());

create policy emp_select on public.employees for select to authenticated using (public.is_org_staff(org_id));
create policy emp_insert on public.employees for insert to authenticated with check (public.is_org_admin(org_id));
create policy emp_update on public.employees for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy emp_delete on public.employees for delete to authenticated using (public.is_org_admin(org_id));

create policy team_select on public.teams for select to authenticated using (public.is_org_staff(org_id));
create policy team_write  on public.teams for all    to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy tm_select   on public.team_members for select to authenticated using (public.is_org_staff(org_id));
create policy tm_write    on public.team_members for all    to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

create policy cli_select on public.clients for select to authenticated using (
  public.is_org_admin(org_id)
  or user_id = auth.uid()
  or exists (select 1 from public.jobs j where j.client_id = clients.id and public.is_assigned_to_job(j.id))
);
create policy cli_insert on public.clients for insert to authenticated with check (public.is_org_admin(org_id));
create policy cli_update on public.clients for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy cli_delete on public.clients for delete to authenticated using (public.is_org_admin(org_id));

create policy tpl_select on public.checklist_templates for select to authenticated using (public.is_org_staff(org_id));
create policy tpl_write  on public.checklist_templates for all    to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy sec_select on public.checklist_sections  for select to authenticated using (public.is_org_staff(org_id));
create policy sec_write  on public.checklist_sections  for all    to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy itm_select on public.checklist_items     for select to authenticated using (public.is_org_staff(org_id));
create policy itm_write  on public.checklist_items     for all    to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

create policy appt_select on public.appointments for select to authenticated using (
  public.is_org_admin(org_id)
  or exists (select 1 from public.jobs j where j.appointment_id = appointments.id and public.is_assigned_to_job(j.id))
);
create policy appt_write on public.appointments for all to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

create policy job_select on public.jobs for select to authenticated using (
  public.is_org_admin(org_id) or public.is_assigned_to_job(id) or client_id in (select public.my_client_ids())
);
create policy job_insert on public.jobs for insert to authenticated with check (public.is_org_admin(org_id));
create policy job_update on public.jobs for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy job_delete on public.jobs for delete to authenticated using (public.is_org_admin(org_id));

create policy ja_select on public.job_assignments for select to authenticated using (public.is_org_admin(org_id) or public.is_assigned_to_job(job_id));
create policy ja_write  on public.job_assignments for all    to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- checklist progress: updates only through set_checklist_item()
create policy jci_select on public.job_checklist_items for select to authenticated using (public.can_view_job(job_id));
create policy jci_insert on public.job_checklist_items for insert to authenticated with check (public.is_org_admin(org_id));
create policy jci_delete on public.job_checklist_items for delete to authenticated using (public.is_org_admin(org_id));

-- internal crew notes: admins + assigned crew only (never clients)
create policy jn_select on public.job_notes for select to authenticated using (public.is_org_admin(org_id) or public.is_assigned_to_job(job_id));
create policy jn_insert on public.job_notes for insert to authenticated with check (
  author_id = auth.uid() and (public.is_org_admin(org_id) or public.is_assigned_to_job(job_id))
);
create policy jn_delete on public.job_notes for delete to authenticated using (public.is_org_admin(org_id) or author_id = auth.uid());

create policy cn_select on public.client_notes for select to authenticated using (
  public.is_org_admin(org_id)
  or client_id in (select public.my_client_ids())
  or exists (select 1 from public.jobs j where j.client_id = client_notes.client_id and public.is_assigned_to_job(j.id))
);
create policy cn_insert on public.client_notes for insert to authenticated with check (
  author_id = auth.uid() and (
    (public.is_org_admin(org_id) and from_client = false)
    or (client_id in (select public.my_client_ids()) and from_client = true
        and (job_id is null or public.is_client_of_job(job_id)))
  )
);
create policy cn_delete on public.client_notes for delete to authenticated using (author_id = auth.uid() or public.is_org_admin(org_id));

create policy te_select on public.time_entries for select to authenticated using (
  public.is_org_admin(org_id) or employee_id in (select public.my_employee_ids())
);
create policy te_update on public.time_entries for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy te_delete on public.time_entries for delete to authenticated using (public.is_org_admin(org_id));

create policy ph_select on public.job_photos for select to authenticated using (
  public.is_org_admin(org_id) or public.is_assigned_to_job(job_id)
  or (public.is_client_of_job(job_id) and exists (select 1 from public.jobs j where j.id = job_id and j.status = 'completed'))
);
create policy ph_insert on public.job_photos for insert to authenticated with check (
  uploaded_by = auth.uid() and (public.is_org_admin(org_id) or public.is_assigned_to_job(job_id))
  and storage_path like (org_id::text || '/' || job_id::text || '/%')
);
create policy ph_delete on public.job_photos for delete to authenticated using (public.is_org_admin(org_id) or uploaded_by = auth.uid());

create policy rv_select on public.reviews for select to authenticated using (
  public.is_org_admin(org_id) or client_id in (select public.my_client_ids())
);
create policy rv_update on public.reviews for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

create policy nt_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy nt_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy nt_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Auth hook: create a profile for every new user
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.email)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 5. Notifications
-- ---------------------------------------------------------------------------
create or replace function public.notify_user(p_org uuid, p_user uuid, p_type text, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications (org_id, user_id, type, title, body, link)
  values (p_org, p_user, p_type, p_title, p_body, p_link);
end $$;

create or replace function public.notify_admins(p_org uuid, p_type text, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select distinct user_id from public.memberships
           where org_id = p_org and role in ('owner','admin') and status = 'active' loop
    perform public.notify_user(p_org, u, p_type, p_title, p_body, p_link);
  end loop;
end $$;

create or replace function public.trg_assignment_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare j record; u uuid;
begin
  select jb.*, c.full_name as client_name into j
  from public.jobs jb join public.clients c on c.id = jb.client_id where jb.id = new.job_id;
  if j.status in ('completed','cancelled') then return new; end if;
  for u in
    select e.user_id from public.employees e where e.id = new.employee_id and e.user_id is not null
    union
    select e.user_id from public.team_members tm join public.employees e on e.id = tm.employee_id
    where tm.team_id = new.team_id and e.user_id is not null
  loop
    if u is distinct from auth.uid() then
      perform public.notify_user(new.org_id, u, 'job_assigned', 'New job assigned',
        j.service_name || ' for ' || j.client_name, '/work/jobs/' || new.job_id);
    end if;
  end loop;
  return new;
end $$;
create trigger t_assignment_notify after insert on public.job_assignments
  for each row execute function public.trg_assignment_notify();

create or replace function public.trg_review_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare cname text;
begin
  select full_name into cname from public.clients where id = new.client_id;
  perform public.notify_admins(new.org_id, 'review_received',
    new.rating || '★ review from ' || cname, left(coalesce(new.body, ''), 140), '/jobs/' || new.job_id);
  return new;
end $$;
create trigger t_review_notify after insert on public.reviews for each row execute function public.trg_review_notify();

create or replace function public.trg_client_note_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.from_client then
    perform public.notify_admins(new.org_id, 'client_note', 'New note from ' || coalesce(new.author_name, 'a client'),
      left(new.body, 140), case when new.job_id is not null then '/jobs/' || new.job_id else '/clients/' || new.client_id end);
  end if;
  return new;
end $$;
create trigger t_client_note_notify after insert on public.client_notes for each row execute function public.trg_client_note_notify();

-- ---------------------------------------------------------------------------
-- 6. RPCs (server-side business logic)
-- ---------------------------------------------------------------------------

-- 6.1 Create a new cleaning company workspace; caller becomes owner
create or replace function public.create_organization(p_name text, p_brand_color text default '#0E9F8E')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_slug text; v_base text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Business name is required'; end if;
  v_base := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
  if v_base = '' then v_base := 'company'; end if;
  v_slug := v_base;
  while exists (select 1 from public.organizations where slug = v_slug) loop
    v_slug := v_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 5);
  end loop;
  insert into public.organizations (name, slug, brand_color, created_by, email)
  values (trim(p_name), v_slug, coalesce(p_brand_color, '#0E9F8E'), auth.uid(),
          (select email from auth.users where id = auth.uid()))
  returning id into v_org;
  insert into public.organization_settings (org_id, onboarding_step) values (v_org, 3);
  insert into public.subscriptions (org_id) values (v_org);
  insert into public.memberships (org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  return v_org;
end $$;

-- 6.2 Public lookup of an invitation (used on /join/:token before sign-in)
create or replace function public.get_invitation(p_token text)
returns table (org_name text, org_logo_url text, org_brand_color text, role text,
               invitee_name text, invitee_email text, is_expired boolean, is_accepted boolean)
language sql stable security definer set search_path = public as $$
  select o.name, o.logo_url, o.brand_color, i.role,
         coalesce(e.full_name, c.full_name), coalesce(i.email, e.email, c.email),
         i.expires_at < now(), i.accepted_at is not null
  from public.invitations i
  join public.organizations o on o.id = i.org_id
  left join public.employees e on e.id = i.employee_id
  left join public.clients c on c.id = i.client_id
  where i.token = p_token;
$$;

-- 6.3 Accept an invitation: links the signed-in user to the employee/client record
create or replace function public.accept_invitation(p_token text)
returns table (joined_org_id uuid, joined_role text) language plpgsql security definer set search_path = public as $$
declare inv public.invitations%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into inv from public.invitations where token = p_token for update;
  if not found then raise exception 'Invitation not found'; end if;
  if inv.accepted_at is not null and inv.accepted_by is distinct from auth.uid() then
    raise exception 'This invitation has already been used';
  end if;
  if inv.expires_at < now() then raise exception 'This invitation has expired. Ask for a new link.'; end if;

  if inv.role = 'employee' then
    update public.employees set user_id = auth.uid(), status = 'active' where id = inv.employee_id;
  elsif inv.role = 'client' then
    update public.clients set user_id = auth.uid() where id = inv.client_id;
  end if;

  insert into public.memberships (org_id, user_id, role)
  values (inv.org_id, auth.uid(), inv.role)
  on conflict (org_id, user_id, role) do update set status = 'active';

  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return query select inv.org_id, inv.role;
end $$;

-- 6.4 Activate / deactivate an employee (also toggles their login access)
create or replace function public.set_employee_status(p_employee uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare e public.employees%rowtype;
begin
  select * into e from public.employees where id = p_employee;
  if not found or not public.is_org_admin(e.org_id) then raise exception 'Not allowed'; end if;
  if p_status not in ('active','inactive') then raise exception 'Invalid status'; end if;
  update public.employees set status = p_status where id = p_employee;
  if e.user_id is not null then
    update public.memberships set status = p_status
    where org_id = e.org_id and user_id = e.user_id and role = 'employee';
  end if;
end $$;

-- 6.5 Copy a checklist template into a job (internal helper)
create or replace function public.copy_template_to_job(p_job uuid, p_template uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.jobs where id = p_job;
  insert into public.job_checklist_items (org_id, job_id, section_name, section_position, label, is_required, position)
  select v_org, p_job, s.name, s.position, i.label, i.is_required, i.position
  from public.checklist_sections s
  join public.checklist_items i on i.section_id = s.id
  where s.template_id = p_template and s.org_id = v_org;
end $$;
revoke all on function public.copy_template_to_job(uuid, uuid) from public;

-- 6.6 Schedule an appointment (one-time or recurring) and generate its jobs
create or replace function public.schedule_appointment(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := (p->>'org_id')::uuid;
  v_client uuid := (p->>'client_id')::uuid;
  v_tpl uuid := nullif(p->>'checklist_template_id', '')::uuid;
  v_start timestamptz := (p->>'starts_at')::timestamptz;
  v_dur int := coalesce((p->>'duration_minutes')::int, 120);
  v_rec text := coalesce(p->>'recurrence', 'none');
  v_occ int;
  v_appt uuid; v_job uuid; v_at timestamptz; i int; x uuid;
begin
  if not public.is_org_admin(v_org) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.clients where id = v_client and org_id = v_org) then
    raise exception 'Client not found';
  end if;
  if v_tpl is not null and not exists (select 1 from public.checklist_templates where id = v_tpl and org_id = v_org) then
    raise exception 'Checklist not found';
  end if;
  if v_start is null then raise exception 'Start time is required'; end if;
  v_occ := case when v_rec = 'none' then 1
                else least(greatest(coalesce((p->>'occurrences')::int,
                       case v_rec when 'weekly' then 12 when 'biweekly' then 8 else 6 end), 1), 52) end;

  insert into public.appointments (org_id, client_id, service_name, checklist_template_id, starts_at,
                                   duration_minutes, recurrence, occurrences, internal_notes, created_by)
  values (v_org, v_client, coalesce(nullif(trim(p->>'service_name'), ''), 'Cleaning'), v_tpl, v_start,
          v_dur, v_rec, v_occ, nullif(trim(p->>'internal_notes'), ''), auth.uid())
  returning id into v_appt;

  for i in 0 .. v_occ - 1 loop
    v_at := case v_rec
      when 'weekly'   then v_start + make_interval(days => 7 * i)
      when 'biweekly' then v_start + make_interval(days => 14 * i)
      when 'monthly'  then v_start + make_interval(months => i)
      else v_start end;
    insert into public.jobs (org_id, appointment_id, client_id, service_name, scheduled_start, scheduled_end)
    values (v_org, v_appt, v_client, coalesce(nullif(trim(p->>'service_name'), ''), 'Cleaning'),
            v_at, v_at + make_interval(mins => v_dur))
    returning id into v_job;

    if v_tpl is not null then perform public.copy_template_to_job(v_job, v_tpl); end if;

    for x in select (jsonb_array_elements_text(coalesce(p->'employee_ids', '[]'::jsonb)))::uuid loop
      insert into public.job_assignments (org_id, job_id, employee_id) values (v_org, v_job, x) on conflict do nothing;
    end loop;
    for x in select (jsonb_array_elements_text(coalesce(p->'team_ids', '[]'::jsonb)))::uuid loop
      insert into public.job_assignments (org_id, job_id, team_id) values (v_org, v_job, x) on conflict do nothing;
    end loop;
  end loop;
  return v_appt;
end $$;

-- 6.7 Replace a job's checklist (only before work has started)
create or replace function public.set_job_checklist(p_job uuid, p_template uuid)
returns void language plpgsql security definer set search_path = public as $$
declare j public.jobs%rowtype;
begin
  select * into j from public.jobs where id = p_job;
  if not found or not public.is_org_admin(j.org_id) then raise exception 'Not allowed'; end if;
  if exists (select 1 from public.job_checklist_items where job_id = p_job and completed_at is not null) then
    raise exception 'This job already has completed checklist items';
  end if;
  delete from public.job_checklist_items where job_id = p_job;
  if p_template is not null then
    if not exists (select 1 from public.checklist_templates where id = p_template and org_id = j.org_id) then
      raise exception 'Checklist not found';
    end if;
    perform public.copy_template_to_job(p_job, p_template);
  end if;
end $$;

-- 6.8 Cancel a job, or this and all later jobs in the same series
create or replace function public.cancel_job(p_job uuid, p_scope text default 'this', p_reason text default null)
returns int language plpgsql security definer set search_path = public as $$
declare j public.jobs%rowtype; n int;
begin
  select * into j from public.jobs where id = p_job;
  if not found or not public.is_org_admin(j.org_id) then raise exception 'Not allowed'; end if;
  update public.jobs set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
  where status in ('scheduled')
    and (id = p_job or (p_scope = 'future' and appointment_id = j.appointment_id and scheduled_start >= j.scheduled_start));
  get diagnostics n = row_count;
  return n;
end $$;

-- 6.9 Field work: employee (or admin covering) actions on an assigned job
create or replace function public.my_employee_for_job(p_job uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select e.id from public.employees e
  join public.jobs j on j.org_id = e.org_id
  where j.id = p_job and e.user_id = auth.uid() and e.status = 'active'
  limit 1;
$$;

create or replace function public.clock_in(p_job uuid)
returns public.time_entries language plpgsql security definer set search_path = public as $$
declare j public.jobs%rowtype; v_emp uuid; te public.time_entries%rowtype;
begin
  select * into j from public.jobs where id = p_job;
  if not found then raise exception 'Job not found'; end if;
  if not public.is_assigned_to_job(p_job) then raise exception 'You are not assigned to this job'; end if;
  if j.status in ('completed','cancelled') then raise exception 'This job is %', j.status; end if;
  v_emp := public.my_employee_for_job(p_job);
  if exists (select 1 from public.time_entries where job_id = p_job and employee_id = v_emp and clock_out_at is null) then
    raise exception 'You are already clocked in';
  end if;
  insert into public.time_entries (org_id, job_id, employee_id) values (j.org_id, p_job, v_emp) returning * into te;
  if j.status = 'scheduled' then
    update public.jobs set status = 'in_progress', started_at = coalesce(started_at, now()) where id = p_job;
  end if;
  return te;
end $$;

create or replace function public.clock_out(p_job uuid)
returns public.time_entries language plpgsql security definer set search_path = public as $$
declare te public.time_entries%rowtype;
begin
  if not public.is_assigned_to_job(p_job) then raise exception 'You are not assigned to this job'; end if;
  update public.time_entries set clock_out_at = now()
  where job_id = p_job and employee_id = public.my_employee_for_job(p_job) and clock_out_at is null
  returning * into te;
  if not found then raise exception 'You are not clocked in'; end if;
  return te;
end $$;

create or replace function public.set_checklist_item(p_item uuid, p_done boolean)
returns public.job_checklist_items language plpgsql security definer set search_path = public as $$
declare it public.job_checklist_items%rowtype; j public.jobs%rowtype;
begin
  select * into it from public.job_checklist_items where id = p_item;
  if not found then raise exception 'Item not found'; end if;
  select * into j from public.jobs where id = it.job_id;
  if not (public.is_assigned_to_job(j.id) or public.is_org_admin(j.org_id)) then raise exception 'Not allowed'; end if;
  if j.status in ('completed','cancelled') then raise exception 'This job is %', j.status; end if;
  update public.job_checklist_items
     set completed_at = case when p_done then coalesce(completed_at, now()) else null end,
         completed_by = case when p_done then auth.uid() else null end
   where id = p_item returning * into it;
  if p_done and j.status = 'scheduled' then
    update public.jobs set status = 'in_progress', started_at = coalesce(started_at, now()) where id = j.id;
  end if;
  return it;
end $$;

create or replace function public.complete_job(p_job uuid)
returns public.jobs language plpgsql security definer set search_path = public as $$
declare j public.jobs%rowtype; v_missing int; v_client_user uuid; v_client_name text; s public.organization_settings%rowtype;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'Job not found'; end if;
  if not (public.is_assigned_to_job(p_job) or public.is_org_admin(j.org_id)) then raise exception 'Not allowed'; end if;
  if j.status = 'completed' then return j; end if;
  if j.status = 'cancelled' then raise exception 'This job was cancelled'; end if;
  select count(*) into v_missing from public.job_checklist_items
   where job_id = p_job and is_required and completed_at is null;
  if v_missing > 0 then raise exception 'REQUIRED_ITEMS_INCOMPLETE: % required task(s) still open', v_missing; end if;
  select * into s from public.organization_settings where org_id = j.org_id;
  if s.require_photos_to_complete and not exists (select 1 from public.job_photos where job_id = p_job and kind = 'after') then
    raise exception 'PHOTOS_REQUIRED: add at least one after photo';
  end if;

  update public.time_entries set clock_out_at = now() where job_id = p_job and clock_out_at is null;
  update public.jobs set status = 'completed', completed_at = now(), started_at = coalesce(started_at, now())
   where id = p_job returning * into j;

  select user_id, full_name into v_client_user, v_client_name from public.clients where id = j.client_id;
  perform public.notify_admins(j.org_id, 'job_completed', 'Job completed',
    j.service_name || ' for ' || v_client_name, '/jobs/' || p_job);
  if coalesce(s.review_requests_enabled, true) then
    perform public.notify_user(j.org_id, v_client_user, 'review_request', 'Your cleaning is complete',
      'How did we do? Tap to leave a quick review.', '/portal/appointments/' || p_job);
  end if;
  return j;
end $$;

-- 6.10 Client actions
create or replace function public.submit_review(p_job uuid, p_rating int, p_body text, p_private text)
returns public.reviews language plpgsql security definer set search_path = public as $$
declare j public.jobs%rowtype; r public.reviews%rowtype;
begin
  select * into j from public.jobs where id = p_job;
  if not found or not public.is_client_of_job(p_job) then raise exception 'Not allowed'; end if;
  if j.status <> 'completed' then raise exception 'You can review a cleaning once it is completed'; end if;
  if p_rating not between 1 and 5 then raise exception 'Rating must be 1 to 5'; end if;
  insert into public.reviews (org_id, job_id, client_id, rating, body, private_feedback)
  values (j.org_id, p_job, j.client_id, p_rating, nullif(trim(p_body), ''), nullif(trim(p_private), ''))
  returning * into r;
  return r;
end $$;

create or replace function public.update_my_client_profile(
  p_client uuid, p_full_name text, p_phone text, p_access text, p_prefs text, p_pets text)
returns public.clients language plpgsql security definer set search_path = public as $$
declare c public.clients%rowtype;
begin
  update public.clients set
    full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
    phone = p_phone, access_instructions = p_access, cleaning_preferences = p_prefs, pets = p_pets
  where id = p_client and user_id = auth.uid()
  returning * into c;
  if not found then raise exception 'Not allowed'; end if;
  return c;
end $$;

-- Crew names for a job (lets clients see who is coming without exposing staff records)
create or replace function public.job_crew_names(p_job uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when public.can_view_job(p_job) then (
    select string_agg(distinct split_part(e.full_name, ' ', 1), ', ')
    from public.job_assignments ja
    left join public.team_members tm on tm.team_id = ja.team_id
    join public.employees e on e.id = coalesce(ja.employee_id, tm.employee_id)
    where ja.job_id = p_job
  ) end;
$$;

-- 6.11 Reminders: queue notifications for upcoming jobs (button in admin UI,
--      or run on a schedule by the Netlify scheduled function / pg_cron)
create or replace function public.queue_reminders(p_org uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; u uuid;
begin
  if p_org is not null and not public.is_org_admin(p_org) then raise exception 'Not allowed'; end if;
  if p_org is null and current_user in ('authenticated','anon') then raise exception 'Not allowed'; end if;
  for r in
    select j.*, c.full_name as client_name, c.user_id as client_user, o.name as org_name
    from public.jobs j
    join public.clients c on c.id = j.client_id
    join public.organizations o on o.id = j.org_id
    join public.organization_settings s on s.org_id = j.org_id
    where j.status = 'scheduled' and j.reminder_sent_at is null
      and (p_org is null or j.org_id = p_org)
      and j.scheduled_start > now()
      and j.scheduled_start <= now() + make_interval(hours => s.reminder_hours_before)
  loop
    perform public.notify_user(r.org_id, r.client_user, 'appointment_reminder', 'Upcoming cleaning',
      r.org_name || ' is scheduled for ' || to_char(r.scheduled_start at time zone 'UTC', 'Dy Mon DD') ||
      '. Add any notes for the crew in the app.', '/portal/appointments/' || r.id);
    for u in
      select e.user_id from public.job_assignments ja
      left join public.team_members tm on tm.team_id = ja.team_id
      join public.employees e on e.id = coalesce(ja.employee_id, tm.employee_id)
      where ja.job_id = r.id and e.user_id is not null and e.status = 'active'
      group by e.user_id
    loop
      perform public.notify_user(r.org_id, u, 'job_reminder', 'Upcoming job',
        r.service_name || ' for ' || r.client_name, '/work/jobs/' || r.id);
    end loop;
    update public.jobs set reminder_sent_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Storage buckets + policies
--    logos:      public read, path  {org_id}/logo-<ts>.<ext>
--    job-photos: private,     path  {org_id}/{job_id}/{before|after}/<file>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('logos', 'logos', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('job-photos', 'job-photos', false)
  on conflict (id) do nothing;

create policy logos_read on storage.objects for select to authenticated
  using (bucket_id = 'logos');
create policy logos_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and public.is_org_admin(public.try_uuid((storage.foldername(name))[1])));
create policy logos_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'logos' and public.is_org_admin(public.try_uuid((storage.foldername(name))[1])));
create policy logos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and public.is_org_admin(public.try_uuid((storage.foldername(name))[1])));

create policy photos_select on storage.objects for select to authenticated
  using (bucket_id = 'job-photos'
         and public.job_org(public.try_uuid((storage.foldername(name))[2])) = public.try_uuid((storage.foldername(name))[1])
         and (
           public.is_org_admin(public.try_uuid((storage.foldername(name))[1]))
           or public.is_assigned_to_job(public.try_uuid((storage.foldername(name))[2]))
           or (public.is_client_of_job(public.try_uuid((storage.foldername(name))[2]))
               and exists (select 1 from public.jobs j where j.id = public.try_uuid((storage.foldername(name))[2]) and j.status = 'completed'))
         ));
create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos'
         and public.job_org(public.try_uuid((storage.foldername(name))[2])) = public.try_uuid((storage.foldername(name))[1])
         and (public.is_org_admin(public.try_uuid((storage.foldername(name))[1]))
              or public.is_assigned_to_job(public.try_uuid((storage.foldername(name))[2]))));
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'job-photos'
         and (public.is_org_admin(public.try_uuid((storage.foldername(name))[1])) or owner = auth.uid()));

-- ---------------------------------------------------------------------------
-- 8. Function privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.copy_template_to_job(uuid, uuid) from authenticated;
revoke execute on function public.notify_user(uuid, uuid, text, text, text, text) from authenticated;
revoke execute on function public.notify_admins(uuid, text, text, text, text) from authenticated;
grant execute on function public.get_invitation(text) to anon;
grant execute on function public.try_uuid(text) to anon;

-- Realtime: stream notifications + job progress to open apps
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications, public.jobs, public.job_checklist_items;
  end if;
end $$;
