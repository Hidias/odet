-- Essai local de 0469 : relances graduées, mise en demeure chiffrée, particulier sans indemnité, suspension proposée.
begin;
set local client_min_messages = warning;
do $$
declare v_cie uuid; v_pro uuid; v_part uuid; v_i1 uuid; v_i2 uuid; v_r jsonb; a record;
begin
  select id into v_cie from public.companies limit 1;
  update public.billing_settings set relance_paliers = '{7,15,30}', mise_en_demeure_jours = 45, taux_bce = 2, taux_bce_au = date '2026-07-01' where company_id = v_cie;
  insert into public.clients (name, client_type, email, company_id) values ('Pro 0469', 'entreprise', 'pro@exemple.invalid', v_cie) returning id into v_pro;
  insert into public.clients (name, client_type, email, company_id) values ('Particulier 0469', 'particulier', 'part@exemple.invalid', v_cie) returning id into v_part;
  insert into public.itv_contracts (client_id, company_id, start_on, annual_price_ht, visit_months, status) values (v_pro, v_cie, current_date - 400, 100, array[3], 'actif');
  insert into public.invoices (reference, type, client_id, company_id, status, total_ht, total_ttc, amount_due, invoice_date, due_date)
  values ('FACT-0469-1', 'invoice', v_pro, v_cie, 'draft', 1000, 1200, 1200, current_date - 90, current_date - 45) returning id into v_i1;
  insert into public.invoices (reference, type, client_id, company_id, status, total_ht, total_ttc, amount_due, invoice_date, due_date)
  values ('FACT-0469-2', 'invoice', v_part, v_cie, 'draft', 100, 120, 120, current_date - 60, current_date - 15) returning id into v_i2;
  alter table public.invoices disable trigger user;
  update public.invoices set status = 'sent' where id in (v_i1, v_i2);
  alter table public.invoices enable trigger user;
  v_r := public.impayes_generer();
  -- Pro : J+45 → seule la mise en demeure est dans la fenêtre (J+30 hors des 14 derniers jours) ; particulier : J+15
  if (v_r->>'mises_en_demeure')::int <> 1 or (v_r->>'suspensions_proposees')::int <> 1 then raise exception 'résultat : %', v_r; end if;
  select * into a from public.scheduled_actions where dedup_key = 'impaye:' || v_i1 || ':mise_en_demeure';
  -- 1200 × 12 % × 45 / 365 = 17,75
  if (a.payload->>'interets')::numeric <> 17.75 or (a.payload->>'indemnite')::int <> 40 or a.payload->>'texte' not like '%L441-10%' then raise exception 'mise en demeure pro : %', a.payload; end if;
  if not exists (select 1 from public.scheduled_actions where dedup_key = 'impaye:' || v_i2 || ':15' and payload->>'texte' like '%Nous revenons vers vous%') then raise exception 'relance J+15 particulier absente'; end if;
  if exists (select 1 from public.scheduled_actions where dedup_key = 'impaye:' || v_i2 || ':15' and payload->>'texte' like '%indemnité%') then raise exception 'indemnité pour un particulier'; end if;
  -- Une seule fois
  v_r := public.impayes_generer();
  if (v_r->>'relances')::int + (v_r->>'mises_en_demeure')::int <> 0 then raise exception 'doublons : %', v_r; end if;
  raise warning 'ESSAI 0469 : OK (%)', a.payload->>'interets';
end
$$;
rollback;
