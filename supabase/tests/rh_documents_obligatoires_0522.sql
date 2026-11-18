-- Essai de 0522 : travail isolé, accueil sécurité, affichages obligatoires.
-- Rouge sans 0522 (tables et colonnes absentes). Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_p uuid; v_q uuid; v_job uuid; v_job2 uuid; v_e uuid; v_eq uuid; v_i uuid; v_n int; v_lab text;
  v_item uuid; v_loc uuid;
begin
  select id into v_cie from public.companies order by created_at limit 1;
  insert into public.hr_people (company_id, first_name, last_name) values (v_cie, 'Essai', 'ACCUEIL 0522') returning id into v_p;
  insert into public.hr_people (company_id, first_name, last_name) values (v_cie, 'Essai', 'ISOLE 0522') returning id into v_q;
  insert into public.hr_jobs (company_id, name) values (v_cie, 'Poste essai 0522') returning id into v_job;
  insert into public.hr_jobs (company_id, name, lone_work) values (v_cie, 'Poste seul essai 0522', true) returning id into v_job2;

  -- 1. Affichages : code hors référentiel refusé
  begin
    insert into public.hr_postings (company_id, item_code, status, done_on) values (v_cie, 'inconnu', 'fait', current_date);
    raise exception 'Essai 0522 : code d''affichage inconnu accepté';
  exception when check_violation then null;
  end;

  -- 2. Contrat en cours sans accueil : échéance « Accueil sécurité » à la date de début
  insert into public.hr_employments (company_id, person_id, contract_type, start_on, job_id)
    values (v_cie, v_p, 'cdi', current_date - 3, v_job) returning id into v_e;
  select count(*) into v_n from public.v_hr_echeances where kind = 'accueil_securite' and source_id = v_e and due_on = current_date - 3;
  if v_n <> 1 then raise exception 'Essai 0522 : échéance d''accueil sécurité attendue (% trouvée)', v_n; end if;

  -- 3. Liste d'arrivée ouverte : la ligne du modèle est là et se coche seule à la signature
  if not exists (select 1 from public.hr_checklist_templates where company_id = v_cie and kind = 'arrivee' and label = 'Accueil sécurité fait') then
    raise exception 'Essai 0522 : ligne « Accueil sécurité fait » absente du modèle';
  end if;
  insert into public.hr_checklists (company_id, person_id, kind, items)
    values (v_cie, v_p, 'arrivee', '[{"label":"Contrat signé et rangé dans les documents","done_on":null,"done_by":null},{"label":"Accueil sécurité fait","done_on":null,"done_by":null}]');

  -- Fiche non signée : pas de date de signature, l'échéance reste
  insert into public.hr_safety_inductions (person_id, done_on, topics)
    values (v_p, current_date, '[{"label":"Conditions de circulation dans l''entreprise","done":true}]') returning id into v_i;
  if (select signed_at from public.hr_safety_inductions where id = v_i) is not null then raise exception 'Essai 0522 : signée sans signature'; end if;
  if (select company_id from public.hr_safety_inductions where id = v_i) <> v_cie then raise exception 'Essai 0522 : société non reprise de la personne'; end if;
  if not exists (select 1 from public.v_hr_echeances where kind = 'accueil_securite' and source_id = v_e) then
    raise exception 'Essai 0522 : échéance disparue sans signature';
  end if;

  -- Signature : date posée, poste noté, échéance levée, ligne cochée
  update public.hr_safety_inductions set employee_signature = 'data:image/png;base64,AAAA' where id = v_i;
  if (select signed_at from public.hr_safety_inductions where id = v_i) is null then raise exception 'Essai 0522 : signature non datée'; end if;
  if (select job_id from public.hr_safety_inductions where id = v_i) is distinct from v_job then raise exception 'Essai 0522 : poste non noté à la signature'; end if;
  if exists (select 1 from public.v_hr_echeances where kind = 'accueil_securite' and source_id = v_e) then
    raise exception 'Essai 0522 : échéance encore là après la signature';
  end if;
  select x->>'done_on' into v_lab from public.hr_checklists l, jsonb_array_elements(l.items) x
   where l.person_id = v_p and l.kind = 'arrivee' and x->>'label' = 'Accueil sécurité fait';
  if v_lab is null or v_lab::date <> current_date then raise exception 'Essai 0522 : ligne de la liste d''arrivée non cochée (%)', v_lab; end if;
  select x->>'done_on' into v_lab from public.hr_checklists l, jsonb_array_elements(l.items) x
   where l.person_id = v_p and l.kind = 'arrivee' and x->>'label' = 'Contrat signé et rangé dans les documents';
  if v_lab is not null then raise exception 'Essai 0522 : une autre ligne de la liste a été cochée'; end if;

  -- Fiche signée figée (sauf les notes)
  update public.hr_safety_inductions set notes = 'Note après signature' where id = v_i;
  begin
    update public.hr_safety_inductions set topics = '[]' where id = v_i;
    raise exception 'Essai 0522 : fiche signée modifiée';
  exception when invalid_parameter_value then null;
  end;

  -- 4. Changement de poste : l'accueil est à refaire
  update public.hr_employments set job_id = v_job2 where id = v_e;
  select label into v_lab from public.v_hr_echeances where kind = 'accueil_securite' and source_id = v_e;
  if v_lab is distinct from 'Accueil sécurité à refaire (changement de poste)' then raise exception 'Essai 0522 : changement de poste non repéré (%)', v_lab; end if;

  -- 5. Travail isolé : poste « seul » sans mesure, puis DATI exigé et non remis, puis remis
  insert into public.hr_employments (company_id, person_id, contract_type, start_on, job_id)
    values (v_cie, v_q, 'cdi', current_date - 1, v_job2) returning id into v_eq;
  select label into v_lab from public.v_hr_echeances where kind = 'travail_isole' and source_id = v_eq;
  if v_lab is distinct from 'Travail isolé : aucune mesure sur le poste Poste seul essai 0522' then raise exception 'Essai 0522 : poste seul sans mesure non signalé (%)', v_lab; end if;
  update public.hr_jobs set lone_work_measures = array['appel_controle'] where id = v_job2;
  if exists (select 1 from public.v_hr_echeances where kind = 'travail_isole' and source_id = v_eq) then
    raise exception 'Essai 0522 : alerte de travail isolé avec une mesure sans DATI';
  end if;
  update public.hr_jobs set lone_work_measures = array['dati', 'appel_controle'] where id = v_job2;
  select label into v_lab from public.v_hr_echeances where kind = 'travail_isole' and source_id = v_eq;
  if v_lab is distinct from 'Travail isolé : DATI à remettre' then raise exception 'Essai 0522 : DATI manquant non signalé (%)', v_lab; end if;
  insert into public.stock_items (company_id, label, ppe, dati) values (v_cie, 'DATI essai 0522', true, true) returning id into v_item;
  insert into public.hr_ppe_handovers (person_id, item_id) values (v_q, v_item);
  if exists (select 1 from public.v_hr_echeances where kind = 'travail_isole' and source_id = v_eq) then
    raise exception 'Essai 0522 : alerte DATI restée après la remise';
  end if;
  -- Mesure « autre » sans précision refusée ; mesure inconnue refusée
  begin
    update public.hr_jobs set lone_work_measures = array['autre'], lone_work_note = null where id = v_job2;
    raise exception 'Essai 0522 : mesure « autre » sans précision acceptée';
  exception when check_violation then null;
  end;
  begin
    update public.hr_jobs set lone_work_measures = array['inconnue'] where id = v_job2;
    raise exception 'Essai 0522 : mesure inconnue acceptée';
  exception when check_violation then null;
  end;

  -- 6. Affichages : « fait » exige une date ; « sans objet » exige un motif ; une ligne par code
  insert into public.hr_postings (company_id, item_code, status, done_on) values (v_cie, 'inspection_travail', 'fait', current_date);
  begin
    insert into public.hr_postings (company_id, item_code, status, done_on) values (v_cie, 'inspection_travail', 'fait', current_date);
    raise exception 'Essai 0522 : deux lignes pour le même affichage';
  exception when unique_violation then null;
  end;
  begin
    insert into public.hr_postings (company_id, item_code, status) values (v_cie, 'medecin_travail', 'fait');
    raise exception 'Essai 0522 : affichage « fait » sans date accepté';
  exception when check_violation then null;
  end;
  begin
    insert into public.hr_postings (company_id, item_code, status) values (v_cie, 'rupture_conventionnelle_collective', 'sans_objet');
    raise exception 'Essai 0522 : « sans objet » sans motif accepté';
  exception when check_violation then null;
  end;
  insert into public.hr_postings (company_id, item_code, status, note) values (v_cie, 'rupture_conventionnelle_collective', 'sans_objet', 'Aucune rupture conventionnelle collective');

  -- 7. Droits posés, vue aux droits du lecteur
  if (select count(*) from pg_policies where schemaname = 'public' and tablename in ('hr_safety_inductions', 'hr_postings')) <> 8 then
    raise exception 'Essai 0522 : règles d''accès inattendues';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.v_hr_echeances'::regclass and reloptions @> array['security_invoker=true']) then
    raise exception 'Essai 0522 : la vue des échéances doit rester aux droits du lecteur';
  end if;
  if has_table_privilege('anon', 'public.hr_safety_inductions', 'select') or has_table_privilege('anon', 'public.hr_postings', 'select') then
    raise exception 'Essai 0522 : droits de table trop larges';
  end if;
end $$;

rollback;
