-- Essai local de 0461 (échéancier, clients publics), en transaction annulée. Base locale seulement.
begin;
set local client_min_messages = warning;
do $$
declare
  v_client uuid; v_k uuid; v_s1 uuid; v_s2 uuid; v_n int; v_sum numeric; v_inv uuid; v_r jsonb; i record; v_cie uuid;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, client_type, chorus_engagement_required, chorus_service_code, company_id) values ('Mairie Essai 0461', 'public', true, 'SERV1', v_cie) returning id into v_client;
  insert into public.sites (client_id, name, city, is_active, company_id) values (v_client, 'Mairie', 'Quimper', true, v_cie) returning id into v_s1;
  insert into public.sites (client_id, name, city, is_active, company_id) values (v_client, 'École', 'Quimper', true, v_cie) returning id into v_s2;
  insert into public.itv_equipment (client_id, site_id, type_id, status, company_id, label_code)
    select v_client, case when g <= 3 then v_s1 else v_s2 end, (select id from public.itv_equipment_types limit 1), 'en_service', v_cie, 'E0461-' || g from generate_series(1, 4) g;
  insert into public.client_engagements (client_id, year, number, company_id) values (v_client, extract(year from current_date)::int, 'ENG-2026-1', v_cie);

  -- Trimestriel, début le 15 du 2e mois d'un trimestre : prorata ; total des échéances = prix annuel (1 an)
  insert into public.itv_contracts (client_id, company_id, start_on, annual_price_ht, visit_months, status, duration_years, tacit_renewal, billing_period, purchase_order_ref)
  values (v_client, v_cie, date '2026-02-15', 1200, array[3], 'a_valider', 1, true, 'trimestriel', 'BC-77') returning id into v_k;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  v_r := public.contrat_valider(v_k);
  select count(*), sum(amount_ht) into v_n, v_sum from public.itv_contract_installments where contract_id = v_k;
  -- 15/02 au 31/03 (45 j sur 90 : 150), T2, T3, T4 (300 chacun), 01/01 au 14/02/2027 (45 j sur 90 : 150)
  if v_n <> 5 or v_sum <> 1200 then raise exception 'échéancier : % échéances, total %', v_n, v_sum; end if;
  -- Client public : terme échu par défaut
  if exists (select 1 from public.itv_contract_installments where contract_id = v_k and due_on <> period_end + 1) then raise exception 'terme échu attendu'; end if;

  -- Facture de la 1re échéance : une ligne par site, 3/4 et 1/4, engagement et bon de commande repris
  select * into i from public.itv_contract_installments where contract_id = v_k order by period_start limit 1;
  v_inv := public.contrat_echeance_facturer(i.id);
  select count(*), sum(total_ht) into v_n, v_sum from public.invoice_items where invoice_id = v_inv;
  if v_n <> 2 or v_sum <> i.amount_ht then raise exception 'lignes : % pour %', v_n, v_sum; end if;
  if not exists (select 1 from public.invoice_items where invoice_id = v_inv and total_ht = 37.50) then raise exception 'répartition par appareils absente'; end if;
  if not exists (select 1 from public.invoices where id = v_inv and status = 'draft' and client_reference = 'BC-77' and chorus_engagement = 'ENG-2026-1' and chorus_service_code = 'SERV1' and total_ttc = 180) then
    raise exception 'facture : références ou totaux incorrects';
  end if;
  -- Une seule facture par échéance
  if public.contrat_echeance_facturer(i.id) <> v_inv then raise exception 'facture en double'; end if;

  -- Nuit : les échéances dues sont préparées et signalées
  update public.itv_contract_installments set due_on = current_date where contract_id = v_k and status = 'a_facturer';
  v_r := public.contrats_relances_generer();
  if (v_r ->> 'factures_echeances')::int <> 4 then raise exception 'nuit : %', v_r; end if;
  select count(*) into v_n from public.scheduled_actions where kind = 'facture_brouillon' and client_id = v_client;
  if v_n <> 4 then raise exception 'actions à valider : %', v_n; end if;

  -- Mensuel, particulier : à échoir, prorata du premier mois
  insert into public.clients (name, client_type, company_id) values ('Particulier 0461', 'particulier', v_cie) returning id into v_client;
  insert into public.itv_contracts (client_id, company_id, start_on, annual_price_ht, visit_months, status, duration_years, tacit_renewal, billing_period)
  values (v_client, v_cie, date '2026-03-16', 120, array[3], 'a_valider', 1, false, 'mensuel') returning id into v_k;
  v_r := public.contrat_valider(v_k);
  select count(*), sum(amount_ht) into v_n, v_sum from public.itv_contract_installments where contract_id = v_k;
  -- 16/03 au 31/03 (16/31 de 10 = 5,16), avril à février (11 × 10), 01/03 au 15/03/2027 (15/31 de 10 = 4,84)
  if v_n <> 13 or v_sum <> 120 then raise exception 'mensuel : % échéances, total %', v_n, v_sum; end if;
  if exists (select 1 from public.itv_contract_installments where contract_id = v_k and due_on <> period_start) then raise exception 'terme à échoir attendu'; end if;

  -- À la visite : aucun échéancier
  update public.itv_contracts set billing_period = 'visite' where id = v_k;
  perform public.contrat_echeancier_generer(v_k);
  select count(*) into v_n from public.itv_contract_installments where contract_id = v_k;
  if v_n <> 0 then raise exception 'à la visite : % échéances restantes', v_n; end if;

  raise warning 'ESSAI 0461 : OK';
end
$$;
rollback;
