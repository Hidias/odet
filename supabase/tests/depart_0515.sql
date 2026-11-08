-- Essai de 0515 : départ d'un salarié qui fait le ménage (bilan, enregistrement, nuit du lendemain, annulation).
-- Rouge sans 0515 (fonctions et colonnes absentes). Données d'essai créées ici (une société existante seulement),
-- tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_co2 uuid;
  v_rh uuid := 'd0515000-0000-4000-8000-000000000001';
  v_lec uuid := 'd0515000-0000-4000-8000-000000000002';
  v_sal uuid := 'd0515000-0000-4000-8000-000000000003';
  v_sal2 uuid := 'd0515000-0000-4000-8000-000000000004';
  v_sa uuid := 'd0515000-0000-4000-8000-000000000005';
  c_rh text; c_lec text;
  v_j date := current_date + 3;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_p5 uuid; v_p6 uuid;
  v_tr uuid; v_veh uuid; v_aff uuid; v_cp uuid; v_abs1 uuid; v_abs2 uuid; v_abs3 uuid;
  v_item uuid; v_cli uuid; v_site uuid; v_ses uuid; v_vis uuid; v_act uuid;
  b jsonb; r jsonb; v_n int;
begin
  select id into v_cie from public.companies order by created_at limit 1;
  insert into public.companies (legal_name) values ('Société essai 0515') returning id into v_co2;

  -- Comptes : RH (administrateur de la société), lecture seule, deux salariés, un super administrateur
  insert into auth.users (id, email, aud, role) values
    (v_rh, 'rh-0515@exemple.invalid', 'authenticated', 'authenticated'),
    (v_lec, 'lec-0515@exemple.invalid', 'authenticated', 'authenticated'),
    (v_sal, 'sal-0515@exemple.invalid', 'authenticated', 'authenticated'),
    (v_sal2, 'sal2-0515@exemple.invalid', 'authenticated', 'authenticated'),
    (v_sa, 'sa-0515@exemple.invalid', 'authenticated', 'authenticated');
  insert into public.profiles (id, email) values (v_rh, 'rh-0515@exemple.invalid'), (v_lec, 'lec-0515@exemple.invalid'),
    (v_sal, 'sal-0515@exemple.invalid'), (v_sal2, 'sal2-0515@exemple.invalid'), (v_sa, 'sa-0515@exemple.invalid')
  on conflict (id) do nothing;
  alter table public.profiles disable trigger profiles_protect_role;
  update public.profiles set role = 'superadmin' where id = v_sa;
  alter table public.profiles enable trigger profiles_protect_role;
  insert into public.company_members (company_id, profile_id, role, is_default, is_active) values
    (v_cie, v_rh, 'admin', true, true), (v_cie, v_lec, 'lecture', true, true), (v_cie, v_sal, 'gestionnaire', true, true),
    (v_cie, v_sal2, 'gestionnaire', true, true), (v_co2, v_sal2, 'gestionnaire', false, true)
  on conflict (company_id, profile_id) do update set role = excluded.role, is_active = true;
  -- Droit posé explicitement (indépendant des profils de droits de la société) ; retiré au compte lecture
  alter table public.company_member_rights disable trigger company_member_rights_guard;
  insert into public.company_member_rights (company_id, member_id, right_code, effect)
    select v_cie, m.id, 'rh.dossiers.gerer', case when m.profile_id = v_rh then 'grant' else 'revoke' end
    from public.company_members m where m.company_id = v_cie and m.profile_id in (v_rh, v_lec);
  alter table public.company_member_rights enable trigger company_member_rights_guard;
  if not ('rh.dossiers.gerer' = any (app.rights_for(v_rh, v_cie))) then raise exception '0. compte RH sans droit rh.dossiers.gerer'; end if;
  if 'rh.dossiers.gerer' = any (app.rights_for(v_lec, v_cie)) then raise exception '0. compte lecture avec droit'; end if;
  c_rh := json_build_object('sub', v_rh, 'role', 'authenticated')::text;
  c_lec := json_build_object('sub', v_lec, 'role', 'authenticated')::text;

  -- Personne 1 : contrat, véhicule, absences, EPI, session comme formatrice, visite, action ouverte
  insert into public.trainers (first_name, last_name, company_id) values ('Alice', 'Formatrice0515', v_cie) returning id into v_tr;
  insert into public.hr_people (company_id, first_name, last_name, profile_id, trainer_id)
    values (v_cie, 'Alice', 'Depart0515', v_sal, v_tr) returning id into v_p1;
  insert into public.hr_employments (company_id, person_id, contract_type, start_on) values (v_cie, v_p1, 'cdi', current_date - 400);
  insert into public.vehicles (company_id, plate, brand, model) values (v_cie, 'AA-515-AA', 'Renault', 'Kangoo') returning id into v_veh;
  alter table public.vehicle_assignments disable trigger vehicle_assignments_permis;
  insert into public.vehicle_assignments (company_id, vehicle_id, person_id, start_on) values (v_cie, v_veh, v_p1, current_date - 30) returning id into v_aff;
  alter table public.vehicle_assignments enable trigger vehicle_assignments_permis;
  select id into v_cp from public.hr_absence_types where company_id = v_cie and counts_balance and is_active order by position limit 1;
  insert into public.hr_absence_requests (company_id, person_id, type_id, start_on, end_on, days, status)
    values (v_cie, v_p1, v_cp, v_j + 5, v_j + 6, 2, 'demandee') returning id into v_abs1;
  perform app.hr_absence_appliquer(v_abs1, 'validee', null, null);
  insert into public.hr_absence_requests (company_id, person_id, type_id, start_on, end_on, days, status)
    values (v_cie, v_p1, v_cp, v_j + 10, v_j + 10, 1, 'demandee') returning id into v_abs2;
  insert into public.hr_absence_requests (company_id, person_id, type_id, start_on, end_on, days, status)
    values (v_cie, v_p1, v_cp, v_j - 1, v_j + 2, 4, 'demandee') returning id into v_abs3;
  perform app.hr_absence_appliquer(v_abs3, 'validee', null, null);
  insert into public.stock_items (company_id, label, ppe) values (v_cie, 'Casque essai 0515', true) returning id into v_item;
  alter table public.hr_ppe_handovers disable trigger user;
  insert into public.hr_ppe_handovers (company_id, person_id, item_id, size, handed_on) values (v_cie, v_p1, v_item, 'M', current_date - 100);
  insert into public.hr_ppe_handovers (company_id, person_id, item_id, handed_on, returned_on) values (v_cie, v_p1, v_item, current_date - 200, current_date - 150);
  alter table public.hr_ppe_handovers enable trigger user;
  insert into public.sessions (reference, start_date, end_date, attendance_token, company_id, trainer_id)
    values ('ESSAI-0515-A', v_j + 10, v_j + 11, 'jeton-0515a', v_cie, v_tr) returning id into v_ses;
  insert into public.sessions (reference, start_date, end_date, attendance_token, company_id, trainer_id)
    values ('ESSAI-0515-PASSEE', current_date - 20, current_date - 20, 'jeton-0515p', v_cie, v_tr);
  insert into public.clients (name, client_type, company_id) values ('Client essai 0515', 'entreprise', v_cie) returning id into v_cli;
  insert into public.sites (name, client_id, company_id) values ('Site essai 0515', v_cli, v_cie) returning id into v_site;
  insert into public.itv_visits (client_id, site_id, technician_id, planned_on, status, company_id)
    values (v_cli, v_site, v_sal, v_j + 4, 'planifiee', v_cie) returning id into v_vis;
  insert into public.itv_visits (client_id, site_id, technician_id, planned_on, status, company_id)
    values (v_cli, v_site, v_sal, v_j - 2, 'terminee', v_cie);
  -- Visite prévue avant le départ : la personne la fait encore, rien à signaler
  insert into public.itv_visits (client_id, site_id, technician_id, planned_on, status, company_id)
    values (v_cli, v_site, v_sal, v_j - 1, 'planifiee', v_cie);
  insert into public.team_actions (company_id, title, owner_id) values (v_cie, 'Appeler le client essai 0515', v_sal) returning id into v_act;

  -- 1. Compte sans droit : bilan et enregistrement refusés
  perform set_config('request.jwt.claims', c_lec, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.rh_depart_bilan(v_p1, v_j);
    raise exception '1. bilan accepté sans droit';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.rh_enregistrer_depart(v_p1, v_j, 'Démission', '{}');
    raise exception '1b. départ accepté sans droit';
  exception when insufficient_privilege then null;
  end;

  -- 2. Bilan complet
  perform set_config('request.jwt.claims', c_rh, true);
  b := public.rh_depart_bilan(v_p1, v_j);
  if jsonb_array_length(b -> 'contrats') <> 1 or jsonb_array_length(b -> 'vehicules') <> 1
     or jsonb_array_length(b -> 'absences') <> 2 or jsonb_array_length(b -> 'absences_a_cheval') <> 1
     or jsonb_array_length(b -> 'epi') <> 1 or jsonb_array_length(b -> 'sessions') <> 1
     or jsonb_array_length(b -> 'visites') <> 1 or jsonb_array_length(b -> 'actions') <> 1
     or b -> 'compte' ->> 'etat' <> 'desactive' or (b ->> 'archivage_le')::date <> v_j + 1 or b ->> 'bloquant' is not null then
    raise exception '2. bilan faux : %', b; end if;

  -- 3. Colonnes du départ et actions « départ » refusées en direct
  begin
    update public.hr_people set departure_on = v_j where id = v_p1;
    raise exception '3. départ écrit en direct';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.team_actions (company_id, title, source) values (v_cie, 'Fausse action de départ', 'depart');
    raise exception '3b. action de départ créée en direct';
  exception when insufficient_privilege then null;
  end;
  -- Motif obligatoire
  begin
    perform public.rh_enregistrer_depart(v_p1, v_j, ' ', '{}');
    raise exception '3c. motif vide accepté';
  exception when invalid_parameter_value then null;
  end;

  -- 4. Enregistrement
  r := public.rh_enregistrer_depart(v_p1, v_j, 'Démission', '{}');
  if (r -> 'fait' ->> 'contrats')::int <> 1 or (r -> 'fait' ->> 'vehicules')::int <> 1 or (r -> 'fait' ->> 'absences')::int <> 2
     or (r -> 'fait' ->> 'actions')::int <> 5 or (r ->> 'archivage_le')::date <> v_j + 1 then raise exception '4. résultat faux : %', r; end if;
  perform set_config('role', 'postgres', true);
  if not exists (select 1 from public.hr_employments where person_id = v_p1 and end_on = v_j and end_reason = 'Démission') then raise exception '4b. contrat non clos'; end if;
  if (select end_on from public.vehicle_assignments where id = v_aff) is distinct from v_j then raise exception '4c. véhicule non clos'; end if;
  if (select count(*) from public.hr_absence_requests where id in (v_abs1, v_abs2) and status = 'annulee') <> 2 then raise exception '4d. absences non annulées'; end if;
  if (select status from public.hr_absence_requests where id = v_abs3) <> 'validee' then raise exception '4e. absence à cheval modifiée'; end if;
  if not exists (select 1 from public.hr_leave_ledger where request_id = v_abs1 and kind = 'annulation' and days = 2) then raise exception '4f. solde non rendu'; end if;
  if (select count(*) from public.team_actions where source = 'depart' and source_id = v_p1 and owner_id = v_rh and due_on = v_j) <> 5 then
    raise exception '4g. actions fausses'; end if;
  if not exists (select 1 from public.team_actions where source = 'depart' and source_id = v_p1 and title like 'EPI à récupérer%' and detail like '%Casque essai 0515 (taille M)%') then
    raise exception '4h. action EPI fausse'; end if;
  if (select status from public.team_actions where id = v_act) <> 'a_faire' or (select owner_id from public.team_actions where id = v_act) <> v_sal then
    raise exception '4i. action ouverte réaffectée'; end if;
  if (select technician_id from public.itv_visits where id = v_vis) <> v_sal then raise exception '4j. visite réaffectée'; end if;
  if not exists (select 1 from public.hr_people where id = v_p1 and departure_on = v_j and departure_reason = 'Démission' and departure_auto
                 and departure_by = v_rh and departure_applied_at is null and archived_at is null) then raise exception '4k. fiche fausse'; end if;

  -- 5. Second enregistrement le même jour : aucune action en double
  perform set_config('role', 'authenticated', true);
  r := public.rh_enregistrer_depart(v_p1, v_j, 'Démission', '{}');
  perform set_config('role', 'postgres', true);
  if (select count(*) from public.team_actions where source = 'depart' and source_id = v_p1) <> 5 then raise exception '5. actions en double'; end if;

  -- 6. Nuit avant le lendemain : rien
  perform set_config('request.jwt.claims', '', true);
  r := public.rh_departs_appliquer();
  if exists (select 1 from public.hr_people where id = v_p1 and (archived_at is not null or departure_applied_at is not null)) then raise exception '6. archivée trop tôt'; end if;
  -- Le lendemain : fiche archivée, compte coupé, une seule fois
  update public.hr_people set departure_on = current_date - 1 where id = v_p1;
  r := public.rh_departs_appliquer();
  if not exists (select 1 from public.hr_people where id = v_p1 and archived_at is not null and departure_applied_at is not null) then raise exception '6b. fiche non archivée'; end if;
  if (select is_active from public.profiles where id = v_sal) then raise exception '6c. compte non coupé'; end if;
  update public.hr_people set archived_at = null where id = v_p1;
  update public.profiles set is_active = true where id = v_sal;
  r := public.rh_departs_appliquer();
  if (select archived_at from public.hr_people where id = v_p1) is not null or not (select is_active from public.profiles where id = v_sal) then
    raise exception '6d. départ traité deux fois'; end if;

  -- 7. Compte actif dans une autre société : seule l'appartenance à cette société est coupée
  insert into public.hr_people (company_id, first_name, last_name, profile_id) values (v_cie, 'Bruno', 'Deuxsocietes0515', v_sal2) returning id into v_p2;
  perform set_config('request.jwt.claims', c_rh, true);
  perform set_config('role', 'authenticated', true);
  b := public.rh_depart_bilan(v_p2, v_j);
  if b -> 'compte' ->> 'etat' <> 'societe' then raise exception '7. compte multi-sociétés : %', b -> 'compte'; end if;
  perform public.rh_enregistrer_depart(v_p2, v_j, 'Mutation', '{}');
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  update public.hr_people set departure_on = current_date - 1 where id = v_p2;
  perform public.rh_departs_appliquer();
  if not (select is_active from public.profiles where id = v_sal2) then raise exception '7b. compte entier coupé'; end if;
  if (select is_active from public.company_members where profile_id = v_sal2 and company_id = v_cie) then raise exception '7c. appartenance non coupée'; end if;
  if not (select is_active from public.company_members where profile_id = v_sal2 and company_id = v_co2) then raise exception '7d. autre société coupée'; end if;

  -- 8. Super administrateur : jamais coupé, une action le signale
  insert into public.hr_people (company_id, first_name, last_name, profile_id) values (v_cie, 'Carla', 'Superadmin0515', v_sa) returning id into v_p3;
  perform set_config('request.jwt.claims', c_rh, true);
  perform set_config('role', 'authenticated', true);
  perform public.rh_enregistrer_depart(v_p3, v_j, 'Retraite', '{}');
  perform set_config('role', 'postgres', true);
  if not exists (select 1 from public.team_actions where source = 'depart' and source_id = v_p3 and title like 'Compte à couper à la main%') then
    raise exception '8. action super administrateur absente'; end if;
  perform set_config('request.jwt.claims', '', true);
  update public.hr_people set departure_on = current_date - 1 where id = v_p3;
  perform public.rh_departs_appliquer();
  if not (select is_active from public.profiles where id = v_sa) then raise exception '8b. super administrateur coupé'; end if;
  if (select archived_at from public.hr_people where id = v_p3) is null then raise exception '8c. fiche du super administrateur non archivée'; end if;

  -- 9. Cases décochées : rien fait sauf le contrat ; sans archivage, la nuit ne touche à rien
  insert into public.hr_people (company_id, first_name, last_name) values (v_cie, 'Denis', 'Sansarchive0515') returning id into v_p4;
  insert into public.hr_employments (company_id, person_id, contract_type, start_on) values (v_cie, v_p4, 'cdd', current_date - 50);
  insert into public.hr_ppe_handovers (company_id, person_id, item_id, handed_on) select v_cie, v_p4, v_item, current_date - 10
    where false;
  perform set_config('request.jwt.claims', c_rh, true);
  perform set_config('role', 'authenticated', true);
  r := public.rh_enregistrer_depart(v_p4, v_j, 'Fin de CDD', '{"vehicules": false, "absences": false, "actions": false, "archiver": false}');
  perform set_config('role', 'postgres', true);
  if r -> 'fait' ? 'actions' or r ->> 'archivage_le' is not null then raise exception '9. cases ignorées : %', r; end if;
  perform set_config('request.jwt.claims', '', true);
  update public.hr_people set departure_on = current_date - 1 where id = v_p4;
  perform public.rh_departs_appliquer();
  if exists (select 1 from public.hr_people where id = v_p4 and archived_at is not null) then raise exception '9b. archivée sans accord'; end if;

  -- 10. Annulation avant la nuit ; plus rien à annuler ensuite ; fiche archivée refusée
  insert into public.hr_people (company_id, first_name, last_name) values (v_cie, 'Emma', 'Annule0515') returning id into v_p5;
  perform set_config('request.jwt.claims', c_rh, true);
  perform set_config('role', 'authenticated', true);
  perform public.rh_enregistrer_depart(v_p5, v_j, 'Démission', '{}');
  perform public.rh_annuler_depart(v_p5);
  if exists (select 1 from public.hr_people where id = v_p5 and departure_on is not null) then raise exception '10. départ non annulé'; end if;
  begin
    perform public.rh_annuler_depart(v_p5);
    raise exception '10b. annulation sans départ acceptée';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.rh_enregistrer_depart(v_p3, v_j, 'Démission', '{}');
    raise exception '10c. fiche archivée acceptée';
  exception when invalid_parameter_value then null;
  end;

  -- 11. Contrat qui commence après la date de départ : bloquant
  insert into public.hr_people (company_id, first_name, last_name) values (v_cie, 'Fabien', 'Futur0515') returning id into v_p6;
  perform set_config('role', 'postgres', true);
  insert into public.hr_employments (company_id, person_id, contract_type, start_on) values (v_cie, v_p6, 'cdi', v_j + 20);
  perform set_config('role', 'authenticated', true);
  b := public.rh_depart_bilan(v_p6, v_j);
  if b ->> 'bloquant' is null then raise exception '11. contrat futur non bloquant'; end if;
  begin
    perform public.rh_enregistrer_depart(v_p6, v_j, 'Démission', '{}');
    raise exception '11b. départ accepté malgré un contrat futur';
  exception when invalid_parameter_value then null;
  end;

  -- 12. La nuit est réservée à la tâche planifiée
  begin
    perform public.rh_departs_appliquer();
    raise exception '12. nuit lancée par un compte';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

rollback;
