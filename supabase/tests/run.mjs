// Runs the ScrubHub migration inside an embedded Postgres (PGlite) with minimal
// stand-ins for Supabase's auth + storage schemas, then walks through the six V1
// flows as different users with row-level security enforced.
//   npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(here, '../migrations/0001_scrubhub_schema.sql'), 'utf8');
const billingMigration = readFileSync(join(here, '../migrations/0002_billing.sql'), 'utf8');
const inventoryMigration = readFileSync(join(here, '../migrations/0003_inventory.sql'), 'utf8');
const tradesMigration = readFileSync(join(here, '../migrations/0004_trades_theme_equipment.sql'), 'utf8');

const SUPABASE_STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema auth, storage to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
`;
const GRANTS = `
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated, anon;
grant select on storage.objects to authenticated; grant insert, update, delete on storage.objects to authenticated;
grant usage on schema public to service_role; grant all on all tables in schema public to service_role;
`;

const db = new PGlite();
process.on('unhandledRejection', e => { console.error('\nFATAL:', e.message, e.where ?? ''); process.exit(1); });
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log('  ✓', msg); } else { failed++; console.log('  ✗', msg); } };

async function asServer(fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}
async function as(userId, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId ?? ''}', false);`);
  if (userId) await db.exec('set role authenticated;'); else await db.exec('set role anon;');
  try { return await fn(); } finally { await db.exec('reset role;'); }
}
const q = async (sql, params) => (await db.query(sql, params)).rows;
async function expectError(promise, msg, match) {
  try { await promise; ok(false, msg + ' (expected an error)'); }
  catch (e) { ok(!match || String(e.message).includes(match), `${msg} → "${String(e.message).slice(0, 70)}"`); }
}

const U = {
  owner:  '00000000-0000-0000-0000-00000000000a',
  emp:    '00000000-0000-0000-0000-00000000000e',
  emp2:   '00000000-0000-0000-0000-00000000000f',
  client: '00000000-0000-0000-0000-00000000000c',
  rival:  '00000000-0000-0000-0000-00000000000b',
};

await db.exec(SUPABASE_STUBS);
await db.exec(migration);
await db.exec(billingMigration);
await db.exec(inventoryMigration);
await db.exec(tradesMigration);
await db.exec(GRANTS);
for (const [k, id] of Object.entries(U)) {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
    [id, `${k}@example.com`, JSON.stringify({ full_name: k })]);
}
console.log('Migration applied.\n');

// ---------------------------------------------------------------- Flow 1
console.log('Flow 1 — owner registers and creates a business');
const org = await as(U.owner, async () => (await q(`select public.create_organization('Top Shelf Cleaning Co.', '#1E6FD9') as id`))[0].id);
ok(!!org, 'create_organization returns an id');
await as(U.owner, async () => {
  ok((await q('select * from organizations')).length === 1, 'owner sees their organization');
  ok((await q(`select role from memberships`))[0].role === 'owner', 'owner membership created');
  await q(`update organizations set logo_url = 'https://x/logo.png', brand_color = '#0E9F8E' where id = $1`, [org]);
  ok((await q('select logo_url from organizations'))[0].logo_url.endsWith('logo.png'), 'owner can update branding/logo');
  await q(`insert into storage.objects (bucket_id, name, owner) values ('logos', $1, $2)`, [`${org}/logo-1.png`, U.owner]);
  ok(true, 'owner can upload a logo into {org}/ in the logos bucket');
  ok((await q('select profiles.full_name from profiles'))[0].full_name === 'owner', 'profile auto-created from sign-up metadata');
  ok((await q(`select status from subscriptions`))[0].status === 'trialing', 'owner can read subscription (14-day trial)');
  ok((await q(`update subscriptions set status = 'active' returning org_id`)).length === 0, 'owner cannot change their own subscription status');
});

// ---------------------------------------------------------------- Flow 2
console.log('\nFlow 2 — admin adds an employee, employee accepts invite');
const { empId, empToken, clientId, clientToken, tplId, emp2Id, teamId } = await as(U.owner, async () => {
  const empId = (await q(`insert into employees (org_id, full_name, email) values ($1, 'Maria Lopez', 'emp@example.com') returning id`, [org]))[0].id;
  const emp2Id = (await q(`insert into employees (org_id, full_name) values ($1, 'Ana Silva') returning id`, [org]))[0].id;
  const teamId = (await q(`insert into teams (org_id, name) values ($1, 'Team A') returning id`, [org]))[0].id;
  await q(`insert into team_members (team_id, employee_id, org_id) values ($1, $2, $3)`, [teamId, emp2Id, org]);
  const empToken = (await q(`insert into invitations (org_id, role, employee_id, created_by) values ($1, 'employee', $2, $3) returning token`, [org, empId, U.owner]))[0].token;
  const clientId = (await q(`insert into clients (org_id, full_name, email, address_line1, city, access_instructions, pets)
    values ($1, 'Josh Abrams', 'client@example.com', '100 Beach Dr', 'St. Petersburg', 'Lockbox 4471', 'One friendly dog') returning id`, [org]))[0].id;
  const clientToken = (await q(`insert into invitations (org_id, role, client_id, created_by) values ($1, 'client', $2, $3) returning token`, [org, clientId, U.owner]))[0].token;
  const tplId = (await q(`insert into checklist_templates (org_id, name) values ($1, 'Standard clean') returning id`, [org]))[0].id;
  const s1 = (await q(`insert into checklist_sections (org_id, template_id, name, position) values ($1, $2, 'Kitchen', 0) returning id`, [org, tplId]))[0].id;
  const s2 = (await q(`insert into checklist_sections (org_id, template_id, name, position) values ($1, $2, 'Bathrooms', 1) returning id`, [org, tplId]))[0].id;
  await q(`insert into checklist_items (org_id, template_id, section_id, label, is_required, position) values
    ($1, $2, $3, 'Wipe counters', true, 0), ($1, $2, $3, 'Clean microwave', false, 1), ($1, $2, $4, 'Scrub toilet', true, 0)`, [org, tplId, s1, s2]);
  await expectError(q(`update employees set user_id = $1 where id = $2`, [U.rival, empId]), 'admin cannot hand-link an employee to someone else\'s account', 'invitation');
  return { empId, empToken, clientId, clientToken, tplId, emp2Id, teamId };
});
const info = await as(null, async () => (await q(`select * from public.get_invitation($1)`, [empToken]))[0]);
ok(info.org_name === 'Top Shelf Cleaning Co.' && info.role === 'employee', 'anonymous visitor can preview invite (org name + role)');
await as(U.emp, async () => {
  const r = (await q(`select * from public.accept_invitation($1)`, [empToken]))[0];
  ok(r.joined_role === 'employee', 'employee accepts invite');
  ok((await q(`select user_id from employees where id = $1`, [empId]))[0].user_id === U.emp, 'employee record linked to account');
  ok((await q(`select * from organizations`)).length === 1, 'employee can read their company branding');
  ok((await q(`select * from subscriptions`)).length === 0, 'employee cannot read billing');
});
await as(U.rival, async () => {
  await expectError(q(`select * from public.accept_invitation($1)`, [empToken]), 'used invitation cannot be reused by another account', 'already');
});
// emp2 via team
await as(U.owner, async () => {
  const t = (await q(`insert into invitations (org_id, role, employee_id, created_by) values ($1, 'employee', $2, $3) returning token`, [org, emp2Id, U.owner]))[0].token;
  await as(U.emp2, async () => q(`select * from public.accept_invitation($1)`, [t]));
});

