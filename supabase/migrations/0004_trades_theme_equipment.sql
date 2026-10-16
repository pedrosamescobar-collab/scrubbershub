-- =============================================================================
-- ScrubHub — trades, brand kit, equipment at property, priority jobs, billable parts
-- Run AFTER 0001, 0002_billing, 0003_inventory. Additive: existing companies stay
-- "cleaning" with their current look until they change it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Trade + brand kit on each company
-- ---------------------------------------------------------------------------
create or replace function public.valid_theme(t jsonb)
returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(t) = 'object'
    and octet_length(t::text) < 2000
    and (not t ? 'accent'  or jsonb_typeof(t->'accent') = 'null' or (t->>'accent') ~ '^#[0-9A-Fa-f]{6}$')
    and (not t ? 'font'    or t->>'font'    in ('jakarta','inter','poppins','nunito','montserrat','merriweather','system'))
    and (not t ? 'corners' or t->>'corners' in ('rounded','soft','square'))
    and (not t ? 'mode'    or t->>'mode'    in ('light','dark','auto'))
    and (not t ? 'sidebar' or t->>'sidebar' in ('light','tinted','brand','dark'))
    and (not t ? 'app_name' or jsonb_typeof(t->'app_name') = 'null' or char_length(t->>'app_name') <= 30)
    and (not t ? 'tagline'  or jsonb_typeof(t->'tagline')  = 'null' or char_length(t->>'tagline')  <= 120);
$$;

alter table public.organizations
  add column if not exists trade text not null default 'cleaning' check (trade in ('cleaning','plumbing')),
  add column if not exists theme jsonb not null default '{}'::jsonb;
alter table public.organizations add constraint organizations_theme_valid check (public.valid_theme(theme));

-- Public branding (no sign-in): used by the login page (/c/:slug), invite links and public invoice/estimate pages.
create or replace function public.get_org_branding(p_slug text default null, p_token text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', o.name, 'slug', o.slug, 'logo_url', o.logo_url, 'brand_color', o.brand_color,
                            'theme', o.theme, 'trade', o.trade)
  from public.organizations o
  where (p_slug is not null and o.slug = lower(trim(p_slug)))
     or (p_token is not null and o.id = (select i.org_id from public.invitations i where i.token = p_token))
  limit 1;
$$;

create or replace function public.org_public_json(p_org uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'name', o.name, 'logo_url', o.logo_url, 'brand_color', o.brand_color,
    'phone', o.phone, 'email', o.email, 'website', o.website, 'address', o.address, 'theme', o.theme, 'trade', o.trade, 'slug', o.slug)
  from public.organizations o where o.id = p_org;
$$;

