-- ScrubHub 0005: Zelle as a payment option
-- Safe to run on a live project: only adds columns and widens what's allowed.
--   • billing_settings gets the Zelle recipient (email or US mobile) and the name clients will see in their bank app
--   • 'zelle' becomes a payment method you can record (Zelle can't be confirmed automatically — you mark it paid)
--   • the client-facing invoice includes the Zelle details so the pay page can show them

alter table public.billing_settings
  add column if not exists zelle_recipient text check (zelle_recipient is null or char_length(zelle_recipient) <= 120),
  add column if not exists zelle_name      text check (zelle_name is null or char_length(zelle_name) <= 80);

alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('card','debit_card','ach','cash','check','zelle','other'));

-- Same as 0002, plus 'zelle'
create or replace function public.record_payment(p_invoice uuid, p_amount numeric, p_method text,
  p_paid_at timestamptz default null, p_reference text default null, p_notes text default null, p_tip numeric default 0)
returns public.payments language plpgsql security definer set search_path = public as $$
declare inv public.invoices%rowtype;
begin
  select * into inv from public.invoices where id = p_invoice;
  if not found or not public.is_org_admin(inv.org_id) then raise exception 'Not allowed'; end if;
  if inv.voided_at is not null then raise exception 'This invoice was cancelled'; end if;
  if p_method not in ('card','debit_card','ach','cash','check','zelle','other') then raise exception 'Choose a payment method'; end if;
  if coalesce(p_amount, 0) < 0 or coalesce(p_tip, 0) < 0 then raise exception 'Amounts must be positive'; end if;
  if coalesce(p_amount, 0) + coalesce(p_tip, 0) <= 0 then raise exception 'Enter an amount'; end if;
  if round(p_amount, 2) > inv.balance_due then
    raise exception 'That’s more than the balance due (%)', public.fmt_money(inv.balance_due, (select currency from public.billing_settings where org_id = inv.org_id));
  end if;
  return public.insert_payment(p_invoice, p_amount, p_tip, p_method, 'manual', null, null, null, p_reference, p_notes, p_paid_at);
end $$;

-- Same as 0002, plus zelle_recipient / zelle_name in settings
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
                   'receipt_message', s.receipt_message, 'autopay_enabled', s.autopay_enabled,
                   'zelle_recipient', s.zelle_recipient, 'zelle_name', s.zelle_name)
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
