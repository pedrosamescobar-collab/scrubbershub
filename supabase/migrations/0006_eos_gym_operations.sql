-- Additive Gym Operations module. Uses existing organization roles and native jobs.
-- Supervisor = owner/admin, cleaners = employees, gym = linked client.
create table public.gym_contracts (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
 client_id uuid not null references public.clients(id), template_id uuid references public.checklist_templates(id),
 name text not null, address text not null, site_key text not null default 'eos-54th-st-pete',
 timezone text not null default 'America/New_York' check(timezone='America/New_York'),
 phase text not null default 'pre_opening' check(phase in ('pre_opening','operating')),
 scope_approved boolean not null default false, created_at timestamptz not null default now(), unique(org_id,site_key),unique(id,org_id)
);
create table public.gym_zones (
 id uuid primary key default gen_random_uuid(),org_id uuid not null,contract_id uuid not null,
 name text not null check(length(trim(name)) between 1 and 150), cadence text not null check(length(trim(cadence)) between 1 and 500),
 in_scope boolean not null default true,confirmed boolean not null default false,tasks jsonb not null check(jsonb_typeof(tasks)='array' and jsonb_array_length(tasks) between 1 and 50),
 instructions text not null default '',template_id uuid references public.checklist_templates(id),
 unique(id,contract_id,org_id),foreign key(contract_id,org_id) references public.gym_contracts(id,org_id)
);
create index gym_zones_contract on public.gym_zones(org_id,contract_id);
create table public.gym_readiness (
 id uuid primary key default gen_random_uuid(),org_id uuid not null,contract_id uuid not null,label text not null,
 status text not null default 'todo' check(status in ('todo','blocked','done')),note text not null default '',
 foreign key(contract_id,org_id) references public.gym_contracts(id,org_id)
);
create index gym_readiness_contract on public.gym_readiness(org_id,contract_id);
create table public.gym_training (
 org_id uuid not null references public.organizations(id),employee_id uuid primary key references public.employees(id),
 orientation boolean not null default false,chemical boolean not null default false,valid_until date not null,
 updated_at timestamptz not null default now()
);
create index gym_training_org on public.gym_training(org_id);
create table public.gym_rounds (
 id uuid primary key default gen_random_uuid(),org_id uuid not null,contract_id uuid not null,job_id uuid not null unique references public.jobs(id),
 zone_id uuid,required_staff int not null default 1 check(required_staff between 1 and 20),
 unique(id,contract_id,org_id),foreign key(contract_id,org_id) references public.gym_contracts(id,org_id),
 foreign key(zone_id,contract_id,org_id) references public.gym_zones(id,contract_id,org_id)
);
create index gym_rounds_contract on public.gym_rounds(org_id,contract_id);
create table public.gym_callouts (
 id uuid primary key default gen_random_uuid(),org_id uuid not null,contract_id uuid not null,round_id uuid not null,
 employee_id uuid not null references public.employees(id),replacement_id uuid references public.employees(id),
 status text not null default 'requested' check(status in ('requested','open','covered')),
 created_at timestamptz not null default now(),confirmed_at timestamptz,
 foreign key(round_id,contract_id,org_id) references public.gym_rounds(id,contract_id,org_id),
 check((status='covered' and replacement_id is not null and confirmed_at is not null) or (status<>'covered' and replacement_id is null and confirmed_at is null)),
 check(replacement_id is distinct from employee_id)
);
create index gym_callouts_contract on public.gym_callouts(org_id,contract_id);
create index gym_callouts_employee on public.gym_callouts(employee_id);
create unique index gym_callouts_one_open on public.gym_callouts(round_id,employee_id) where status in ('requested','open');
create table public.gym_inspections (
 id uuid primary key default gen_random_uuid(),org_id uuid not null,contract_id uuid not null,round_id uuid not null,
 result text not null check(result in ('pass','rework','critical')),finding text not null default '',corrective_action text not null default '',
 due_at timestamptz,status text not null check(status in ('open','resolved')),resolution text,created_at timestamptz not null default now(),resolved_at timestamptz,
 foreign key(round_id,contract_id,org_id) references public.gym_rounds(id,contract_id,org_id),
 check(result='pass' or (length(trim(finding))>0 and length(trim(corrective_action))>0 and due_at is not null)),
 check(status<>'resolved' or result='pass' or (length(trim(resolution))>0 and resolved_at is not null))
);
create index gym_inspections_contract on public.gym_inspections(org_id,contract_id,created_at);
create table public.gym_reports (
 id uuid primary key default gen_random_uuid(),org_id uuid not null,contract_id uuid not null,client_id uuid not null references public.clients(id),
 period_start date not null,period_end date not null check(period_end>=period_start),snapshot jsonb not null,
 created_at timestamptz not null default now(),foreign key(contract_id,org_id) references public.gym_contracts(id,org_id)
);
create index gym_reports_client on public.gym_reports(client_id,created_at);
create index gym_reports_contract on public.gym_reports(org_id,contract_id);

