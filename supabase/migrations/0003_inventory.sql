-- =============================================================================
-- ScrubHub — Inventory (supplies & equipment)
-- Run AFTER 0001_scrubhub_schema.sql and 0002_billing.sql. Safe to run once in the Supabase SQL editor.
--
--   inventory_items      what the company stocks (products, paper goods, tools, equipment)
--   inventory_movements  every change to stock: restock, use on a job, waste/damage, count adjustment
--
-- Stock on hand (inventory_items.quantity) is changed ONLY through the server
-- functions below, so every change leaves a history row. Admins manage items;
-- employees can see items and log supplies used on jobs they're assigned to.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table public.inventory_items (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  name                  text not null check (char_length(name) between 1 and 120),
  category              text not null default 'Cleaning products' check (char_length(category) between 1 and 60),
  unit                  text not null default 'each' check (char_length(unit) between 1 and 30),
  quantity              numeric(12,2) not null default 0 check (quantity >= 0),
  reorder_level         numeric(12,2) not null default 0 check (reorder_level >= 0),
  reorder_quantity      numeric(12,2) check (reorder_quantity is null or reorder_quantity > 0),
  unit_cost             numeric(12,2) check (unit_cost is null or unit_cost >= 0),
  supplier              text,
  sku                   text,
  location              text,
  assigned_employee_id  uuid references public.employees(id) on delete set null,
  notes                 text,
  is_archived           boolean not null default false,
  low_stock_notified_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on public.inventory_items (org_id, is_archived, name);

create table public.inventory_movements (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  item_id         uuid not null references public.inventory_items(id) on delete cascade,
  kind            text not null check (kind in ('restock','use','waste','adjust')),
  quantity_change numeric(12,2) not null check (quantity_change <> 0),
  quantity_after  numeric(12,2) not null check (quantity_after >= 0),
  unit_cost       numeric(12,2),
  job_id          uuid references public.jobs(id) on delete set null,
  employee_id     uuid references public.employees(id) on delete set null,
  note            text,
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text,
  reverses_id     uuid references public.inventory_movements(id) on delete set null,
  undone_at       timestamptz,
  created_at      timestamptz not null default now()
);
create index on public.inventory_movements (org_id, created_at desc);
create index on public.inventory_movements (item_id, created_at desc);
create index on public.inventory_movements (job_id);

create trigger t_inv_upd before update on public.inventory_items for each row execute function public.set_updated_at();
create trigger t_inventory_items_orgguard     before update on public.inventory_items     for each row execute function public.guard_org_id();
create trigger t_inventory_movements_orgguard before update on public.inventory_movements for each row execute function public.guard_org_id();

-- ---------------------------------------------------------------------------
-- 2. Guards
-- ---------------------------------------------------------------------------
-- Stock can only change through the functions in section 4 (so history is never skipped).
-- A new item may start with a quantity; that becomes its first history row.
create or replace function public.guard_inventory_quantity()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated','anon') and new.quantity is distinct from old.quantity then
    raise exception 'USE_STOCK_FUNCTIONS: change stock with restock, use, or count';
  end if;
  return new;
end $$;
create trigger t_inv_qty_guard before update on public.inventory_items for each row execute function public.guard_inventory_quantity();

-- Assigned employee must belong to the same company
create or replace function public.guard_inventory_item_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_employee_id is not null
     and not exists (select 1 from public.employees where id = new.assigned_employee_id and org_id = new.org_id) then
    raise exception 'Employee belongs to another organization';
  end if;
  return new;
end $$;
create trigger t_inv_item_org before insert or update on public.inventory_items for each row execute function public.guard_inventory_item_org();

-- Movement rows must point at an item / job in the same company
create or replace function public.guard_inventory_movement_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.inventory_items where id = new.item_id and org_id = new.org_id) then
    raise exception 'Cross-organization reference rejected on inventory_movements';
  end if;
  if new.job_id is not null and not exists (select 1 from public.jobs where id = new.job_id and org_id = new.org_id) then
    raise exception 'Cross-organization reference rejected on inventory_movements';
  end if;
  return new;
end $$;
create trigger t_inv_mov_org before insert or update on public.inventory_movements for each row execute function public.guard_inventory_movement_org();

