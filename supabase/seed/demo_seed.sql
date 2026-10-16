-- =============================================================================
-- OPTIONAL demo data for testing. Not part of the app.
-- 1. Sign up in the app and finish onboarding (creates your company).
-- 2. Replace the email below with the one you signed up with.
-- 3. Run this in the Supabase SQL editor.
-- It adds sample employees, a team, clients and two weeks of jobs to YOUR company.
-- Employees/clients here are not linked to logins — use "Invite" in the app for that.
-- =============================================================================
do $$
declare
  v_email text := 'you@example.com';   -- <<< change me
  v_org uuid; v_owner uuid; v_tpl uuid;
  e1 uuid; e2 uuid; e3 uuid; t1 uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid;
  v_appt uuid; v_job uuid; d int; cl uuid; emp uuid; h int;
begin
  select id into v_owner from auth.users where email = v_email;
  if v_owner is null then raise exception 'No user with email %', v_email; end if;
  select org_id into v_org from public.memberships where user_id = v_owner and role = 'owner' limit 1;
  if v_org is null then raise exception 'That user does not own a company yet — finish onboarding first'; end if;

  insert into public.employees (org_id, full_name, phone, role_title, color) values
    (v_org, 'Maria Lopez', '727-555-0101', 'Lead cleaner', '#0E9F8E') returning id into e1;
  insert into public.employees (org_id, full_name, phone, color) values (v_org, 'Ana Silva', '727-555-0102', '#7048E8') returning id into e2;
  insert into public.employees (org_id, full_name, phone, color) values (v_org, 'Renato Costa', '727-555-0103', '#E8590C') returning id into e3;
  insert into public.teams (org_id, name) values (v_org, 'Team North') returning id into t1;
  insert into public.team_members (team_id, employee_id, org_id) values (t1, e2, v_org), (t1, e3, v_org);

  insert into public.clients (org_id, full_name, phone, email, address_line1, city, state, postal_code, access_instructions, pets, cleaning_preferences)
    values (v_org, 'Josh Abrams', '727-555-0199', 'josh@example.com', '100 Beach Dr NE', 'St. Petersburg', 'FL', '33701', 'Lockbox on side gate, code 4471', 'Friendly golden retriever', 'Unscented products only') returning id into c1;
  insert into public.clients (org_id, full_name, phone, address_line1, city, state, postal_code)
    values (v_org, 'Benjamin Hostetter', '727-555-0142', '412 Main St', 'Safety Harbor', 'FL', '34695') returning id into c2;
  insert into public.clients (org_id, full_name, email, address_line1, city, state, postal_code)
    values (v_org, 'Green Home Management', 'office@example.com', '2200 4th St N', 'St. Petersburg', 'FL', '33704') returning id into c3;
  insert into public.clients (org_id, full_name, phone, address_line1, city, state, postal_code, pets)
    values (v_org, 'Lauren Kim', '727-555-0177', '85 Snell Isle Blvd', 'St. Petersburg', 'FL', '33704', 'Two cats — keep bedroom doors closed') returning id into c4;

  select id into v_tpl from public.checklist_templates where org_id = v_org and not is_archived order by created_at limit 1;

  for d in 0 .. 13 loop
    if extract(dow from current_date + d) in (0) then continue; end if;
    for h in 0 .. 1 loop
      cl := (array[c1, c2, c3, c4])[1 + ((d + h) % 4)];
      emp := (array[e1, e2, e3])[1 + ((d + h) % 3)];
      insert into public.appointments (org_id, client_id, service_name, checklist_template_id, starts_at, duration_minutes, created_by)
        values (v_org, cl, 'Standard clean', v_tpl, (current_date + d + time '09:00' + make_interval(hours => h * 4)) at time zone 'America/New_York', 150, v_owner)
        returning id into v_appt;
      insert into public.jobs (org_id, appointment_id, client_id, service_name, scheduled_start, scheduled_end)
        select v_org, v_appt, cl, 'Standard clean', a.starts_at, a.starts_at + interval '150 minutes' from public.appointments a where a.id = v_appt
        returning id into v_job;
      if v_tpl is not null then perform public.copy_template_to_job(v_job, v_tpl); end if;
      insert into public.job_assignments (org_id, job_id, employee_id) values (v_org, v_job, emp);
    end loop;
  end loop;
  raise notice 'Demo data added to organization %', v_org;
end $$;