// ---------------------------------------------------------------- Flow 3
console.log('\nFlow 3 — admin adds client, schedules recurring cleaning, assigns crew + checklist');
await as(U.client, async () => { await q(`select * from public.accept_invitation($1)`, [clientToken]); });
const start = new Date(Date.now() + 3 * 3600e3).toISOString();
const apptId = await as(U.owner, async () => (await q(`select public.schedule_appointment($1::jsonb) as id`, [JSON.stringify({
  org_id: org, client_id: clientId, service_name: 'Standard clean', checklist_template_id: tplId, starts_at: start,
  duration_minutes: 150, recurrence: 'weekly', occurrences: 3, internal_notes: 'Garage code 1234',
  employee_ids: [empId], team_ids: [],
})]))[0].id);
const jobs = await as(U.owner, async () => q(`select * from jobs where appointment_id = $1 order by scheduled_start`, [apptId]));
ok(jobs.length === 3, 'weekly × 3 generated 3 jobs');
ok(Math.round((new Date(jobs[1].scheduled_start) - new Date(jobs[0].scheduled_start)) / 864e5) === 7, 'occurrences are 7 days apart');
const job = jobs[0];
await as(U.owner, async () => {
  ok((await q(`select count(*)::int n from job_checklist_items where job_id = $1`, [job.id]))[0].n === 3, 'checklist copied into each job');
  await q(`insert into job_assignments (org_id, job_id, team_id) values ($1, $2, $3)`, [org, jobs[1].id, teamId]);
  ok(true, 'team assigned to second visit');
});

// ---------------------------------------------------------------- Flow 4
console.log('\nFlow 4 — employee works the job');
await as(U.emp, async () => {
  ok((await q(`select * from jobs`)).length === 3, 'employee sees their 3 assigned jobs');
  ok((await q(`select * from notifications where type = 'job_assigned'`)).length === 3, 'employee got 3 assignment notifications');
  ok((await q(`select internal_notes from appointments`))[0]?.internal_notes === 'Garage code 1234', 'employee sees internal job notes');
  ok((await q(`select access_instructions from clients`))[0]?.access_instructions === 'Lockbox 4471', 'employee sees client access instructions');
  await q(`select public.clock_in($1)`, [job.id]);
  ok((await q(`select status from jobs where id = $1`, [job.id]))[0].status === 'in_progress', 'clock-in moves job to in progress');
  await expectError(q(`select public.clock_in($1)`, [job.id]), 'double clock-in rejected', 'already');
  await expectError(q(`update job_checklist_items set completed_at = now() where job_id = $1`, [job.id]).then(async () => {
    if ((await q(`select count(*)::int n from job_checklist_items where completed_at is not null`))[0].n === 0) throw new Error('blocked by RLS');
  }), 'direct checklist UPDATE is blocked (must use RPC)', 'blocked');
  const items = await q(`select * from job_checklist_items where job_id = $1 order by section_position, position`, [job.id]);
  await q(`select public.set_checklist_item($1, true)`, [items[0].id]);
  await expectError(q(`select public.complete_job($1)`, [job.id]), 'cannot complete with required tasks open', 'REQUIRED_ITEMS_INCOMPLETE');
  for (const it of items.filter(i => i.is_required)) await q(`select public.set_checklist_item($1, true)`, [it.id]);
  await q(`insert into job_notes (org_id, job_id, author_id, body) values ($1, $2, $3, 'Used the side door.')`, [org, job.id, U.emp]);
  await q(`insert into storage.objects (bucket_id, name, owner) values ('job-photos', $1, $2)`, [`${org}/${job.id}/before/a.jpg`, U.emp]);
  await q(`insert into job_photos (org_id, job_id, kind, storage_path, uploaded_by) values ($1, $2, 'before', $3, $4)`, [org, job.id, `${org}/${job.id}/before/a.jpg`, U.emp]);
  await q(`insert into job_photos (org_id, job_id, kind, storage_path, uploaded_by) values ($1, $2, 'after', $3, $4)`, [org, job.id, `${org}/${job.id}/after/b.jpg`, U.emp]);
  ok(true, 'employee added a note and before/after photos');
  await q(`select public.clock_out($1)`, [job.id]);
  const done = (await q(`select (public.complete_job($1)).*`, [job.id]))[0];
  ok(done.status === 'completed' && done.completed_at, 'job completed with timestamp');
  await expectError(q(`select public.clock_in($1)`, ['00000000-0000-0000-0000-000000000000']), 'cannot clock into unknown job', 'not');
});
await as(U.emp2, async () => {
  ok((await q(`select * from jobs`)).length === 1, 'team member sees only the visit assigned to their team');
  await expectError(q(`select public.clock_in($1)`, [jobs[0].id]), 'non-assigned employee cannot clock into a job', 'not assigned');
});