-- Starting quantity on a new item becomes a history row
create or replace function public.trg_inventory_item_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.quantity > 0 then
    insert into public.inventory_movements (org_id, item_id, kind, quantity_change, quantity_after, unit_cost, note, created_by, created_by_name)
    values (new.org_id, new.id, 'adjust', new.quantity, new.quantity, new.unit_cost, 'Starting count', auth.uid(),
            (select full_name from public.profiles where id = auth.uid()));
  end if;
  return new;
end $$;
create trigger t_inv_item_created after insert on public.inventory_items for each row execute function public.trg_inventory_item_created();

-- ---------------------------------------------------------------------------
-- 3. Row-level security
-- ---------------------------------------------------------------------------
alter table public.inventory_items     enable row level security;
alter table public.inventory_movements enable row level security;

-- Staff (owner/admin/employee) can see the supply list; clients never can.
create policy inv_select on public.inventory_items for select to authenticated using (public.is_org_staff(org_id));
create policy inv_insert on public.inventory_items for insert to authenticated with check (public.is_org_admin(org_id));
create policy inv_update on public.inventory_items for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy inv_delete on public.inventory_items for delete to authenticated using (public.is_org_admin(org_id));

-- History: admins see everything; employees see what they logged and what was used on their jobs.
-- No insert/update/delete policies: rows are written only by the functions below.
create policy invm_select on public.inventory_movements for select to authenticated using (
  public.is_org_admin(org_id)
  or created_by = auth.uid()
  or (job_id is not null and public.is_assigned_to_job(job_id))
);

-- ---------------------------------------------------------------------------
-- 4. Server functions
-- ---------------------------------------------------------------------------
-- Internal: apply a change, write history, notify admins when an item first drops to its reorder level.
create or replace function public.apply_inventory_change(
  p_item uuid, p_kind text, p_change numeric, p_job uuid, p_note text, p_unit_cost numeric
) returns public.inventory_movements
language plpgsql security definer set search_path = public as $$
declare it public.inventory_items%rowtype; mv public.inventory_movements%rowtype; v_after numeric; v_emp uuid;
begin
  select * into it from public.inventory_items where id = p_item for update;
  if not found then raise exception 'Item not found'; end if;
  v_after := it.quantity + p_change;
  if v_after < 0 then
    raise exception 'INSUFFICIENT_STOCK: only % % on hand', trim(to_char(it.quantity, 'FM999999990.##')), it.unit;
  end if;
  if p_job is not null then v_emp := public.my_employee_for_job(p_job); end if;
  if v_emp is null then
    select e.id into v_emp from public.employees e where e.org_id = it.org_id and e.user_id = auth.uid() and e.status = 'active' limit 1;
  end if;

  update public.inventory_items
     set quantity = v_after,
         unit_cost = case when p_kind = 'restock' and p_unit_cost is not null then p_unit_cost else unit_cost end,
         low_stock_notified_at = case when v_after > reorder_level then null else low_stock_notified_at end
   where id = p_item returning * into it;

  insert into public.inventory_movements (org_id, item_id, kind, quantity_change, quantity_after, unit_cost, job_id, employee_id, note, created_by, created_by_name)
  values (it.org_id, it.id, p_kind, p_change, v_after, coalesce(p_unit_cost, it.unit_cost), p_job, v_emp, nullif(trim(p_note), ''), auth.uid(),
          (select full_name from public.profiles where id = auth.uid()))
  returning * into mv;

  if it.reorder_level > 0 and v_after <= it.reorder_level and it.low_stock_notified_at is null then
    update public.inventory_items set low_stock_notified_at = now() where id = it.id;
    perform public.notify_admins(it.org_id, 'low_stock',
      case when v_after = 0 then 'Out of ' || it.name else 'Running low: ' || it.name end,
      trim(to_char(v_after, 'FM999999990.##')) || ' ' || it.unit || ' left (reorder at ' || trim(to_char(it.reorder_level, 'FM999999990.##')) || ')',
      '/inventory/' || it.id);
  end if;
  return mv;
end $$;

