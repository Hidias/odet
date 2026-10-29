-- Essai local de 0467 : devis de vente signé → livraison préparée, commande proposée, entrée au parc, pas de rappel facture.
begin;
set local client_min_messages = warning;
do $$
declare v_cie uuid; v_client uuid; v_sup uuid; v_ext uuid; v_bloc uuid; v_q uuid; v_vis uuid; v_n int; v_type uuid;
begin
  select id into v_cie from public.companies limit 1;
  select id into v_type from public.itv_equipment_types order by name limit 1;
  update public.org_modules set enabled = true where key = 'stock';
  insert into public.clients (name, address, city, company_id) values ('Client 0467', '1 rue du Port', 'Concarneau', v_cie) returning id into v_client;
  insert into public.suppliers (company_id, name) values (v_cie, 'Fournisseur 0467') returning id into v_sup;
  insert into public.stock_items (company_id, label, unit, supplier_id, equipment_type_id, warranty_months) values (v_cie, 'Extincteur essai 0467', 'u', v_sup, v_type, 24) returning id into v_ext;
  insert into public.stock_items (company_id, label, unit) values (v_cie, 'Panneau essai 0467', 'u') returning id into v_bloc;
  insert into public.quotes (reference, client_id, company_id, status, metier, quote_date) values ('DEV-ESSAI-0467', v_client, v_cie, 'sent', 'vente', current_date) returning id into v_q;
  insert into public.quote_items (quote_id, company_id, position, description_title, quantity, unit_price_ht, stock_item_id) values
    (v_q, v_cie, 0, 'Extincteur 6 L', 3, 60, v_ext), (v_q, v_cie, 1, 'Panneau', 2, 5, v_bloc);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  update public.quotes set status = 'accepted' where id = v_q;

  select id into v_vis from public.itv_visits where quote_id = v_q and kind = 'livraison';
  if v_vis is null then raise exception 'livraison non préparée'; end if;
  select count(*) into v_n from public.itv_visit_parts where visit_id = v_vis;
  if v_n <> 2 then raise exception 'pièces : %', v_n; end if;
  if not exists (select 1 from public.sites where client_id = v_client and is_default) then raise exception 'site non créé'; end if;
  select count(*) into v_n from public.purchase_order_lines l join public.purchase_orders o on o.id = l.order_id where o.supplier_id = v_sup and l.item_id = v_ext and l.quantity = 3;
  if v_n <> 1 then raise exception 'commande proposée : %', v_n; end if;
  if not exists (select 1 from public.scheduled_actions where dedup_key = 'livraison_stock:' || v_vis and payload->>'texte' like '%aucun fournisseur%') then raise exception 'rappel stock absent'; end if;
  -- Une seule livraison par devis
  perform app.devis_prepare_livraison(v_q);
  select count(*) into v_n from public.itv_visits where quote_id = v_q;
  if v_n <> 1 then raise exception 'livraison en double'; end if;

  -- Fin de livraison : 3 extincteurs au parc avec garantie, pas les panneaux ; pas de rappel facture ; une seule fois
  update public.itv_visits set status = 'en_cours', started_at = now() where id = v_vis;
  update public.itv_visits set status = 'terminee', finished_at = now() where id = v_vis;
  select count(*) into v_n from public.itv_equipment where source_quote_id = v_q and warranty_until = (current_date + interval '24 months')::date and installed_on = current_date;
  if v_n <> 3 then raise exception 'parc : %', v_n; end if;
  if exists (select 1 from public.scheduled_actions where dedup_key = 'visite_facture:' || v_vis) then raise exception 'rappel facture en trop'; end if;
  raise warning 'ESSAI 0467 : OK';
end
$$;
rollback;