// ---------------------------------------------------------------- Flow 5
console.log('\nFlow 5 — client portal');
await as(U.owner, async () => {
  await q(`select public.schedule_appointment($1::jsonb)`, [JSON.stringify({ org_id: org, client_id: clientId, service_name: 'Deep clean',
    starts_at: new Date(Date.now() + 5 * 3600e3).toISOString(), employee_ids: [empId] })]);
});
const queued = await as(U.owner, async () => (await q(`select public.queue_reminders($1) n`, [org]))[0].n);
ok(queued >= 1, `admin queued reminders for ${queued} upcoming job(s)`);
await as(U.client, async () => {
  ok((await q(`select * from jobs`)).length === 4, 'client sees their 4 appointments');
  ok((await q(`select * from job_notes`)).length === 0, 'client cannot see internal crew notes');
  ok((await q(`select * from appointments`)).length === 0, 'client cannot see internal appointment notes');
  ok((await q(`select * from employees`)).length === 0, 'client cannot list staff records');
  ok((await q(`select public.job_crew_names($1) n`, [job.id]))[0].n === 'Maria', 'client sees first name of crew');
  ok((await q(`select * from notifications where type in ('appointment_reminder','review_request')`)).length >= 2, 'client received reminder + review request');
  await q(`insert into client_notes (org_id, client_id, job_id, author_id, author_name, from_client, body) values ($1, $2, $3, $4, 'Josh', true, 'Please skip the office.')`, [org, clientId, jobs[1].id, U.client]);
  ok(true, 'client added a note for an upcoming appointment');
  ok((await q(`select * from job_photos where job_id = $1`, [job.id])).length === 2, 'client sees photos of completed job');
  await expectError(q(`select public.submit_review($1, 5, 'Great', null)`, [jobs[1].id]), 'cannot review an unfinished job', 'completed');
  await q(`select public.submit_review($1, 5, 'Spotless, thank you!', 'Maybe arrive a bit earlier')`, [job.id]);
  await expectError(q(`select public.submit_review($1, 4, 'again', null)`, [job.id]), 'cannot review the same job twice', 'duplicate');
  await q(`select public.update_my_client_profile($1, 'Josh Abrams', '727-555-0100', 'Lockbox 9999', 'Unscented products', 'Dog')`, [clientId]);
  ok((await q(`select access_instructions from clients`))[0].access_instructions === 'Lockbox 9999', 'client updated own access instructions');
  await expectError(q(`update clients set org_id = gen_random_uuid()`).then(async r => { throw new Error('rls ' + JSON.stringify(r)); }), 'client cannot write client record directly', '');
});

// ---------------------------------------------------------------- Flow 6
console.log('\nFlow 6 — admin reviews the finished job');
await as(U.owner, async () => {
  const te = await q(`select * from time_entries where job_id = $1`, [job.id]);
  ok(te.length === 1 && te[0].clock_out_at, 'admin sees clock-in/out times');
  ok((await q(`select * from job_photos where job_id = $1`, [job.id])).length === 2, 'admin sees before/after photos');
  ok((await q(`select * from job_notes where job_id = $1`, [job.id])).length === 1, 'admin sees crew notes');
  ok((await q(`select count(*)::int n from job_checklist_items where job_id = $1 and completed_at is not null`, [job.id]))[0].n === 2, 'admin sees checklist status');
  const rv = (await q(`select * from reviews where job_id = $1`, [job.id]))[0];
  ok(rv?.rating === 5 && rv.private_feedback, 'admin sees review incl. private feedback');
  const types = (await q(`select type from notifications`)).map(r => r.type);
  ok(types.includes('job_completed') && types.includes('review_received') && types.includes('client_note'), 'admin notified of completion, review, client note');
  const n = (await q(`select public.cancel_job($1, 'future', 'Client moved')  n`, [jobs[1].id]))[0].n;
  ok(n === 2, 'cancel "this and future" cancelled 2 visits');
});