-- Trade-aware starter price list for new companies
create or replace function public.seed_service_catalog(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_trade text;
begin
  if exists (select 1 from public.service_catalog where org_id = p_org) then return; end if;
  select trade into v_trade from public.organizations where id = p_org;
  if v_trade = 'plumbing' then
    -- Prices start at $0 so each company enters its own rates.
    insert into public.service_catalog (org_id, name, description, default_price, pricing_type, unit_label, position) values
      (p_org, 'Service Call / Diagnostic', 'Trip charge and diagnosis', 0, 'flat', null, 0),
      (p_org, 'Drain Cleaning', 'Clear clogged sink, tub, shower or main line', 0, 'flat', null, 1),
      (p_org, 'Leak Repair', 'Locate and repair a supply or drain leak', 0, 'flat', null, 2),
      (p_org, 'Toilet Repair / Replace', 'Flapper, fill valve, wax ring or full replacement', 0, 'flat', null, 3),
      (p_org, 'Faucet / Fixture Install', 'Install customer- or company-supplied fixture', 0, 'flat', null, 4),
      (p_org, 'Water Heater Repair', 'Diagnose and repair tank or tankless unit', 0, 'flat', null, 5),
      (p_org, 'Water Heater Replacement', 'Remove old unit, install and test new unit', 0, 'flat', null, 6),
      (p_org, 'Sewer Camera Inspection', 'Video inspection of drain / sewer line', 0, 'flat', null, 7),
      (p_org, 'Hourly Labor', 'Billed per technician hour', 0, 'hourly', 'hour', 8),
      (p_org, 'Custom Service', null, 0, 'custom', null, 9);
  else
    insert into public.service_catalog (org_id, name, description, default_price, pricing_type, unit_label, position) values
      (p_org, 'Standard Cleaning', 'Kitchen, bathrooms, dusting, floors and trash', 150, 'flat', null, 0),
      (p_org, 'Deep Cleaning', 'Top-to-bottom clean incl. baseboards, inside appliances on request', 275, 'flat', null, 1),
      (p_org, 'Move-In Cleaning', 'Empty home, cabinets and appliances inside and out', 325, 'flat', null, 2),
      (p_org, 'Move-Out Cleaning', 'Empty home, cabinets and appliances inside and out', 325, 'flat', null, 3),
      (p_org, 'Add-On Service', 'Inside oven, fridge, windows, laundry…', 40, 'per_unit', 'item', 4),
      (p_org, 'Hourly Labor', 'Billed per cleaner hour', 50, 'hourly', 'hour', 5),
      (p_org, 'Custom Service', null, 0, 'custom', null, 6);
  end if;
end $$;

-- create_organization now takes the trade (replaces the 2-argument version)
drop function if exists public.create_organization(text, text);
create or replace function public.create_organization(p_name text, p_brand_color text default '#0E9F8E', p_trade text default 'cleaning')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_slug text; v_base text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Business name is required'; end if;
  if coalesce(p_trade, 'cleaning') not in ('cleaning','plumbing') then raise exception 'Unknown trade'; end if;
  v_base := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
  if v_base = '' then v_base := 'company'; end if;
  v_slug := v_base;
  while exists (select 1 from public.organizations where slug = v_slug) loop
    v_slug := v_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 5);
  end loop;
  insert into public.organizations (name, slug, brand_color, created_by, email, trade)
  values (trim(p_name), v_slug, coalesce(p_brand_color, '#0E9F8E'), auth.uid(),
          (select email from auth.users where id = auth.uid()), coalesce(p_trade, 'cleaning'))
  returning id into v_org;
  insert into public.organization_settings (org_id, onboarding_step) values (v_org, 3);
  insert into public.subscriptions (org_id) values (v_org);
  insert into public.memberships (org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  return v_org;
end $$;

-- Client-facing notification wording follows the company's trade
create or replace function public.trg_notification_wording()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_trade text;
begin
  select trade into v_trade from public.organizations where id = new.org_id;
  if v_trade = 'plumbing' then
    new.title := replace(replace(new.title, 'Your cleaning is complete', 'Your service visit is complete'), 'Upcoming cleaning', 'Upcoming service visit');
    new.body  := replace(coalesce(new.body, ''), 'recurring cleanings', 'recurring service visits');
    if new.body = '' then new.body := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists t_notification_wording on public.notifications;
create trigger t_notification_wording before insert on public.notifications for each row execute function public.trg_notification_wording();

-- ---------------------------------------------------------------------------
-- 2. Priority / emergency jobs
-- ---------------------------------------------------------------------------
alter table public.jobs add column if not exists priority text not null default 'normal'
  check (priority in ('normal','urgent','emergency'));
create index if not exists jobs_org_priority_idx on public.jobs (org_id, priority) where priority <> 'normal';

alter table public.billing_settings
  add column if not exists urgent_fee    numeric(12,2) not null default 0 check (urgent_fee >= 0),
  add column if not exists emergency_fee numeric(12,2) not null default 0 check (emergency_fee >= 0);

-- Tell the office and the assigned crew as soon as a job is flagged urgent / emergency
create or replace function public.trg_job_priority_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_client text; u uuid; v_title text;
begin
  if new.priority = 'normal' or new.status in ('completed','cancelled') then return new; end if;
  if tg_op = 'UPDATE' and old.priority is not distinct from new.priority then return new; end if;
  select full_name into v_client from public.clients where id = new.client_id;
  v_title := case when new.priority = 'emergency' then 'Emergency job' else 'Urgent job' end;
  perform public.notify_admins(new.org_id, 'job_' || new.priority, v_title,
    new.service_name || ' for ' || coalesce(v_client, 'a client') || ' · ' || to_char(new.scheduled_start at time zone 'UTC', 'Mon DD HH24:MI') || ' UTC',
    '/jobs/' || new.id);
  for u in
    select e.user_id from public.job_assignments ja
    left join public.team_members tm on tm.team_id = ja.team_id
    join public.employees e on e.id = coalesce(ja.employee_id, tm.employee_id)
    where ja.job_id = new.id and e.user_id is not null and e.status = 'active'
      and not exists (select 1 from public.memberships m where m.org_id = new.org_id and m.user_id = e.user_id
                        and m.status = 'active' and m.role in ('owner','admin'))  -- admins were notified above
    group by e.user_id
  loop
    perform public.notify_user(new.org_id, u, 'job_' || new.priority, v_title,
      new.service_name || ' for ' || coalesce(v_client, 'a client'), '/work/jobs/' || new.id);
  end loop;
  return new;
end $$;
drop trigger if exists t_job_priority_notify on public.jobs;
create trigger t_job_priority_notify after insert or update of priority on public.jobs
  for each row execute function public.trg_job_priority_notify();

-- ---------------------------------------------------------------------------
-- 3. Equipment at a client's property (water heaters, softeners, AC units…)
-- ---------------------------------------------------------------------------
create or replace function public.is_assigned_to_client(p_client uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.jobs j where j.client_id = p_client and public.is_assigned_to_job(j.id));
$$;

create table if not exists public.client_equipment (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  client_id       uuid not null references public.clients(id) on delete cascade,
  kind            text not null check (char_length(kind) between 1 and 80),
  brand           text check (brand is null or char_length(brand) <= 80),
  model           text check (model is null or char_length(model) <= 80),
  serial          text check (serial is null or char_length(serial) <= 80),
  location        text check (location is null or char_length(location) <= 120),
  installed_on    date,
  warranty_until  date,
  notes           text,
  is_active       boolean not null default true,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists client_equipment_client_idx on public.client_equipment (client_id);
create index if not exists client_equipment_org_idx on public.client_equipment (org_id);

-- Which equipment was serviced on which job (service history)
create table if not exists public.job_equipment (
  job_id        uuid not null references public.jobs(id) on delete cascade,
  equipment_id  uuid not null references public.client_equipment(id) on delete cascade,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  note          text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (job_id, equipment_id)
);
create index if not exists job_equipment_equipment_idx on public.job_equipment (equipment_id);

create trigger t_equip_upd before update on public.client_equipment for each row execute function public.set_updated_at();
create trigger t_client_equipment_orgguard before update on public.client_equipment for each row execute function public.guard_org_id();
create trigger t_job_equipment_orgguard    before update on public.job_equipment    for each row execute function public.guard_org_id();

create or replace function public.guard_equipment_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'client_equipment' then
    if not exists (select 1 from public.clients where id = new.client_id and org_id = new.org_id) then
      raise exception 'Cross-organization reference rejected on client_equipment';
    end if;
  else
    if not exists (select 1 from public.jobs j join public.client_equipment e on e.client_id = j.client_id
                   where j.id = new.job_id and e.id = new.equipment_id and j.org_id = new.org_id and e.org_id = new.org_id) then
      raise exception 'Equipment must belong to this job''s client';
    end if;
  end if;
  return new;
end $$;
create trigger t_equip_org before insert or update on public.client_equipment for each row execute function public.guard_equipment_org();
create trigger t_job_equip_org before insert or update on public.job_equipment for each row execute function public.guard_equipment_org();

alter table public.client_equipment enable row level security;
alter table public.job_equipment    enable row level security;

-- Admins: everything. Crew: equipment at homes they have jobs at (and may add/update it in the field).
-- Clients: read their own equipment in the portal.
create policy eq_select on public.client_equipment for select to authenticated using (
  public.is_org_admin(org_id) or public.is_assigned_to_client(client_id) or client_id in (select public.my_client_ids()));
create policy eq_insert on public.client_equipment for insert to authenticated with check (
  public.is_org_admin(org_id) or (public.is_org_staff(org_id) and public.is_assigned_to_client(client_id)));
create policy eq_update on public.client_equipment for update to authenticated
  using (public.is_org_admin(org_id) or (public.is_org_staff(org_id) and public.is_assigned_to_client(client_id)))
  with check (public.is_org_admin(org_id) or (public.is_org_staff(org_id) and public.is_assigned_to_client(client_id)));
create policy eq_delete on public.client_equipment for delete to authenticated using (public.is_org_admin(org_id));

create policy je_select on public.job_equipment for select to authenticated using (public.can_view_job(job_id));
create policy je_insert on public.job_equipment for insert to authenticated with check (
  public.is_org_admin(org_id) or public.is_assigned_to_job(job_id));
create policy je_update on public.job_equipment for update to authenticated
  using (public.is_org_admin(org_id) or public.is_assigned_to_job(job_id))
  with check (public.is_org_admin(org_id) or public.is_assigned_to_job(job_id));
create policy je_delete on public.job_equipment for delete to authenticated using (
  public.is_org_admin(org_id) or (created_by = auth.uid() and public.is_assigned_to_job(job_id)));

grant select, insert, update, delete on public.client_equipment, public.job_equipment to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Parts used on a job → invoice
-- ---------------------------------------------------------------------------
alter table public.inventory_items
  add column if not exists billable   boolean not null default false,
  add column if not exists sell_price numeric(12,2) check (sell_price is null or sell_price >= 0);

-- Billable parts used on a job (net of undos), ready to become invoice lines
create or replace function public.job_billable_parts(p_job uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'service_id', null, 'description', i.name, 'quantity', q.qty,
           'unit_price', coalesce(i.sell_price, 0), 'taxable', true) order by i.name), '[]'::jsonb)
  from (select item_id, -sum(quantity_change) as qty
          from public.inventory_movements
         where job_id = p_job and kind = 'use' and undone_at is null and reverses_id is null
         group by item_id) q
  join public.inventory_items i on i.id = q.item_id
  where i.billable and q.qty > 0;
