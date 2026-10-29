-- Essai local de 0462 (révision annuelle par indice), en transaction annulée. Base locale seulement.
begin;
set local client_min_messages = warning;
do $$
declare v_client uuid; v_k uuid; v_cie uuid; v_rev uuid; v_r jsonb; v_n int; v_sum numeric; v_ok boolean;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Client 0462', v_cie) returning id into v_client;
  -- Contrat signé il y a presque un an, annuel, 3 ans, indice 120 au départ
  insert into public.itv_contracts (client_id, company_id, start_on, annual_price_ht, visit_months, status, duration_years, tacit_renewal, billing_period,
    index_label, index_series, index_base_value, term_on, signed_at, signed_name)
  values (v_client, v_cie, current_date - 350, 1000, array[3], 'actif', 3, true, 'annuel', 'ICHTrev-TS', '001565183', 120,
    (current_date - 350 + interval '3 years' - interval '1 day')::date, now(), 'Client') returning id into v_k;
  if (select base_price_ht from public.itv_contracts where id = v_k) <> 1000 then raise exception 'P0 non posé'; end if;
  perform app.contrat_echeancier(v_k);
  -- Prix figé hors révision
  v_ok := false;
  begin update public.itv_contracts set annual_price_ht = 1100 where id = v_k; exception when others then v_ok := true; end;
  if not v_ok then raise exception 'prix modifiable sans révision'; end if;

  -- Révision préparée 30 jours avant l'anniversaire
  if public.contrats_revisions_generer() <> 1 then raise exception 'révision non préparée'; end if;
  select id into v_rev from public.itv_contract_revisions where contract_id = v_k;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  v_r := public.contrat_revision_decider(v_rev, 126, date '2026-06-01', true, null);
  -- 1000 × 126 / 120 = 1050
  if (v_r ->> 'prix')::numeric <> 1050 then raise exception 'prix révisé : %', v_r; end if;
  -- 1re année au prix de départ, années suivantes au prix révisé
  select count(*), sum(amount_ht) into v_n, v_sum from public.itv_contract_installments where contract_id = v_k;
  if v_n <> 3 or v_sum <> 1000 + 1050 + 1050 then raise exception 'échéancier révisé : % échéances, %', v_n, v_sum; end if;
  -- Une seule révision par anniversaire, décision unique
  if public.contrats_revisions_generer() <> 0 then raise exception 'révision en double'; end if;
  v_ok := false;
  begin perform public.contrat_revision_decider(v_rev, 130, null, true, null); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'révision décidée deux fois'; end if;
  raise warning 'ESSAI 0462 : OK';
end
$$;
rollback;