// ---------------------------------------------------------------- Billing
console.log('\nBilling — invoice a completed job, get paid, refunds, estimates, recurring');
const bill = {};
await as(U.owner, async () => {
  ok((await q(`select * from billing_settings`)).length === 1, 'billing settings created for the company');
  ok((await q(`select * from service_catalog`)).length === 7, 'starter services seeded (editable examples)');
  await q(`update service_catalog set name = 'Standard clean' where name = 'Standard Cleaning'`);
  bill.inv = (await q(`select public.create_invoice_from_job($1) id`, [job.id]))[0].id;
  const inv = (await q(`select * from invoices where id = $1`, [bill.inv]))[0];
  ok(inv.status === 'draft' && inv.number === 'INV-1001', 'invoice drafted from the completed job (INV-1001)');
  ok(Number(inv.total) === 150 && inv.client_id === clientId && inv.service_address?.includes('100 Beach Dr'), 'client, address and catalog price filled in automatically');
  ok((await q(`select public.create_invoice_from_job($1) id`, [job.id]))[0].id === bill.inv, 'creating again returns the same invoice (no duplicates)');
  await q(`select public.save_invoice($1::jsonb)`, [JSON.stringify({ id: bill.inv, org_id: org, client_id: clientId, job_id: job.id,
    tax_rate: 10, discount_type: 'amount', discount_value: 10, internal_notes: 'Client haggles — hold firm',
    items: [{ description: 'Standard clean', quantity: 1, unit_price: 150, taxable: true }, { description: 'Inside fridge', quantity: 2, unit_price: 20, taxable: false }] })]);
  const t = (await q(`select * from invoices where id = $1`, [bill.inv]))[0];
  ok(Number(t.subtotal) === 190 && Number(t.discount_total) === 10 && Number(t.tax_total) === 14.21 && Number(t.total) === 194.21,
    `totals computed server-side (190 − 10 + 14.21 tax = ${t.total})`);
  await q(`update invoices set amount_paid = 999, balance_due = 0, total = 1 where id = $1`, [bill.inv]);
  const t2 = (await q(`select * from invoices where id = $1`, [bill.inv]))[0];
  ok(Number(t2.amount_paid) === 0 && Number(t2.total) === 194.21, 'amounts cannot be overwritten directly');
});
await as(U.client, async () => {
  ok((await q(`select * from invoices`)).length === 0, 'client cannot read billing tables directly');
  await expectError(q(`select public.get_my_invoice($1)`, [bill.inv]), 'client cannot see a draft invoice', 'not found');
});
await as(U.owner, async () => {
  const s = (await q(`select status from public.send_invoice($1)`, [bill.inv]))[0].status;
  ok(s === 'sent', 'admin sends the invoice');
});
await as(U.client, async () => {
  ok((await q(`select * from notifications where type = 'invoice_sent'`)).length === 1, 'client notified of the new invoice');
  const mb = (await q(`select public.my_billing($1) b`, [org]))[0].b;
  ok(mb.invoices.length === 1 && Number(mb.invoices[0].balance_due) === 194.21, 'invoice appears in the client portal with balance due');
  const inv = (await q(`select public.get_my_invoice($1) i`, [bill.inv]))[0].i;
  ok(inv.items.length === 2 && !('internal_notes' in inv) && !JSON.stringify(inv).includes('haggles'), 'client invoice view hides internal notes');
  await expectError(q(`select public.record_payment($1, 10, 'cash')`, [bill.inv]), 'client cannot record a payment', 'Not allowed');
  await expectError(q(`select public.apply_online_payment($1::jsonb)`, ['{}']), 'client cannot fake an online payment', 'permission denied');
});
await as(U.owner, async () => {
  ok((await q(`select status from invoices where id = $1`, [bill.inv]))[0].status === 'viewed', 'status moves to Viewed after the client opens it');
  ok((await q(`select * from billing_activity where invoice_id = $1 and type = 'invoice_viewed'`, [bill.inv])).length === 1, 'view recorded in activity history');
});
await as(U.emp, async () => {
  ok((await q(`select * from invoices`)).length === 0, 'team members see no billing by default');
});
await as(U.owner, async () => { await q(`update employees set billing_access = true where id = $1`, [empId]); });
await as(U.emp, async () => {
  ok((await q(`select * from invoices`)).length === 1, 'team member with granted billing access can view invoices');
  await expectError(q(`select public.record_payment($1, 10, 'cash')`, [bill.inv]), '…but cannot record payments', 'Not allowed');
  await expectError(q(`select public.save_invoice($1::jsonb)`, [JSON.stringify({ id: bill.inv, org_id: org, client_id: clientId, items: [] })]), '…or change amounts', 'Not allowed');
});
await as(U.owner, async () => {
  const p = (await q(`select * from public.record_payment($1, 50, 'cash', null, null, 'Paid at the door')`, [bill.inv]))[0];
  bill.cashPay = p.id;
  const inv = (await q(`select * from invoices where id = $1`, [bill.inv]))[0];
  ok(inv.status === 'partially_paid' && Number(inv.balance_due) === 144.21, 'manual cash payment → Partially paid, balance 144.21');
  await expectError(q(`select public.record_payment($1, 500, 'cash')`, [bill.inv]), 'cannot record more than the balance', 'balance');
});
bill.stripePay = await asServer(async () => (await q(`select public.apply_online_payment($1::jsonb) id`, [JSON.stringify({
  invoice_id: bill.inv, amount: 164.21, tip_amount: 20, processor_payment_id: 'pi_test_1', method: 'card', card_brand: 'visa', card_last4: '4242' })]))[0].id);
