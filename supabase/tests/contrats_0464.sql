-- Essai local de 0464 : la clôture d'un inventaire ne pose pas de date de vérification, une vérification si.
begin;
set local client_min_messages = warning;
do $$
declare v_cie uuid; v_client uuid; v_site uuid; v_eq uuid; v_vis uuid; e record;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Client 0464', v_cie) returning id into v_client;
  insert into public.sites (client_id, name, is_active, company_id) values (v_client, 'Site', true, v_cie) returning id into v_site;
  insert into public.itv_equipment (client_id, site_id, type_id, status, company_id, label_code)
  values (v_client, v_site, (select id from public.itv_equipment_types limit 1), 'en_service', v_cie, 'E0464') returning id into v_eq;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  insert into public.itv_visits (client_id, site_id, company_id, kind, status, started_at) values (v_client, v_site, v_cie, 'inventaire', 'en_cours', now()) returning id into v_vis;
  insert into public.itv_visit_items (visit_id, equipment_id, result, company_id) values (v_vis, v_eq, 'conforme', v_cie);
  perform public.itv_close_visit(v_vis);
  select * into e from public.itv_equipment where id = v_eq;
  if e.last_check_on is not null or e.next_check_on is not null then raise exception 'inventaire : dates posées %/%', e.last_check_on, e.next_check_on; end if;
  insert into public.itv_visits (client_id, site_id, company_id, status, started_at) values (v_client, v_site, v_cie, 'en_cours', now()) returning id into v_vis;
  insert into public.itv_visit_items (visit_id, equipment_id, result, company_id) values (v_vis, v_eq, 'conforme', v_cie);
  perform public.itv_close_visit(v_vis);
  select * into e from public.itv_equipment where id = v_eq;
  if e.last_check_on is null or e.next_check_on is null then raise exception 'vérification : dates absentes'; end if;
  raise warning 'ESSAI 0464 : OK';
end
$$;
rollback;