$$;

-- Same as before, plus: billable parts from the job, and the urgent / emergency fee
create or replace function public.create_invoice_from_job(p_job uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare j public.jobs%rowtype; v_existing uuid; svc public.service_catalog%rowtype; v_items jsonb;
        v_hours numeric; v_price numeric; v_prev jsonb; v_fee numeric; bs public.billing_settings%rowtype;
begin
  select * into j from public.jobs where id = p_job;
  if not found or not public.is_org_admin(j.org_id) then raise exception 'Not allowed'; end if;
  if j.status = 'cancelled' then raise exception 'This job was cancelled'; end if;
  select id into v_existing from public.invoices where job_id = p_job and voided_at is null order by created_at desc limit 1;
  if v_existing is not null then return v_existing; end if;

  select jsonb_agg(jsonb_build_object('service_id', ii.service_id, 'description', ii.description, 'quantity', ii.quantity,
                                      'unit_price', ii.unit_price, 'taxable', ii.taxable) order by ii.position)
    into v_prev
    from public.invoice_items ii
   where ii.invoice_id = (select i.id from public.invoices i where i.appointment_id = j.appointment_id and j.appointment_id is not null
                            and i.voided_at is null order by i.created_at desc limit 1)
     and not exists (select 1 from public.inventory_items x where x.org_id = j.org_id and x.name = ii.description and x.billable)
     and ii.description not in ('Urgent service fee', 'Emergency service fee');

  if v_prev is not null and jsonb_array_length(v_prev) > 0 then
    v_items := v_prev;
  else
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

  v_items := v_items || public.job_billable_parts(p_job);

  select * into bs from public.billing_settings where org_id = j.org_id;
  v_fee := case j.priority when 'emergency' then coalesce(bs.emergency_fee, 0) when 'urgent' then coalesce(bs.urgent_fee, 0) else 0 end;
  if v_fee > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object('service_id', null,
      'description', case j.priority when 'emergency' then 'Emergency service fee' else 'Urgent service fee' end,
      'quantity', 1, 'unit_price', v_fee, 'taxable', true));
  end if;

  return public.save_invoice(jsonb_build_object(
    'org_id', j.org_id, 'client_id', j.client_id, 'job_id', j.id, 'appointment_id', j.appointment_id,
    'issue_date', current_date, 'items', v_items));