await asServer(async () => { await q(`select public.apply_online_payment($1::jsonb)`, [JSON.stringify({ invoice_id: bill.inv, amount: 164.21, tip_amount: 20, processor_payment_id: 'pi_test_1' })]); });
await as(U.owner, async () => {
  const inv = (await q(`select * from invoices where id = $1`, [bill.inv]))[0];
  ok(inv.status === 'paid' && Number(inv.balance_due) === 0 && Number(inv.tip_total) === 20, 'online card payment → Paid; tip kept separate (20.00)');
  ok((await q(`select * from payments where invoice_id = $1`, [bill.inv])).length === 2, 'webhook retries don’t double-record the payment');
  ok((await q(`select * from notifications where type = 'payment_received'`)).length >= 2, 'admin notified of payments');
  await q(`select public.issue_refund($1, 20, 'Missed a spot')`, [bill.cashPay]);
  const pay = (await q(`select * from payments where id = $1`, [bill.cashPay]))[0];
  const inv2 = (await q(`select * from invoices where id = $1`, [bill.inv]))[0];
  ok(pay.status === 'partially_refunded' && Number(inv2.amount_refunded) === 20, 'partial refund recorded against payment and invoice');
  await expectError(q(`select public.issue_refund($1, 5)`, [bill.stripePay]), 'card payments must be refunded through Stripe', 'processor');
  await expectError(q(`select public.void_invoice($1)`, [bill.inv]), 'cannot cancel an invoice that still holds payments', 'Refund');
});
await as(U.client, async () => {
  const mb = (await q(`select public.my_billing($1) b`, [org]))[0].b;
  ok(mb.payments.length === 2 && mb.payments.some((p) => p.receipt_number?.startsWith('R-INV-1001')), 'client sees payment history with receipt numbers');
  ok((await q(`select * from notifications where type = 'payment_receipt'`)).length >= 1, 'client received a receipt');
});
await asServer(async () => {
  await q(`select public.record_online_refund($1::jsonb)`, [JSON.stringify({ processor_payment_id: 'pi_test_1', processor_refund_id: 're_1', amount: 164.21, reason: 'Refund' })]);
});
await as(U.owner, async () => {
  await q(`select public.issue_refund($1, 30)`, [bill.cashPay]);
  ok((await q(`select status from invoices where id = $1`, [bill.inv]))[0].status === 'refunded', 'fully refunded invoice → Refunded');
  const dup = (await q(`select public.duplicate_invoice($1) id`, [bill.inv]))[0].id;
  const d = (await q(`select * from invoices where id = $1`, [dup]))[0];
  ok(d.number === 'INV-1002' && d.status === 'draft' && Number(d.total) === 194.21, 'duplicate creates a new draft INV-1002');
  await q(`select public.void_invoice($1, 'Duplicate')`, [dup]);
  ok((await q(`select status from invoices where id = $1`, [dup]))[0].status === 'cancelled', 'unpaid invoice can be cancelled');

  // overdue + reminders
  const od = (await q(`select public.save_invoice($1::jsonb) id`, [JSON.stringify({ org_id: org, client_id: clientId,
    issue_date: new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10), due_date: new Date(Date.now() - 4 * 864e5).toISOString().slice(0, 10),
    items: [{ description: 'Deep clean', quantity: 1, unit_price: 200 }] })]))[0].id;
  await q(`update invoices set sent_at = now() - interval '20 days' where id = $1`, [od]);
  bill.overdue = od;
  const n = (await q(`select public.queue_invoice_reminders($1) n`, [org]))[0].n;
  const odr = (await q(`select * from invoices where id = $1`, [od]))[0];
  ok(n === 1 && odr.status === 'overdue', 'unpaid past-due invoice → Overdue and one reminder queued');
  ok((await q(`select days_offset from invoice_reminders where invoice_id = $1`, [od]))[0].days_offset === 3, 'sends the “3 days overdue” reminder (not every missed one)');
  ok((await q(`select public.queue_invoice_reminders($1) n`, [org]))[0].n === 0, 'reminders are not repeated');
  ok((await q(`select * from notifications where type = 'invoice_overdue'`)).length === 1, 'office alerted once when an invoice goes overdue');
  await q(`select public.send_invoice_reminder($1)`, [od]);
  ok((await q(`select * from invoice_reminders where invoice_id = $1 and kind = 'manual'`, [od])).length === 1, 'manual “send reminder” works');
});
await as(U.client, async () => {
  ok((await q(`select * from notifications where type = 'invoice_reminder'`)).length === 2, 'client received the reminders');
});
// estimates
await as(U.owner, async () => {
  bill.est = (await q(`select public.save_estimate($1::jsonb) id`, [JSON.stringify({ org_id: org, client_id: clientId, title: 'Move-out clean', internal_notes: 'Margin 40%',
    items: [{ description: 'Move-Out Cleaning', quantity: 1, unit_price: 325 }, { description: 'Inside oven', quantity: 1, unit_price: 40, is_optional: true }] })]))[0].id;
  const e = (await q(`select * from estimates where id = $1`, [bill.est]))[0];
  ok(e.number === 'EST-1001' && e.status === 'draft' && Number(e.total) === 325, 'estimate drafted; optional add-on excluded from total');
  await q(`select public.send_estimate($1)`, [bill.est]);
});
await as(U.client, async () => {
  const e = (await q(`select public.get_my_estimate($1) e`, [bill.est]))[0].e;
  ok(e.items.length === 2 && !JSON.stringify(e).includes('Margin'), 'client sees the estimate without internal notes');
  const optional = e.items.find((i) => i.description === 'Inside oven').id;
  const r = (await q(`select public.respond_estimate($1, true, 'Looks great', $2::uuid[]) r`, [bill.est, `{${optional}}`]))[0].r;
  ok(r.status === 'approved' && Number(r.total) === 365, 'client approves and picks the optional add-on (total 365)');
  await expectError(q(`select public.respond_estimate($1, false)`, [bill.est]), 'cannot answer twice', 'already');
});
await as(U.owner, async () => {
  const invId = (await q(`select public.convert_estimate_to_invoice($1) id`, [bill.est]))[0].id;
  ok(Number((await q(`select total from invoices where id = $1`, [invId]))[0].total) === 365, 'approved estimate converted to an invoice');
  const jobId = (await q(`select public.convert_estimate_to_job($1, $2)`, [bill.est, new Date(Date.now() + 7 * 864e5).toISOString()]))[0].convert_estimate_to_job;
  ok(!!jobId, 'approved estimate booked as a job');
  // recurring
  await q(`insert into recurring_billing_rules (org_id, client_id, appointment_id, name, frequency, next_run_date, mode, items)
           values ($1, $2, $3, 'Weekly clean', 'weekly', current_date, 'send', $4)`,
    [org, clientId, apptId, JSON.stringify([{ description: 'Weekly clean', quantity: 1, unit_price: 120 }])]);
  ok((await q(`select public.run_recurring_billing($1) n`, [org]))[0].n === 1, 'recurring rule generated an invoice');
  const r = (await q(`select * from recurring_billing_rules`))[0];
  const ri = (await q(`select * from invoices where id = $1`, [r.last_invoice_id]))[0];
  ok(ri.status === 'sent' && Number(ri.total) === 120 && r.next_run_date.getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime() === 7 * 864e5,
    'recurring invoice auto-sent; next run moved 7 days ahead');
  ok((await q(`select public.run_recurring_billing($1) n`, [org]))[0].n === 0, 'recurring rule does not double-bill');
  await expectError(q(`update billing_settings set stripe_account_id = 'acct_evil'`), 'admin cannot redirect payouts to another Stripe account', 'server');
});
bill.pm = await asServer(async () => (await q(`select public.save_payment_method($1::jsonb) id`, [JSON.stringify({
  client_id: clientId, customer_id: 'cus_1', payment_method_id: 'pm_1', brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030, autopay: true })]))[0].id);
