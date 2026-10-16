# ScrubHub

A white-label, mobile-first operating system for independent cleaning businesses.
Each cleaning company gets its own private workspace with its logo and brand color, and three apps:

| Who | Where | What they do |
|---|---|---|
| **Owner / admin** | `/dashboard` | Dashboard, calendar, clients, team & crews, checklist builder, scheduling (one-time + recurring), job review (time, photos, notes, checklist), reviews, reminders, settings |
| **Employee** | `/work` | Today's jobs, clock in/out, room-by-room checklist, before/after photos, notes, complete job |
| **Client** | `/portal` | Upcoming/past cleanings, live progress, notes for the crew, reminders, reviews, profile |

Built with React 18 + TypeScript + Vite (installable PWA), Supabase (Postgres, Auth, Storage, Row Level Security, Realtime), and deployed on Netlify.

---

## 1. Set up Supabase (about 10 minutes)

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**, paste the whole of `supabase/migrations/0001_scrubhub_schema.sql`, and run it.
   This creates all tables, RLS policies, storage buckets (`logos`, `job-photos`), and server functions.
3. **New query** again, paste the whole of `supabase/migrations/0002_billing.sql`, and run it (adds Billing).
   If your project already ran 0001 earlier, just run 0002 — it adds billing to every existing company.
4. **Authentication → URL Configuration**
   - *Site URL*: your Netlify URL (e.g. `https://scrubhub.netlify.app`)
   - *Redirect URLs*: add `https://YOUR-SITE/**` and `http://localhost:5173/**`
5. **Authentication → Providers → Email**: leave on. For faster testing you can turn off "Confirm email";
   the app handles both flows (it shows "check your email" when confirmation is on).
6. **Project Settings → API**: copy the *Project URL*, the *anon public* key, and (for step 3 below) the *service_role* key.

## 2. Run locally

```bash
npm install
cp .env.example .env      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev               # http://localhost:5173
```

Other scripts: `npm run build` (typecheck + production build), `npm run preview`, and `npm run test:db`
(runs the migration in an embedded Postgres and checks all six V1 flows and cross-company isolation under RLS: 72 checks).

## 3. Deploy to Netlify

1. Push this folder to a GitHub repo, then in Netlify choose **Add new site → Import an existing project**.
   (Or drag-and-drop: run `npm run build` and drop the `dist` folder. Scheduled functions need the Git method.)
2. Build settings are read from `netlify.toml` (`npm run build`, publish `dist`, functions in `netlify/functions`).
3. **Site configuration → Environment variables**:

| Variable | Required | Used by | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | Browser | Project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Browser | anon public key: safe to expose, protected by RLS |
| `SUPABASE_URL` | for reminders | Functions | same Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | for reminders | Functions | **secret**, never prefix with `VITE_` |
| `APP_URL` | recommended | Functions | your site URL, used in email links |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional | Functions | turns on email delivery |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | optional | Functions | turns on SMS delivery |
| `STRIPE_SECRET_KEY` | for online payments | Functions | **secret**. Turns on "Pay now", saved cards, auto-pay, card refunds |
| `STRIPE_WEBHOOK_SECRET` | for online payments | Functions | signing secret of the webhook below |
| `STRIPE_PLATFORM_FEE_PERCENT` | optional | Functions | ScrubHub's cut when a company uses its own connected Stripe account |

4. Trigger a deploy. Refreshing any nested route (e.g. `/jobs/123`) works because `netlify.toml` rewrites all paths to `index.html`.

If the two `VITE_` variables are missing, the app shows a setup screen instead of a blank page.

## 4. First run

1. Open the site → **Create your workspace** → follow the 9-step onboarding (business name, logo, color, first employee, first client, checklists, first job).
2. Employees and clients join through private **invite links** (Team → Invite, or Client → Get portal invite link). You can text, share, or copy the link.
   Links work once and expire after 14 days.
3. Optional demo data: edit the email in `supabase/seed/demo_seed.sql` and run it in the SQL editor.

## 5. Billing (invoices, payments, estimates)

Everything under **Billing** works without Stripe: create/send invoices and estimates, record cash / check / bank payments, refunds, recurring billing, reminders, reports, PDFs.

