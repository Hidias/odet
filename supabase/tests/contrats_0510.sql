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
end
$$;
rollback;