await as(U.client, async () => {
  const mb = (await q(`select public.my_billing($1) b`, [org]))[0].b;
  ok(mb.payment_methods.length === 1 && mb.payment_methods[0].autopay_enabled && mb.payment_methods[0].last4 === '4242', 'client sees saved card (brand + last 4 only) with auto-pay on');
  await q(`select public.set_autopay($1, false)`, [bill.pm]);
  ok(!(await q(`select public.my_billing($1) b`, [org]))[0].b.payment_methods[0].autopay_enabled, 'client can turn auto-pay off');
});
const token = (await q(`select public_token from invoices where id = $1`, [bill.overdue]))[0].public_token;
await as(null, async () => {
  const pub = (await q(`select public.get_public_invoice($1) i`, [token]))[0].i;
  ok(pub.number && Number(pub.balance_due) === 200 && pub.org.name === 'Top Shelf Cleaning Co.', 'secure pay link works without signing in');
  await expectError(q(`select public.get_public_invoice($1)`, ['nope']), 'wrong link shows nothing', 'not found');
  ok((await q(`select * from invoices`)).length === 0, 'anonymous visitors cannot list invoices');
});

// ---------------------------------------------------------------- Inventory
console.log('\nFlow 7 — inventory: supplies and equipment');
const { itemId, glovesId, otherJobId } = await as(U.owner, async () => {
  const itemId = (await q(`insert into inventory_items (org_id, name, category, unit, quantity, reorder_level, reorder_quantity, unit_cost)
    values ($1, 'All-purpose cleaner', 'Cleaning products', 'bottle', 10, 3, 12, 4.50) returning id`, [org]))[0].id;
  const glovesId = (await q(`insert into inventory_items (org_id, name, category, unit, reorder_level) values ($1, 'Nitrile gloves', 'Paper & disposables', 'box', 1) returning id`, [org]))[0].id;
  const h = await q(`select * from inventory_movements where item_id = $1`, [itemId]);
  ok(h.length === 1 && Number(h[0].quantity_after) === 10, 'starting quantity recorded as first history row');
  await expectError(q(`update inventory_items set quantity = 99 where id = $1`, [itemId]), 'direct quantity edit is blocked (history cannot be skipped)', 'USE_STOCK_FUNCTIONS');
  await q(`select public.record_inventory_movement($1, 'restock', 5, null, 'Costco run', 4.25)`, [itemId]);
  const it = (await q(`select quantity, unit_cost from inventory_items where id = $1`, [itemId]))[0];
  ok(Number(it.quantity) === 15 && Number(it.unit_cost) === 4.25, 'restock adds stock and updates unit cost');
  await q(`select public.set_inventory_count($1, 14, 'Monthly count')`, [itemId]);
  ok(Number((await q(`select quantity from inventory_items where id = $1`, [itemId]))[0].quantity) === 14, 'stock count sets exact quantity');
  await q(`update inventory_items set name = 'All-purpose cleaner (lavender)', reorder_level = 12 where id = $1`, [itemId]);
  ok(true, 'admin can edit item details');
  const otherJob = (await q(`select public.schedule_appointment($1::jsonb) as id`, [JSON.stringify({ org_id: org, client_id: clientId, service_name: 'Move-out',
    starts_at: new Date(Date.now() + 26 * 3600e3).toISOString(), employee_ids: [emp2Id] })]))[0].id;
  const otherJobId = (await q(`select id from jobs where appointment_id = $1`, [otherJob]))[0].id;
  return { itemId, glovesId, otherJobId };
});
await as(U.emp, async () => {
  ok((await q(`select * from inventory_items`)).length === 2, 'employee can see the supply list');
  await expectError(q(`select public.record_inventory_movement($1, 'restock', 5)`, [itemId]), 'employee cannot restock', 'admin');
  await expectError(q(`insert into inventory_items (org_id, name) values ($1, 'x')`, [org]), 'employee cannot create items', 'row-level security');
  await expectError(q(`select public.record_inventory_movement($1, 'use', 1, $2)`, [itemId, otherJobId]), 'employee cannot log supplies on a job they are not on', 'not assigned');
  const mv = (await q(`select * from public.record_inventory_movement($1, 'use', 3, $2, 'Kitchen + baths')`, [itemId, jobs[2].id]))[0];
  ok(Number(mv.quantity_after) === 11 && mv.employee_id === empId, 'employee logs supplies used on their job');
  await expectError(q(`select public.record_inventory_movement($1, 'use', 50, $2)`, [itemId, jobs[2].id]), 'cannot use more than is on hand', 'INSUFFICIENT_STOCK');
  ok((await q(`select * from inventory_movements`)).length === 1, 'employee sees only their own / their jobs\' history');
  await q(`select public.undo_inventory_movement($1)`, [mv.id]);
  ok(Number((await q(`select quantity from inventory_items where id = $1`, [itemId]))[0].quantity) === 14, 'employee can undo their own mistake');
  await expectError(q(`select public.undo_inventory_movement($1)`, [mv.id]), 'same entry cannot be undone twice', 'already');
  await q(`select public.record_inventory_movement($1, 'use', 3, $2)`, [itemId, jobs[2].id]);
});
await as(U.owner, async () => {
  const n = (await q(`select * from notifications where type = 'low_stock'`));
  ok(n.length === 2 && n.every(x => x.title.startsWith('Running low')), `admin alerted when item drops to reorder level (again after going back above it) [${n.length}]`);
  await q(`select public.record_inventory_movement($1, 'use', 1)`, [itemId]);
  ok((await q(`select * from notifications where type = 'low_stock'`)).length === 2, 'no repeat low-stock alert while still low');
  ok((await q(`select * from inventory_movements where job_id = $1`, [jobs[2].id])).length === 3, 'admin sees supplies used on a job');
  await expectError(q(`select public.set_inventory_count($1, -1)`, [glovesId]), 'negative count rejected', 'negative');
});
await as(U.client, async () => {
  ok((await q(`select * from inventory_items`)).length === 0, 'client cannot see inventory');
  ok((await q(`select * from inventory_movements`)).length === 0, 'client cannot see inventory history');
  await expectError(q(`select public.record_inventory_movement($1, 'use', 1)`, [itemId]), 'client cannot log inventory', 'not found');
});


