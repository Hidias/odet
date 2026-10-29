-- Essai local de 0470 : intérêts avec paiement partiel, relances écartées quand la facture est réglée.
begin;
set local client_min_messages = warning;
do $$
declare v_cie uuid; v_pro uuid; v_i uuid; v_r jsonb; a record;
begin
  select id into v_cie from public.companies limit 1;
  update public.billing_settings set relance_paliers = '{7,15,30}', mise_en_demeure_jours = 45, taux_bce = 2, taux_bce_au = date '2026-07-01' where company_id = v_cie;
  insert into public.clients (name, client_type, email, company_id) values ('Pro 0470', 'entreprise', 'pro@exemple.invalid', v_cie) returning id into v_pro;
  insert into public.invoices (reference, type, client_id, company_id, status, total_ht, total_ttc, amount_due, invoice_date, due_date)
  values ('FACT-0470-1', 'invoice', v_pro, v_cie, 'draft', 1000, 1200, 600, current_date - 90, current_date - 45) returning id into v_i;
  alter table public.invoices disable trigger user;
  update public.invoices set status = 'partial' where id = v_i;
  alter table public.invoices enable trigger user;
  -- 600 € payés 15 jours après l'échéance : 1200 € dus 14 jours, puis 600 € dus 31 jours
  insert into public.invoice_payments (invoice_id, amount, payment_date) values (v_i, 600, current_date - 30);
  v_r := public.impayes_generer();
  select * into a from public.scheduled_actions where dedup_key = 'impaye:' || v_i || ':mise_en_demeure';
  -- (1200 × 14 + 600 × 31) × 12 % / 365 = 11,64
  if (a.payload->>'interets')::numeric <> 11.64 then raise exception 'intérêts : %', a.payload->>'interets'; end if;
  -- Règlement du solde : la mise en demeure en attente est écartée
  alter table public.invoices disable trigger invoices_verrou;
  update public.invoices set amount_due = 0, status = 'paid' where id = v_i;
  alter table public.invoices enable trigger invoices_verrou;
  if (select status from public.scheduled_actions where id = a.id) <> 'ignore' then raise exception 'mise en demeure non écartée'; end if;
  raise warning 'ESSAI 0470 : OK';
end
$$;
rollback;
