-- Essai local de 0466 : contrat signé, délai de dépannage et « compris au contrat » figés.
begin;
set local client_min_messages = warning;
do $$
declare v_cie uuid; v_client uuid; v_k uuid; v_ok boolean;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Client 0466', v_cie) returning id into v_client;
  insert into public.itv_contracts (client_id, company_id, start_on, annual_price_ht, visit_months, status, emergency_hours, includes)
  values (v_client, v_cie, current_date, 500, array[3], 'actif', 48, '{}') returning id into v_k;
  update public.itv_contracts set emergency_hours = 24 where id = v_k; -- non signé : permis
  update public.itv_contracts set signed_at = now(), signed_on_paper = true where id = v_k;
  begin update public.itv_contracts set emergency_hours = 72 where id = v_k; v_ok := true; exception when insufficient_privilege then v_ok := false; end;
  if v_ok then raise exception 'délai modifiable après signature'; end if;
  begin update public.itv_contracts set includes = '{"pieces": true}' where id = v_k; v_ok := true; exception when insufficient_privilege then v_ok := false; end;
  if v_ok then raise exception 'compris modifiable après signature'; end if;
  update public.itv_contracts set notes = 'ok' where id = v_k; -- le reste reste libre
  raise warning 'ESSAI 0466 : OK';
end
$$;
rollback;