end $$;

-- Add parts logged after the invoice was created (draft invoices only)
create or replace function public.add_job_parts_to_invoice(p_invoice uuid)
returns int language plpgsql security definer set search_path = public as $$
declare inv public.invoices%rowtype; v_parts jsonb; v_cur jsonb; v_new jsonb; n int;
begin
  select * into inv from public.invoices where id = p_invoice;
  if not found or not public.is_org_admin(inv.org_id) then raise exception 'Not allowed'; end if;
  if inv.job_id is null then raise exception 'This invoice isn''t linked to a job'; end if;
  if inv.status <> 'draft' then raise exception 'Only draft invoices can be changed this way'; end if;
  v_parts := public.job_billable_parts(inv.job_id);
  select coalesce(jsonb_agg(jsonb_build_object('service_id', service_id, 'description', description, 'quantity', quantity,
           'unit_price', unit_price, 'taxable', taxable) order by position), '[]'::jsonb)
    into v_cur from public.invoice_items
   where invoice_id = p_invoice
     and description not in (select x->>'description' from jsonb_array_elements(v_parts) x);
  v_new := v_cur || v_parts;
  perform public.set_invoice_items(p_invoice, v_new);
  update public.invoices set updated_at = now() where id = p_invoice;  -- re-runs totals
  n := jsonb_array_length(v_parts);
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Permissions
-- ---------------------------------------------------------------------------
revoke execute on function public.create_organization(text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text) to authenticated;
revoke execute on function public.add_job_parts_to_invoice(uuid) from public, anon;
grant execute on function public.add_job_parts_to_invoice(uuid) to authenticated;
revoke execute on function public.job_billable_parts(uuid) from public, anon, authenticated;
revoke execute on function public.is_assigned_to_client(uuid) from public, anon;
grant execute on function public.is_assigned_to_client(uuid) to authenticated;
grant execute on function public.get_org_branding(text, text) to anon, authenticated;
grant execute on function public.valid_theme(jsonb) to anon, authenticated;
revoke execute on function public.seed_service_catalog(uuid) from public, anon, authenticated;