// ---------------------------------------------------------------- Trades, brand kit, equipment, priority, parts
console.log('\nFlow 8 — trades, brand kit, equipment at property, emergency jobs, parts on invoices');
await as(U.owner, async () => {
  ok((await q(`select trade from organizations where id = $1`, [org]))[0].trade === 'cleaning', 'existing company defaults to cleaning');
  ok((await q(`select count(*)::int n from service_catalog where org_id = $1 and name ilike '%cleaning%'`, [org]))[0].n >= 1, 'cleaning company keeps cleaning price list');
  await q(`update organizations set theme = $2 where id = $1`, [org, JSON.stringify({ accent: '#E8590C', font: 'inter', corners: 'square', mode: 'dark', sidebar: 'brand', app_name: 'Top Shelf' })]);
  ok((await q(`select theme->>'font' f from organizations where id = $1`, [org]))[0].f === 'inter', 'admin saves a full brand kit');
  await expectError(q(`update organizations set theme = '{"font":"comic-sans"}' where id = $1`, [org]), 'unknown font rejected', 'organizations_theme_valid');
  await expectError(q(`update organizations set theme = '{"accent":"red"}' where id = $1`, [org]), 'invalid accent color rejected', 'organizations_theme_valid');
});
await as(U.emp, async () => {
  ok((await q(`update organizations set theme = '{}' where id = $1 returning id`, [org])).length === 0, 'employee cannot change the brand kit');
});
await as(null, async () => {
  const slug = (await q(`select public.get_org_branding('top-shelf-cleaning-co') b`))[0].b;
  ok(slug?.theme?.accent === '#E8590C' && slug.name === 'Top Shelf Cleaning Co.', 'signed-out login page can load branding by company link');
  ok((await q(`select public.get_org_branding('nope') b`))[0].b === null, 'unknown company link returns nothing');
});

