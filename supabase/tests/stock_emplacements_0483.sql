-- Essai local de 0483 : emplacement inactif ignoré par les alertes et la commande depuis les alertes (négatif toujours
-- signalé) ; emplacement technicien inactif réactivé au lieu d'un doublon, seulement pour un technicien actif.
begin;
set local client_min_messages = warning;
do $$
declare
  v_cie uuid; v_fou uuid; v_art uuid; v_actif uuid; v_ferme uuid; v_tech uuid; v_id uuid; v_cmd uuid; v_q numeric; v_n int;
  v_msg text;
  v_sa text := '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
  v_prof uuid := '00000000-0000-4000-8000-000000000013';
begin
  select id into v_cie from public.companies limit 1;
  insert into public.suppliers (company_id, name) values (v_cie, 'Fournisseur 0483') returning id into v_fou;
  insert into public.stock_items (company_id, label, supplier_id) values (v_cie, 'Article 0483', v_fou) returning id into v_art;
  insert into public.stock_locations (company_id, kind, name) values (v_cie, 'depot', 'Dépôt 0483') returning id into v_actif;
  insert into public.stock_locations (company_id, kind, name) values (v_cie, 'depot', 'Dépôt fermé 0483') returning id into v_ferme;
  insert into public.stock_thresholds (company_id, item_id, location_id, min_qty, target_qty) values
    (v_cie, v_art, v_actif, 2, 5), (v_cie, v_art, v_ferme, 3, 10);

  -- 1. Deux emplacements actifs : deux alertes, 15 à commander
  select count(*), sum(to_order) into v_n, v_q from public.v_stock_alerts where item_id = v_art;
  if v_n <> 2 or v_q <> 15 then raise exception '1. % alertes, % à commander (2 et 15 attendus)', v_n, v_q; end if;

  -- 2. Emplacement fermé : une seule alerte, commande de 5 seulement ; même résultat lu par un compte connecté
  update public.stock_locations set is_active = false where id = v_ferme;
  select count(*), sum(to_order) into v_n, v_q from public.v_stock_alerts where item_id = v_art;
  if v_n <> 1 or v_q <> 5 then raise exception '2. % alertes, % à commander (1 et 5 attendus)', v_n, v_q; end if;
  perform set_config('request.jwt.claims', v_sa, true);
  perform set_config('role', 'authenticated', true);
  select count(*), sum(to_order) into v_n, v_q from public.v_stock_alerts where item_id = v_art;
  perform set_config('role', 'postgres', true);
  if v_n <> 1 or v_q <> 5 then raise exception '2. lu connecté : % alertes, % à commander (1 et 5 attendus)', v_n, v_q; end if;
  v_cmd := public.stock_commande_depuis_alertes(v_fou, null);
  select sum(quantity) into v_q from public.purchase_order_lines where order_id = v_cmd;
  if v_q <> 5 then raise exception '2. commande de % (5 attendu)', v_q; end if;

  -- 3. Seul l'emplacement fermé est sous le seuil : rien à commander, ni en le désignant
  insert into public.stock_movements (company_id, kind, item_id, quantity, to_location_id) values (v_cie, 'entree', v_art, 5, v_actif);
  v_msg := null;
  begin perform public.stock_commande_depuis_alertes(v_fou, null);
  exception when others then v_msg := sqlerrm; end;
  if v_msg is distinct from 'Aucun article de ce fournisseur sous le seuil' then raise exception '3. % (refus attendu)', coalesce(v_msg, 'commande préparée'); end if;
  v_msg := null;
  begin perform public.stock_commande_depuis_alertes(v_fou, v_ferme);
  exception when others then v_msg := sqlerrm; end;
  if v_msg is null then raise exception '3. commande préparée pour l''emplacement fermé désigné'; end if;

  -- 4. Négatif sur l'emplacement fermé : toujours signalé, jamais commandé
  insert into public.stock_movements (company_id, kind, item_id, quantity, from_location_id) values (v_cie, 'sortie', v_art, 1, v_ferme);
  if not exists (select 1 from public.v_stock_alerts where item_id = v_art and location_id = v_ferme and quantity = -1) then
    raise exception '4. négatif sur emplacement fermé non signalé'; end if;
  v_msg := null;
  begin perform public.stock_commande_depuis_alertes(v_fou, null);
  exception when others then v_msg := sqlerrm; end;
  if v_msg is distinct from 'Aucun article de ce fournisseur sous le seuil' then raise exception '4. % (refus attendu)', coalesce(v_msg, 'commande préparée'); end if;

  -- 5. Camion d'un technicien parti (compte inactif) : renvoyé inactif, pas réactivé (écritures du système)
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set is_active = false where id = v_prof;
  v_tech := app.stock_camion(v_cie, v_prof, true);
  update public.stock_locations set is_active = false where id = v_tech;
  v_id := app.stock_camion(v_cie, v_prof, true);
  if v_id is distinct from v_tech then raise exception '5. autre emplacement renvoyé'; end if;
  if (select is_active from public.stock_locations where id = v_tech) then raise exception '5. camion d''un technicien parti réactivé'; end if;

  -- 6. Technicien actif : camion réactivé, pas de doublon ; sans création demandée, rien ne change
  update public.profiles set is_active = true where id = v_prof;
  insert into public.itv_technicians (profile_id, company_id, is_active) values (v_prof, v_cie, true)
  on conflict (profile_id) do update set is_active = true, company_id = excluded.company_id;
  update public.stock_locations set is_active = false where id = v_tech;
  if app.stock_camion(v_cie, v_prof, false) is distinct from v_tech then raise exception '6. sans création, autre emplacement'; end if;
  if (select is_active from public.stock_locations where id = v_tech) then raise exception '6. réactivé sans création demandée'; end if;
  v_id := app.stock_camion(v_cie, v_prof, true);
  if v_id is distinct from v_tech or not (select is_active from public.stock_locations where id = v_tech) then raise exception '6. camion non réactivé'; end if;

  -- 7. « Mon stock » de la personne connectée avec un emplacement inactif : réactivé, pas d'erreur de doublon
  update public.stock_locations set is_active = false where id = v_tech;
  perform set_config('request.jwt.claims', json_build_object('sub', v_prof, 'role', 'authenticated')::text, true);
  if app.current_company() is distinct from v_cie then
    update public.stock_locations set company_id = app.current_company() where id = v_tech;
  end if;
  if app.stock_mon_emplacement(false) is not null then raise exception '7. emplacement inactif renvoyé sans création'; end if;
  v_id := app.stock_mon_emplacement(true);
  if v_id is distinct from v_tech then raise exception '7. doublon créé (%, attendu %)', v_id, v_tech; end if;
  if not (select is_active from public.stock_locations where id = v_tech) then raise exception '7. non réactivé'; end if;
  select count(*) into v_n from public.stock_locations where profile_id = v_prof and kind = 'technicien';
  if v_n <> 1 then raise exception '7. % emplacements technicien', v_n; end if;
  raise warning 'ESSAI 0483 : OK';
end
$$;
rollback;
