-- Essai local de 0465 : délai promis, suivi des urgences, dates de vérification, facture à préparer.
begin;
set local client_min_messages = warning;
do $$
declare v_cie uuid; v_client uuid; v_site uuid; v_eq uuid; v_k uuid; v_vis uuid; v_r jsonb; e record; v_n int;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Client 0465', v_cie) returning id into v_client;
  insert into public.sites (client_id, name, is_active, company_id) values (v_client, 'Site', true, v_cie) returning id into v_site;
  insert into public.itv_equipment (client_id, site_id, type_id, status, company_id, label_code)
  values (v_client, v_site, (select id from public.itv_equipment_types limit 1), 'en_service', v_cie, 'E0465') returning id into v_eq;
  insert into public.itv_contracts (client_id, company_id, start_on, annual_price_ht, visit_months, status, billing_period, emergency_hours, includes)
  values (v_client, v_cie, current_date, 1200, array[3], 'actif', 'trimestriel', 48, '{"pieces": true}') returning id into v_k;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

  -- Urgence sans contrat posé sur l'intervention : le délai du contrat du client s'applique
  insert into public.itv_visits (client_id, site_id, company_id, kind, urgent, requested_at, status)
  values (v_client, v_site, v_cie, 'depannage', true, now() - interval '50 hours', 'planifiee') returning id into v_vis;
  if (select deadline_at from public.itv_visits where id = v_vis) <> (select requested_at + interval '48 hours' from public.itv_visits where id = v_vis) then raise exception 'délai non posé'; end if;
  v_r := public.contrat_urgences(v_k);
  if (v_r->>'urgences')::int <> 1 or (v_r->>'en_retard')::int <> 1 then raise exception 'suivi : %', v_r; end if;

  -- Dépannage clôturé : pas de date de vérification, rappel « facture à préparer »
  update public.itv_visits set status = 'en_cours', started_at = now() where id = v_vis;
  insert into public.itv_visit_items (visit_id, equipment_id, result, company_id) values (v_vis, v_eq, 'conforme', v_cie);
  perform public.itv_close_visit(v_vis);
  select * into e from public.itv_equipment where id = v_eq;
  if e.next_check_on is not null then raise exception 'dépannage : date posée'; end if;
  select count(*) into v_n from public.scheduled_actions where dedup_key = 'visite_facture:' || v_vis;
  if v_n <> 1 then raise exception 'rappel facture absent'; end if;

  -- Vérification sous échéancier, pièce comprise : rien à facturer ; dates posées
  insert into public.itv_visits (client_id, site_id, company_id, contract_id, status, started_at) values (v_client, v_site, v_cie, v_k, 'en_cours', now()) returning id into v_vis;
  insert into public.itv_visit_items (visit_id, equipment_id, result, company_id) values (v_vis, v_eq, 'conforme', v_cie);
  insert into public.itv_visit_parts (visit_id, label, quantity, unit_price_ht, company_id) values (v_vis, 'Joint', 1, 5, v_cie);
  perform public.itv_close_visit(v_vis);
  select count(*) into v_n from public.scheduled_actions where dedup_key = 'visite_facture:' || v_vis;
  if v_n <> 0 then raise exception 'vérification couverte : rappel en trop'; end if;
  if (select next_check_on from public.itv_equipment where id = v_eq) is null then raise exception 'vérification : date absente'; end if;
  raise warning 'ESSAI 0465 : OK';
end
$$;
rollback;
