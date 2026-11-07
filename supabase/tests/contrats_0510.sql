-- Essai de 0510 : contrat signé, moment de facturation figé. Rouge sans 0510 (le changement passait).
-- Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;
do $$
declare v_cie uuid; v_client uuid; v_k uuid; v_ok boolean;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Client essai 0510', v_cie) returning id into v_client;
  insert into public.itv_contracts (client_id, company_id, start_on, annual_price_ht, visit_months, status, billing_term)
  values (v_client, v_cie, current_date, 500, array[3], 'actif', 'echoir') returning id into v_k;
  -- 1. Contrat non signé : le moment de facturation se change
  update public.itv_contracts set billing_term = 'echu' where id = v_k;
  update public.itv_contracts set billing_term = null where id = v_k;
  update public.itv_contracts set billing_term = 'echoir' where id = v_k;
  update public.itv_contracts set signed_at = now(), signed_on_paper = true where id = v_k;
  -- 2. Contrat signé : changé, ou vidé (règle par défaut selon le client), refusé
  begin update public.itv_contracts set billing_term = 'echu' where id = v_k; v_ok := true; exception when insufficient_privilege then v_ok := false; end;
  if v_ok then raise exception '2. moment de facturation modifiable après signature'; end if;
  begin update public.itv_contracts set billing_term = null where id = v_k; v_ok := true; exception when insufficient_privilege then v_ok := false; end;
  if v_ok then raise exception '2b. moment de facturation vidé après signature'; end if;
  -- 3. Conditions déjà figées : toujours refusées ; le reste reste libre, même valeur réécrite permise
  begin update public.itv_contracts set includes = '{"pieces": true}' where id = v_k; v_ok := true; exception when insufficient_privilege then v_ok := false; end;
  if v_ok then raise exception '3. compris modifiable après signature'; end if;
  update public.itv_contracts set notes = 'ok', billing_term = 'echoir' where id = v_k;
  if (select billing_term from public.itv_contracts where id = v_k) <> 'echoir' then raise exception '3b. moment de facturation changé'; end if;
  -- 4. Signé avec un moment vide : fixé à la signature selon le client, puis plus changé par le type du client
  insert into public.itv_contracts (client_id, company_id, start_on, annual_price_ht, visit_months, status)
  values (v_client, v_cie, current_date, 500, array[3], 'actif') returning id into v_k;
  update public.itv_contracts set signed_at = now(), signed_on_paper = true where id = v_k;
  if (select billing_term from public.itv_contracts where id = v_k) is distinct from 'echoir' then raise exception '4. moment non fixé à la signature'; end if;
  update public.clients set client_type = 'public' where id = v_client;
  if (select billing_term from public.itv_contracts where id = v_k) is distinct from 'echoir' then raise exception '4b. moment changé avec le client'; end if;
  insert into public.itv_contracts (client_id, company_id, start_on, annual_price_ht, visit_months, status)
  values (v_client, v_cie, current_date, 500, array[3], 'actif') returning id into v_k;
  update public.itv_contracts set signed_at = now(), signed_on_paper = true where id = v_k;
  if (select billing_term from public.itv_contracts where id = v_k) is distinct from 'echu' then raise exception '4c. client public : moment faux'; end if;
  -- 5. Indice : nom et mois figés après signature ; valeur de référence sans indice ni mois refusée
  insert into public.itv_contracts (client_id, company_id, start_on, annual_price_ht, visit_months, status, index_label, index_base_value, index_base_month)
  values (v_client, v_cie, current_date, 500, array[3], 'actif', 'Indice essai', 100, '2026-06-01') returning id into v_k;
  update public.itv_contracts set signed_at = now(), signed_on_paper = true where id = v_k;
  begin update public.itv_contracts set index_label = 'Autre' where id = v_k; v_ok := true; exception when insufficient_privilege then v_ok := false; end;
  if v_ok then raise exception '5. nom de l''indice modifiable après signature'; end if;
  begin update public.itv_contracts set index_base_month = '2026-07-01' where id = v_k; v_ok := true; exception when insufficient_privilege then v_ok := false; end;
  if v_ok then raise exception '5b. mois de référence modifiable après signature'; end if;
  begin
    insert into public.itv_contracts (client_id, company_id, start_on, annual_price_ht, visit_months, status, index_base_value)
    values (v_client, v_cie, current_date, 500, array[3], 'actif', 100);
    raise exception '5c. valeur de référence sans indice acceptée';
  exception when check_violation then null;
  end;
end
$$;
rollback;