-- Tenant validation also applies to direct REST mutations, not just UI calls.
create function public.gym_guard_links() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if tg_op='UPDATE' and new.org_id is distinct from old.org_id then raise exception 'Workspace cannot change'; end if;
 if tg_table_name='gym_contracts' then
  if not exists(select 1 from clients where id=new.client_id and org_id=new.org_id) then raise exception 'Client workspace mismatch'; end if;
  if new.template_id is not null and not exists(select 1 from checklist_templates where id=new.template_id and org_id=new.org_id) then raise exception 'Checklist workspace mismatch';end if;
 elsif tg_table_name='gym_training' then
  if not exists(select 1 from employees where id=new.employee_id and org_id=new.org_id) then raise exception 'Employee workspace mismatch';end if;
 elsif tg_table_name='gym_rounds' then
  if not exists(select 1 from jobs j join gym_contracts c on c.id=new.contract_id where j.id=new.job_id and j.org_id=new.org_id and j.client_id=c.client_id) then raise exception 'Round workspace or facility mismatch';end if;
 elsif tg_table_name='gym_zones' then
  if new.template_id is not null and not exists(select 1 from checklist_templates where id=new.template_id and org_id=new.org_id) then raise exception 'Checklist workspace mismatch';end if;
 elsif tg_table_name='gym_callouts' then
  if not exists(select 1 from employees where id=new.employee_id and org_id=new.org_id) or (new.replacement_id is not null and not exists(select 1 from employees where id=new.replacement_id and org_id=new.org_id)) then raise exception 'Employee workspace mismatch';end if;
 elsif tg_table_name='gym_reports' then
  if not exists(select 1 from gym_contracts c where c.id=new.contract_id and c.org_id=new.org_id and c.client_id=new.client_id) then raise exception 'Report client mismatch';end if;
 end if;
 return new;