-- Restock / use / waste. Admins: any kind. Employees: use or waste only,
-- and if a job is given they must be assigned to it.
create or replace function public.record_inventory_movement(
  p_item uuid, p_kind text, p_quantity numeric, p_job uuid default null, p_note text default null, p_unit_cost numeric default null
) returns public.inventory_movements
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_admin boolean;
begin
  select org_id into v_org from public.inventory_items where id = p_item;
  if v_org is null or not public.is_org_staff(v_org) then raise exception 'Item not found'; end if;
  if p_kind not in ('restock','use','waste') then raise exception 'Unknown stock action'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Enter a quantity greater than zero'; end if;
  v_admin := public.is_org_admin(v_org);
  if not v_admin then
    if p_kind = 'restock' then raise exception 'Only an admin can restock'; end if;
    if p_job is not null and not public.is_assigned_to_job(p_job) then raise exception 'You are not assigned to this job'; end if;
  end if;
  if p_job is not null and public.job_org(p_job) is distinct from v_org then raise exception 'Job not found'; end if;
  if exists (select 1 from public.inventory_items where id = p_item and is_archived) and p_kind <> 'restock' and not v_admin then
    raise exception 'This item is no longer tracked';
  end if;
  return public.apply_inventory_change(p_item, p_kind,
    case when p_kind = 'restock' then p_quantity else -p_quantity end,
    p_job, p_note, case when p_kind = 'restock' then p_unit_cost else null end);
end $$;

-- Physical count: set the exact quantity on hand (admins only).
create or replace function public.set_inventory_count(p_item uuid, p_counted numeric, p_note text default null)
returns public.inventory_movements
language plpgsql security definer set search_path = public as $$
declare it public.inventory_items%rowtype;
begin
  select * into it from public.inventory_items where id = p_item;
  if not found or not public.is_org_admin(it.org_id) then raise exception 'Item not found'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Count can''t be negative'; end if;
  if p_counted = it.quantity then raise exception 'NO_CHANGE: count matches what''s on hand'; end if;
  return public.apply_inventory_change(p_item, 'adjust', p_counted - it.quantity, null, coalesce(nullif(trim(p_note), ''), 'Stock count'), null);
end $$;

-- Undo a mistaken entry (admins, or the employee who logged it within 24 hours).
create or replace function public.undo_inventory_movement(p_movement uuid)
returns public.inventory_movements
language plpgsql security definer set search_path = public as $$
declare mv public.inventory_movements%rowtype;
begin
  select * into mv from public.inventory_movements where id = p_movement;
  if not found then raise exception 'Entry not found'; end if;
  if not (public.is_org_admin(mv.org_id) or (mv.created_by = auth.uid() and mv.created_at > now() - interval '24 hours' and mv.kind in ('use','waste'))) then
    raise exception 'Not allowed';
  end if;
  if mv.reverses_id is not null then raise exception 'That entry is already an undo'; end if;
  if mv.undone_at is not null then raise exception 'That entry was already undone'; end if;
  update public.inventory_movements set undone_at = now() where id = mv.id;
  mv := public.apply_inventory_change(mv.item_id, mv.kind, -mv.quantity_change, mv.job_id, 'Undo: ' || coalesce(mv.note, mv.kind), mv.unit_cost);
  update public.inventory_movements set reverses_id = p_movement where id = mv.id returning * into mv;
  return mv;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Permissions
-- ---------------------------------------------------------------------------
revoke execute on function public.apply_inventory_change(uuid, text, numeric, uuid, text, numeric) from public, anon, authenticated;
revoke execute on function public.record_inventory_movement(uuid, text, numeric, uuid, text, numeric) from public, anon;
revoke execute on function public.set_inventory_count(uuid, numeric, text) from public, anon;
revoke execute on function public.undo_inventory_movement(uuid) from public, anon;
grant execute on function public.record_inventory_movement(uuid, text, numeric, uuid, text, numeric) to authenticated;
grant execute on function public.set_inventory_count(uuid, numeric, text) to authenticated;
grant execute on function public.undo_inventory_movement(uuid) to authenticated;
grant select, insert, update, delete on public.inventory_items to authenticated;
grant select on public.inventory_movements to authenticated;

-- Live updates in the app
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.inventory_items';
  end if;
end $$;
