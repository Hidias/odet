-- Essai local de 0468 : sortie du dépôt sans technicien, stock déjà promis aux autres livraisons.
begin;
set local client_min_messages = warning;
do $$
declare v_cie uuid; v_client uuid; v_sup uuid; v_it uuid; v_dep uuid; v_q1 uuid; v_q2 uuid; v_v1 uuid; v_v2 uuid; v_n numeric;
begin
  select id into v_cie from public.companies limit 1;
  update public.org_modules set enabled = true where key = 'stock';
  insert into public.clients (name, company_id) values ('Client 0468', v_cie) returning id into v_client;
  insert into public.suppliers (company_id, name) values (v_cie, 'Fournisseur 0468') returning id into v_sup;
  insert into public.stock_items (company_id, label, unit, supplier_id) values (v_cie, 'Bloc essai 0468', 'u', v_sup) returning id into v_it;
  insert into public.stock_locations (company_id, kind, name, created_at) values (v_cie, 'depot', 'Dépôt essai 0468', now() - interval '100 years') returning id into v_dep;
  insert into public.stock_movements (company_id, kind, item_id, quantity, to_location_id) values (v_cie, 'entree', v_it, 8, v_dep);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  insert into public.quotes (reference, client_id, company_id, status, metier, quote_date) values ('DEV-0468-1', v_client, v_cie, 'sent', 'vente', current_date) returning id into v_q1;
  insert into public.quote_items (quote_id, company_id, position, description_title, quantity, unit_price_ht, stock_item_id) values (v_q1, v_cie, 0, 'Bloc', 8, 10, v_it);
  insert into public.quotes (reference, client_id, company_id, status, metier, quote_date) values ('DEV-0468-2', v_client, v_cie, 'sent', 'vente', current_date) returning id into v_q2;
  insert into public.quote_items (quote_id, company_id, position, description_title, quantity, unit_price_ht, stock_item_id) values (v_q2, v_cie, 0, 'Bloc', 8, 10, v_it);
  update public.quotes set status = 'accepted' where id = v_q1;
  update public.quotes set status = 'accepted' where id = v_q2;
  select id into v_v1 from public.itv_visits where quote_id = v_q1;
  select id into v_v2 from public.itv_visits where quote_id = v_q2;
  if exists (select 1 from public.scheduled_actions where dedup_key = 'livraison_stock:' || v_v1) then raise exception '1re livraison : manque signalé à tort'; end if;
  if not exists (select 1 from public.scheduled_actions where dedup_key = 'livraison_stock:' || v_v2) then raise exception '2e livraison : manque non vu'; end if;
  select sum(l.quantity) into v_n from public.purchase_order_lines l where l.item_id = v_it;
  if v_n <> 8 then raise exception 'commande proposée : %', v_n; end if;
  -- Clôture sans technicien : sortie du dépôt
  update public.itv_visits set status = 'en_cours', started_at = now() where id = v_v1;
  update public.itv_visits set status = 'terminee', finished_at = now() where id = v_v1;
  if not exists (select 1 from public.stock_movements where item_id = v_it and kind = 'sortie' and from_location_id = v_dep and quantity = 8) then raise exception 'pas de sortie du dépôt'; end if;
  raise warning 'ESSAI 0468 : OK';
end
$$;
rollback;