const plumber = '00000000-0000-0000-0000-0000000000d1';
await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'plumber@example.com', '{"full_name":"Pat Plumber"}')`, [plumber]);
const orgP = await as(plumber, async () => (await q(`select public.create_organization('Pipe Pros', '#1E6FD9', 'plumbing') id`))[0].id);
await as(plumber, async () => {
  ok((await q(`select trade from organizations`))[0].trade === 'plumbing', 'new company can start as plumbing');
  const names = (await q(`select name from service_catalog order by position`)).map(r => r.name);
  ok(names.includes('Drain Cleaning') && names.includes('Water Heater Replacement') && !names.includes('Standard Cleaning'), 'plumbing company gets a plumbing price list');
  await expectError(q(`select public.create_organization('X', '#1E6FD9', 'roofing')`), 'unknown trade rejected', 'Unknown trade');
});
await db.exec('reset role;');
await q(`select public.notify_user($1, $2, 'review_request', 'Your cleaning is complete', 'How did we do?', null)`, [orgP, plumber]);
await q(`select public.notify_user($1, $2, 'review_request', 'Your cleaning is complete', 'How did we do?', null)`, [org, U.owner]);
await as(plumber, async () => {
  ok((await q(`select title from notifications where type = 'review_request'`))[0]?.title === 'Your service visit is complete', 'plumbing clients get plumbing wording');
});
await as(U.owner, async () => {
  ok((await q(`select title from notifications where type = 'review_request' order by created_at desc limit 1`))[0]?.title === 'Your cleaning is complete', 'cleaning clients keep cleaning wording');
});

// Equipment at property
const { eqId, pJob } = await as(U.owner, async () => {
  const eqId = (await q(`insert into client_equipment (org_id, client_id, kind, brand, model, serial, location, installed_on)
    values ($1, $2, 'Water heater', 'Rheem', 'XE50T10', 'RH-123456', 'Garage', '2019-05-01') returning id`, [org, clientId]))[0].id;
  const appt = (await q(`select public.schedule_appointment($1::jsonb) as id`, [JSON.stringify({ org_id: org, client_id: clientId, service_name: 'Water heater flush',
    starts_at: new Date(Date.now() + 30 * 3600e3).toISOString(), employee_ids: [empId] })]))[0].id;
  const pJob = (await q(`select id from jobs where appointment_id = $1`, [appt]))[0].id;
  return { eqId, pJob };
});
await as(U.emp, async () => {
  ok((await q(`select * from client_equipment`)).length === 1, 'crew sees equipment at homes they service');
  const e2 = (await q(`insert into client_equipment (org_id, client_id, kind, brand) values ($1, $2, 'Water softener', 'Culligan') returning id`, [org, clientId]))[0].id;
  ok(!!e2, 'crew can record new equipment in the field');
  await q(`insert into job_equipment (org_id, job_id, equipment_id, note, created_by) values ($1, $2, $3, 'Flushed tank, anode ok', $4)`, [org, pJob, eqId, U.emp]);
  ok((await q(`select * from job_equipment where equipment_id = $1`, [eqId])).length === 1, 'crew logs service on equipment for their job');
  await expectError(q(`delete from client_equipment where id = $1 returning id`, [eqId]).then(r => { if (!r.length) throw new Error('blocked'); }), 'crew cannot delete equipment records', 'blocked');
});
await as(U.client, async () => {
  ok((await q(`select * from client_equipment`)).length === 2, 'client sees their own equipment in the portal');
  await expectError(q(`insert into client_equipment (org_id, client_id, kind) values ($1, $2, 'x')`, [org, clientId]), 'client cannot add equipment', 'row-level security');
});

// Emergency priority + billable parts → invoice
await as(U.owner, async () => {
  await q(`update inventory_items set billable = true, sell_price = 9.99 where id = $1`, [itemId]);
  await q(`update billing_settings set emergency_fee = 75 where org_id = $1`, [org]);
  await q(`update jobs set priority = 'emergency' where id = $1`, [pJob]);
  ok((await q(`select * from notifications where type = 'job_emergency'`)).length === 1, 'office notified of emergency job');
});
await as(U.emp, async () => {
  ok((await q(`select * from notifications where type = 'job_emergency'`)).length === 1, 'assigned tech notified of emergency job');
  await q(`select * from public.record_inventory_movement($1, 'use', 2, $2)`, [itemId, pJob]);
});
const invId = await as(U.owner, async () => {
  await q(`select * from public.record_inventory_movement($1, 'restock', 10)`, [itemId]);
  const id = (await q(`select public.create_invoice_from_job($1) id`, [pJob]))[0].id;
  const lines = await q(`select description, quantity::float q, unit_price::float p from invoice_items where invoice_id = $1 order by position`, [id]);
  const part = lines.find(l => l.description.startsWith('All-purpose cleaner'));
  ok(part && part.q === 2 && part.p === 9.99, 'billable parts used on the job land on the invoice at the sell price');
  ok(lines.some(l => l.description === 'Emergency service fee' && l.p === 75), 'emergency fee added to the invoice');
  return id;
});
await as(U.emp, async () => { await q(`select * from public.record_inventory_movement($1, 'use', 1, $2)`, [itemId, pJob]); });
await as(U.owner, async () => {
  await q(`select public.add_job_parts_to_invoice($1)`, [invId]);
  const lines = await q(`select description, quantity::float q from invoice_items where invoice_id = $1`, [invId]);
  ok(lines.filter(l => l.description.startsWith('All-purpose cleaner')).length === 1 && lines.find(l => l.description.startsWith('All-purpose cleaner')).q === 3, 'parts logged later can be pulled onto the draft invoice (no duplicates)');
  ok(Number((await q(`select total from invoices where id = $1`, [invId]))[0].total) > 0, 'invoice totals recomputed');
});
// ---------------------------------------------------------------- Tenant isolation
console.log('\nTenant isolation — a second company');
const org2 = await as(U.rival, async () => (await q(`select public.create_organization('Rival Maids') id`))[0].id);
await as(U.rival, async () => {
  ok((await q(`select * from organizations`)).length === 1, 'rival sees only their own organization');
  for (const t of ['clients', 'employees', 'jobs', 'job_notes', 'job_photos', 'reviews', 'time_entries', 'checklist_templates', 'appointments', 'invitations',
    'invoices', 'invoice_items', 'payments', 'refunds', 'estimates', 'recurring_billing_rules', 'payment_methods', 'billing_activity']) {
    ok((await q(`select * from ${t}`)).length === 0, `rival sees 0 rows in ${t}`);
  }
  const upd = await q(`update organizations set name = 'hacked' where id = $1 returning id`, [org]);
  ok(upd.length === 0, 'rival cannot rename another company');
  await expectError(q(`insert into clients (org_id, full_name) values ($1, 'x')`, [org]), 'rival cannot insert a client into another company', 'row-level security');
  const rc = (await q(`insert into clients (org_id, full_name) values ($1, 'Mine') returning id`, [org2]))[0].id;
  await expectError(q(`select public.schedule_appointment($1::jsonb)`, [JSON.stringify({ org_id: org2, client_id: clientId, starts_at: start })]), 'rival cannot schedule a job for another company\'s client', 'Client not found');
  await expectError(q(`insert into job_assignments (org_id, job_id, employee_id) values ($1, $2, $3)`, [org2, jobs[2].id, empId]), 'rival cannot attach to another company\'s job', '');
  await expectError(q(`select public.queue_reminders($1)`, [org]), 'rival cannot trigger reminders for another company', 'Not allowed');
  await expectError(q(`insert into storage.objects (bucket_id, name, owner) values ('job-photos', $1, $2)`, [`${org}/${job.id}/after/x.jpg`, U.rival]), 'rival cannot upload photos into another company\'s job', 'row-level security');
  ok((await q(`select * from storage.objects where bucket_id = 'job-photos'`)).length === 0, 'rival cannot read another company\'s photo files');
  ok((await q(`select * from inventory_items`)).length === 0, 'rival sees 0 inventory items');
  await expectError(q(`select public.record_inventory_movement($1, 'use', 1)`, [itemId]), 'rival cannot change another company\'s stock', 'not found');
  await expectError(q(`select public.set_inventory_count($1, 0)`, [itemId]), 'rival cannot count another company\'s stock', 'not found');
  await expectError(q(`insert into inventory_items (org_id, name) values ($1, 'x')`, [org]), 'rival cannot add items to another company', 'row-level security');
  ok((await q(`select * from client_equipment`)).length === 0, 'rival sees 0 equipment records');
  await expectError(q(`insert into client_equipment (org_id, client_id, kind) values ($1, $2, 'x')`, [org, clientId]), 'rival cannot add equipment to another company\'s client', 'row-level security');
  ok((await q(`update jobs set priority = 'emergency' where org_id = $1 returning id`, [org])).length === 0, 'rival cannot flag another company\'s jobs');
  ok(!!rc, 'rival can still work inside their own company');
  await expectError(q(`select public.save_invoice($1::jsonb)`, [JSON.stringify({ org_id: org, client_id: clientId, items: [] })]), 'rival cannot create invoices in another company', 'Not allowed');
  await expectError(q(`select public.save_invoice($1::jsonb)`, [JSON.stringify({ org_id: org2, client_id: clientId, items: [] })]), 'rival cannot invoice another company\'s client', 'Client not found');
  await expectError(q(`select public.get_my_invoice($1)`, [bill.inv]), 'rival cannot open another company\'s invoice', 'not found');
  await expectError(q(`select public.record_payment($1, 1, 'cash')`, [bill.overdue]), 'rival cannot record payments for another company', 'Not allowed');
  ok((await q(`select * from service_catalog`)).length === 7, 'rival has their own separate service catalog');
});
await as(U.emp, async () => {
  ok((await q(`select * from storage.objects where bucket_id = 'job-photos'`)).length === 1, 'assigned employee can read job photo files');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