end $$;
revoke all on function public.gym_guard_links() from public;
do $$declare t text;begin
 foreach t in array array['gym_contracts','gym_zones','gym_readiness','gym_training','gym_rounds','gym_callouts','gym_inspections','gym_reports'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy gym_admin on public.%I for all to authenticated using(public.is_org_admin(org_id)) with check(public.is_org_admin(org_id))',t);
  execute format('create trigger gym_links before insert or update on public.%I for each row execute function public.gym_guard_links()',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('revoke all on public.%I from anon',t);
 end loop;
end $$;
create policy gym_round_worker on public.gym_rounds for select to authenticated using(public.is_assigned_to_job(job_id));
create policy gym_worker_site on public.gym_contracts for select to authenticated using(exists(select 1 from gym_rounds r where r.contract_id=gym_contracts.id and public.is_assigned_to_job(r.job_id)) or exists(select 1 from gym_callouts a where a.contract_id=gym_contracts.id and a.employee_id in(select public.my_employee_ids())));
create policy gym_worker_callout on public.gym_callouts for select to authenticated using(employee_id in(select public.my_employee_ids()));
create policy gym_worker_request on public.gym_callouts for insert to authenticated with check(
 employee_id in(select public.my_employee_ids()) and status='requested' and replacement_id is null
 and exists(select 1 from gym_rounds r join jobs j on j.id=r.job_id join job_assignments a on a.job_id=j.id
  where r.id=round_id and r.org_id=gym_callouts.org_id and j.status='scheduled' and a.employee_id=gym_callouts.employee_id));
create policy gym_client_report on public.gym_reports for select to authenticated using(client_id in(select public.my_client_ids()));
create policy gym_worker_training on public.gym_training for select to authenticated using(employee_id in(select public.my_employee_ids()));

create function public.gym_setup(p_org uuid,p_zones jsonb,p_readiness jsonb,p_client uuid default null) returns uuid
language plpgsql security invoker set search_path=public as $$
declare c uuid;cli uuid;z jsonb;label jsonb;tpl uuid;sec uuid;i int;n int;begin
 if not is_org_admin(p_org) then raise exception 'Supervisor access required';end if;
 if jsonb_typeof(p_zones) is distinct from 'array' or jsonb_typeof(p_readiness) is distinct from 'array' or jsonb_array_length(p_zones) not between 1 and 20 or jsonb_array_length(p_readiness) not between 1 and 30 then raise exception 'Invalid operating plan';end if;
 if exists(select 1 from gym_contracts where org_id=p_org and site_key='eos-54th-st-pete') then raise exception 'This facility is already set up';end if;
 if p_client is null then
  insert into clients(org_id,full_name,address_line1,city,state,postal_code,special_notes) values(p_org,'EōS Fitness · 54th Ave S','2830 54th Avenue S','St. Petersburg','FL','33712','Gym management client. Confirm scope and contacts before service.') returning id into cli;
 else
  if not exists(select 1 from clients where id=p_client and org_id=p_org and status='active') then raise exception 'Client not available';end if;cli:=p_client;
 end if;
 insert into gym_contracts(org_id,client_id,name,address) values(p_org,cli,'EōS Fitness · 54th Ave S','2830 54th Avenue S, St. Petersburg, FL 33712') returning id into c;
 for z in select * from jsonb_array_elements(p_zones) loop
  if jsonb_array_length(z->'tasks') not between 1 and 50 then raise exception 'Zone checklist is empty';end if;
  insert into checklist_templates(org_id,name,description) values(p_org,'EōS · '||(z->>'name'),'Proposed gym checklist. Supervisor and facility approval required.') returning id into tpl;
  insert into checklist_sections(org_id,template_id,name,position) values(p_org,tpl,z->>'name',0) returning id into sec;
  i:=0;for label in select * from jsonb_array_elements(z->'tasks') loop
   if length(trim(label#>>'{}')) not between 1 and 1000 then raise exception 'Invalid task';end if;
   insert into checklist_items(org_id,template_id,section_id,label,is_required,position) values(p_org,tpl,sec,label#>>'{}',true,i);i:=i+1;
  end loop;
  insert into gym_zones(org_id,contract_id,name,cadence,in_scope,tasks,instructions,template_id) values(p_org,c,z->>'name',z->>'cadence',(z->>'in_scope')::boolean,z->'tasks',coalesce(z->>'instructions',''),tpl);
 end loop;
 n:=0;for label in select * from jsonb_array_elements(p_readiness) loop
  insert into gym_readiness(org_id,contract_id,label) values(p_org,c,label#>>'{}');n:=n+1;
 end loop;
 return c;
end $$;

-- Employee availability requests contain no medical or private explanation.
create function public.gym_request_callout(p_round uuid,p_employee uuid) returns uuid language plpgsql security invoker set search_path=public as $$
declare r gym_rounds%rowtype;v uuid;begin
 select * into r from gym_rounds where id=p_round;
 if not found then raise exception 'Round not available';end if;
 if not is_org_admin(r.org_id) and p_employee not in(select my_employee_ids()) then raise exception 'Not allowed';end if;
 if not exists(select 1 from employees where id=p_employee and org_id=r.org_id and status='active') then raise exception 'Employee not active';end if;
 if not exists(select 1 from job_assignments a join jobs j on j.id=a.job_id where a.job_id=r.job_id and a.employee_id=p_employee and j.status='scheduled') then raise exception 'Only assigned, scheduled rounds support an availability request';end if;
 insert into gym_callouts(org_id,contract_id,round_id,employee_id) values(r.org_id,r.contract_id,r.id,p_employee) returning id into v;return v;
end $$;

create function public.gym_admin_action(p_contract uuid,p_action text,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare c gym_contracts%rowtype;z gym_zones%rowtype;r gym_rounds%rowtype;j jobs%rowtype;a gym_callouts%rowtype;insp gym_inspections%rowtype;
 eid uuid;ids uuid[];did uuid;tpl uuid;sec uuid;appt uuid;jid uuid;lbl jsonb;x gym_zones%rowtype;ix int;day date;at_time timestamptz;end_time timestamptz;days int;dur int;need int;start_day date;v jsonb;sid uuid;begin
 select * into c from gym_contracts where id=p_contract for update;
 if not found or not is_org_admin(c.org_id) then raise exception 'Supervisor access required';end if;
 case p_action
 when 'readiness' then
  update gym_readiness set status=p_data->>'status',note=coalesce(p_data->>'note','') where id=(p_data->>'id')::uuid and contract_id=c.id;
  if not found then raise exception 'Readiness item not found';end if;
 when 'phase' then
  if p_data->>'phase'='operating' and (not c.scope_approved or exists(select 1 from gym_readiness where contract_id=c.id and status<>'done')) then raise exception 'Complete readiness and approve the plan before daily operations';end if;
  update gym_contracts set phase=p_data->>'phase' where id=c.id;
 when 'zone' then
  select * into z from gym_zones where id=(p_data->>'id')::uuid and contract_id=c.id;
  if not found then raise exception 'Zone not found';end if;
  if jsonb_typeof(p_data->'tasks')<>'array' or jsonb_array_length(p_data->'tasks') not between 1 and 50 then raise exception 'Add 1 to 50 checklist tasks';end if;
  for lbl in select * from jsonb_array_elements(p_data->'tasks') loop
   if length(trim(lbl#>>'{}')) not between 1 and 1000 then raise exception 'Checklist tasks cannot be blank';end if;
  end loop;
  update gym_zones set cadence=p_data->>'cadence',in_scope=(p_data->>'in_scope')::boolean,confirmed=(p_data->>'confirmed')::boolean,tasks=p_data->'tasks',instructions=p_data->>'instructions' where id=z.id;
  update gym_contracts set scope_approved=false where id=c.id;
  delete from checklist_items where template_id=z.template_id;
  select id into sec from checklist_sections where template_id=z.template_id order by position limit 1;
  ix:=0;for lbl in select * from jsonb_array_elements(p_data->'tasks') loop
   insert into checklist_items(org_id,template_id,section_id,label,is_required,position) values(c.org_id,z.template_id,sec,lbl#>>'{}',true,ix);ix:=ix+1;
  end loop;
 when 'approve' then
  if not exists(select 1 from gym_zones where contract_id=c.id and in_scope) or exists(select 1 from gym_zones where contract_id=c.id and in_scope and not confirmed) then raise exception 'Confirm every included zone and its frequency';end if;
  insert into checklist_templates(org_id,name,description) values(c.org_id,'EōS · Full facility round','Approved zone checklist snapshot for new rounds. Product and manufacturer instructions apply.') returning id into tpl;
  ix:=0;for x in select * from gym_zones where contract_id=c.id and in_scope order by name loop
   insert into checklist_sections(org_id,template_id,name,position) values(c.org_id,tpl,x.name,ix) returning id into sec;ix:=ix+1;
   insert into checklist_items(org_id,template_id,section_id,label,is_required,position) select c.org_id,tpl,sec,t.value,true,t.ordinality::int-1 from jsonb_array_elements_text(x.tasks) with ordinality as t(value,ordinality);
  end loop;
  update gym_contracts set template_id=tpl,scope_approved=true where id=c.id;
 when 'training' then
  eid:=(p_data->>'employee_id')::uuid;
  if not exists(select 1 from employees where id=eid and org_id=c.org_id and status='active') then raise exception 'Employee not active';end if;
  if (p_data->>'valid_until')::date<current_date then raise exception 'Training review date must not be in the past';end if;
  insert into gym_training(org_id,employee_id,orientation,chemical,valid_until) values(c.org_id,eid,(p_data->>'orientation')::boolean,(p_data->>'chemical')::boolean,(p_data->>'valid_until')::date)
  on conflict(employee_id) do update set orientation=excluded.orientation,chemical=excluded.chemical,valid_until=excluded.valid_until,updated_at=now();
 when 'schedule' then
  if not c.scope_approved then raise exception 'Approve the operating plan before scheduling';end if;
  days:=(p_data->>'days')::int;dur:=(p_data->>'duration')::int;need:=(p_data->>'required_staff')::int;start_day:=(p_data->>'date')::date;
  if days is null or days not between 1 and 14 or dur is null or dur not between 15 and 720 or need is null or need not between 1 and 20 or start_day is null then raise exception 'Invalid round schedule';end if;
  select array_agg(distinct v::uuid) into ids from jsonb_array_elements_text(p_data->'employee_ids') as e(v);
  if coalesce(cardinality(ids),0)<need then raise exception 'Assign enough trained staff for the round';end if;
  -- Serialize assignments of the same employee across different gym contracts.
  perform 1 from employees where id=any(ids) order by id for update;
  tpl:=c.template_id;
  if nullif(p_data->>'zone_id','') is not null then
   select * into z from gym_zones where id=(p_data->>'zone_id')::uuid and contract_id=c.id and in_scope and confirmed;
   if not found then raise exception 'Zone is not approved';end if;tpl:=z.template_id;
  end if;
  for ix in 0..days-1 loop
   day:=start_day+ix;
   at_time:=((day::text||' '||(p_data->>'time'))::timestamp at time zone c.timezone);
   if to_char(at_time at time zone c.timezone,'YYYY-MM-DD HH24:MI')<>day::text||' '||(p_data->>'time') then raise exception 'This local time does not exist because of daylight saving';end if;
   end_time:=at_time+make_interval(mins=>dur);
   foreach eid in array ids loop
    if not exists(select 1 from employees e join gym_training t on t.employee_id=e.id and t.org_id=e.org_id where e.id=eid and e.org_id=c.org_id and e.status='active' and t.orientation and t.chemical and t.valid_until>=(end_time at time zone c.timezone)::date) then raise exception 'Each worker needs current site orientation and chemical training through the end of the round';end if;
    if exists(select 1 from job_assignments ja join jobs jj on jj.id=ja.job_id where jj.org_id=c.org_id and jj.status<>'cancelled' and jj.scheduled_start<end_time and jj.scheduled_end>at_time and (ja.employee_id=eid or ja.team_id in(select team_id from team_members where employee_id=eid))) then raise exception 'A selected employee already has overlapping work, including overnight or team assignments';end if;
   end loop;
   appt:=schedule_appointment(jsonb_build_object('org_id',c.org_id,'client_id',c.client_id,'checklist_template_id',tpl,'starts_at',at_time,'duration_minutes',dur,'recurrence','none','service_name','EōS · '||coalesce(z.name,'Full facility round'),'employee_ids',to_jsonb(ids),'team_ids','[]'::jsonb,'internal_notes',coalesce(z.instructions,'Follow the approved zone procedures. Coordinate privacy, wet-floor controls and equipment access with gym staff.')));
   select id into jid from jobs where appointment_id=appt;
   insert into gym_rounds(org_id,contract_id,job_id,zone_id,required_staff) values(c.org_id,c.id,jid,z.id,need);
  end loop;
 when 'confirm_callout' then
  select * into a from gym_callouts where id=(p_data->>'id')::uuid and contract_id=c.id for update;
  if not found or a.status<>'requested' then raise exception 'Availability request is no longer pending';end if;
  select * into r from gym_rounds where id=a.round_id;select * into j from jobs where id=r.job_id for update;
  if j.status<>'scheduled' then raise exception 'This round has already started or ended';end if;
  delete from job_assignments where job_id=r.job_id and employee_id=a.employee_id;
  update gym_callouts set status='open' where id=a.id;
 when 'cover' then
  select * into a from gym_callouts where id=(p_data->>'id')::uuid and contract_id=c.id for update;
  if not found or a.status<>'open' then raise exception 'This callout is no longer open';end if;
  if coalesce((p_data->>'confirmed')::boolean,false) is not true then raise exception 'Confirm acceptance with the worker first';end if;
  eid:=(p_data->>'employee_id')::uuid;
  perform 1 from employees where id=eid for update;
  select * into r from gym_rounds where id=a.round_id;select * into j from jobs where id=r.job_id for update;
  if j.status<>'scheduled' or eid=a.employee_id then raise exception 'Replacement is not eligible';end if;
  if not exists(select 1 from employees e join gym_training t on t.employee_id=e.id and t.org_id=e.org_id where e.id=eid and e.org_id=c.org_id and e.status='active' and t.orientation and t.chemical and t.valid_until>=(j.scheduled_end at time zone c.timezone)::date) then raise exception 'Replacement needs current site orientation and chemical training';end if;
  if exists(select 1 from job_assignments ja join jobs jj on jj.id=ja.job_id where jj.org_id=c.org_id and jj.status<>'cancelled' and jj.scheduled_start<j.scheduled_end and jj.scheduled_end>j.scheduled_start and(ja.employee_id=eid or ja.team_id in(select team_id from team_members where employee_id=eid))) then raise exception 'Replacement has overlapping work';end if;
  insert into job_assignments(org_id,job_id,employee_id) values(c.org_id,j.id,eid);
  update gym_callouts set status='covered',replacement_id=eid,confirmed_at=now() where id=a.id;
 when 'inspect' then
  select * into r from gym_rounds where id=(p_data->>'round_id')::uuid and contract_id=c.id;
  if not found then raise exception 'Round not found';end if;
  if not exists(select 1 from jobs where id=r.job_id and status in ('in_progress','completed')) then raise exception 'Inspect a round that has started or completed';end if;
  insert into gym_inspections(org_id,contract_id,round_id,result,finding,corrective_action,due_at,status)
  values(c.org_id,c.id,r.id,p_data->>'result',coalesce(p_data->>'finding',''),coalesce(p_data->>'corrective_action',''),nullif(p_data->>'due_at','')::timestamptz,case when p_data->>'result'='pass' then 'resolved' else 'open' end);
 when 'resolve' then
  if coalesce((p_data->>'rechecked')::boolean,false) is not true then raise exception 'Reinspect the area before closing the finding';end if;
  if length(trim(coalesce(p_data->>'resolution','')))=0 then raise exception 'Record the correction and reinspection outcome';end if;
  update gym_inspections set status='resolved',resolution=p_data->>'resolution',resolved_at=now() where id=(p_data->>'id')::uuid and contract_id=c.id and result<>'pass' and status='open';
  if not found then raise exception 'Finding is no longer open';end if;
 when 'publish' then
  start_day:=(p_data->>'start')::date;day:=(p_data->>'end')::date;
  if start_day is null or day is null or day<start_day or day-start_day>93 then raise exception 'Select a report period of up to 94 days';end if;
  at_time:=start_day::timestamp at time zone c.timezone;end_time:=(day+1)::timestamp at time zone c.timezone;
  select jsonb_build_object('site',c.name,'address',c.address,'scheduled',count(*),'completed',count(*)filter(where jj.status='completed'),'cancelled',count(*)filter(where jj.status='cancelled')) into v from gym_rounds rr join jobs jj on jj.id=rr.job_id where rr.contract_id=c.id and jj.scheduled_start>=at_time and jj.scheduled_start<end_time;
  v:=v||jsonb_build_object('open_findings',(select count(*) from gym_inspections where contract_id=c.id and status='open' and created_at>=at_time and created_at<end_time),'critical_findings',(select count(*) from gym_inspections where contract_id=c.id and result='critical' and created_at>=at_time and created_at<end_time),'passed_inspections',(select count(*) from gym_inspections where contract_id=c.id and result='pass' and created_at>=at_time and created_at<end_time));
  insert into gym_reports(org_id,contract_id,client_id,period_start,period_end,snapshot) values(c.org_id,c.id,c.client_id,start_day,day,v) returning id into sid;
  return jsonb_build_object('id',sid);
 else raise exception 'Unknown gym action';end case;
 return '{}'::jsonb;
end $$;
revoke all on function public.gym_setup(uuid,jsonb,jsonb,uuid),public.gym_request_callout(uuid,uuid),public.gym_admin_action(uuid,text,jsonb) from public;
grant execute on function public.gym_setup(uuid,jsonb,jsonb,uuid),public.gym_request_callout(uuid,uuid),public.gym_admin_action(uuid,text,jsonb) to authenticated;