To let clients **pay online** (card, debit, ACH):
1. Create a Stripe account → Developers → API keys → copy the **Secret key** into Netlify as `STRIPE_SECRET_KEY`.
2. Stripe → Developers → Webhooks → **Add endpoint** `https://YOUR-SITE/.netlify/functions/stripe-webhook` with events
   `payment_intent.succeeded`, `payment_intent.payment_failed`, `checkout.session.completed`, `charge.refunded`
   (tick "Events on Connected accounts" too if you use Stripe Connect). Copy its **Signing secret** into `STRIPE_WEBHOOK_SECRET`.
3. Redeploy. The "Pay now" button appears on invoices in the client portal and on secure pay links.

Card numbers never reach ScrubHub: clients pay on Stripe's hosted checkout page; we store only Stripe ids, brand and last 4.

**One Stripe account per cleaning company (Stripe Connect):** ScrubHub → cleaning business → their customer.
Set `billing_settings.stripe_account_id` (an `acct_…` id) for a company from the server/SQL editor after onboarding them to
Connect. All their charges, saved cards and refunds then run on *their* account (direct charges), optionally with
`STRIPE_PLATFORM_FEE_PERCENT`. Browsers cannot change this field (enforced by a trigger).

**The V1 flow:** job completed → **Create invoice** (client, address and price pre-filled from the service catalog or the
series' last invoice) → review → **Send** → client opens it in the portal (or via the secure link if they have no login) →
**Pay now** (optional tip, optional "save my card") → Stripe webhook records the payment, invoice turns **Paid**, client
gets a receipt, the office is notified and it shows on the Billing dashboard. Unpaid invoices get reminders on the
schedule in Billing settings (default 3 days before, on the due date, 3 and 7 days overdue); the hourly `billing-daily`
function also generates recurring invoices and runs auto-pay charges.

---

## Architecture

```
src/
  auth/            AuthProvider (session, memberships, active workspace), route guards
  components/ui/   Design system: Button, Form fields, Modal/ConfirmDialog, Toast, Badge, Progress, Empty/Loading/Error states
  components/layout AppShell (desktop sidebar + mobile bottom nav)
  features/
    auth/          Login, signup, password reset, invite join
    onboarding/    9-step setup with progress indicator
    admin/         Dashboard, calendar, job form/detail, clients, team, settings, reviews
    checklists/    Template builder + starter templates
    employee/      Field app
    portal/        Client portal (+ Billing tab, secure /pay and /estimate links)
    billing/       Billing: overview, invoices, estimates, payments, recurring, services, reports, settings
    shared/        Data hooks, notifications, job components, account
  lib/             Supabase client, types, formatting, branding, storage helpers
supabase/
  migrations/      Full schema + RLS + RPCs + storage policies
  tests/           Database flow & isolation tests (PGlite)
  seed/            Optional demo data
netlify/functions/ send-reminders (hourly), dispatch-notifications (every 5 min), channel adapters,
                   billing-daily (hourly: reminders, overdue, recurring invoices, auto-pay), billing-checkout,
                   billing-autopay, billing-refund, stripe-webhook, billing-config
```

### Multi-tenancy & security
- Every tenant table carries `org_id`. **RLS is enabled on every table**, and policies check membership and role through `SECURITY DEFINER` helpers (`is_org_admin`, `is_org_staff`, `is_assigned_to_job`, …).
- Triggers stop cross-organization references (for example, assigning another company's employee) and stop `org_id` from ever changing.
- Accounts are linked to employee or client records **only** through invitations (enforced by a trigger).
- Sensitive state changes run as server functions that re-check permissions: `clock_in`, `clock_out`, `set_checklist_item`, `complete_job`, `schedule_appointment`, `cancel_job`, `submit_review`, `accept_invitation`, `queue_reminders`.
- Clients never see internal crew notes, appointment internal notes, staff records, or time entries. They see photos only after completion.
- Storage paths: `logos/{org_id}/…` (public read, admin write) and `job-photos/{org_id}/{job_id}/{before|after}/…` (private, signed URLs).
- The UI hides things by role, but the database is what enforces access.
- **Billing:** owners/admins manage money; employees see nothing unless an admin turns on "Can view billing" (read-only).
  Clients never query billing tables — they use `my_billing`, `get_my_invoice`, `get_public_invoice`… which return
  client-safe JSON (internal notes are never included). Totals, balances and statuses are recomputed by triggers, so
  amounts can't be edited from the browser; payments, refunds and online-payment recording are server-side functions.

### Data model
`organizations` · `organization_settings` · `subscriptions` · `profiles` · `memberships` · `invitations` · `employees` · `teams` · `team_members` · `clients` · `checklist_templates` → `checklist_sections` → `checklist_items` · `appointments` (booking / recurring series) → `jobs` (each visit) → `job_assignments`, `job_checklist_items` (snapshot), `job_notes`, `time_entries`, `job_photos` · `client_notes` · `reviews` · `notifications`

- **Recurring appointments** generate one `jobs` row per visit (weekly, biweekly, monthly; up to 52). Each visit can then be edited, reassigned, or cancelled individually, or "this and future".
- **Billing:** `billing_settings` · `service_catalog` · `invoices` → `invoice_items` · `payments` → `refunds` · `estimates` → `estimate_items` ·
  `recurring_billing_rules` · `payment_methods` (Stripe refs only) · `billing_customers` · `invoice_reminders` · `billing_activity` · `billing_outbox`.
- **Checklists** are copied onto each job, so editing a template never rewrites past or in-progress work.
- **Job status** is a text column with a check constraint (`scheduled`, `in_progress`, `completed`, `cancelled`). To add a status, alter the constraint and add it to `STATUS_META` in `src/lib/format.ts`.

### Notifications
Core logic only writes rows to `notifications` (assignment, reminders, completion, review requests, reviews, client notes). The app shows them live via Realtime. `dispatch-notifications` delivers pending rows by email/SMS through adapters in `netlify/functions/_lib/channels.ts`; each adapter turns on only when its keys exist. Web push is stubbed there, ready for VAPID keys.

Reminders are queued hourly by `send-reminders`, or on demand with **Send reminders** on the dashboard.

### Subscription-ready
`subscriptions` (plan, status, trial end, provider IDs) is readable by admins and writable only with the service role, so a billing webhook (e.g. Stripe) can update it later. New workspaces start a 14-day trial.

### Native apps later
The UI is a responsive PWA with touch-sized controls, and all data access goes through `@supabase/supabase-js`, so it can be wrapped with Capacitor for iOS/Android without restructuring.

---

## Trades, brand kit and trade tools (migrations 0003 + 0004)

**Trades.** Each company picks its trade during onboarding (`organizations.trade`: `cleaning` or `plumbing`).
The trade sets the app's wording (`src/lib/trades.ts`, used through `useTrade()`), the starter price list, starter
checklists (`starterTemplatesFor`), starter inventory (`starterItemsFor`), and which tools are switched on.
Client notifications are reworded per trade by the `t_notification_wording` trigger. To add a trade: add it to the
`organizations.trade` check, `seed_service_catalog`, and `TRADES` / `EQUIPMENT_KINDS` / starter lists.

**Brand kit** (Settings → Brand kit, stored in `organizations.theme`, validated by `valid_theme`): brand color,
optional accent color, font (7 choices), corner style, light / dark / auto mode, side-menu style, app name and
tagline, with a live preview. Applied by `applyTheme()` in `src/lib/brand.ts`. The last company's look is cached on the
device so the sign-in screen is branded. Each company gets a sign-in link: `/c/<company-slug>`.
Public invoice / estimate pages and invite links use the same theme (`get_org_branding`, `org_public_json`).

**Plumbing tools**
- **Equipment at property** — `client_equipment` + `job_equipment` (service history). On client pages, job pages
  (admin + technician) and read-only in the client portal. Technicians can add equipment at homes they service.
- **Urgent / emergency jobs** — `jobs.priority`. Set on new/edit job; the office and assigned technician are notified;
  shown first under "Needs attention"; `billing_settings.urgent_fee` / `emergency_fee` are added to the invoice.
- **Parts → invoice** — inventory items marked *Charge the client* with a client price are added to the job's invoice
  by `create_invoice_from_job`; parts logged later can be pulled onto a draft invoice (`add_job_parts_to_invoice`).

`npm run test:db` runs 193 checks across all migrations, both trades, and cross-company isolation.
