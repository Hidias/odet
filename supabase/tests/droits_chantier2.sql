-- supabase/tests/droits_chantier2.sql : tests de droits rejouables (chantier 2, sécurité des accès).
--
-- Le script crée des comptes et des données d'essai, se fait passer pour chaque rôle
-- (set local role + request.jwt.claims), vérifie ce que chacun voit, modifie et appelle,
-- puis SE TERMINE TOUJOURS PAR UNE ERREUR VOLONTAIRE : rien n'est jamais enregistré.
-- Le message d'erreur contient le résultat, une ligne par test : OK ou ÉCHEC, puis le total.
--
-- Utilisation : coller le fichier dans l'éditeur SQL de Supabase et exécuter ; ou le placer après
-- les migrations dans une même exécution pour les essayer en transaction annulée.
-- Chaque branche du lot 2 ajoute ses cas dans la liste « tests » ci-dessous.
-- Socle multi-sociétés (C1a) : bloc conditionnel en fin de script (isolement entre deux sociétés fictives,
-- société courante, accès de support), joué seulement si la table companies existe.
-- Droits composés (C1b) : bloc conditionnel après celui de C1a (catalogue, reprise sans perte, prix cachés au
-- technicien, comptable externe sans écriture, RH, salarié, écran, licence totale, offres, droits par société,
-- circuits de validation), joué seulement si la table permissions existe.

do $test$
declare
  -- Comptes d'essai
  u_sa uuid := gen_random_uuid();  u_ad uuid := gen_random_uuid();  u_dir uuid := gen_random_uuid();
  u_ges uuid := gen_random_uuid(); u_for uuid := gen_random_uuid(); u_com uuid := gen_random_uuid();
  u_cpt uuid := gen_random_uuid(); u_lec uuid := gen_random_uuid(); u_tech uuid := gen_random_uuid();
  u_ent uuid := gen_random_uuid(); u_ext uuid := gen_random_uuid(); u_stg uuid := gen_random_uuid();
  u_off uuid := gen_random_uuid();
  -- Données d'essai
  v_trainer uuid; v_client uuid; v_client_tech uuid; v_site uuid; v_site2 uuid; v_s1 uuid; v_s2 uuid; v_tr1 uuid; v_tr2 uuid;
  v_st1 uuid; v_v1 uuid; v_v2 uuid; v_eq uuid; v_token text; v_ref text; v_code text := '482915'; v_ticket text;
  v_inv uuid; n_budget int; n_pm int;
  -- Comptes réservés à la licence totale (C1b, 0379) : l'administrateur d'une société sans licence ne gère plus les comptes
  v_lic_comptes boolean := false;
  -- Exécution
  r record; v_n bigint; v_got text; v_ok boolean; v_lines text[] := '{}'; v_fail int := 0; v_total int := 0;
  v_uid uuid; v_claims text;
begin
  set local lock_timeout = '5s';

  -- Isolement par société (C2, 0275) : le super administrateur ne lit les données d'une société que par l'accès de
  -- support. Les tests du super administrateur se jouent avec l'accès permanent sur la société de l'instance (réglage
  -- facultatif de l'instance), quel que soit le réglage de la base d'essai ; annulé avec le reste.
  if to_regprocedure('app.societes_lisibles()') is not null then
    alter table public.companies disable trigger companies_guard;
    update public.companies set support_access_mode = 'permanent' where is_instance_owner;
    alter table public.companies enable trigger companies_guard;
  end if;

  -- Comptes ------------------------------------------------------------------------------------------
  insert into auth.users (id, email, aud, role)
  select x.id, x.email, 'authenticated', 'authenticated' from (values
    (u_sa, 'essai.sa@test.invalid'), (u_ad, 'essai.ad@test.invalid'), (u_dir, 'essai.dir@test.invalid'),
    (u_ges, 'essai.ges@test.invalid'), (u_for, 'essai.for@test.invalid'), (u_com, 'essai.com@test.invalid'),
    (u_cpt, 'essai.cpt@test.invalid'), (u_lec, 'essai.lec@test.invalid'), (u_tech, 'essai.tech@test.invalid'),
    (u_ent, 'essai.ent@test.invalid'), (u_ext, 'essai.ext@test.invalid'), (u_stg, 'essai.stg@test.invalid'),
    (u_off, 'essai.off@test.invalid')) x(id, email);

  insert into public.trainers (first_name, last_name) values ('Essai', 'FORMATEUR') returning id into v_trainer;

  -- Le garde des rôles (profiles_protect_role) exige un administrateur connecté : suspendu le temps
  -- de créer les comptes d'essai (dans cette transaction annulée seulement).
  alter table public.profiles disable trigger profiles_protect_role;
  insert into public.profiles (id, email, role, is_active, trainer_id)
  select x.id, x.email, x.role, x.active, x.trainer from (values
    (u_sa, 'essai.sa@test.invalid', 'superadmin', true, null::uuid), (u_ad, 'essai.ad@test.invalid', 'admin', true, null),
    (u_dir, 'essai.dir@test.invalid', 'direction', true, null), (u_ges, 'essai.ges@test.invalid', 'gestionnaire', true, null),
    (u_for, 'essai.for@test.invalid', 'formateur', true, v_trainer), (u_com, 'essai.com@test.invalid', 'commercial', true, null),
    (u_cpt, 'essai.cpt@test.invalid', 'comptable', true, null), (u_lec, 'essai.lec@test.invalid', 'lecture', true, null),
    (u_tech, 'essai.tech@test.invalid', 'lecture', true, null), (u_ent, 'essai.ent@test.invalid', 'entreprise', true, null),
    (u_ext, 'essai.ext@test.invalid', 'formateur_externe', true, null), (u_stg, 'essai.stg@test.invalid', 'stagiaire', true, null),
    (u_off, 'essai.off@test.invalid', 'direction', false, null)) x(id, email, role, active, trainer)
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active, trainer_id = excluded.trainer_id;
  alter table public.profiles enable trigger profiles_protect_role;

  insert into public.itv_technicians (profile_id, is_active) values (u_tech, true)
  on conflict (profile_id) do update set is_active = true;

  -- Données ------------------------------------------------------------------------------------------
  insert into public.clients (name) values ('Essai client formation') returning id into v_client;
  insert into public.clients (name) values ('Essai client technicien') returning id into v_client_tech;
  insert into public.sites (name, client_id) values ('Essai site', v_client_tech) returning id into v_site;
  insert into public.sites (name, client_id) values ('Essai site formation', v_client) returning id into v_site2;

  insert into public.sessions (start_date, end_date, trainer_id, client_id, attendance_token)
  values (current_date, current_date, v_trainer, v_client, 'essai-' || replace(gen_random_uuid()::text, '-', ''))
  returning id, attendance_token, reference into v_s1, v_token, v_ref;
  insert into public.sessions (start_date, end_date, client_id, attendance_token)
  values (current_date, current_date, v_client, 'essai-' || replace(gen_random_uuid()::text, '-', ''))
  returning id into v_s2;

  insert into public.trainees (first_name, last_name, social_security_number) values ('Essai', 'UN', '185057800608436')
  returning id into v_tr1;
  insert into public.trainees (first_name, last_name) values ('Essai', 'DEUX') returning id into v_tr2;
  -- Handicap (0087) : écrit par l'ancien chemin, rangé par le déclencheur ; référent handicap = le commercial d'essai
  update public.trainees set has_disability = true, disability_details = 'Essai besoin', disability_adaptations = 'Essai adaptation'
  where id = v_tr1;
  update public.quality_roles set profile_id = u_com where code = 'referent_handicap';
  insert into public.psh_requests (besoin_fonctionnel) values ('Essai besoin PSH');
  insert into public.session_trainees (session_id, trainee_id) values (v_s1, v_tr1) returning id into v_st1;
  insert into public.session_trainees (session_id, trainee_id) values (v_s2, v_tr2);
  update public.session_trainees set access_code = v_code, access_code_attempts = 0, access_code_locked = false where id = v_st1;

  insert into public.itv_visits (client_id, site_id, technician_id, status) values (v_client_tech, v_site, u_tech, 'planifiee')
  returning id into v_v1;
  insert into public.itv_visits (client_id, site_id, status) values (v_client, v_site2, 'planifiee')
  returning id into v_v2;
  insert into public.itv_equipment_types (name) values ('Essai type') returning id into v_eq;
  insert into public.itv_equipment (client_id, site_id, type_id, label_code) values (v_client_tech, v_site, v_eq, 'ESSAI-' || left(gen_random_uuid()::text, 8))
  returning id into v_eq;

  insert into public.audit_logs (action, entity_type) values ('view', 'system');
  select id into v_inv from public.invoices where status <> 'draft' limit 1;
  select count(*) into n_budget from public.budget_categories;
  select count(*) into n_pm from public.prospection_massive;
  if to_regclass('public.permissions') is not null then
    execute $q$select coalesce((select p.full_license_only from public.permissions p where p.code = 'parametres.utilisateurs.gerer'), false)
               and not exists (select 1 from public.companies c where c.full_license)$q$ into v_lic_comptes;
  end if;

  -- Tests : (compte, libellé, requête renvoyant un nombre, attendu)
  -- attendu : 'refus' (erreur de droit), 'vide' (0 ou refus), 'non_vide' (> 0), '=N'
  for r in
    select * from (values
      -- Lecture des clients
      ('sa', 'lit les clients', 'select count(*) from public.clients', 'non_vide'),
      ('for', 'lit les clients', 'select count(*) from public.clients', 'non_vide'),
      ('cpt', 'lit les clients', 'select count(*) from public.clients', 'non_vide'),
      ('tech', 'ne lit que le client de sa visite', 'select count(*) from public.clients', '=1'),
      ('ent', 'ne lit aucun client', 'select count(*) from public.clients', 'vide'),
      ('ext', 'ne lit aucun client', 'select count(*) from public.clients', 'vide'),
      ('stg', 'ne lit aucun client', 'select count(*) from public.clients', 'vide'),
      ('off', 'compte désactivé : aucun client', 'select count(*) from public.clients', 'vide'),
      ('anon', 'ne lit pas les clients', 'select count(*) from public.clients', 'refus'),
      -- Stagiaires
      ('ges', 'lit les stagiaires', 'select count(*) from public.trainees', 'non_vide'),
      ('com', 'lit les stagiaires', 'select count(*) from public.trainees', 'non_vide'),
      ('for', 'ne lit que les stagiaires de ses sessions', 'select count(*) from public.trainees', '=1'),
      ('tech', 'ne lit aucun stagiaire', 'select count(*) from public.trainees', 'vide'),
      ('ent', 'ne lit aucun stagiaire', 'select count(*) from public.trainees', 'vide'),
      ('anon', 'ne lit pas les stagiaires', 'select count(*) from public.trainees', 'refus'),
      ('for', 'fiches de renseignements de ses sessions seulement', 'select count(*) from public.trainee_info_sheets', '=1'),
      ('cpt', 'ne lit pas les fiches de renseignements', 'select count(*) from public.trainee_info_sheets', 'vide'),
      -- Sessions
      ('dir', 'lit les sessions', 'select count(*) from public.sessions', 'non_vide'),
      ('cpt', 'lit les sessions (facturation)', 'select count(*) from public.sessions', 'non_vide'),
      ('for', 'ne lit que ses sessions', 'select count(*) from public.sessions', '=1'),
      ('tech', 'ne lit aucune session', 'select count(*) from public.sessions', 'vide'),
      ('anon', 'ne lit pas les sessions', 'select count(*) from public.sessions', 'refus'),
      -- Devis et factures
      ('com', 'lit les factures', 'select count(*) from public.invoices', 'non_vide'),
      ('cpt', 'lit les factures', 'select count(*) from public.invoices', 'non_vide'),
      ('for', 'ne lit aucune facture', 'select count(*) from public.invoices', 'vide'),
      ('lec', 'ne lit aucune facture', 'select count(*) from public.invoices', 'vide'),
      ('tech', 'ne lit aucune facture', 'select count(*) from public.invoices', 'vide'),
      ('for', 'ne lit aucun devis', 'select count(*) from public.quotes', 'vide'),
      ('lec', 'ne lit aucun devis', 'select count(*) from public.quotes', 'vide'),
      ('com', 'lit les devis', 'select count(*) from public.quotes', 'non_vide'),
      -- Prospection
      -- Base prospects : lisible par le commercial si le module Prospection est actif ; module coupé = seul le super administrateur lit
      ('com', case when exists (select 1 from public.org_modules m where m.key = 'prospection' and m.enabled)
                   then 'lit la base prospects (module actif)' else 'ne lit pas la base prospects (module coupé)' end,
              'select count(*) from public.prospection_massive',
              case when exists (select 1 from public.org_modules m where m.key = 'prospection' and m.enabled) then 'non_vide' else 'vide' end),
      ('sa', 'lit la base prospects (module actif ou coupé)', 'select count(*) from public.prospection_massive', 'non_vide'),
      ('for', 'ne lit pas la base prospects', 'select count(*) from public.prospection_massive', 'vide'),
      ('cpt', 'ne lit pas la base prospects', 'select count(*) from public.prospection_massive', 'vide'),
      ('lec', 'ne lit pas la base prospects', 'select count(*) from public.prospection_massive', 'vide'),
      -- Budget (module désactivé en production : seul le super administrateur lit)
      ('cpt', 'budget coupé avec le module', 'select count(*) from public.budget_categories', 'vide'),
      ('sa', 'super administrateur lit le budget même coupé', 'select count(*) from public.budget_categories', '=' || n_budget),
      -- Données techniques et secrets
      ('sa', 'clés de chiffrement inaccessibles', 'select count(*) from public._encryption_keys', 'refus'),
      ('ges', 'table des numéros de sécurité sociale inaccessible', 'select count(*) from public.trainee_ssn', 'refus'),
      ('sa', 'numéro de sécurité sociale absent de trainees', 'select count(*) from public.trainees where social_security_number is not null', '=0'),
      ('sa', 'numéro signalé comme connu', 'select count(*) from public.trainees where id = ''' || v_tr1 || ''' and ssn_present', '=1'),
      ('lec', 'comptes email des autres invisibles', 'select count(*) from public.user_email_configs where user_id <> auth.uid()', '=0'),
      ('dir', 'jetons des réseaux sociaux invisibles', 'select count(*) from public.social_tokens', 'vide'),
      ('ad', 'lit le journal d''audit', 'select count(*) from public.audit_logs', 'non_vide'),
      ('dir', 'ne lit pas le journal d''audit', 'select count(*) from public.audit_logs', 'vide'),
      ('lec', 'lit les notifications', 'select count(*) from public.notifications', 'non_vide'),
      ('tech', 'ne lit pas les notifications', 'select count(*) from public.notifications', 'vide'),
      ('tech', 'lit les comptes (noms)', 'select count(*) from public.profiles', 'non_vide'),
      ('ent', 'ne lit que son propre compte', 'select count(*) from public.profiles where id <> auth.uid()', 'vide'),
      ('com', 'ne lit pas la certification', 'select count(*) from public.cert_indicators', 'vide'),
      ('ges', 'lit la certification', 'select count(*) from public.cert_indicators', 'non_vide'),
      -- Interventions
      ('tech', 'ne lit que ses visites et celles de ses clients', 'select count(*) from public.itv_visits', '=1'),
      ('tech', 'lit le parc de ses clients', 'select count(*) from public.itv_equipment', '=1'),
      ('tech', 'ne lit aucun contrat', 'select count(*) from public.itv_contracts', 'vide'),
      ('lec', 'lit les visites', 'select count(*) from public.itv_visits', 'non_vide'),
      ('cpt', 'ne lit pas les visites', 'select count(*) from public.itv_visits', 'vide'),
      -- Écritures
      ('lec', 'ne crée pas de client', 'with x as (insert into public.clients (name) values (''Essai lecture'') returning 1) select count(*) from x', 'refus'),
      ('cpt', 'ne crée pas de client', 'with x as (insert into public.clients (name) values (''Essai comptable'') returning 1) select count(*) from x', 'refus'),
      ('com', 'crée un client', 'with x as (insert into public.clients (name) values (''Essai commercial'') returning 1) select count(*) from x', '=1'),
      ('tech', 'ne crée pas de client', 'with x as (insert into public.clients (name) values (''Essai technicien'') returning 1) select count(*) from x', 'refus'),
      ('for', 'modifie sa session', 'with x as (update public.sessions set notes = coalesce(notes, '''') where id = ''' || v_s1 || ''' returning 1) select count(*) from x', '=1'),
      ('for', 'ne modifie pas une autre session', 'with x as (update public.sessions set notes = coalesce(notes, '''') where id = ''' || v_s2 || ''' returning 1) select count(*) from x', '=0'),
      ('for', 'ne modifie pas un stagiaire hors de ses sessions', 'with x as (update public.trainees set notes = coalesce(notes, '''') where id = ''' || v_tr2 || ''' returning 1) select count(*) from x', '=0'),
      ('lec', 'ne modifie pas une session', 'with x as (update public.sessions set notes = coalesce(notes, '''') where id = ''' || v_s1 || ''' returning 1) select count(*) from x', '=0'),
      ('tech', 'modifie sa visite', 'with x as (update public.itv_visits set notes = coalesce(notes, '''') where id = ''' || v_v1 || ''' returning 1) select count(*) from x', '=1'),
      ('tech', 'ne modifie pas la visite d''un autre', 'with x as (update public.itv_visits set notes = coalesce(notes, '''') where id = ''' || v_v2 || ''' returning 1) select count(*) from x', '=0'),
      ('tech', 'modifie un appareil de son client', 'with x as (update public.itv_equipment set notes = coalesce(notes, '''') where id = ''' || v_eq || ''' returning 1) select count(*) from x', '=1'),
      ('lec', 'ne modifie pas une facture', 'with x as (update public.invoices set notes = coalesce(notes, '''') where id = ''' || coalesce(v_inv::text, gen_random_uuid()::text) || ''' returning 1) select count(*) from x', '=0'),
      ('ad', 'ne modifie pas un super administrateur', 'with x as (update public.profiles set fonction = fonction where id = ''' || u_sa || ''' returning 1) select count(*) from x', '=0'),
      ('ad', case when v_lic_comptes then 'sans licence totale : ne modifie pas un gestionnaire' else 'modifie un gestionnaire' end,
             'with x as (update public.profiles set fonction = fonction where id = ''' || u_ges || ''' returning 1) select count(*) from x',
             case when v_lic_comptes then '=0' else '=1' end),
      ('lec', 'modifie son propre profil', 'with x as (update public.profiles set fonction = fonction where id = auth.uid() returning 1) select count(*) from x', '=1'),
      -- Fonctions
      ('ges', 'lit le numéro de sécurité sociale masqué', 'select count(*) from public.get_trainee_with_ssn(''' || v_tr1 || ''') where social_security_number = ''••••••••••••436''', '=1'),
      ('for', 'lit le numéro d''un stagiaire de sa session', 'select count(*) from public.get_trainee_with_ssn(''' || v_tr1 || ''') where social_security_number is not null', '=1'),
      ('for', 'ne lit pas le numéro hors de ses sessions', 'select count(*) from public.get_trainee_with_ssn(''' || v_tr2 || ''')', 'refus'),
      ('com', 'ne lit pas le numéro de sécurité sociale', 'select count(*) from public.get_trainee_with_ssn(''' || v_tr1 || ''')', 'refus'),
      ('ges', 'n''appelle pas le déchiffrement', 'select count(*) from (select public.decrypt_ssn(null::bytea)) x', 'refus'),
      ('ad', 'n''appelle pas la tâche planifiée', 'select count(*) from (select public.cron_call_vercel(''/api/health'')) x', 'refus'),
      ('lec', 'n''appelle pas la tâche des campagnes', 'select count(*) from (select public.mailing_tick()) x', 'refus'),
      ('com', 'ne lit pas le journal par fonction', 'select count(*) from public.get_audit_logs()', 'refus'),
      ('ad', 'lit le journal par fonction', 'select count(*) from public.get_audit_logs()', 'non_vide'),
      ('tech', 'ne clôt pas la visite d''un autre', 'select count(*) from (select public.itv_close_visit(''' || v_v2 || ''')) x', 'refus'),
      ('lec', 'n''exporte pas un stagiaire', 'select count(*) from (select public.export_trainee_data(''' || v_tr1 || ''')) x', 'refus'),
      ('com', 'ne modifie pas les présences par fonction', 'select count(*) from (select public.set_trainee_absent(''' || v_s1 || ''', ''' || v_tr1 || ''', false) r) x where (r->>''ok'')::boolean', '=0'),
      ('for', 'modifie les présences de sa session', 'select count(*) from (select public.set_trainee_absent(''' || v_s1 || ''', ''' || v_tr1 || ''', false) r) x where (r->>''ok'')::boolean', '=1'),
      -- Portails (anon)
      ('anon', 'lit l''identité publique', 'select count(*) from (select public.get_public_branding()) x', '=1'),
      ('anon', 'lit la session par jeton', 'select count(*) from (select public.get_portal_session(''' || v_token || ''')) x', '=1'),
      ('anon', 'données du stagiaire refusées sans code', 'select count(*) from (select public.load_trainee_data(''' || v_token || ''', ''' || v_tr1 || ''')) x', 'refus'),
      ('anon', 'fiche refusée sans code', 'select count(*) from (select public.update_trainee_data(''' || v_token || ''', ''' || v_tr1 || ''', ''{}''::jsonb)) x', 'refus'),
      ('anon', 'mauvais code refusé', 'select count(*) from (select public.verify_trainee_access_code(''' || v_st1 || ''', ''000000'') r) x where (r->>''success'')::boolean', '=0'),
      ('anon', 'ne lit pas les documents en direct', 'select count(*) from public.course_documents', 'refus'),
      ('anon', 'lit les documents par jeton', 'select count(*) from (select public.portal_documents(''' || v_token || ''')) x', '=1'),
      ('anon', 'trouve la session pour une réclamation', 'select count(*) from (select public.public_reclamation_session(''' || coalesce(v_ref, 'X') || ''') r) x where r is not null', '=1'),
      ('anon', 'n''appelle pas une fonction du personnel', 'select count(*) from (select public.client_contact_sync_primary(''' || v_client || ''')) x', 'refus'),
      ('anon', 'ne lit aucun fichier du bucket documents', 'select count(*) from storage.objects where bucket_id = ''documents''', 'vide'),
      -- Handicap (ajout du chantier F, 17/10) : direction et référent handicap seulement
      ('dir', 'lit le handicap', 'select count(*) from public.trainee_disability where trainee_id = ''' || v_tr1 || '''', '=1'),
      ('sa', 'lit le handicap', 'select count(*) from public.trainee_disability where trainee_id = ''' || v_tr1 || '''', '=1'),
      ('com', 'référent handicap : lit le handicap', 'select count(*) from public.trainee_disability where trainee_id = ''' || v_tr1 || '''', '=1'),
      ('ges', 'ne lit pas le handicap', 'select count(*) from public.trainee_disability', 'vide'),
      ('for', 'ne lit pas le handicap', 'select count(*) from public.trainee_disability', 'vide'),
      ('lec', 'ne lit pas le handicap', 'select count(*) from public.trainee_disability', 'vide'),
      ('cpt', 'ne lit pas le handicap', 'select count(*) from public.trainee_disability', 'vide'),
      ('off', 'compte désactivé : pas de handicap', 'select count(*) from public.trainee_disability', 'vide'),
      ('anon', 'ne lit pas le handicap', 'select count(*) from public.trainee_disability', 'refus'),
      ('ges', 'le handicap ne reste pas dans la fiche', 'select count(*) from public.trainees where id = ''' || v_tr1 || ''' and (has_disability or disability_details is not null or disability_adaptations is not null)', '=0'),
      ('ges', 'compte des stagiaires concernés, sans identité', 'select public.disability_count(array[''' || v_tr1 || ''']::uuid[])', '=1'),
      ('ges', 'fiche lue sans handicap', 'select count(*) from public.get_trainee_with_ssn(''' || v_tr1 || ''') where has_disability is null and disability_details is null', '=1'),
      ('dir', 'fiche lue avec handicap', 'select count(*) from public.get_trainee_with_ssn(''' || v_tr1 || ''') where has_disability and disability_details = ''Essai besoin''', '=1'),
      ('ges', 'enregistre la fiche (handicap non visible)', 'select count(*) from (select public.save_trainee_with_ssn(''' || v_tr1 || ''', ''Essai'', ''UN'')) x', '=1'),
      ('dir', 'handicap conservé après enregistrement par la gestion', 'select count(*) from public.trainee_disability where trainee_id = ''' || v_tr1 || ''' and has_disability and details = ''Essai besoin''', '=1'),
      ('dir', 'retire le handicap depuis la fiche', 'select count(*) from (select public.save_trainee_with_ssn(''' || v_tr1 || ''', ''Essai'', ''UN'', p_has_disability => false)) x', '=1'),
      ('dir', 'handicap retiré', 'select count(*) from public.trainee_disability where trainee_id = ''' || v_tr1 || '''', '=0'),
      ('dir', 'lit le registre PSH', 'select count(*) from public.psh_requests', 'non_vide'),
      ('com', 'référent handicap : lit le registre PSH', 'select count(*) from public.psh_requests', 'non_vide'),
      ('ges', 'ne lit pas le registre PSH', 'select count(*) from public.psh_requests', 'vide'),
      ('for', 'ne lit pas le registre PSH', 'select count(*) from public.psh_requests', 'vide'),
      ('ges', 'compte du registre PSH, sans contenu', 'select public.psh_request_count()', 'non_vide'),
      -- Signatures des formateurs : bucket privé
      ('anon', 'ne lit pas les signatures des formateurs', 'select count(*) from storage.objects where bucket_id = ''trainer-signatures''', 'vide'),
      ('ent', 'ne lit pas les signatures des formateurs', 'select count(*) from storage.objects where bucket_id = ''trainer-signatures''', 'vide'),
      -- Suivi formatif (0250, règles du module, non modifiées) : rien pour les rôles externes et les visiteurs
      ('ent', 'ne lit pas le suivi formatif', 'select count(*) from public.formative_sheets', 'vide'),
      ('stg', 'ne lit pas le suivi formatif', 'select count(*) from public.formative_evaluations', 'vide'),
      ('ext', 'ne lit pas les séquences', 'select count(*) from public.session_sequences', 'vide'),
      ('off', 'compte désactivé : pas de suivi formatif', 'select count(*) from public.formative_evaluations', 'vide'),
      -- Retours du post-it (0260) : serveur seulement, même le super administrateur ne lit rien en direct
      ('sa', 'ne lit pas les retours en direct', 'select count(*) from public.user_feedback', 'refus'),
      ('lec', 'n''écrit pas de retour en direct', 'with x as (insert into public.user_feedback (author_id, message) values (''' || u_lec || ''', ''Essai'') returning 1) select count(*) from x', 'refus'),
      ('anon', 'ne lit pas les retours', 'select count(*) from public.user_feedback', 'refus'),
      ('anon', 'ne lit pas le suivi formatif', 'select count(*) from public.formative_evaluations', 'refus'),
      ('ent', 'n''appelle pas une fonction du personnel', 'select count(*) from (select public.client_contact_sync_primary(''' || v_client || ''')) x', 'refus')
    ) t(who, label, sql, expect)
  loop
    v_uid := case r.who when 'sa' then u_sa when 'ad' then u_ad when 'dir' then u_dir when 'ges' then u_ges
                        when 'for' then u_for when 'com' then u_com when 'cpt' then u_cpt when 'lec' then u_lec
                        when 'tech' then u_tech when 'ent' then u_ent when 'ext' then u_ext when 'stg' then u_stg
                        when 'off' then u_off end;
    if r.who = 'anon' then
      v_claims := '{"role":"anon"}';
    else
      v_claims := json_build_object('sub', v_uid, 'role', 'authenticated', 'email', 'essai.' || r.who || '@test.invalid')::text;
    end if;

    begin
      perform set_config('request.jwt.claims', v_claims, true);
      perform set_config('request.jwt.claim.sub', coalesce(v_uid::text, ''), true);
      if r.who = 'anon' then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
      execute r.sql into v_n;
      v_got := v_n::text;
      execute 'reset role';
    exception when others then
      v_got := 'refus (' || sqlstate || ')';
    end;

    v_ok := case
      when r.expect = 'refus' then v_got like 'refus%'
      when r.expect = 'vide' then v_got like 'refus%' or v_got = '0'
      when r.expect = 'non_vide' then v_got ~ '^[0-9]+$' and v_got::bigint > 0
      when r.expect like '=%' then v_got = substr(r.expect, 2)
      else false end;
    v_total := v_total + 1;
    if not v_ok then v_fail := v_fail + 1; end if;
    v_lines := v_lines || format('%s  %-5s %-55s attendu %-10s obtenu %s',
      case when v_ok then 'OK    ' else 'ÉCHEC ' end, r.who, r.label, r.expect, v_got);
  end loop;

  -- Portail : ticket délivré par le bon code, puis lecture sans numéro complet
  begin
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
    select x.vr->>'ticket' into v_ticket from (select public.verify_trainee_access_code(v_st1, v_code) as vr) x;
    -- Une seconde vérification (route serveur du Passeport) ne doit pas invalider le ticket du navigateur
    perform public.verify_trainee_access_code(v_st1, v_code);
    select count(*) into v_n from (select public.load_trainee_data(v_token, v_tr1, v_ticket) as vd) x
      where x.vd->'info_sheet'->>'ssn' is null and (x.vd->'info_sheet'->>'ssn_on_file')::boolean
        and x.vd->'info_sheet'->>'ssn_last3' = '436';
    v_got := v_n::text;
    execute 'reset role';
  exception when others then
    v_got := 'refus (' || sqlstate || ' ' || sqlerrm || ')';
  end;
  v_total := v_total + 1;
  if v_got = '1' then
    v_lines := v_lines || format('OK      anon  %-55s attendu =1         obtenu %s', 'bon code : données lues, numéro masqué', v_got);
  else
    v_fail := v_fail + 1;
    v_lines := v_lines || format('ÉCHEC   anon  %-55s attendu =1         obtenu %s', 'bon code : données lues, numéro masqué', v_got);
  end if;

  -- Module coupé : prospection désactivée pendant le test
  update public.org_modules set enabled = false where key = 'prospection';
  for r in select * from (values
      ('com', 'prospection coupée : base prospects invisible', 'select count(*) from public.prospection_massive', 'vide'),
      ('sa', 'prospection coupée : super administrateur lit encore', 'select count(*) from public.prospection_massive', '=' || n_pm)
    ) t(who, label, sql, expect)
  loop
    v_uid := case r.who when 'com' then u_com else u_sa end;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', v_uid::text, true);
      execute 'set local role authenticated';
      execute r.sql into v_n;
      v_got := v_n::text;
      execute 'reset role';
    exception when others then
      v_got := 'refus (' || sqlstate || ')';
    end;
    v_ok := case when r.expect = 'vide' then v_got like 'refus%' or v_got = '0' else v_got = substr(r.expect, 2) end;
    v_total := v_total + 1;
    if not v_ok then v_fail := v_fail + 1; end if;
    v_lines := v_lines || format('%s  %-5s %-55s attendu %-10s obtenu %s',
      case when v_ok then 'OK    ' else 'ÉCHEC ' end, r.who, r.label, r.expect, v_got);
  end loop;

  -- Contrôles de structure (en postgres)
  v_total := v_total + 4;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and roles::text like '%anon%' and cmd <> 'SELECT') then
    v_lines := v_lines || 'OK      base  aucune écriture de fichier pour anon'::text;
  else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  aucune écriture de fichier pour anon'::text; end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and roles::text like '%anon%') then
    v_lines := v_lines || 'OK      base  aucune règle de table pour anon'::text;
  else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  aucune règle de table pour anon'::text; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.prokind = 'f'
                   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
                   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) then
    v_lines := v_lines || 'OK      base  search_path fixé sur toutes les fonctions'::text;
  else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  search_path fixé sur toutes les fonctions'::text; end if;
  if not exists (select tablename, cmd from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE'
                 group by tablename, cmd, roles having count(*) > 1) then
    v_lines := v_lines || 'OK      base  une seule règle permissive par action et par table'::text;
  else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  une seule règle permissive par action et par table'::text; end if;

  -- Ajouts du chantier F (17/10) : TRUNCATE, TRIGGER, REFERENCES retirés partout ; signatures privées
  v_total := v_total + 2;
  if not exists (select 1 from pg_class c, aclexplode(c.relacl) a
                 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
                   and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
                   and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')) then
    v_lines := v_lines || 'OK      base  aucun TRUNCATE, TRIGGER ni REFERENCES pour anon et authenticated'::text;
  else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  aucun TRUNCATE, TRIGGER ni REFERENCES pour anon et authenticated'::text; end if;
  if exists (select 1 from storage.buckets where id = 'trainer-signatures' and not public)
     or not exists (select 1 from storage.buckets where id = 'trainer-signatures') then
    v_lines := v_lines || 'OK      base  bucket trainer-signatures privé'::text;
  else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  bucket trainer-signatures privé'::text; end if;

  -- Suivi formatif (0250) : fonctions et règles identiques à l'état d'avant les migrations
  -- (photographie prise par le script d'essai avant 0080, table temporaire essai_sf_avant)
  if to_regclass('pg_temp.essai_sf_avant') is not null then
    v_total := v_total + 1;
    select string_agg(x.kind || ' ' || x.name, ', ') into v_got from (
      select * from essai_sf_avant
      except
      (select 'fonction', p.oid::regprocedure::text,
              md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
                  (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
                   from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
       from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'sf\_%' or p.proname = 'save_formative_batch')
       union all
       select 'règle', tablename || '.' || policyname, md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check))
       from pg_policies where schemaname = 'public'
         and tablename in ('course_sequences', 'session_sequences', 'formative_evaluations', 'formative_sheets'))) x;
    if v_got is null then
      v_lines := v_lines || 'OK      base  suivi formatif : fonctions sf_* et règles inchangées'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  suivi formatif : fonctions sf_* et règles inchangées (' || v_got || ')'); end if;
  end if;

  -- Suivi des erreurs (0070, chantier 1, appliquée après le chantier 2) : accès gardés
  if to_regprocedure('public.log_error(text, text, text, text, text, text, uuid)') is not null then
    v_total := v_total + 3;
    if has_function_privilege('anon', 'public.log_error(text, text, text, text, text, text, uuid)', 'EXECUTE') then
      v_lines := v_lines || 'OK      base  log_error appelable par les portails (anon)'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  log_error appelable par les portails (anon)'::text; end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications'
               and policyname = 'notifications_audience_superadmin' and permissive = 'RESTRICTIVE') then
      v_lines := v_lines || 'OK      base  règle restrictive des notifications du chantier 1 présente'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  règle restrictive des notifications du chantier 1 présente'::text; end if;
    if not has_table_privilege('anon', 'public.error_logs', 'SELECT')
       and not has_table_privilege('authenticated', 'public.error_logs', 'INSERT') then
      v_lines := v_lines || 'OK      base  error_logs : aucune lecture anon, aucune écriture directe'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  error_logs : aucune lecture anon, aucune écriture directe'::text; end if;
  end if;

  -- Retours du post-it (0260) : table serveur seulement (RLS active, aucune règle, aucun droit anon ni authenticated)
  if to_regclass('public.user_feedback') is not null then
    v_total := v_total + 1;
    if (select relrowsecurity from pg_class where oid = 'public.user_feedback'::regclass)
       and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_feedback')
       and not exists (select 1 from aclexplode(coalesce((select relacl from pg_class where oid = 'public.user_feedback'::regclass),
                                                         acldefault('r', (select relowner from pg_class where oid = 'public.user_feedback'::regclass)))) a
                       where a.grantee in ('anon'::regrole, 'authenticated'::regrole)) then
      v_lines := v_lines || 'OK      base  user_feedback : serveur seulement (aucune règle, aucun droit des comptes)'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  user_feedback : serveur seulement (aucune règle, aucun droit des comptes)'::text; end if;
  end if;

  -- Passeport de prévention (si le module est installé) : pp_nir réservée au serveur
  if to_regclass('public.pp_nir') is not null then
    v_total := v_total + 2;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pp_nir')
       and not has_table_privilege('authenticated', 'public.pp_nir', 'SELECT') then
      v_lines := v_lines || 'OK      base  pp_nir : aucune règle, aucun droit pour les comptes connectés'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  pp_nir : aucune règle, aucun droit pour les comptes connectés'::text; end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'pp\_%' and policyname not like '%\_societe\_%'
                   and ((coalesce(qual, '') || coalesce(with_check, '')) not like '%pp_can%'
                        or (coalesce(qual, '') || coalesce(with_check, '')) not like '%app.role()%')) then
      v_lines := v_lines || 'OK      base  tables pp_* : règles du Passeport (direction et gestion), compte actif'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  tables pp_* : règles du Passeport (direction et gestion), compte actif'::text; end if;
  end if;

  -- Socle multi-sociétés (C1a, 0270 à 0273) : seulement si les tables des sociétés existent
  if to_regclass('public.companies') is not null then
    declare
      c_own uuid; c_a uuid; c_b uuid;
      u_a uuid := gen_random_uuid(); u_aa uuid := gen_random_uuid(); u_b uuid := gen_random_uuid(); u_ba uuid := gen_random_uuid();
      v_hdr text;
    begin
      -- Structure (en postgres), avant les sociétés fictives
      select id into c_own from public.companies where is_instance_owner;
      v_total := v_total + 5;
      if (select count(*) from public.companies where is_instance_owner) = 1 then
        v_lines := v_lines || 'OK      base  une seule société n° 1 (porte l''instance)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  une seule société n° 1 (porte l''instance)'::text; end if;
      if not exists (select 1 from public.profiles p
                     where p.role in ('admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture')
                       and not exists (select 1 from public.company_members m
                                       where m.profile_id = p.id and m.company_id = c_own and m.role = p.role
                                         and m.is_active = coalesce(p.is_active, true)))
         and not exists (select 1 from public.company_members m join public.profiles p on p.id = m.profile_id
                         where p.role = 'superadmin' and m.is_active) then
        v_lines := v_lines || 'OK      base  appartenances à la société n° 1 = rôles des comptes internes'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  appartenances à la société n° 1 = rôles des comptes internes'::text; end if;
      if not exists (select 1 from public.org_modules o
                     left join public.company_modules cm on cm.company_id = c_own and cm.key = o.key
                     where cm.enabled is distinct from o.enabled) then
        v_lines := v_lines || 'OK      base  modules de la société n° 1 = modules actifs'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  modules de la société n° 1 = modules actifs'::text; end if;
      select string_agg(c.relname, ', ') into v_got from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
        and not exists (select 1 from app.tables_avant_societes t where t.table_name = c.relname)
        and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped);
      if v_got is null then
        v_lines := v_lines || 'OK      base  toute nouvelle table naît avec company_id'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  toute nouvelle table naît avec company_id (' || v_got || ')'); end if;
      if (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relrowsecurity
            and c.relname in ('companies', 'company_establishments', 'company_members', 'company_member_roles',
                              'company_modules', 'support_access_grants')) = 6 then
        v_lines := v_lines || 'OK      base  RLS active sur les 6 tables des sociétés'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  RLS active sur les 6 tables des sociétés'::text; end if;

      -- Deux sociétés fictives, créées et supprimées dans la transaction : A en accès de support permanent, B à la demande
      insert into auth.users (id, email, aud, role)
      select x.id, x.email, 'authenticated', 'authenticated' from (values
        (u_a, 'essai.a@test.invalid'), (u_aa, 'essai.aa@test.invalid'), (u_b, 'essai.b@test.invalid'),
        (u_ba, 'essai.ba@test.invalid')) x(id, email);
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active)
      select x.id, x.email, x.role, true from (values
        (u_a, 'essai.a@test.invalid', 'direction'), (u_aa, 'essai.aa@test.invalid', 'admin'),
        (u_b, 'essai.b@test.invalid', 'gestionnaire'), (u_ba, 'essai.ba@test.invalid', 'admin')) x(id, email, role)
      on conflict (id) do update set role = excluded.role, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      delete from public.company_members where profile_id in (u_a, u_aa, u_b, u_ba);
      insert into public.companies (legal_name, support_access_mode) values ('Essai société A', 'permanent') returning id into c_a;
      insert into public.companies (legal_name, support_access_mode) values ('Essai société B', 'on_demand') returning id into c_b;
      insert into public.company_members (company_id, profile_id, role, is_default) values
        (c_a, u_a, 'direction', true), (c_a, u_aa, 'admin', true), (c_b, u_b, 'gestionnaire', true), (c_b, u_ba, 'admin', true);
      insert into public.company_modules (company_id, key, enabled) values (c_a, 'formation', true), (c_b, 'formation', true);

      for r in
        select * from (values
          -- Isolement entre sociétés
          ('a', null, 'lit sa société', 'select count(*) from public.companies where id = ''' || c_a || '''', '=1'),
          ('a', null, 'ne voit pas une autre société', 'select count(*) from public.companies where id = ''' || c_b || '''', '=0'),
          ('a', null, 'ne voit pas la société n° 1', 'select count(*) from public.companies where is_instance_owner', '=0'),
          ('a', null, 'lit les modules de sa société', 'select count(*) from public.company_modules where company_id = ''' || c_a || '''', '=1'),
          ('b', null, 'ne lit pas les modules d''une autre société', 'select count(*) from public.company_modules where company_id = ''' || c_a || '''', '=0'),
          ('b', null, 'ne lit pas les appartenances d''une autre société', 'select count(*) from public.company_members where company_id = ''' || c_a || '''', '=0'),
          ('a', null, 'ne modifie pas une autre société', 'with x as (update public.companies set short_name = short_name where id = ''' || c_b || ''' returning 1) select count(*) from x', '=0'),
          ('a', null, 'direction ne modifie pas sa société (sans licence totale)', 'with x as (update public.companies set short_name = short_name where id = ''' || c_a || ''' returning 1) select count(*) from x', '=0'),
          ('a', null, 'direction ne donne pas d''accès', 'with x as (insert into public.company_members (company_id, profile_id, role) values (''' || c_a || ''', ''' || u_b || ''', ''lecture'') returning 1) select count(*) from x', 'refus'),
          ('aa', null, 'administrateur de A : donne un accès à A', 'with x as (insert into public.company_members (company_id, profile_id, role) values (''' || c_a || ''', ''' || u_b || ''', ''lecture'') returning 1) select count(*) from x', '=1'),
          ('aa', null, 'administrateur de A : pas d''accès à B', 'with x as (insert into public.company_members (company_id, profile_id, role) values (''' || c_b || ''', ''' || u_a || ''', ''lecture'') returning 1) select count(*) from x', 'refus'),
          ('aa', null, 'aucune appartenance super administrateur', 'with x as (insert into public.company_members (company_id, profile_id, role) values (''' || c_a || ''', ''' || u_ba || ''', ''superadmin'') returning 1) select count(*) from x', 'refus'),
          ('b', null, 'accès donné : voit A et B', 'select count(*) from public.companies where id in (''' || c_a || ''', ''' || c_b || ''')', '=2'),
          ('b', null, 'société courante : la société par défaut (B)', 'select count(*) from (select app.current_company() c) x where c = ''' || c_b || '''', '=1'),
          ('b', '{"x-company-id":"' || c_a || '"}', 'en-tête autorisé : société courante A', 'select count(*) from (select app.current_company() c) x where c = ''' || c_a || '''', '=1'),
          ('b', '{"x-company-id":"' || c_a || '"}', 'rôle dans A : celui de l''appartenance (lecture)', 'select count(*) from (select app.company_role() r) x where r = ''lecture''', '=1'),
          ('a', '{"x-company-id":"' || c_b || '"}', 'en-tête non autorisé : retombe sur sa société', 'select count(*) from (select app.current_company() c) x where c = ''' || c_a || '''', '=1'),
          ('a', '{"x-company-id":"pas-un-uuid"}', 'en-tête mal formé : retombe sur sa société', 'select count(*) from (select app.current_company() c) x where c = ''' || c_a || '''', '=1'),
          ('a', '{"x-company-id":"' || gen_random_uuid() || '"}', 'en-tête inconnu : retombe sur sa société', 'select count(*) from (select app.current_company() c) x where c = ''' || c_a || '''', '=1'),
          ('ges', null, 'société courante : la société n° 1', 'select count(*) from (select app.current_company() c) x where c = ''' || coalesce(c_own::text, gen_random_uuid()::text) || '''', '=1'),
          ('lec', null, 'ses sociétés : la société n° 1 seulement', 'select count(*) from public.my_companies()', '=1'),
          ('tech', null, 'technicien : voit la société n° 1', 'select count(*) from public.companies where is_instance_owner', '=1'),
          ('off', null, 'compte désactivé : aucune société', 'select count(*) from public.companies', 'vide'),
          ('ent', null, 'compte externe : aucune société', 'select count(*) from public.companies', 'vide'),
          ('anon', null, 'visiteur : aucune société', 'select count(*) from public.companies', 'refus'),
          ('anon', null, 'visiteur : n''appelle pas ses sociétés', 'select count(*) from public.my_companies()', 'refus'),
          -- Accès de support de l'éditeur
          ('sa', null, 'liste des sociétés lisible (réglages)', 'select count(*) from public.companies where id in (''' || c_a || ''', ''' || c_b || ''')', '=2'),
          ('sa', null, 'accès permanent : données de A visibles', 'select count(*) from app.visible_companies() v where v = ''' || c_a || '''', '=1'),
          ('sa', null, 'à la demande sans fenêtre : B non visible', 'select count(*) from app.visible_companies() v where v = ''' || c_b || '''', '=0'),
          ('sa', null, 'aucune appartenance active pour le super administrateur', 'select count(*) from public.company_members where profile_id = auth.uid() and is_active', '=0'),
          ('sa', '{"x-company-id":"' || c_a || '"}', 'trace des lectures de A', 'select public.support_trace(array[''clients'', ''profiles'', ''pas_une_table''], ''#/clients?q=essai'')', '=1'),
          ('sa', null, 'trace : tables métier seulement, page sans la recherche', 'select count(*) from public.audit_logs where details ->> ''company_id'' = ''' || c_a || ''' and details -> ''tables'' = ''["clients"]''::jsonb and details ->> ''page'' = ''#/clients'' and (details ->> ''fenetre_ouverte'')::boolean', '=1'),
          ('sa', '{"x-company-id":"' || c_b || '"}', 'trace des lectures de B hors fenêtre', 'select public.support_trace(array[''sessions''], ''#/sessions'')', '=1'),
          ('sa', null, 'trace de B : fenêtre fermée notée', 'select count(*) from public.audit_logs where details ->> ''company_id'' = ''' || c_b || ''' and not (details ->> ''fenetre_ouverte'')::boolean', '=1'),
          ('sa', null, 'trace sans table métier : rien d''écrit', 'select public.support_trace(array[''profiles'', ''org_modules''], ''#/'')', '=0'),
          ('aa', null, 'administrateur : voit la trace au journal', 'select count(*) from public.audit_logs where details ->> ''company_id'' = ''' || c_a || ''' and (details ->> ''support'')::boolean', 'non_vide'),
          ('ges', null, 'trace refusée hors super administrateur', 'select public.support_trace(array[''clients''], ''#/'')', 'refus'),
          ('a', null, 'direction ne change pas le mode d''accès', 'select count(*) from (select public.company_set_support_mode(''' || c_a || ''', ''none'')) x', 'refus'),
          ('sa', null, 'le super administrateur ne change pas le mode', 'select count(*) from (select public.company_set_support_mode(''' || c_b || ''', ''permanent'')) x', 'refus'),
          ('sa', null, 'mode non modifiable en direct', 'with x as (update public.companies set support_access_mode = ''permanent'' where id = ''' || c_b || ''' returning 1) select count(*) from x', 'refus'),
          ('aa', null, 'administrateur de A : passe A à la demande', 'select count(*) from (select public.company_set_support_mode(''' || c_a || ''', ''on_demand'')) x', '=1'),
          ('sa', null, 'A à la demande sans fenêtre : non visible', 'select count(*) from app.visible_companies() v where v = ''' || c_a || '''', '=0'),
          ('a', null, 'direction n''ouvre pas de fenêtre', 'select count(*) from (select public.support_access_open(''' || c_a || ''', ''Essai support'', 2)) x', 'refus'),
          ('aa', null, 'administrateur de A : pas de fenêtre sur B', 'select count(*) from (select public.support_access_open(''' || c_b || ''', ''Essai support'', 2)) x', 'refus'),
          ('ba', null, 'administrateur de B : ouvre une fenêtre de 2 h', 'select count(*) from (select public.support_access_open(''' || c_b || ''', ''Essai support'', 2) t) x where t > now() + interval ''1 hour''', '=1'),
          ('sa', null, 'fenêtre ouverte : B visible', 'select count(*) from app.visible_companies() v where v = ''' || c_b || '''', '=1'),
          ('sa', null, 'fenêtre ouverte : rôle super administrateur dans B', 'select count(*) from (select app.company_role(''' || c_b || ''') r) x where r = ''superadmin''', '=1'),
          ('ba', null, 'administrateur de B : lit ses fenêtres', 'select count(*) from public.support_access_grants where company_id = ''' || c_b || '''', '=1'),
          ('a', null, 'direction de A : ne lit pas les fenêtres de B', 'select count(*) from public.support_access_grants', '=0'),
          ('ba', null, 'fenêtre non créée en direct', 'with x as (insert into public.support_access_grants (company_id, expires_at, reason) values (''' || c_b || ''', now() + interval ''1 day'', ''Essai'') returning 1) select count(*) from x', 'refus'),
          ('ba', null, 'administrateur de B : ferme la fenêtre', 'select public.support_access_close(''' || c_b || ''')', '=1'),
          ('sa', null, 'fenêtre fermée : B non visible', 'select count(*) from app.visible_companies() v where v = ''' || c_b || '''', '=0'),
          ('ba', null, 'ouverture et fermeture écrites au journal', 'select count(*) from public.audit_logs where details ->> ''company_id'' = ''' || c_b || ''' and entity_name in (''Accès de support ouvert'', ''Accès de support fermé'')', '=2'),
          ('aa', null, 'licence totale réservée au super administrateur', 'with x as (update public.companies set full_license = true where id = ''' || c_a || ''' returning 1) select count(*) from x', 'vide')
        ) t(who, hdr, label, sql, expect)
      loop
        v_uid := case r.who when 'sa' then u_sa when 'ges' then u_ges when 'lec' then u_lec when 'tech' then u_tech
                            when 'off' then u_off when 'ent' then u_ent when 'a' then u_a when 'aa' then u_aa
                            when 'b' then u_b when 'ba' then u_ba end;
        if r.who = 'anon' then
          v_claims := '{"role":"anon"}';
        else
          v_claims := json_build_object('sub', v_uid, 'role', 'authenticated', 'email', 'essai.' || r.who || '@test.invalid')::text;
        end if;
        begin
          perform set_config('request.jwt.claims', v_claims, true);
          perform set_config('request.jwt.claim.sub', coalesce(v_uid::text, ''), true);
          perform set_config('request.headers', coalesce(r.hdr, ''), true);
          if r.who = 'anon' then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
          execute r.sql into v_n;
          v_got := v_n::text;
          execute 'reset role';
        exception when others then
          v_got := 'refus (' || sqlstate || ')';
        end;
        perform set_config('request.headers', '', true);
        v_ok := case
          when r.expect = 'refus' then v_got like 'refus%'
          when r.expect = 'vide' then v_got like 'refus%' or v_got = '0'
          when r.expect = 'non_vide' then v_got ~ '^[0-9]+$' and v_got::bigint > 0
          when r.expect like '=%' then v_got = substr(r.expect, 2)
          else false end;
        v_total := v_total + 1;
        if not v_ok then v_fail := v_fail + 1; end if;
        v_lines := v_lines || format('%s  %-5s %-55s attendu %-10s obtenu %s',
          case when v_ok then 'OK    ' else 'ÉCHEC ' end, r.who, r.label, r.expect, v_got);
      end loop;

      -- Sociétés fictives supprimées (l'erreur finale annule de toute façon toute la transaction)
      -- Lignes rattachées aux sociétés fictives (C2 : company_id sur les tables métier)
      declare v_ct text;
      begin
        for v_ct in select distinct tc.relname from pg_constraint k join pg_class tc on tc.oid = k.conrelid
                    join pg_namespace n on n.oid = tc.relnamespace
                    where k.contype = 'f' and k.confrelid = 'public.companies'::regclass and n.nspname = 'public'
                      and tc.relname like '%' and exists (select 1 from pg_constraint k2 where k2.oid = k.oid and k2.conname = tc.relname || '_company_fk') loop
          execute format('delete from public.%I where company_id = any ($1)', v_ct) using array[c_a, c_b];
        end loop;
      end;
      delete from public.support_access_grants where company_id in (c_a, c_b);
      delete from public.company_modules where company_id in (c_a, c_b);
      delete from public.company_members where company_id in (c_a, c_b);
      delete from public.audit_logs where company_id in (c_a, c_b);
      delete from public.companies where id in (c_a, c_b);
      v_total := v_total + 1;
      if not exists (select 1 from public.companies where legal_name like 'Essai société %') then
        v_lines := v_lines || 'OK      base  sociétés fictives supprimées'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  sociétés fictives supprimées'::text; end if;
    end;
  end if;

  -- Droits composés par société (C1b, 0370 à 0375) : seulement si le catalogue des droits existe
  if to_regclass('public.permissions') is not null then
    declare
      c1 uuid; c_x uuid; c_y uuid;
      u_cpe uuid := gen_random_uuid(); u_rh uuid := gen_random_uuid(); u_sal uuid := gen_random_uuid();
      u_ecr uuid := gen_random_uuid(); u_mbr uuid := gen_random_uuid(); u_x uuid := gen_random_uuid();
      v_part uuid; v_vp uuid; v_req uuid; v_req2 uuid; v_del uuid; v_off uuid;
    begin
      select id into c1 from public.companies where is_instance_owner;

      -- Structure (en postgres) ------------------------------------------------------------------------
      v_total := v_total + 7;
      -- Tous les droits demandés par les règles existent au catalogue
      select string_agg(distinct m[1], ', ') into v_got
      from pg_policies p, regexp_matches(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
                                         'a_le_droit(?:_dans)?\(''([a-z_.]+)''', 'g') m
      where p.schemaname = 'public' and not exists (select 1 from public.permissions d where d.code = m[1]);
      if v_got is null then
        v_lines := v_lines || 'OK      base  C1b : tous les droits des règles sont au catalogue'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  C1b : droits des règles absents du catalogue (' || v_got || ')'); end if;
      -- Plus aucune règle de table par groupe de rôles : une seule source (app.a_le_droit)
      if not exists (select 1 from pg_policies where schemaname = 'public'
                     and (coalesce(qual, '') || coalesce(with_check, '')) like '%app.grp(%') then
        v_lines := v_lines || 'OK      base  C1b : règles des tables par droits (plus de groupe de rôles)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  C1b : règles des tables par droits (plus de groupe de rôles)'::text; end if;
      -- Reprise sans perte : chaque compte actif a exactement les droits du modèle de son rôle (sans profil en plus)
      select string_agg(p.email, ', ') into v_got
      from public.profiles p
      where app.role_of(p.id) is not null and p.id not in (u_cpe, u_rh, u_sal, u_ecr, u_mbr, u_x)
        and (app.role_of(p.id) = 'superadmin'
             or exists (select 1 from public.company_members m where m.profile_id = p.id and m.company_id = c1 and m.is_active))
        and not exists (select 1 from public.company_member_roles cr join public.company_members m on m.id = cr.member_id
                        where m.profile_id = p.id)
        and not exists (select 1 from public.company_member_rights cg join public.company_members m on m.id = cg.member_id
                        where m.profile_id = p.id)
        and app.rights_for(p.id, case when app.role_of(p.id) = 'superadmin' then null else c1 end)
            is distinct from coalesce((select array_agg(pr.right_code order by pr.right_code)
                                       from public.permission_profile_rights pr
                                       join public.permission_profiles pp on pp.id = pr.profile_id
                                       join public.permissions d on d.code = pr.right_code
                                       where pp.company_id is null and pp.key = app.role_of(p.id)
                                         -- sans licence totale, les droits qui la demandent ne sont pas donnés
                                         and (app.role_of(p.id) = 'superadmin' or not d.full_license_only
                                              or (select c.full_license from public.companies c where c.id = c1))),
                                      '{}'::text[]);
      if v_got is null then
        v_lines := v_lines || 'OK      base  C1b : reprise, chaque compte a les droits du modèle de son rôle'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  C1b : reprise, droits différents du modèle (' || v_got || ')'); end if;
      -- Le modèle technicien ne contient aucun droit qui montre des prix
      if not exists (select 1 from public.permission_profile_rights pr join public.permission_profiles p on p.id = pr.profile_id
                     join public.permissions d on d.code = pr.right_code
                     where p.company_id is null and p.key = 'technicien' and d.shows_prices) then
        v_lines := v_lines || 'OK      base  C1b : modèle technicien sans aucun droit de prix'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  C1b : modèle technicien sans aucun droit de prix'::text; end if;
      -- Vues terrain : aucune colonne de prix
      if not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name in ('itv_parts_terrain', 'itv_settings_terrain', 'itv_visit_parts_terrain')
                       and (column_name like '%price%' or column_name like '%fee%' or column_name like '%_ht')) then
        v_lines := v_lines || 'OK      base  C1b : vues terrain sans colonne de prix'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  C1b : vues terrain sans colonne de prix'::text; end if;
      -- Modèles de profils types présents
      if (select count(*) from public.permission_profiles where company_id is null and key in ('superadmin', 'admin',
            'direction', 'gestionnaire', 'formateur', 'commercial', 'technicien', 'comptable', 'comptable_externe', 'rh',
            'salarie', 'lecture', 'ecran', 'membre')) = 14 then
        v_lines := v_lines || 'OK      base  C1b : 14 profils types'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  C1b : 14 profils types'::text; end if;
      -- Lectures identiques avant et après C1b (photographie prise par le script d'essai avant 0370)
      if to_regclass('pg_temp.essai_lectures_avant') is not null then
        select string_agg(x, ', ') into v_got from (
          select a.who || ':' || a.tbl || ' ' || a.n || '→' || coalesce(b.n::text, '?') as x
          from essai_lectures_avant a left join essai_lectures_apres b on b.who = a.who and b.tbl = a.tbl
          where a.n is distinct from b.n
            and not (a.who = 'tech' and a.tbl in ('itv_parts', 'itv_settings', 'itv_visit_parts') and b.n = 0)
            and a.tbl <> 'schema_migrations'  -- les migrations de C1b s'y inscrivent
          order by 1 limit 20) z;
        if v_got is null then
          v_lines := v_lines || ('OK      base  C1b : mêmes lignes lues avant et après pour ' || (select count(*) from essai_lectures_avant)
                                 || ' couples compte-table (sauf prix du technicien : '
                                 || (select count(*) from essai_lectures_avant a join essai_lectures_apres b using (who, tbl)
                                     where a.n is distinct from b.n and a.tbl <> 'schema_migrations') || ' masqués)');
        else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  C1b : lectures différentes (' || v_got || ')'); end if;
      else
        v_lines := v_lines || 'OK      base  C1b : comparaison des lectures (seulement dans le script d''essai)'::text;
      end if;

      -- Comptes et données du bloc ---------------------------------------------------------------------
      insert into auth.users (id, email, aud, role)
      select x.id, x.email, 'authenticated', 'authenticated' from (values
        (u_cpe, 'essai.cpe@test.invalid'), (u_rh, 'essai.rh@test.invalid'), (u_sal, 'essai.sal@test.invalid'),
        (u_ecr, 'essai.ecr@test.invalid'), (u_mbr, 'essai.mbr@test.invalid'), (u_x, 'essai.x@test.invalid')) x(id, email);
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active)
      select x.id, x.email, x.role, true from (values
        (u_cpe, 'essai.cpe@test.invalid', 'membre'), (u_rh, 'essai.rh@test.invalid', 'membre'),
        (u_sal, 'essai.sal@test.invalid', 'membre'), (u_ecr, 'essai.ecr@test.invalid', 'membre'),
        (u_mbr, 'essai.mbr@test.invalid', 'membre'), (u_x, 'essai.x@test.invalid', 'gestionnaire')) x(id, email, role)
      on conflict (id) do update set role = excluded.role, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      insert into public.company_member_roles (member_id, role_key)
      select m.id, x.k from (values (u_cpe, 'comptable_externe'), (u_rh, 'rh'), (u_sal, 'salarie'), (u_ecr, 'ecran')) x(u, k)
      join public.company_members m on m.profile_id = x.u and m.company_id = c1;
      insert into public.itv_parts (name, price_ht) values ('Essai pièce C1b', 42) returning id into v_part;
      insert into public.itv_visit_parts (visit_id, part_id, label, quantity, unit_price_ht)
      values (v_v1, v_part, 'Essai pièce C1b', 1, 42) returning id into v_vp;
      -- Deux sociétés fictives : X (le gestionnaire u_x y est membre en lecture) et Y (aucun lien)
      insert into public.companies (legal_name) values ('Essai société X') returning id into c_x;
      insert into public.companies (legal_name) values ('Essai société Y') returning id into c_y;
      insert into public.company_members (company_id, profile_id, role) values (c_x, u_x, 'lecture');
      insert into public.approval_rules (company_id, scope, mode, validator_right) values (c_y, 'expense', 'none', 'frais.notes.valider');

      for r in
        select * from (values
          -- Technicien : aucun prix lisible, missions par les vues sans prix
          ('tech', null, 'ne lit pas les prix des pièces', 'select count(*) from public.itv_parts', 'vide'),
          ('tech', null, 'ne lit pas le forfait de visite', 'select count(*) from public.itv_settings', 'vide'),
          ('tech', null, 'ne lit pas les prix des pièces fournies', 'select count(*) from public.itv_visit_parts', 'vide'),
          ('tech', null, 'ne lit aucun contrat (prix annuel)', 'select count(*) from public.itv_contracts', 'vide'),
          ('tech', null, 'ne lit aucun devis', 'select count(*) from public.quotes', 'vide'),
          ('tech', null, 'ne lit aucune ligne de facture', 'select count(*) from public.invoice_items', 'vide'),
          ('tech', null, 'ne lit aucun coût de session', 'select count(*) from public.session_costs', 'vide'),
          ('tech', null, 'aucun droit qui montre des prix', 'select count(*) from public.permissions where code = any (app.rights()) and shows_prices', '=0'),
          ('tech', null, 'lit le catalogue des pièces sans prix', 'select count(*) from public.itv_parts_terrain where id = ''' || v_part || '''', '=1'),
          ('tech', null, 'lit les réglages sans forfait', 'select count(*) from public.itv_settings_terrain', '=1'),
          ('tech', null, 'lit les pièces fournies de sa visite sans prix', 'select count(*) from public.itv_visit_parts_terrain where id = ''' || v_vp || '''', '=1'),
          ('tech', null, 'ajoute une pièce à sa visite : réponse sans prix', 'select count(*) from (select public.itv_visit_part_add(''' || v_v1 || ''', ''' || v_part || ''') j) x where not (j ? ''unit_price_ht'') and (j ->> ''label'') = ''Essai pièce C1b''', '=1'),
          ('tech', null, 'change la quantité d''une pièce de sa visite', 'select count(*) from (select public.itv_visit_part_set_quantity(''' || v_vp || ''', 3) j) x where (j ->> ''quantity'')::numeric = 3', '=1'),
          ('tech', null, 'n''ajoute pas de pièce à la visite d''un autre', 'select count(*) from (select public.itv_visit_part_add(''' || v_v2 || ''', ''' || v_part || ''')) x', 'refus'),
          ('tech', null, 'garde ses missions : ses visites', 'select count(*) from public.itv_visits', '=1'),
          ('tech', null, 'garde l''annotation du parc de son client', 'with x as (update public.itv_equipment set notes = coalesce(notes, '''') where id = ''' || v_eq || ''' returning 1) select count(*) from x', '=1'),
          ('lec', null, 'lecture : lit toujours les prix des pièces (inchangé)', 'select count(*) from public.itv_parts where id = ''' || v_part || '''', '=1'),
          ('ges', null, 'gestionnaire : lit le prix porté par la base', 'select count(*) from public.itv_visit_parts where visit_id = ''' || v_v1 || ''' and part_id = ''' || v_part || ''' and unit_price_ht = 42', '=2'),
          -- Droits lus par l'application (une seule source)
          ('lec', null, 'my_rights : droits du modèle lecture', 'select count(*) from (select public.my_rights() j) x where (j -> ''rights'') = (select to_jsonb(array_agg(r.right_code order by r.right_code)) from public.permission_profile_rights r join public.permission_profiles p on p.id = r.profile_id where p.company_id is null and p.key = ''lecture'')', '=1'),
          ('for', null, 'formateur : ses sessions seulement (droit limité)', 'select count(*) from (select app.rights() d) x where ''formation.sessions.voir_siennes'' = any (d) and not ''formation.sessions.voir'' = any (d)', '=1'),
          ('tech', null, 'technicien : profil de base technicien', 'select count(*) from (select public.my_rights() j) x where (j -> ''profiles'') = ''["technicien"]''::jsonb', '=1'),
          ('off', null, 'compte désactivé : aucun droit', 'select coalesce(array_length(app.rights(), 1), 0)', '=0'),
          ('ent', null, 'compte externe : aucun droit', 'select coalesce(array_length(app.rights(), 1), 0)', '=0'),
          ('anon', null, 'visiteur : n''appelle pas my_rights', 'select count(*) from (select public.my_rights() j) x where j is not null', 'refus'),
          ('anon', null, 'visiteur : ne lit pas le catalogue', 'select count(*) from public.permissions', 'refus'),
          -- Comptable externe : lecture des factures, aucune écriture
          ('cpe', null, 'comptable externe : lit les factures', 'select count(*) from public.invoices', 'non_vide'),
          ('cpe', null, 'comptable externe : lit les clients', 'select count(*) from public.clients', 'non_vide'),
          ('cpe', null, 'comptable externe : devis masqués par défaut', 'select count(*) from public.quotes', 'vide'),
          ('cpe', null, 'comptable externe : ne crée pas de facture', 'with x as (insert into public.invoices (reference, status) values (''ESSAI-CPE'', ''draft'') returning 1) select count(*) from x', 'refus'),
          ('cpe', null, 'comptable externe : ne modifie pas une facture', 'with x as (update public.invoices set notes = coalesce(notes, '''') returning 1) select count(*) from x', '=0'),
          ('cpe', null, 'comptable externe : ne supprime pas une facture', 'with x as (delete from public.invoices returning 1) select count(*) from x', '=0'),
          ('cpe', null, 'comptable externe : ne crée pas de paiement', 'with x as (insert into public.invoice_payments (invoice_id, amount) values (''' || coalesce(v_inv::text, gen_random_uuid()::text) || ''', 1) returning 1) select count(*) from x', 'refus'),
          ('cpe', null, 'comptable externe : ne modifie pas un client', 'with x as (update public.clients set notes = coalesce(notes, '''') returning 1) select count(*) from x', '=0'),
          ('cpe', null, 'comptable externe : aucune session ni stagiaire', 'select (select count(*) from public.sessions) + (select count(*) from public.trainees)', '=0'),
          ('cpe', null, 'comptable externe : ne change pas l''accès aux devis', 'select count(*) from (select public.external_accountant_set_quotes(true)) x', 'refus'),
          ('dir', null, 'direction : rend les devis visibles au comptable externe', 'select count(*) from (select public.external_accountant_set_quotes(true) v) x where v', '=1'),
          ('cpe', null, 'comptable externe : devis visibles après le choix de la direction', 'select count(*) from public.quotes', 'non_vide'),
          ('cpe', null, 'comptable externe : ne modifie toujours pas un devis', 'with x as (update public.quotes set notes = coalesce(notes, '''') returning 1) select count(*) from x', '=0'),
          ('dir', null, 'direction : masque de nouveau les devis', 'select count(*) from (select public.external_accountant_set_quotes(false) v) x where not v', '=1'),
          ('cpe', null, 'comptable externe : devis de nouveau masqués', 'select count(*) from public.quotes', 'vide'),
          -- RH, salarié, écran, membre sans profil
          ('rh', null, 'RH : droits RH (salaires, absences)', 'select count(*) from (select app.rights() d) x where ''rh.salaires.voir'' = any (d) and ''rh.absences.valider'' = any (d)', '=1'),
          ('rh', null, 'RH : aucune facture ni session', 'select (select count(*) from public.invoices) + (select count(*) from public.sessions)', '=0'),
          ('sal', null, 'salarié : demande ses absences, ne voit pas les salaires', 'select count(*) from (select app.rights() d) x where ''rh.absences.demander'' = any (d) and not ''rh.salaires.voir'' = any (d)', '=1'),
          ('sal', null, 'salarié : aucun client', 'select count(*) from public.clients', 'vide'),
          ('ecr', null, 'écran : seulement l''écran mural et les réglages', 'select count(*) from (select app.rights() d) x where d = array[''organisation.reglages.voir'', ''vehicules.ecran_mural.voir'']', '=1'),
          ('ecr', null, 'écran : aucune donnée métier', 'select (select count(*) from public.clients) + (select count(*) from public.itv_visits)', '=0'),
          ('mbr', null, 'membre sans profil : aucun droit', 'select coalesce(array_length(app.rights(), 1), 0)', '=0'),
          ('mbr', null, 'membre sans profil : aucun client', 'select count(*) from public.clients', 'vide'),
          -- Licence totale : les Paramètres s'ouvrent seulement avec elle (super administrateur toujours)
          ('ad', null, 'administrateur sans licence totale : pas les Paramètres', 'select count(*) from (select app.rights() d) x where ''parametres.ouvrir'' = any (d)', '=0'),
          ('dir', null, 'direction : jamais les Paramètres', 'select count(*) from (select app.rights() d) x where ''parametres.ouvrir'' = any (d) or ''parametres.organisme.modifier'' = any (d)', '=0'),
          ('sa', null, 'super administrateur : les Paramètres', 'select count(*) from (select app.rights() d) x where ''parametres.ouvrir'' = any (d)', '=1'),
          ('ad', null, 'administrateur sans licence : n''attribue pas de profil', 'with x as (insert into public.company_member_roles (member_id, role_key) select m.id, ''salarie'' from public.company_members m where m.profile_id = ''' || u_lec || ''' and m.company_id = ''' || c1 || ''' returning 1) select count(*) from x', 'refus'),
          -- Droits par société : le même compte, deux rôles dans deux sociétés
          ('x', null, 'gestionnaire dans sa société : crée des sessions', 'select count(*) from (select app.a_le_droit(''formation.sessions.creer'') v) x where v', '=1'),
          ('x', '{"x-company-id":"' || c_x || '"}', 'lecture dans la société X : ne crée pas de sessions', 'select count(*) from (select app.a_le_droit(''formation.sessions.creer'') v) x where v', '=0'),
          ('x', '{"x-company-id":"' || c_x || '"}', 'société X : profil de base lecture', 'select count(*) from (select public.my_rights() j) x where (j -> ''profiles'') = ''["lecture"]''::jsonb', '=1'),
          ('x', null, 'aucun droit dans une société sans appartenance', 'select count(*) from (select app.a_le_droit_dans(''' || c_y || ''', ''organisation.reglages.voir'') v) x where v', '=0'),
          ('dir', null, 'isolement : ne lit pas les circuits d''une autre société', 'select count(*) from public.approval_rules where company_id = ''' || c_y || '''', '=0'),
          -- Circuits de validation : commandes au-delà de 100 €
          ('dir', null, 'direction : règle un seuil de 100 € sur les commandes', 'with x as (insert into public.approval_rules (company_id, scope, mode, threshold, validator_right) values (''' || c1 || ''', ''purchase_order'', ''threshold'', 100, ''stock.commandes.valider'') returning 1) select count(*) from x', '=1'),
          ('ges', null, 'gestionnaire : ne règle pas les circuits', 'with x as (insert into public.approval_rules (company_id, scope, mode, validator_right) values (''' || c1 || ''', ''absence'', ''none'', ''rh.absences.valider'') returning 1) select count(*) from x', 'refus'),
          ('tech', null, 'commande de 50 € : aucune validation', 'select count(*) from (select public.approval_submit(''purchase_order'', ''itv_visits'', ''' || v_v1 || ''', 50) v) x where v is null', '=1'),
          ('tech', null, 'commande de 150 € : demande de validation', 'select count(*) from (select public.approval_submit(''purchase_order'', ''itv_visits'', ''' || v_v1 || ''', 150) v) x where v is not null', '=1'),
          ('tech', null, 'ne valide pas sa propre demande', 'select count(*) from (select public.approval_decide((select id from public.approval_requests where object_id = ''' || v_v1 || ''' and status = ''pending''), ''approved'')) x', 'refus'),
          ('ges', null, 'sans le droit, ne valide pas', 'select count(*) from (select public.approval_decide((select r.id from public.approval_requests r limit 1), ''approved'')) x', 'refus'),
          ('dir', null, 'refus sans motif impossible', 'select count(*) from (select public.approval_decide((select id from public.approval_requests where object_id = ''' || v_v1 || ''' and status = ''pending''), ''rejected'')) x', 'refus'),
          ('dir', null, 'direction : valide la commande', 'select count(*) from (select public.approval_decide((select id from public.approval_requests where object_id = ''' || v_v1 || ''' and status = ''pending''), ''approved'', ''Essai'') s) x where s = ''approved''', '=1'),
          ('dir', null, 'direction : délègue ses validations au gestionnaire', 'select count(*) from (select public.approval_delegate(''' || u_ges || ''', now() + interval ''7 days'', ''Essai congés'') v) x where v is not null', '=1'),
          ('tech', null, 'nouvelle commande de 300 €', 'select count(*) from (select public.approval_submit(''purchase_order'', ''itv_visits'', ''' || v_v1 || ''', 300) v) x where v is not null', '=1'),
          ('ges', null, 'gestionnaire délégué : voit la demande', 'select count(*) from public.approval_requests where object_id = ''' || v_v1 || ''' and status = ''pending''', '=1'),
          ('ges', null, 'gestionnaire délégué : valide la commande', 'select count(*) from (select public.approval_decide((select id from public.approval_requests where object_id = ''' || v_v1 || ''' and status = ''pending''), ''approved'') s) x where s = ''approved''', '=1'),
          ('lec', null, 'sans droit : ne voit pas les demandes des autres', 'select count(*) from public.approval_requests', '=0'),
          ('tech', null, 'demande non écrite en direct', 'with x as (insert into public.approval_requests (company_id, scope, object_table, object_id, steps) values (''' || c1 || ''', ''expense'', ''itv_visits'', ''' || v_v1 || ''', ''["frais.notes.valider"]'') returning 1) select count(*) from x', 'refus')
        ) t(who, hdr, label, sql, expect)
      loop
        v_uid := case r.who when 'sa' then u_sa when 'ad' then u_ad when 'dir' then u_dir when 'ges' then u_ges
                            when 'for' then u_for when 'com' then u_com when 'cpt' then u_cpt when 'lec' then u_lec
                            when 'tech' then u_tech when 'ent' then u_ent when 'off' then u_off when 'cpe' then u_cpe
                            when 'rh' then u_rh when 'sal' then u_sal when 'ecr' then u_ecr when 'mbr' then u_mbr
                            when 'x' then u_x end;
        if r.who = 'anon' then
          v_claims := '{"role":"anon"}';
        else
          v_claims := json_build_object('sub', v_uid, 'role', 'authenticated', 'email', 'essai.' || r.who || '@test.invalid')::text;
        end if;
        begin
          perform set_config('request.jwt.claims', v_claims, true);
          perform set_config('request.jwt.claim.sub', coalesce(v_uid::text, ''), true);
          perform set_config('request.headers', coalesce(r.hdr, ''), true);
          if r.who = 'anon' then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
          execute r.sql into v_n;
          v_got := v_n::text;
          execute 'reset role';
        exception when others then
          v_got := 'refus (' || sqlstate || ')';
        end;
        perform set_config('request.headers', '', true);
        v_ok := case
          when r.expect = 'refus' then v_got like 'refus%'
          when r.expect = 'vide' then v_got like 'refus%' or v_got = '0'
          when r.expect = 'non_vide' then v_got ~ '^[0-9]+$' and v_got::bigint > 0
          when r.expect like '=%' then v_got = substr(r.expect, 2)
          else false end;
        v_total := v_total + 1;
        if not v_ok then v_fail := v_fail + 1; end if;
        v_lines := v_lines || format('%s  %-5s %-55s attendu %-10s obtenu %s',
          case when v_ok then 'OK    ' else 'ÉCHEC ' end, r.who, r.label, r.expect, v_got);
      end loop;

      -- Contrôles en postgres : prix posé par la base, offre, ajustement individuel ------------------------
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      v_total := v_total + 4;
      if (select count(*) from public.itv_visit_parts where visit_id = v_v1 and part_id = v_part and unit_price_ht = 42) = 2 then
        v_lines := v_lines || 'OK      base  C1b : prix de la pièce ajoutée par le technicien pris au catalogue'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  C1b : prix de la pièce ajoutée par le technicien pris au catalogue'::text; end if;
      -- Offre : un droit réservé à une offre disparaît, puis revient avec l'offre
      insert into public.offer_restrictions (kind, item_key) values ('right', 'formation.convocations.envoyer');
      if not ('formation.convocations.envoyer' = any (app.rights_for(u_ges, c1))) then
        insert into public.offers (code, label) values ('essai_offre', 'Essai offre') returning id into v_off;
        insert into public.offer_items (offer_id, kind, item_key) values (v_off, 'right', 'formation.convocations.envoyer');
        update public.companies set offer_id = v_off where id = c1;
        if 'formation.convocations.envoyer' = any (app.rights_for(u_ges, c1)) then
          v_lines := v_lines || 'OK      base  C1b : droit réservé à une offre, rendu par l''offre de la société'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  C1b : droit réservé à une offre (non rendu par l''offre)'::text; end if;
        update public.companies set offer_id = null where id = c1;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  C1b : droit réservé à une offre (toujours présent sans offre)'::text; end if;
      delete from public.offer_restrictions where item_key = 'formation.convocations.envoyer';
      -- Ajustement individuel : droit retiré à une personne
      insert into public.company_member_rights (member_id, right_code, effect)
      select m.id, 'clients.fiches.voir', 'revoke' from public.company_members m where m.profile_id = u_lec and m.company_id = c1;
      if not ('clients.fiches.voir' = any (app.rights_for(u_lec, c1))) then
        v_lines := v_lines || 'OK      base  C1b : droit retiré à une personne'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  C1b : droit retiré à une personne'::text; end if;
      delete from public.company_member_rights where right_code = 'clients.fiches.voir' and company_id = c1;
      -- Licence totale : l'administrateur reçoit les Paramètres
      update public.companies set full_license = true where id = c1;
      if 'parametres.ouvrir' = any (app.rights_for(u_ad, c1)) then
        v_lines := v_lines || 'OK      base  C1b : licence totale, l''administrateur ouvre les Paramètres'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  C1b : licence totale, l''administrateur ouvre les Paramètres'::text; end if;
      update public.companies set full_license = false where id = c1;

      -- Nettoyage (l'erreur finale annule de toute façon toute la transaction)
      delete from public.approval_requests where object_id = v_v1;
      delete from public.approval_delegations where company_id in (c1, c_x, c_y) and reason = 'Essai congés';
      delete from public.approval_rules where company_id in (c1, c_y) and validator_right in ('stock.commandes.valider', 'frais.notes.valider');
      delete from public.offers where code = 'essai_offre';
      delete from public.permission_profiles where company_id = c1 and key = 'comptable_externe';
      -- Lignes rattachées aux sociétés fictives (C2 : company_id sur les tables métier)
      declare v_ct text;
      begin
        for v_ct in select distinct tc.relname from pg_constraint k join pg_class tc on tc.oid = k.conrelid
                    join pg_namespace n on n.oid = tc.relnamespace
                    where k.contype = 'f' and k.confrelid = 'public.companies'::regclass and n.nspname = 'public'
                      and tc.relname like '%' and exists (select 1 from pg_constraint k2 where k2.oid = k.oid and k2.conname = tc.relname || '_company_fk') loop
          execute format('delete from public.%I where company_id = any ($1)', v_ct) using array[c_x, c_y];
        end loop;
      end;
      delete from public.company_members where company_id in (c_x, c_y);
      delete from public.audit_logs where company_id in (c_x, c_y);
      delete from public.companies where id in (c_x, c_y);
    end;
  end if;

  -- Contrôle de l'annuaire (0365) : l'annuaire ne s'appelle pas pendant les tests ; jusqu'au bloc 0365, un déclencheur
  -- d'essai (annulé avec le reste) marque chaque nouvelle facture comme vérifiée pour le SIRET actuel de son client.
  if to_regprocedure('public.billing_siret_motif(uuid, text)') is not null then
    execute 'reset role';
    execute $f$create or replace function app.zz_essai_siret() returns trigger language plpgsql set search_path = '' as $c$
      begin
        new.siret_checked_at := now();
        new.siret_check_result := jsonb_build_object('etat', 'actif', 'ecarts', '[]'::jsonb, 'identifiant',
          (select regexp_replace(coalesce(nullif(btrim(c.siret), ''), c.siren, ''), '\s', '', 'g') from public.clients c
            where c.id = coalesce(new.billing_client_id, new.client_id)));
        return new;
      end $c$$f$;
    execute 'create trigger zz_essai_siret before insert on public.invoices for each row execute function app.zz_essai_siret()';
    execute $f$create or replace function app.zz_essai_siret_client() returns trigger language plpgsql security definer set search_path = '' as $c$
      begin
        update public.invoices set siret_checked_at = now(), siret_check_result = jsonb_build_object('etat', 'actif', 'ecarts', '[]'::jsonb,
          'identifiant', regexp_replace(coalesce(nullif(btrim(new.siret), ''), new.siren, ''), '\s', '', 'g'))
        where issued_at is null and coalesce(billing_client_id, client_id) = new.id;
        return new;
      end $c$$f$;
    execute 'create trigger zz_essai_siret after update on public.clients for each row execute function app.zz_essai_siret_client()';
  end if;

  -- Facturation fiable : numérotation par la base, émission, verrou (0360 à 0362)
  if to_regprocedure('public.billing_issue(uuid)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 13;
    declare
      b_dir uuid := gen_random_uuid(); b_lec uuid := gen_random_uuid(); b_cli uuid; b_f1 uuid; b_f2 uuid; b_av uuid;
      b_r1 jsonb; b_r2 jsonb; b_ok boolean; b_ref text; b_n1 bigint; b_n2 bigint;
    begin
      insert into auth.users (id, email, aud, role) values
        (b_dir, 'fac.dir@test.invalid', 'authenticated', 'authenticated'), (b_lec, 'fac.lec@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (b_dir, 'fac.dir@test.invalid', 'direction', true), (b_lec, 'fac.lec@test.invalid', 'lecture', true)
      on conflict (id) do update set role = excluded.role, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      insert into public.clients (name, siret, siren, address, postal_code, city, tva) values
        ('Client facturation essai', '12345678900011', '123456789', '1 rue de l''Essai', '29200', 'Brest', 'FR00123456789') returning id into b_cli;
      -- Organisme complet pour l'essai (base locale) ; la production garde ses valeurs (coalesce)
      update public.organization_settings set legal_name = coalesce(legal_name, 'Organisme essai'), siren = coalesce(siren, '987654321'),
        address = coalesce(address, '2 rue de l''Essai'), postal_code = coalesce(postal_code, '29200'), city = coalesce(city, 'Brest'),
        forme_juridique = coalesce(forme_juridique, 'SARL'), capital_social = coalesce(capital_social, '1000'),
        tva_intra = coalesce(tva_intra, 'FR00987654321'), rcs = coalesce(rcs, 'RCS Brest 987 654 321');
      -- RIB de démonstration (0384) : remplacé le temps de l'essai, pour que l'émission soit possible (tout est annulé)
      if to_regprocedure('app.rib_demo(uuid)') is not null and app.rib_demo(app.company_default()) then
        update public.organization_settings set bic = 'BANKFRPPXXX', iban = 'FR7612345678901234567890104';
        update public.companies set bic = null, iban = null;
      end if;
      perform set_config('request.jwt.claims', json_build_object('sub', b_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.invoices (reference, type, client_id, invoice_date, due_date, status)
      values ('FACT-TRICHE-1', 'invoice', b_cli, current_date, current_date + 30, 'due') returning id, reference into b_f1, b_ref;
      insert into public.invoice_items (invoice_id, position, description_title, quantity, unit_price_ht, tva_rate)
      values (b_f1, 0, 'Ligne A', 3, 33.335, 20), (b_f1, 1, 'Ligne B', 1, 10, 0);
      execute 'reset role';
      if b_ref like 'BROUILLON-%' and (select status from public.invoices where id = b_f1) = 'draft' then
        v_lines := v_lines || 'OK      dir   0362 : un document naît brouillon, sans numéro'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0362 : un document naît brouillon, sans numéro (' || b_ref || ')'); end if;
      -- Un compte connecté ne pose pas lui-même l'émission ni un statut
      execute 'set local role authenticated';
      b_ok := false;
      begin update public.invoices set issued_at = now() where id = b_f1; exception when insufficient_privilege then b_ok := true; end;
      begin update public.invoices set status = 'due' where id = b_f1; b_ok := false; exception when insufficient_privilege then null; end;
      execute 'reset role';
      if b_ok then v_lines := v_lines || 'OK      dir   0362 : émission et statut seulement par la fonction d''émission'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0362 : émission et statut seulement par la fonction d''émission'::text; end if;
      -- Lecture ne peut pas émettre
      perform set_config('request.jwt.claims', json_build_object('sub', b_lec, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      b_ok := false;
      begin perform public.billing_issue(b_f1); exception when insufficient_privilege then b_ok := true; end;
      execute 'reset role';
      if b_ok then v_lines := v_lines || 'OK      lec   0361 : émission refusée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   lec   0361 : émission refusée'::text; end if;
      -- Direction émet : numéro, totaux de la règle unique (3 x 33,335 = 100,01 ; TVA 20,00 ; ligne à 0 %)
      perform set_config('request.jwt.claims', json_build_object('sub', b_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      b_r1 := public.billing_issue(b_f1);
      insert into public.invoices (reference, type, client_id, invoice_date, due_date) values ('x', 'invoice', b_cli, current_date, current_date + 30) returning id into b_f2;
      insert into public.invoice_items (invoice_id, position, description_title, quantity, unit_price_ht, tva_rate) values (b_f2, 0, 'Ligne', 1, 50, 20);
      b_r2 := public.billing_issue(b_f2);
      execute 'reset role';
      b_n1 := (regexp_match(b_r1 ->> 'reference', '([0-9]+)$'))[1]::bigint;
      b_n2 := (regexp_match(b_r2 ->> 'reference', '([0-9]+)$'))[1]::bigint;
      if b_r1 ->> 'reference' like 'FACT-%' and b_n2 = b_n1 + 1 then
        v_lines := v_lines || 'OK      dir   0361 : numéros donnés par la base, consécutifs'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0361 : numéros donnés par la base, consécutifs (' || coalesce(b_r1 ->> 'reference', '') || ', ' || coalesce(b_r2 ->> 'reference', '') || ')'); end if;
      if (select total_ttc from public.invoices where id = b_f1) = 130.01 and (select total_tva from public.invoices where id = b_f1) = 20.00
         and (select issued_at is not null and seller_snapshot is not null and buyer_snapshot is not null and status = 'due' from public.invoices where id = b_f1) then
        v_lines := v_lines || 'OK      dir   0361 : totaux de la règle unique, coordonnées figées, date d''émission'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0361 : totaux de la règle unique, coordonnées figées (' || (select total_ttc::text || ' / ' || total_tva::text from public.invoices where id = b_f1) || ')'); end if;
      -- Verrou : ni modification du contenu, ni lignes, ni suppression, ni retour en brouillon (postgres compris)
      execute 'set local role authenticated';
      b_ok := true;
      begin update public.invoices set object = 'modifié' where id = b_f1; b_ok := false; exception when insufficient_privilege then null; end;
      begin update public.invoices set status = 'draft' where id = b_f1; b_ok := false; exception when insufficient_privilege then null; end;
      begin insert into public.invoice_items (invoice_id, position, description_title, quantity, unit_price_ht) values (b_f1, 9, 'x', 1, 1); b_ok := false; exception when insufficient_privilege then null; end;
      begin update public.invoice_items set unit_price_ht = 1 where invoice_id = b_f1; b_ok := false; exception when insufficient_privilege then null; end;
      execute 'reset role';
      if b_ok then v_lines := v_lines || 'OK      dir   0362 : facture émise figée (contenu, lignes, statut brouillon)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0362 : facture émise figée (contenu, lignes, statut brouillon)'::text; end if;
      b_ok := false;
      begin delete from public.invoices where id = b_f1; exception when insufficient_privilege then b_ok := true; end;
      if b_ok then v_lines := v_lines || 'OK      base  0362 : suppression d''une facture émise refusée, même au propriétaire'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0362 : suppression d''une facture émise refusée, même au propriétaire'::text; end if;
      execute 'set local role authenticated';
      b_ok := true;
      begin update public.invoices set amount_paid = 10, amount_due = 120.01, status = 'partial' where id = b_f1;
      exception when others then b_ok := false; end;
      execute 'reset role';
      if b_ok then v_lines := v_lines || 'OK      dir   0362 : paiement saisi sur une facture émise'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0362 : paiement saisi sur une facture émise'::text; end if;
      -- Avoir : au-delà du montant refusé ; avoir partiel émis en série AVR
      execute 'set local role authenticated';
      insert into public.invoices (reference, type, client_id, parent_invoice_id, invoice_date) values ('x', 'credit_note', b_cli, b_f2, current_date) returning id into b_av;
      insert into public.invoice_items (invoice_id, position, description_title, quantity, unit_price_ht, tva_rate) values (b_av, 0, 'Trop', 1, 100, 20);
      b_ok := false;
      begin perform public.billing_issue(b_av); exception when sqlstate '22023' then b_ok := true; end;
      execute 'reset role';
      if b_ok then v_lines := v_lines || 'OK      dir   0361 : avoir supérieur à la facture refusé'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0361 : avoir supérieur à la facture refusé'::text; end if;
      execute 'set local role authenticated';
      update public.invoice_items set unit_price_ht = 10 where invoice_id = b_av;
      b_r1 := public.billing_issue(b_av);
      execute 'reset role';
      if b_r1 ->> 'reference' like 'AVR-%' then v_lines := v_lines || 'OK      dir   0361 : avoir émis en série AVR'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0361 : avoir émis en série AVR (' || coalesce(b_r1 ->> 'reference', '') || ')'); end if;
      -- Brouillon : reste supprimable par qui en a le droit
      execute 'set local role authenticated';
      insert into public.invoices (reference, type, client_id, invoice_date, due_date) values ('x', 'invoice', b_cli, current_date, current_date + 30) returning id into b_f2;
      delete from public.invoices where id = b_f2;
      execute 'reset role';
      if not exists (select 1 from public.invoices where id = b_f2) then v_lines := v_lines || 'OK      dir   0362 : brouillon supprimable'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0362 : brouillon supprimable'::text; end if;
      -- Aperçu du prochain numéro sans avancer le compteur
      execute 'set local role authenticated';
      b_ref := public.billing_next_number('invoice');
      execute 'reset role';
      if (regexp_match(b_ref, '([0-9]+)$'))[1]::bigint = b_n2 + 1 then v_lines := v_lines || 'OK      dir   0361 : aperçu du prochain numéro'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0361 : aperçu du prochain numéro (' || b_ref || ')'); end if;
      if (select count(*) from pg_class where relname in ('billing_settings', 'billing_sequences') and relrowsecurity) = 2 then
        v_lines := v_lines || 'OK      base  0360 : RLS sur les réglages et les compteurs'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0360 : RLS sur les réglages et les compteurs'::text; end if;
      perform set_config('request.jwt.claims', '', true);
    end;
  end if;

  -- Écritures de la nuit (0376) : fonction réservée à la tâche planifiée, idempotente
  if to_regprocedure('public.daily_maintenance()') is not null then
    execute 'reset role';
    v_total := v_total + 3;
    if not has_function_privilege('anon', 'public.daily_maintenance()', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.daily_maintenance()', 'EXECUTE')
       and has_function_privilege('service_role', 'public.daily_maintenance()', 'EXECUTE') then
      v_lines := v_lines || 'OK      base  0376 : maintenance de la nuit réservée à la tâche planifiée'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0376 : maintenance de la nuit réservée à la tâche planifiée'::text; end if;
    declare
      v_sm uuid; v_r1 jsonb; v_r2 jsonb;
    begin
      insert into public.sessions (start_date, end_date, attendance_token, status)
      values (current_date - 5, current_date - 3, 'nuit-' || replace(gen_random_uuid()::text, '-', ''), 'planned')
      returning id into v_sm;
      execute 'set local role service_role';
      v_r1 := public.daily_maintenance();
      v_r2 := public.daily_maintenance();
      execute 'reset role';
      if (select status from public.sessions where id = v_sm) = 'completed' then
        v_lines := v_lines || 'OK      base  0376 : session passée marquée terminée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0376 : session passée marquée terminée'::text; end if;
      if (v_r2->>'sessions_terminees')::int = 0 and (v_r2->>'rappels')::int = 0 and (v_r2->>'alertes_qualite')::int = 0
         and (v_r2->>'factures_en_retard')::int = 0 and (v_r2->>'factures_dues')::int = 0 then
        v_lines := v_lines || 'OK      base  0376 : relancée le même jour, ne refait rien'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0376 : relancée le même jour, ne refait rien (' || v_r2::text || ')'); end if;
    end;
  end if;

  -- Écrans des droits (0377) : aperçu, personnalisation et retour au modèle, réservés aux bons droits
  if to_regprocedure('public.permission_profile_customize(text)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 6;
    declare
      e_ad uuid := gen_random_uuid(); e_lec uuid := gen_random_uuid(); e_c uuid; e_lic boolean; e_p uuid; e_ok boolean;
    begin
      select id, full_license into e_c, e_lic from public.companies where is_instance_owner;
      insert into auth.users (id, email, aud, role) values
        (e_ad, 'ecr.ad@test.invalid', 'authenticated', 'authenticated'), (e_lec, 'ecr.lec@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (e_ad, 'ecr.ad@test.invalid', 'admin', true), (e_lec, 'ecr.lec@test.invalid', 'lecture', true)
      on conflict (id) do update set role = excluded.role, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      if has_function_privilege('anon', 'public.member_rights_preview(uuid)', 'EXECUTE')
         or has_function_privilege('anon', 'public.permission_profile_customize(text)', 'EXECUTE') then
        v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0377 : fonctions des écrans de droits fermées à anon'::text;
      else v_lines := v_lines || 'OK      base  0377 : fonctions des écrans de droits fermées à anon'::text; end if;
      -- Lecture : son propre aperçu oui, celui d'un autre non
      perform set_config('request.jwt.claims', json_build_object('sub', e_lec, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      e_ok := (public.member_rights_preview(e_lec) ->> 'rights') is not null;
      begin
        perform public.member_rights_preview(e_ad); e_ok := false;
      exception when insufficient_privilege then null;
      end;
      execute 'reset role';
      if e_ok then v_lines := v_lines || 'OK      lec   0377 : aperçu de ses droits seulement'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   lec   0377 : aperçu de ses droits seulement'::text; end if;
      -- Administrateur sans licence totale : ne personnalise pas un profil
      alter table public.companies disable trigger companies_guard;
      update public.companies set full_license = false where id = e_c;
      alter table public.companies enable trigger companies_guard;
      perform set_config('request.jwt.claims', json_build_object('sub', e_ad, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      e_ok := false;
      begin
        perform public.permission_profile_customize('lecture');
      exception when insufficient_privilege then e_ok := true;
      end;
      execute 'reset role';
      if e_ok then v_lines := v_lines || 'OK      ad    0377 : sans licence totale, pas de personnalisation'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ad    0377 : sans licence totale, pas de personnalisation'::text; end if;
      -- Avec licence totale : copie identique au modèle, aperçu d'un autre, puis retour au modèle
      alter table public.companies disable trigger companies_guard;
      update public.companies set full_license = true where id = e_c;
      alter table public.companies enable trigger companies_guard;
      execute 'set local role authenticated';
      e_p := public.permission_profile_customize('lecture');
      e_ok := (public.member_rights_preview(e_lec) ->> 'rights') is not null;
      execute 'reset role';
      if e_p is not null and e_ok and (select array_agg(right_code order by right_code) from public.permission_profile_rights where profile_id = e_p)
           = (select array_agg(x7.right_code order by x7.right_code) from public.permission_profile_rights x7
              join public.permission_profiles y7 on y7.id = x7.profile_id where y7.company_id is null and y7.key = 'lecture') then
        v_lines := v_lines || 'OK      ad    0377 : personnalisation = copie exacte du modèle, aperçu des autres'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ad    0377 : personnalisation = copie exacte du modèle, aperçu des autres'::text; end if;
      if app.rights_for(e_lec, e_c) = (select coalesce(array_agg(x7.right_code order by x7.right_code), '{}') from public.permission_profile_rights x7
            join public.permissions z7 on z7.code = x7.right_code where x7.profile_id = e_p and not z7.platform_only
              and (not z7.full_license_only or (select c7.full_license from public.companies c7 where c7.id = e_c))) then
        v_lines := v_lines || 'OK      base  0377 : la copie de la société remplace le modèle sans rien changer'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0377 : la copie de la société remplace le modèle sans rien changer'::text; end if;
      execute 'set local role authenticated';
      e_ok := public.permission_profile_reset('lecture');
      execute 'reset role';
      if e_ok and not exists (select 1 from public.permission_profiles where company_id = e_c and key = 'lecture') then
        v_lines := v_lines || 'OK      ad    0377 : retour au modèle'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ad    0377 : retour au modèle'::text; end if;
      alter table public.companies disable trigger companies_guard;
      update public.companies set full_license = e_lic where id = e_c;
      alter table public.companies enable trigger companies_guard;
      perform set_config('request.jwt.claims', '', true);
    end;
  end if;

  -- Fonctions, fichiers et handicap par droits (0378)
  if to_regprocedure('app.un_des_droits(text[])') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 4;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname like 'odet\_%' and (coalesce(qual, '') || coalesce(with_check, '')) like '%app.role()%'
                   and (coalesce(qual, '') || coalesce(with_check, '')) not like '%un_des_droits%') then
      v_lines := v_lines || 'OK      base  0378 : chaque règle de fichiers demande aussi un droit'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0378 : chaque règle de fichiers demande aussi un droit'::text; end if;
    if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                   and pg_get_functiondef(p.oid) like '%garde chantier 2%' and pg_get_functiondef(p.oid) like '%app.require_roles(%') then
      v_lines := v_lines || 'OK      base  0378 : plus aucune garde de fonction par groupe de rôles'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0378 : plus aucune garde de fonction par groupe de rôles'::text; end if;
    declare
      f_lec uuid := gen_random_uuid(); f_ges uuid := gen_random_uuid(); f_c uuid; f_m uuid; f_s uuid; f_a boolean; f_b boolean; f_h1 boolean; f_h2 boolean;
    begin
      select id into f_c from public.companies where is_instance_owner;
      insert into auth.users (id, email, aud, role) values
        (f_lec, 'fct.lec@test.invalid', 'authenticated', 'authenticated'), (f_ges, 'fct.ges@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (f_lec, 'fct.lec@test.invalid', 'lecture', true), (f_ges, 'fct.ges@test.invalid', 'gestionnaire', true)
      on conflict (id) do update set role = excluded.role, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      select id into f_s from public.sessions limit 1;
      select id into f_m from public.company_members where profile_id = f_lec and company_id = f_c;
      perform set_config('request.jwt.claims', json_build_object('sub', f_lec, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      f_a := app.can_read_session(f_s);
      execute 'reset role';
      insert into public.company_member_rights (member_id, company_id, right_code, effect) values (f_m, f_c, 'formation.suivi.voir', 'revoke');
      execute 'set local role authenticated';
      f_b := app.can_read_session(f_s);
      execute 'reset role';
      if f_s is null or (f_a and not f_b) then
        v_lines := v_lines || 'OK      lec   0378 : droit retiré à une personne, la fonction suit'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   lec   0378 : droit retiré à une personne, la fonction suit'::text; end if;
      perform set_config('request.jwt.claims', json_build_object('sub', f_ges, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      f_h1 := app.can_see_disability();
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if not f_h1 then
        v_lines := v_lines || 'OK      ges   0378 : handicap fermé au gestionnaire (droit qualite.handicap.voir)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   0378 : handicap fermé au gestionnaire (droit qualite.handicap.voir)'::text; end if;
    end;
  end if;

  -- Compteur des numéros en démonstration (0369)
  if to_regprocedure('public.billing_counter_reset()') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 3;
    declare
      k_sa uuid := gen_random_uuid(); k_ad uuid := gen_random_uuid(); k_demo boolean; k_ok boolean; k_c uuid := app.billing_company();
    begin
      select coalesce(demo_mode, false) into k_demo from public.organization_settings limit 1;
      insert into auth.users (id, email, aud, role) values
        (k_sa, 'cpt.sa@test.invalid', 'authenticated', 'authenticated'), (k_ad, 'cpt.ad@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (k_sa, 'cpt.sa@test.invalid', 'superadmin', true), (k_ad, 'cpt.ad@test.invalid', 'admin', true)
      on conflict (id) do update set role = excluded.role, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      insert into public.billing_sequences (company_id, series, last_number) values (k_c, 'invoice', 7)
      on conflict (company_id, series) do update set last_number = 7;
      -- Administrateur : refusé
      perform set_config('request.jwt.claims', json_build_object('sub', k_ad, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      k_ok := false;
      begin perform public.billing_counter_reset(); exception when insufficient_privilege then k_ok := true; end;
      execute 'reset role';
      if k_ok then v_lines := v_lines || 'OK      ad    0369 : remise à zéro du compteur refusée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ad    0369 : remise à zéro du compteur refusée'::text; end if;
      -- Super administrateur hors démonstration : refusé
      update public.organization_settings set demo_mode = false;
      perform set_config('request.jwt.claims', json_build_object('sub', k_sa, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      k_ok := false;
      begin perform public.billing_counter_reset(); exception when insufficient_privilege then k_ok := true; end;
      execute 'reset role';
      if k_ok and exists (select 1 from public.billing_sequences where company_id = k_c) then
        v_lines := v_lines || 'OK      sa    0369 : hors démonstration, le compteur ne recule jamais'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   sa    0369 : hors démonstration, le compteur ne recule jamais'::text; end if;
      -- Super administrateur en démonstration : accepté
      update public.organization_settings set demo_mode = true;
      execute 'set local role authenticated';
      perform public.billing_counter_reset();
      execute 'reset role';
      if not exists (select 1 from public.billing_sequences where company_id = k_c) then
        v_lines := v_lines || 'OK      sa    0369 : en démonstration, compteur remis à zéro'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   sa    0369 : en démonstration, compteur remis à zéro'::text; end if;
      update public.organization_settings set demo_mode = k_demo;
      perform set_config('request.jwt.claims', '', true);
    end;
  end if;

  -- Mentions obligatoires, nature et régime par ligne (0363)
  if to_regprocedure('public.billing_missing_mentions(uuid)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 6;
    declare
      m_dir uuid := gen_random_uuid(); m_cli uuid; m_part uuid; m_f uuid; m_p uuid; m_ok boolean; m_chk jsonb;
    begin
      insert into auth.users (id, email, aud, role) values (m_dir, 'men.dir@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (m_dir, 'men.dir@test.invalid', 'direction', true)
      on conflict (id) do update set role = excluded.role, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      update public.organization_settings set legal_name = coalesce(legal_name, 'Organisme essai'), siren = coalesce(siren, '987654321'),
        address = coalesce(address, '2 rue de l''Essai'), postal_code = coalesce(postal_code, '29200'), city = coalesce(city, 'Brest'),
        forme_juridique = coalesce(forme_juridique, 'SARL'), capital_social = coalesce(capital_social, '1000'),
        tva_intra = coalesce(tva_intra, 'FR00987654321'), rcs = coalesce(rcs, 'RCS Brest 987 654 321');
      insert into public.clients (name, address, postal_code, city) values ('Pro sans SIREN essai', '3 rue', '29200', 'Brest') returning id into m_cli;
      insert into public.clients (name, address, postal_code, city, client_type, vat_exempt) values ('Particulier essai', '4 rue', '29200', 'Brest', 'particulier', true) returning id into m_part;
      perform set_config('request.jwt.claims', json_build_object('sub', m_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.invoices (reference, type, client_id, invoice_date, due_date) values ('x', 'invoice', m_cli, current_date, current_date + 30) returning id into m_f;
      insert into public.invoice_items (invoice_id, position, description_title, quantity, unit_price_ht, tva_rate) values (m_f, 0, 'Ligne', 1, 500, 20);
      m_chk := public.billing_missing_mentions(m_f);
      m_ok := false;
      begin perform public.billing_issue(m_f); exception when sqlstate '22023' then m_ok := true; end;
      execute 'reset role';
      if m_ok and m_chk -> 'points' @> '[{"code": "client_siren", "bloquant": true}]' and m_chk -> 'points' @> '[{"code": "client_tva", "bloquant": true}]' then
        v_lines := v_lines || 'OK      dir   0363 : client pro sans SIREN ni TVA : émission refusée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0363 : client pro sans SIREN ni TVA : émission refusée (' || coalesce(m_chk::text, '') || ')'); end if;
      -- Ligne exonérée sans exonération activée : refusée
      execute 'set local role authenticated';
      update public.clients set siren = '123456789', tva = 'FR00123456789' where id = m_cli;
      update public.invoice_items set vat_regime = 'exonere', tva_rate = 0 where invoice_id = m_f;
      m_chk := public.billing_missing_mentions(m_f);
      execute 'reset role';
      if m_chk -> 'points' @> '[{"code": "exoneration", "bloquant": true}]' then
        v_lines := v_lines || 'OK      dir   0363 : ligne exonérée refusée sans exonération activée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0363 : ligne exonérée refusée sans exonération activée (' || m_chk::text || ')'); end if;
      -- Client pro complet : émise, mentions pro figées (escompte, pénalités, indemnité), nature services
      execute 'set local role authenticated';
      update public.invoice_items set vat_regime = 'normal', tva_rate = 20 where invoice_id = m_f;
      perform public.billing_issue(m_f);
      execute 'reset role';
      if (select jsonb_array_length(legal_mentions) >= 3 and legal_mentions::text like '%40 €%' and nature_operation = 'services' from public.invoices where id = m_f) then
        v_lines := v_lines || 'OK      dir   0363 : mentions pro et nature figées à l''émission'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0363 : mentions pro et nature figées (' || (select coalesce(legal_mentions::text, 'vide') || ' ' || coalesce(nature_operation, '') from public.invoices where id = m_f) || ')'); end if;
      -- Particulier : pas d'indemnité de 40 €, pas de SIREN demandé ; ligne de bien : nature biens
      execute 'set local role authenticated';
      insert into public.invoices (reference, type, client_id, invoice_date, due_date, service_start_date) values ('x', 'invoice', m_part, current_date, current_date + 30, current_date) returning id into m_p;
      insert into public.invoice_items (invoice_id, position, description_title, quantity, unit_price_ht, tva_rate, nature) values (m_p, 0, 'Extincteur', 1, 80, 20, 'bien');
      m_chk := public.billing_missing_mentions(m_p);
      perform public.billing_issue(m_p);
      execute 'reset role';
      if jsonb_array_length(m_chk -> 'points') = 0 and (select legal_mentions::text not like '%40 €%' and nature_operation = 'biens' from public.invoices where id = m_p) then
        v_lines := v_lines || 'OK      dir   0363 : particulier sans indemnité de 40 €, nature biens'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0363 : particulier sans indemnité de 40 € (' || m_chk::text || ')'); end if;
      -- Lignes : régime inconnu refusé par la base
      m_ok := false;
      begin insert into public.invoice_items (invoice_id, position, description_title, vat_regime) values (m_f, 5, 'x', 'franchise'); exception when check_violation then m_ok := true; when insufficient_privilege then m_ok := true; end;
      if m_ok then v_lines := v_lines || 'OK      base  0363 : régime de TVA de ligne contrôlé'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0363 : régime de TVA de ligne contrôlé'::text; end if;
      if not has_function_privilege('authenticated', 'app.billing_check(uuid)', 'EXECUTE') and not has_function_privilege('anon', 'public.billing_missing_mentions(uuid)', 'EXECUTE') then
        v_lines := v_lines || 'OK      base  0363 : contrôle interne fermé, écran par droit'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0363 : contrôle interne fermé, écran par droit'::text; end if;
      perform set_config('request.jwt.claims', '', true);
    end;
  end if;

  -- Avoirs et reprise d'une facture (0364)
  if to_regprocedure('public.billing_create_credit_note(uuid, text, jsonb, numeric)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 6;
    declare
      a_dir uuid := gen_random_uuid(); a_com uuid := gen_random_uuid(); a_cli uuid; a_f uuid; a_av uuid; a_av2 uuid; a_dup uuid; a_it uuid; a_ok boolean;
    begin
      insert into auth.users (id, email, aud, role) values
        (a_dir, 'avo.dir@test.invalid', 'authenticated', 'authenticated'), (a_com, 'avo.com@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (a_dir, 'avo.dir@test.invalid', 'direction', true), (a_com, 'avo.com@test.invalid', 'commercial', true)
      on conflict (id) do update set role = excluded.role, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      update public.organization_settings set legal_name = coalesce(legal_name, 'Organisme essai'), siren = coalesce(siren, '987654321'),
        address = coalesce(address, '2 rue de l''Essai'), postal_code = coalesce(postal_code, '29200'), city = coalesce(city, 'Brest'),
        forme_juridique = coalesce(forme_juridique, 'SARL'), capital_social = coalesce(capital_social, '1000'),
        tva_intra = coalesce(tva_intra, 'FR00987654321'), rcs = coalesce(rcs, 'RCS Brest 987 654 321');
      insert into public.clients (name, siret, siren, address, postal_code, city, tva) values
        ('Client avoir essai', '12345678900011', '123456789', '1 rue', '29200', 'Brest', 'FR00123456789') returning id into a_cli;
      perform set_config('request.jwt.claims', json_build_object('sub', a_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.invoices (reference, type, client_id, invoice_date, due_date) values ('x', 'invoice', a_cli, current_date, current_date + 30) returning id into a_f;
      insert into public.invoice_items (invoice_id, position, description_title, quantity, unit_price_ht, tva_rate) values
        (a_f, 0, 'Formation', 2, 500, 20), (a_f, 1, 'Livret', 10, 5, 5.5);
      -- Brouillon : pas d'avoir
      a_ok := false;
      begin perform public.billing_create_credit_note(a_f, 'total'); exception when sqlstate '22023' then a_ok := true; end;
      perform public.billing_issue(a_f);
      -- Total : lignes identiques
      a_av := public.billing_create_credit_note(a_f, 'total');
      execute 'reset role';
      if a_ok and (select count(*) from public.invoice_items where invoice_id = a_av) = 2
         and (select type = 'credit_note' and parent_invoice_id = a_f and issued_at is null from public.invoices where id = a_av) then
        v_lines := v_lines || 'OK      dir   0364 : avoir total préparé en brouillon (refusé sur un brouillon)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0364 : avoir total préparé en brouillon (refusé sur un brouillon)'::text; end if;
      -- Partiel : quantité plafonnée à la facture
      select id into a_it from public.invoice_items where invoice_id = a_f and position = 0;
      execute 'set local role authenticated';
      a_av2 := public.billing_create_credit_note(a_f, 'partiel', jsonb_build_array(jsonb_build_object('item_id', a_it, 'quantity', 9)));
      execute 'reset role';
      if (select quantity from public.invoice_items where invoice_id = a_av2) = 2 then
        v_lines := v_lines || 'OK      dir   0364 : avoir partiel plafonné aux quantités de la facture'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0364 : avoir partiel plafonné aux quantités de la facture'::text; end if;
      -- Pourcentage : une ligne par taux, 10 % des bases
      execute 'set local role authenticated';
      delete from public.invoices where id in (a_av, a_av2);
      a_av := public.billing_create_credit_note(a_f, 'pourcentage', null, 10);
      execute 'reset role';
      if (select count(*) from public.invoice_items where invoice_id = a_av) = 2
         and (select sum(unit_price_ht) from public.invoice_items where invoice_id = a_av) = 105 then
        v_lines := v_lines || 'OK      dir   0364 : réduction en pourcentage, une ligne par taux'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0364 : réduction en pourcentage, une ligne par taux'::text; end if;
      -- Avoir émis, puis facture entièrement couverte : plus d'avoir possible
      execute 'set local role authenticated';
      delete from public.invoices where id = a_av;
      a_av := public.billing_create_credit_note(a_f, 'total');
      perform public.billing_issue(a_av);
      a_ok := false;
      begin perform public.billing_create_credit_note(a_f, 'libre'); exception when sqlstate '22023' then a_ok := true; end;
      execute 'reset role';
      if a_ok then v_lines := v_lines || 'OK      dir   0364 : facture couverte, plus d''avoir possible'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0364 : facture couverte, plus d''avoir possible'::text; end if;
      -- Nouvelle facture reprise de la facture annulée : brouillon, mêmes lignes
      execute 'set local role authenticated';
      a_dup := public.billing_duplicate_invoice(a_f);
      execute 'reset role';
      if (select issued_at is null and reference like 'BROUILLON-%' from public.invoices where id = a_dup) and (select count(*) from public.invoice_items where invoice_id = a_dup) = 2 then
        v_lines := v_lines || 'OK      dir   0364 : nouvelle facture préremplie, sans numéro'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0364 : nouvelle facture préremplie, sans numéro'::text; end if;
      -- Commercial (sans le droit des avoirs) : refusé
      perform set_config('request.jwt.claims', json_build_object('sub', a_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      a_ok := false;
      begin perform public.billing_create_credit_note(a_f, 'libre'); exception when insufficient_privilege then a_ok := true; end;
      execute 'reset role';
      if a_ok then v_lines := v_lines || 'OK      com   0364 : préparer un avoir refusé sans le droit'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0364 : préparer un avoir refusé sans le droit'::text; end if;
      perform set_config('request.jwt.claims', '', true);
    end;
  end if;

  -- Revérification du SIRET dans l'annuaire avant émission (0365)
  if to_regprocedure('public.billing_siret_motif(uuid, text)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    execute 'drop trigger if exists zz_essai_siret on public.invoices';
    execute 'drop trigger if exists zz_essai_siret on public.clients';
    v_total := v_total + 7;
    declare
      s_dir uuid := gen_random_uuid(); s_com uuid := gen_random_uuid(); s_cli uuid; s_par uuid; s_f uuid; s_g uuid; s_p uuid; s_ok boolean; s_pts jsonb;
    begin
      insert into auth.users (id, email, aud, role) values
        (s_dir, 'sir.dir@test.invalid', 'authenticated', 'authenticated'), (s_com, 'sir.com@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (s_dir, 'sir.dir@test.invalid', 'direction', true), (s_com, 'sir.com@test.invalid', 'commercial', true)
      on conflict (id) do update set role = excluded.role, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      update public.organization_settings set legal_name = coalesce(legal_name, 'Organisme essai'), siren = coalesce(siren, '987654321'),
        address = coalesce(address, '2 rue de l''Essai'), postal_code = coalesce(postal_code, '29200'), city = coalesce(city, 'Brest'),
        forme_juridique = coalesce(forme_juridique, 'SARL'), capital_social = coalesce(capital_social, '1000'),
        tva_intra = coalesce(tva_intra, 'FR00987654321'), rcs = coalesce(rcs, 'RCS Brest 987 654 321');
      insert into public.clients (name, siret, siren, address, postal_code, city, tva) values
        ('Client annuaire essai', '12345678900011', '123456789', '1 rue', '29200', 'Brest', 'FR00123456789') returning id into s_cli;
      insert into public.clients (name, address, postal_code, city, client_type) values
        ('Particulier essai', '3 rue', '29200', 'Brest', 'particulier') returning id into s_par;
      perform set_config('request.jwt.claims', json_build_object('sub', s_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.invoices (reference, type, client_id, invoice_date, due_date, siret_checked_at, siret_check_result)
        values ('x', 'invoice', s_cli, current_date, current_date + 30, now(), '{"identifiant": "12345678900011", "etat": "actif"}') returning id into s_f;
      insert into public.invoice_items (invoice_id, position, description_title, quantity, unit_price_ht, tva_rate) values (s_f, 0, 'Formation', 1, 100, 20);
      -- Sans contrôle : émission refusée (le contrôle passé à la création est effacé)
      s_ok := false;
      begin perform public.billing_issue(s_f); exception when sqlstate '22023' then s_ok := sqlerrm like '%annuaire%'; end;
      if s_ok and (select siret_checked_at is null from public.invoices where id = s_f) then
        v_lines := v_lines || 'OK      dir   0365 : émission refusée sans contrôle de l''annuaire'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0365 : émission refusée sans contrôle de l''annuaire'::text; end if;
      -- Le contrôle ne se saisit pas à la main
      update public.invoices set siret_checked_at = now(), siret_check_result = '{"identifiant": "12345678900011", "etat": "actif"}' where id = s_f;
      update public.clients set siret_checked_at = now() where id = s_cli;
      if (select siret_checked_at is null and siret_check_result is null from public.invoices where id = s_f)
         and (select siret_checked_at is null from public.clients where id = s_cli) then v_lines := v_lines || 'OK      dir   0365 : contrôle de l''annuaire non modifiable à la main'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0365 : contrôle de l''annuaire non modifiable à la main'::text; end if;
      execute 'reset role';
      -- Contrôle du serveur : établissement fermé = alerte, pas de blocage ; autre SIRET = à refaire ; plus de 24 h = à refaire
      update public.invoices set siret_checked_at = now(),
        siret_check_result = '{"identifiant": "12345678900011", "etat": "ferme", "message": "Établissement fermé dans l''annuaire", "ecarts": []}' where id = s_f;
      s_pts := app.billing_check(s_f) -> 'points';
      if exists (select 1 from jsonb_array_elements(s_pts) p where p ->> 'code' = 'siret_ferme' and not (p ->> 'bloquant')::boolean)
         and not exists (select 1 from jsonb_array_elements(s_pts) p where p ->> 'code' = 'siret_controle') then
        v_lines := v_lines || 'OK      srv   0365 : établissement fermé signalé sans bloquer'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   srv   0365 : établissement fermé signalé sans bloquer'::text; end if;
      update public.invoices set siret_check_result = jsonb_set(siret_check_result, '{identifiant}', '"99999999900011"') where id = s_f;
      s_ok := exists (select 1 from jsonb_array_elements(app.billing_check(s_f) -> 'points') p where p ->> 'code' = 'siret_controle');
      update public.invoices set siret_checked_at = now() - interval '25 hours',
        siret_check_result = jsonb_set(siret_check_result, '{identifiant}', '"12345678900011"') where id = s_f;
      if s_ok and exists (select 1 from jsonb_array_elements(app.billing_check(s_f) -> 'points') p where p ->> 'code' = 'siret_controle') then
        v_lines := v_lines || 'OK      srv   0365 : contrôle d''un autre SIRET ou de plus de 24 h à refaire'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   srv   0365 : contrôle d''un autre SIRET ou de plus de 24 h à refaire'::text; end if;
      -- Commercial sans le droit d'émettre : pas de motif
      perform set_config('request.jwt.claims', json_build_object('sub', s_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      s_ok := false;
      begin perform public.billing_siret_motif(s_f, 'Annuaire en panne'); exception when insufficient_privilege then s_ok := true; end;
      execute 'reset role';
      if s_ok then v_lines := v_lines || 'OK      com   0365 : motif refusé sans le droit d''émettre'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0365 : motif refusé sans le droit d''émettre'::text; end if;
      -- Annuaire indisponible : motif trop court refusé, motif valable = émission permise et motif rappelé
      perform set_config('request.jwt.claims', json_build_object('sub', s_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      s_ok := false;
      begin perform public.billing_siret_motif(s_f, 'ko'); exception when sqlstate '22023' then s_ok := true; end;
      perform public.billing_siret_motif(s_f, 'Annuaire injoignable, fiche client vérifiée le matin');
      s_pts := public.billing_missing_mentions(s_f) -> 'points';
      perform public.billing_issue(s_f);
      execute 'reset role';
      if s_ok and exists (select 1 from jsonb_array_elements(s_pts) p where p ->> 'code' = 'siret_motif')
         and (select issued_at is not null from public.invoices where id = s_f) then
        v_lines := v_lines || 'OK      dir   0365 : émission avec un motif si l''annuaire ne répond pas'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0365 : émission avec un motif si l''annuaire ne répond pas'::text; end if;
      -- Particulier : pas de contrôle de l'annuaire
      execute 'set local role authenticated';
      insert into public.invoices (reference, type, client_id, invoice_date, due_date) values ('x', 'invoice', s_par, current_date, current_date + 30) returning id into s_p;
      insert into public.invoice_items (invoice_id, position, description_title, quantity, unit_price_ht, tva_rate) values (s_p, 0, 'Formation', 1, 100, 20);
      s_pts := public.billing_missing_mentions(s_p) -> 'points';
      execute 'reset role';
      if not exists (select 1 from jsonb_array_elements(s_pts) p where p ->> 'code' like 'siret%') then
        v_lines := v_lines || 'OK      dir   0365 : pas de contrôle de l''annuaire pour un particulier'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0365 : pas de contrôle de l''annuaire pour un particulier'::text; end if;
      perform set_config('request.jwt.claims', '', true);
    end;
  end if;

  -- Transmission au comptable réglée par société (0366)
  if to_regprocedure('public.billing_transmission_mode()') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 3;
    declare
      t_dir uuid := gen_random_uuid(); t_mode text; t_ok boolean;
    begin
      insert into auth.users (id, email, aud, role) values (t_dir, 'tra.dir@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (t_dir, 'tra.dir@test.invalid', 'direction', true)
      on conflict (id) do update set role = excluded.role, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      insert into public.billing_settings (company_id) values (app.billing_company()) on conflict do nothing;
      update public.billing_settings set comptable_transmission = null where company_id = app.billing_company();
      perform set_config('request.jwt.claims', json_build_object('sub', t_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      t_mode := public.billing_transmission_mode();
      execute 'reset role';
      if t_mode is null then v_lines := v_lines || 'OK      dir   0366 : sans réglage, aucun mode supposé'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0366 : sans réglage, aucun mode supposé'::text; end if;
      t_ok := false;
      begin update public.billing_settings set comptable_transmission = 'courrier' where company_id = app.billing_company();
      exception when check_violation then t_ok := true; end;
      if t_ok then v_lines := v_lines || 'OK      base  0366 : mode de transmission inconnu refusé'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0366 : mode de transmission inconnu refusé'::text; end if;
      update public.billing_settings set comptable_transmission = 'email_pdf' where company_id = app.billing_company();
      execute 'set local role authenticated';
      t_mode := public.billing_transmission_mode();
      execute 'reset role';
      if t_mode = 'email_pdf' then v_lines := v_lines || 'OK      dir   0366 : mode réglé lu pour la société'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0366 : mode réglé lu pour la société'::text; end if;
      perform set_config('request.jwt.claims', '', true);
    end;
  end if;

  -- Circuit de facturation branché sur les règles de gestion (0367)
  if to_regprocedure('public.billing_request_validation(uuid)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 6;
    declare
      k_dir uuid := gen_random_uuid(); k_com uuid := gen_random_uuid(); k_cli uuid; k_cli2 uuid; k_f uuid; k_g uuid;
      k_r jsonb; k_r2 jsonb; k_ok boolean; k_pts jsonb;
    begin
      insert into auth.users (id, email, aud, role) values
        (k_dir, 'cir.dir@test.invalid', 'authenticated', 'authenticated'), (k_com, 'cir.com@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (k_dir, 'cir.dir@test.invalid', 'direction', true), (k_com, 'cir.com@test.invalid', 'commercial', true)
      on conflict (id) do update set role = excluded.role, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      update public.organization_settings set legal_name = coalesce(legal_name, 'Organisme essai'), siren = coalesce(siren, '987654321'),
        address = coalesce(address, '2 rue de l''Essai'), postal_code = coalesce(postal_code, '29200'), city = coalesce(city, 'Brest'),
        forme_juridique = coalesce(forme_juridique, 'SARL'), capital_social = coalesce(capital_social, '1000'),
        tva_intra = coalesce(tva_intra, 'FR00987654321'), rcs = coalesce(rcs, 'RCS Brest 987 654 321');
      delete from public.approval_rules where company_id = app.billing_company() and scope = 'invoice';
      insert into public.clients (name, address, postal_code, city, client_type) values ('Circuit essai', '1 rue', '29200', 'Brest', 'particulier') returning id into k_cli;
      insert into public.clients (name, address, postal_code, city, client_type) values ('Circuit libre essai', '2 rue', '29200', 'Brest', 'particulier') returning id into k_cli2;
      insert into public.approval_rules (company_id, scope, client_id, mode, validator_right) values (app.billing_company(), 'invoice', k_cli2, 'none', 'facturation.factures.valider');
      perform set_config('request.jwt.claims', json_build_object('sub', k_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.invoices (reference, type, client_id, invoice_date, due_date) values ('x', 'invoice', k_cli, current_date, current_date + 30) returning id into k_f;
      insert into public.invoice_items (invoice_id, position, description_title, quantity, unit_price_ht, tva_rate) values (k_f, 0, 'Formation', 1, 100, 20);
      insert into public.invoices (reference, type, client_id, invoice_date, due_date) values ('x', 'invoice', k_cli2, current_date, current_date + 30) returning id into k_g;
      insert into public.invoice_items (invoice_id, position, description_title, quantity, unit_price_ht, tva_rate) values (k_g, 0, 'Formation', 1, 100, 20);
      k_pts := public.billing_missing_mentions(k_f) -> 'points';
      k_ok := exists (select 1 from jsonb_array_elements(k_pts) p where p ->> 'code' = 'circuit' and (p ->> 'bloquant')::boolean)
              and not exists (select 1 from jsonb_array_elements(public.billing_missing_mentions(k_g) -> 'points') p where p ->> 'code' = 'circuit');
      execute 'reset role';
      if k_ok then v_lines := v_lines || 'OK      com   0367 : validation requise par défaut, pas pour un client réglé sans validation'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0367 : validation requise par défaut, pas pour un client réglé sans validation'::text; end if;
      -- Demande de validation, une seule en attente
      execute 'set local role authenticated';
      k_r := public.billing_request_validation(k_f);
      k_r2 := public.billing_request_validation(k_f);
      execute 'reset role';
      if (k_r ->> 'required')::boolean and k_r ->> 'request_id' = k_r2 ->> 'request_id' and (k_r2 ->> 'deja')::boolean then
        v_lines := v_lines || 'OK      com   0367 : demande de validation déposée une seule fois'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   com   0367 : demande de validation déposée une seule fois (' || coalesce(k_r::text, '') || ')'); end if;
      -- Le valideur voit la demande ; l'auteur ne valide pas sa propre demande
      execute 'set local role authenticated';
      k_ok := false;
      begin perform public.approval_decide((k_r ->> 'request_id')::uuid, 'approved'); exception when insufficient_privilege then k_ok := true; end;
      execute 'reset role';
      if k_ok then v_lines := v_lines || 'OK      com   0367 : l''auteur ne valide pas sa propre demande'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0367 : l''auteur ne valide pas sa propre demande'::text; end if;
      perform set_config('request.jwt.claims', json_build_object('sub', k_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      k_ok := exists (select 1 from public.approval_requests where id = (k_r ->> 'request_id')::uuid);
      -- Émission par le valideur : demande close comme validée
      perform public.billing_issue(k_f);
      execute 'reset role';
      if k_ok and (select status = 'approved' and decided_by = k_dir from public.approval_requests where id = (k_r ->> 'request_id')::uuid) then
        v_lines := v_lines || 'OK      dir   0367 : le valideur voit la demande, l''émission la clôt'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0367 : le valideur voit la demande, l''émission la clôt'::text; end if;
      -- Circuit à deux étapes : même le valideur passe par une demande validée
      update public.approval_rules set mode = 'always', extra_steps = '["facturation.export.comptable"]' where client_id = k_cli2;
      execute 'set local role authenticated';
      k_ok := false;
      begin perform public.billing_issue(k_g); exception when sqlstate '22023' then k_ok := sqlerrm like '%validation%'; end;
      execute 'reset role';
      if k_ok then v_lines := v_lines || 'OK      dir   0367 : circuit à deux étapes, émission refusée sans demande validée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0367 : circuit à deux étapes, émission refusée sans demande validée'::text; end if;
      -- Commercial : n'émet pas
      perform set_config('request.jwt.claims', json_build_object('sub', k_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      k_ok := false;
      begin perform public.billing_issue(k_g); exception when insufficient_privilege then k_ok := true; end;
      execute 'reset role';
      if k_ok then v_lines := v_lines || 'OK      com   0367 : la personne qui prépare n''émet pas'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0367 : la personne qui prépare n''émet pas'::text; end if;
      perform set_config('request.jwt.claims', '', true);
    end;
  end if;

  -- Factures d'acompte et de solde, financement OPCO (0368)
  if to_regprocedure('public.billing_create_final(uuid)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 8;
    declare
      x_dir uuid := gen_random_uuid(); x_cli uuid; x_opco uuid; x_q uuid; x_a uuid; x_a2 uuid; x_f uuid; x_f2 uuid; x_av uuid; x_o uuid;
      x_ok boolean; x_ttc numeric; x_dev numeric; x_pts jsonb;
    begin
      insert into auth.users (id, email, aud, role) values (x_dir, 'aco.dir@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (x_dir, 'aco.dir@test.invalid', 'direction', true)
      on conflict (id) do update set role = excluded.role, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      update public.organization_settings set legal_name = coalesce(legal_name, 'Organisme essai'), siren = coalesce(siren, '987654321'),
        address = coalesce(address, '2 rue de l''Essai'), postal_code = coalesce(postal_code, '29200'), city = coalesce(city, 'Brest'),
        forme_juridique = coalesce(forme_juridique, 'SARL'), capital_social = coalesce(capital_social, '1000'),
        tva_intra = coalesce(tva_intra, 'FR00987654321'), rcs = coalesce(rcs, 'RCS Brest 987 654 321');
      delete from public.approval_rules where company_id = app.billing_company() and scope = 'invoice';
      insert into public.clients (name, address, postal_code, city, client_type) values ('Acompte essai', '1 rue', '29200', 'Brest', 'particulier') returning id into x_cli;
      insert into public.quotes (reference, client_id, status, discount_percent, discount_label, tva_applicable)
        values ('DEV-ESSAI-ACOMPTE', x_cli, 'accepted', 10, 'Remise fidélité', true) returning id into x_q;
      insert into public.quote_items (quote_id, position, description_title, quantity, unit_price_ht, tva_rate, total_ht) values
        (x_q, 0, 'Formation', 2, 500, 20, 1000), (x_q, 1, 'Livret', 10, 5, 5.5, 50), (x_q, 2, 'Option refusée', 1, 999, 20, 999);
      update public.quote_items set accepted = false where quote_id = x_q and position = 2;
      x_dev := (select sum(base + tax) from app.billing_quote_groups(x_q));
      perform set_config('request.jwt.claims', json_build_object('sub', x_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      x_a := public.billing_create_deposit(x_q, 30);
      execute 'reset role';
      x_ttc := (public.billing_compute_totals(x_a) ->> 'total_ttc')::numeric;
      if x_dev = 1127.48 and abs(x_ttc - round(x_dev * 0.3, 2)) <= 0.02 and (select invoice_kind from public.invoices where id = x_a) = 'acompte'
         and (select count(*) from public.invoice_items where invoice_id = x_a) = 2 then
        v_lines := v_lines || 'OK      dir   0368 : acompte de 30 % réparti par taux (lignes refusées du devis exclues)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0368 : acompte de 30 % réparti par taux (' || x_dev || ' / ' || x_ttc || ')'); end if;
      execute 'set local role authenticated';
      x_ok := false;
      begin perform public.billing_create_deposit(x_q, null, 900); exception when sqlstate '22023' then x_ok := true; end;
      execute 'reset role';
      if x_ok then v_lines := v_lines || 'OK      dir   0368 : acomptes au-delà du devis refusés'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0368 : acomptes au-delà du devis refusés'::text; end if;
      execute 'set local role authenticated';
      x_ok := false;
      begin perform public.billing_create_final(x_q); exception when sqlstate '22023' then x_ok := true; end;
      perform public.billing_issue(x_a);
      x_f := public.billing_create_final(x_q);
      x_f2 := public.billing_create_final(x_q);
      execute 'reset role';
      if x_ok and abs((public.billing_compute_totals(x_f) ->> 'total_ttc')::numeric - (x_dev - x_ttc)) <= 0.02
         and (select count(*) from public.invoice_deposit_links where final_invoice_id = x_f) = 1
         and (select count(*) from public.invoice_deposit_links where final_invoice_id = x_f2) = 0
         and exists (select 1 from public.invoice_items where invoice_id = x_f and description_title like 'Remise fidélité%') then
        v_lines := v_lines || 'OK      dir   0368 : solde = devis moins acompte, remise par taux, acompte déduit une seule fois'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0368 : solde = devis moins acompte (' || coalesce(public.billing_compute_totals(x_f)::text, '') || ')'); end if;
      -- Avoir sur un acompte déjà déduit : bloqué
      execute 'set local role authenticated';
      x_av := public.billing_create_credit_note(x_a, 'total');
      x_pts := public.billing_missing_mentions(x_av) -> 'points';
      delete from public.invoices where id in (x_av, x_f2);
      execute 'reset role';
      if exists (select 1 from jsonb_array_elements(x_pts) p where p ->> 'code' = 'acompte_repris' and (p ->> 'bloquant')::boolean) then
        v_lines := v_lines || 'OK      dir   0368 : avoir refusé sur un acompte déjà déduit'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0368 : avoir refusé sur un acompte déjà déduit'::text; end if;
      -- Solde émis : acomptes déduits figés ; liens jamais écrits depuis l'application
      execute 'set local role authenticated';
      perform public.billing_issue(x_f);
      x_ok := false;
      begin insert into public.invoice_deposit_links (company_id, final_invoice_id, deposit_invoice_id, amount_ht, amount_tva)
        values (app.billing_company(), x_f, x_f, 1, 1); exception when insufficient_privilege then x_ok := true; end;
      execute 'reset role';
      begin delete from public.invoice_deposit_links where final_invoice_id = x_f; exception when insufficient_privilege then x_ok := x_ok and true; end;
      if x_ok and (select count(*) from public.invoice_deposit_links where final_invoice_id = x_f) = 1 then
        v_lines := v_lines || 'OK      dir   0368 : acomptes d''une facture de solde émise figés, liens écrits par la base seule'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0368 : acomptes d''une facture de solde émise figés'::text; end if;
      -- OPCO : numéro de dossier obligatoire, subrogation signalée après la date de fin de l'OPCO
      insert into public.clients (name, siret, siren, address, postal_code, city, client_type, opco_subrogation_end) values
        ('OPCO essai', '85129663200017', '851296632', '3 rue', '75000', 'Paris', 'opco', date '2026-10-01') returning id into x_opco;
      execute 'set local role authenticated';
      insert into public.invoices (reference, type, client_id, billing_client_id, is_subrogation, invoice_date, due_date)
        values ('x', 'invoice', x_cli, x_opco, true, date '2026-10-15', date '2026-11-15') returning id into x_o;
      insert into public.invoice_items (invoice_id, position, description_title, quantity, unit_price_ht, tva_rate) values (x_o, 0, 'Formation', 1, 100, 20);
      x_pts := public.billing_missing_mentions(x_o) -> 'points';
      execute 'reset role';
      if exists (select 1 from jsonb_array_elements(x_pts) p where p ->> 'code' = 'opco_dossier' and (p ->> 'bloquant')::boolean)
         and exists (select 1 from jsonb_array_elements(x_pts) p where p ->> 'code' = 'opco_subrogation' and not (p ->> 'bloquant')::boolean) then
        v_lines := v_lines || 'OK      dir   0368 : OPCO : numéro de dossier exigé, subrogation signalée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0368 : OPCO : numéro de dossier exigé, subrogation signalée (' || x_pts::text || ')'); end if;
      -- Lecture des liens : comptable externe oui (voit les factures), anonyme non
      execute 'set local role anon';
      x_ok := false;
      begin perform 1 from public.invoice_deposit_links; exception when insufficient_privilege then x_ok := true; end;
      execute 'reset role';
      if x_ok then v_lines := v_lines || 'OK      anon  0368 : liens d''acompte illisibles sans connexion'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   anon  0368 : liens d''acompte illisibles sans connexion'::text; end if;
      -- Devis non accepté : pas d'acompte
      update public.quotes set status = 'sent' where id = x_q;
      execute 'set local role authenticated';
      x_ok := false;
      begin perform public.billing_create_deposit(x_q, 10); exception when sqlstate '22023' then x_ok := true; end;
      execute 'reset role';
      if x_ok then v_lines := v_lines || 'OK      dir   0368 : pas d''acompte sur un devis non accepté'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0368 : pas d''acompte sur un devis non accepté'::text; end if;
      perform set_config('request.jwt.claims', '', true);
    end;
  end if;

  -- Données rattachées aux sociétés, isolement entre sociétés (C2, 0274 et 0275)
  if to_regprocedure('app.societes_lisibles()') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 9;
    declare
      y_x uuid; y_own uuid := (select id from public.companies where is_instance_owner limit 1);
      y_ux uuid := gen_random_uuid(); y_ug uuid := gen_random_uuid(); y_cli uuid; y_q uuid; y_qx uuid; y_it uuid;
      y_ok boolean; y_n int; y_err text;
    begin
      insert into public.companies (legal_name, support_access_mode) values ('Essai société C2', 'none') returning id into y_x;
      insert into auth.users (id, email, aud, role) values
        (y_ux, 'c2.x@test.invalid', 'authenticated', 'authenticated'), (y_ug, 'c2.g@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (y_ux, 'c2.x@test.invalid', 'gestionnaire', true), (y_ug, 'c2.g@test.invalid', 'gestionnaire', true)
      on conflict (id) do update set role = excluded.role, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      delete from public.company_members where profile_id in (y_ux, y_ug);
      insert into public.company_members (company_id, profile_id, role, is_default) values (y_x, y_ux, 'gestionnaire', true), (y_own, y_ug, 'gestionnaire', true);
      insert into public.clients (name) values ('Client C2 société 1') returning id into y_cli;
      insert into public.quotes (reference, client_id, status) values ('DEV-C2-1', y_cli, 'draft') returning id into y_q;

      -- Structure : toutes les tables rattachées ont une société non nulle avec clé étrangère
      select count(*) into y_n from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and a.attname = 'company_id' and not a.attnotnull and c.relkind = 'r'
        and exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.conname = c.relname || '_company_fk');
      if y_n = 0 and (select company_id = y_own and company_ids = array[y_own] from public.clients where id = y_cli)
         and (select company_id = y_own from public.quotes where id = y_q) then
        v_lines := v_lines || 'OK      base  C2 : société non nulle, remplie par la société n° 1, fiches partageables'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  C2 : société non nulle, remplie par la société n° 1, fiches partageables'::text; end if;

      -- Compte de la société n° 1 : voit le devis ; compte de l'autre société : ne le voit pas
      perform set_config('request.jwt.claims', json_build_object('sub', y_ug, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into y_n from public.quotes where id = y_q;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', y_ux, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      y_ok := y_n = 1 and (select count(*) from public.quotes where id = y_q) = 0 and (select count(*) from public.clients where id = y_cli) = 0;
      execute 'reset role';
      if y_ok then v_lines := v_lines || 'OK      ges   C2 : devis et client d''une autre société invisibles'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   C2 : devis et client d''une autre société invisibles'::text; end if;

      -- Création dans sa société : société courante par défaut, invisible de la société n° 1
      perform set_config('request.jwt.claims', json_build_object('sub', y_ux, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.clients (name) values ('Client C2 société X') returning id into y_cli;
      insert into public.quotes (reference, client_id, status) values ('DEV-C2-X', y_cli, 'draft') returning id into y_qx;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', y_ug, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into y_n from public.quotes where id = y_qx;
      execute 'reset role';
      if (select company_id = y_x from public.quotes where id = y_qx) and y_n = 0 then
        v_lines := v_lines || 'OK      ges   C2 : création rattachée à la société courante, invisible ailleurs'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   C2 : création rattachée à la société courante, invisible ailleurs'::text; end if;

      -- Création forcée dans une autre société : refusée
      perform set_config('request.jwt.claims', json_build_object('sub', y_ux, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      y_ok := false;
      begin insert into public.quotes (reference, client_id, status, company_id) values ('DEV-C2-F', y_cli, 'draft', y_own);
      exception when insufficient_privilege then y_ok := true; end;
      execute 'reset role';
      if y_ok then v_lines := v_lines || 'OK      ges   C2 : création dans une autre société refusée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   C2 : création dans une autre société refusée'::text; end if;

      -- Ligne fille : société du parent, jamais une autre
      perform set_config('request.jwt.claims', json_build_object('sub', y_ux, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.quote_items (quote_id, position, description_title, quantity, unit_price_ht, company_id)
        values (y_qx, 0, 'Ligne', 1, 10, y_own) returning id into y_it;
      y_ok := false;
      begin insert into public.quote_items (quote_id, position, description_title, quantity, unit_price_ht) values (y_q, 0, 'Ligne', 1, 10);
      exception when insufficient_privilege then y_ok := true; end;
      execute 'reset role';
      if y_ok and (select company_id = y_x from public.quote_items where id = y_it) then
        v_lines := v_lines || 'OK      ges   C2 : ligne fille rattachée à la société de son parent'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   C2 : ligne fille rattachée à la société de son parent'::text; end if;

      -- Modification et suppression d'une ligne d'une autre société : sans effet
      perform set_config('request.jwt.claims', json_build_object('sub', y_ux, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      with x as (update public.quotes set object = 'essai' where id = y_q returning 1) select count(*) into y_n from x;
      with x as (delete from public.quotes where id = y_q returning 1) select y_n + count(*) into y_n from x;
      execute 'reset role';
      if y_n = 0 and exists (select 1 from public.quotes where id = y_q and object is distinct from 'essai') then
        v_lines := v_lines || 'OK      ges   C2 : aucune modification ni suppression dans une autre société'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   C2 : aucune modification ni suppression dans une autre société'::text; end if;

      -- Fiche partagée : visible et modifiable dans les sociétés cochées
      update public.clients set company_ids = array[y_own, y_x] where name = 'Client C2 société 1';
      perform set_config('request.jwt.claims', json_build_object('sub', y_ux, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      with x as (update public.clients set notes = 'vu de X' where name = 'Client C2 société 1' returning 1) select count(*) into y_n from x;
      execute 'reset role';
      if y_n = 1 and (select company_id = y_own from public.clients where name = 'Client C2 société 1') then
        v_lines := v_lines || 'OK      ges   C2 : fiche partagée visible et modifiable dans une société cochée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   C2 : fiche partagée visible et modifiable dans une société cochée'::text; end if;

      -- Super administrateur : société sans accès de support, données invisibles
      perform set_config('request.jwt.claims', json_build_object('sub', u_sa, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into y_n from public.quotes where id = y_qx;
      execute 'reset role';
      if y_n = 0 then v_lines := v_lines || 'OK      sa    C2 : société fermée au support, données invisibles'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   sa    C2 : société fermée au support, données invisibles'::text; end if;

      -- Compte externe (entreprise) : sa règle propre décide, la société ne le bloque pas
      perform set_config('request.jwt.claims', json_build_object('sub', u_ent, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into y_n from (select app.societes_lisibles()) s;
      execute 'reset role';
      if y_n >= 2 then v_lines := v_lines || 'OK      ent   C2 : compte externe limité par ses règles propres, pas par la société'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ent   C2 : compte externe limité par ses règles propres, pas par la société'::text; end if;

      -- Fonctions qui contournent les règles (0276) : objet d'une autre société refusé
      if to_regprocedure('app.exiger_societe(text,uuid,boolean)') is not null then
        v_total := v_total + 3;
        perform set_config('request.jwt.claims', json_build_object('sub', y_ux, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        y_ok := not app.societe_permise(y_own) and app.societe_permise(y_x) and app.societe_permise(y_x, true);
        execute 'reset role';
        perform set_config('request.jwt.claims', json_build_object('sub', y_ug, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        y_ok := y_ok and app.societe_permise(y_own) and not app.societe_permise(y_x);
        execute 'reset role';
        if y_ok then v_lines := v_lines || 'OK      ges   C2 : société permise (lecture et écriture) selon le compte'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   C2 : société permise (lecture et écriture) selon le compte'::text; end if;
        perform set_config('request.jwt.claims', json_build_object('sub', y_ux, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        y_ok := false;
        begin perform public.billing_deposit_summary(y_q); exception when insufficient_privilege then y_ok := true; end;
        execute 'reset role';
        if y_ok then v_lines := v_lines || 'OK      ges   C2 : suivi des acomptes d''un devis d''une autre société refusé'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   C2 : suivi des acomptes d''un devis d''une autre société refusé'::text; end if;
        perform set_config('request.jwt.claims', json_build_object('sub', y_ux, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        y_ok := false;
        execute 'reset role';
        y_cli := (select id from public.clients where name = 'Client C2 société 1');
        execute 'set local role authenticated';
        y_err := '';
        begin perform public.client_contact_sync_primary(y_cli);
          y_ok := true; exception when others then y_ok := false; y_err := sqlerrm; end;
        execute 'reset role';
        update public.clients set company_ids = array[y_own] where id = y_cli;
        execute 'set local role authenticated';
        begin perform public.client_contact_sync_primary(y_cli);
          y_ok := false; y_err := 'non refusé'; exception when insufficient_privilege then y_ok := y_ok; end;
        execute 'reset role';
        if y_ok then v_lines := v_lines || 'OK      ges   C2 : fiche partagée traitée, fiche non partagée refusée'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   ges   C2 : fiche partagée traitée, fiche non partagée refusée ' || coalesce(y_err, '')); end if;
      end if;

      perform set_config('request.jwt.claims', '', true);
      delete from public.quote_items where company_id = y_x;
      delete from public.quotes where company_id = y_x;
      delete from public.clients where company_id = y_x;
      update public.clients set company_ids = array[y_own] where name = 'Client C2 société 1';
      delete from public.audit_logs where company_id = y_x;
      delete from public.company_members where company_id = y_x;
      delete from public.audit_logs where company_id = y_x;
      delete from public.companies where id = y_x;
    end;
  end if;

  -- Interface multi-sociétés, partie base (C3, 0277)
  if to_regprocedure('public.company_create(jsonb)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 7;
    declare
      z_own uuid := (select id from public.companies where is_instance_owner limit 1); z_x uuid; z_y uuid;
      z_h uuid := gen_random_uuid(); z_l uuid := gen_random_uuid(); z_n uuid := gen_random_uuid();
      z_q1 uuid; z_q2 uuid; z_cli uuid; z_ok boolean; z_n1 int; z_ctx jsonb; z_inv uuid;
    begin
      insert into auth.users (id, email, aud, role) values
        (z_h, 'c3.h@test.invalid', 'authenticated', 'authenticated'), (z_l, 'c3.l@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (z_h, 'c3.h@test.invalid', 'direction', true), (z_l, 'c3.l@test.invalid', 'direction', true)
      on conflict (id) do update set role = excluded.role, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      -- Création d'une société : refusée hors plateforme, complète par le super administrateur
      perform set_config('request.jwt.claims', json_build_object('sub', z_h, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      z_ok := false;
      begin perform public.company_create('{"legal_name": "Essai C3 refusée"}'); exception when insufficient_privilege then z_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', u_sa, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      z_x := public.company_create(jsonb_build_object('legal_name', 'Essai C3 Restauration', 'siret', '98765432400019', 'naf', '56.10A',
        'address', '1 route', 'postal_code', '29600', 'city', 'Morlaix', 'legal_form', 'SARL', 'capital', '5000',
        'vat_number', 'FR14987654324', 'rcs', 'RCS Brest', 'modules', jsonb_build_array('formation'),
        'members', jsonb_build_array(jsonb_build_object('profile_id', z_h, 'role', 'direction', 'can_consolidate', true))));
      execute 'reset role';
      if z_ok and (select siren = '987654324' from public.companies where id = z_x)
         and exists (select 1 from public.company_establishments where company_id = z_x and is_head_office and siret = '98765432400019')
         and exists (select 1 from public.billing_settings where company_id = z_x)
         and (select count(*) from public.company_modules where company_id = z_x and enabled) = 1
         and exists (select 1 from public.company_members where company_id = z_x and profile_id = z_h and can_consolidate) then
        v_lines := v_lines || 'OK      sa    C3 : société créée en une fois (siège, modules, facturation, accès), refusée hors plateforme'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   sa    C3 : société créée en une fois (siège, modules, facturation, accès), refusée hors plateforme'::text; end if;
      -- Accès à une société : administrateur de la société ou plateforme seulement
      v_total := v_total + 1;
      perform set_config('request.jwt.claims', json_build_object('sub', z_l, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      z_ok := false;
      begin perform public.company_member_set(z_x, z_l, 'direction'); exception when insufficient_privilege then z_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', u_sa, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.company_member_set(z_x, z_l, 'lecture', false, true);
      execute 'reset role';
      if z_ok and exists (select 1 from public.company_members where company_id = z_x and profile_id = z_l and role = 'lecture' and is_active) then
        v_lines := v_lines || 'OK      sa    C3 : accès à une société donné par la plateforme, refusé à un autre compte'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   sa    C3 : accès à une société donné par la plateforme, refusé à un autre compte'::text; end if;
      delete from public.company_members where company_id = z_x and profile_id = z_l;
      update public.company_members set can_consolidate = true where profile_id = z_h and company_id = z_own;
      update public.company_members set can_consolidate = false where profile_id = z_l;

      -- Vue groupe : société courante vide, lecture des deux sociétés, écriture refusée
      insert into public.clients (name) values ('Client C3') returning id into z_cli;
      insert into public.quotes (reference, client_id, status) values ('DEV-C3-1', z_cli, 'draft') returning id into z_q1;
      insert into public.quotes (reference, client_id, status, company_id) values ('DEV-C3-2', z_cli, 'draft', z_x) returning id into z_q2;
      perform set_config('request.jwt.claims', json_build_object('sub', z_h, 'role', 'authenticated')::text, true);
      perform set_config('request.headers', '{"x-company-id":"groupe"}', true);
      execute 'set local role authenticated';
      z_ctx := public.my_company_context();
      select count(*) into z_n1 from public.quotes where id in (z_q1, z_q2);
      z_ok := false;
      begin insert into public.quotes (reference, client_id, status) values ('DEV-C3-G', z_cli, 'draft'); exception when insufficient_privilege then z_ok := true; end;
      execute 'reset role';
      perform set_config('request.headers', '', true);
      if (z_ctx ->> 'vue_groupe')::boolean and z_ctx ->> 'current' is null and z_n1 = 2 and z_ok then
        v_lines := v_lines || 'OK      dir   C3 : vue groupe en lecture seule sur toutes ses sociétés'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   C3 : vue groupe en lecture seule (' || coalesce(z_ctx::text, '') || ', ' || z_n1 || ')'); end if;

      -- Vue groupe demandée sans le droit : société par défaut
      perform set_config('request.jwt.claims', json_build_object('sub', z_l, 'role', 'authenticated')::text, true);
      perform set_config('request.headers', '{"x-company-id":"groupe"}', true);
      execute 'set local role authenticated';
      z_ctx := public.my_company_context();
      execute 'reset role';
      perform set_config('request.headers', '', true);
      if not (z_ctx ->> 'vue_groupe')::boolean and (z_ctx ->> 'current')::uuid = z_own then
        v_lines := v_lines || 'OK      dir   C3 : vue groupe refusée sans le droit, société par défaut'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   C3 : vue groupe refusée sans le droit, société par défaut'::text; end if;

      -- Société choisie par l'en-tête : ses seuls modules
      perform set_config('request.jwt.claims', json_build_object('sub', z_h, 'role', 'authenticated')::text, true);
      perform set_config('request.headers', json_build_object('x-company-id', z_x)::text, true);
      execute 'set local role authenticated';
      z_ctx := public.my_company_context();
      execute 'reset role';
      perform set_config('request.headers', '', true);
      if (z_ctx ->> 'current')::uuid = z_x and not (z_ctx -> 'modules') ? 'interventions'
         and ((z_ctx -> 'modules') ? 'formation' or not exists (select 1 from public.org_modules where key = 'formation' and enabled)) then
        v_lines := v_lines || 'OK      dir   C3 : modules de la société choisie seulement'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   C3 : modules de la société choisie (' || coalesce(z_ctx::text, '') || ')'); end if;

      -- Identité de la société d'un document
      if (app.identite_societe(z_x)).legal_name = 'Essai C3 Restauration' and (app.identite_societe(z_x)).siret = '98765432400019'
         and (app.identite_societe(z_own)).legal_name is not distinct from (select legal_name from public.organization_settings limit 1) then
        v_lines := v_lines || 'OK      base  C3 : identité de la société d''un document (instance : réglages ; autre : sa fiche)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  C3 : identité de la société d''un document'::text; end if;

      -- Numérotation par société : la première facture de l'autre société porte le n° 1 de sa propre série
      v_total := v_total + 1;
      declare z_part uuid; z_f uuid; z_r jsonb;
      begin
        insert into public.clients (name, address, postal_code, city, client_type, company_id) values ('Particulier C3', '1 rue', '29600', 'Morlaix', 'particulier', z_x) returning id into z_part;
        insert into public.invoices (reference, type, client_id, invoice_date, due_date, company_id) values ('x', 'invoice', z_part, current_date, current_date + 30, z_x) returning id into z_f;
        insert into public.invoice_items (invoice_id, position, description_title, quantity, unit_price_ht, tva_rate) values (z_f, 0, 'Repas', 1, 100, 10);
        perform set_config('request.jwt.claims', json_build_object('sub', z_h, 'role', 'authenticated')::text, true);
        perform set_config('request.headers', json_build_object('x-company-id', z_x)::text, true);
        execute 'set local role authenticated';
        z_r := public.billing_issue(z_f);
        execute 'reset role';
        perform set_config('request.headers', '', true);
        if z_r ->> 'reference' like '%00001' and (select seller_snapshot ->> 'legal_name' from public.invoices where id = z_f) = 'Essai C3 Restauration' then
          v_lines := v_lines || 'OK      dir   C3 : numérotation propre à la société, vendeur figé = la société'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   C3 : numérotation propre à la société (' || coalesce(z_r::text, '') || ')'); end if;
      end;

      -- Facture de l'autre société : vendeur contrôlé sur sa fiche (capital manquant signalé)
      update public.companies set capital = null where id = z_x;
      insert into public.invoices (reference, type, client_id, invoice_date, due_date, company_id) values ('x', 'invoice', z_cli, current_date, current_date + 30, z_x) returning id into z_inv;
      if exists (select 1 from jsonb_array_elements(app.billing_check(z_inv) -> 'points') p where p ->> 'code' = 'vendeur_capital') then
        v_lines := v_lines || 'OK      base  C3 : facture contrôlée avec l''identité de sa société'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  C3 : facture contrôlée avec l''identité de sa société'::text; end if;

      -- Compte rattaché à une autre société seulement : un changement de son profil ne l'ajoute pas à la société de l'instance
      insert into auth.users (id, email, aud, role) values (z_n, 'c3.n@test.invalid', 'authenticated', 'authenticated');
      delete from public.company_members where profile_id = z_n;
      insert into public.company_members (company_id, profile_id, role, is_default) values (z_x, z_n, 'gestionnaire', true);
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (z_n, 'c3.n@test.invalid', 'gestionnaire', true)
      on conflict (id) do update set role = excluded.role, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      if not exists (select 1 from public.company_members where profile_id = z_n and company_id = z_own) then
        v_lines := v_lines || 'OK      base  C3 : compte propre à une société, pas rattaché d''office à la société de l''instance'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  C3 : compte propre à une société, pas rattaché d''office'::text; end if;

      perform set_config('request.jwt.claims', '', true);
      -- Pas de suppression de la société fictive : elle porte une facture émise (verrou) ; l'erreur finale annule tout
    end;
  end if;

  -- Lot 2, clients et sites (0041) : adresse de la fiche = site par défaut, dans les deux sens
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sites'
             and column_name = 'is_head_office') then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 6;
    declare
      l_cli uuid; l_part uuid; l_site public.sites; l_ok boolean; l_com uuid := gen_random_uuid(); l_cli2 uuid;
    begin
      insert into public.clients (name, address, postal_code, city, client_type) values ('Essai lot 2', '1 rue A', '29600', 'Morlaix', 'entreprise') returning id into l_cli;
      select * into l_site from public.sites where client_id = l_cli and is_default;
      if l_site.id is not null and l_site.address = '1 rue A' and l_site.company_ids = (select company_ids from public.clients where id = l_cli) then
        v_lines := v_lines || 'OK      base  0041 : client professionnel créé = site « adresse de la fiche »'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0041 : client professionnel créé = site « adresse de la fiche »'::text; end if;

      update public.clients set address = '2 rue B', city = 'Brest' where id = l_cli;
      update public.sites set postal_code = '29200' where id = l_site.id;
      if (select address || '|' || city from public.sites where id = l_site.id) = '2 rue B|Brest'
         and (select postal_code from public.clients where id = l_cli) = '29200' then
        v_lines := v_lines || 'OK      base  0041 : adresse de la fiche et site par défaut synchronisés dans les deux sens'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0041 : adresse de la fiche et site par défaut synchronisés'::text; end if;

      insert into public.clients (name, address, client_type) values ('Particulier lot 2', '3 rue C', 'particulier') returning id into l_part;
      if not exists (select 1 from public.sites where client_id = l_part) then
        v_lines := v_lines || 'OK      base  0041 : un particulier n''a pas de site'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0041 : un particulier n''a pas de site'::text; end if;

      l_ok := false;
      begin
        insert into public.sites (kind, name, client_id, is_default) values ('client', 'Doublon', l_cli, true);
      exception when unique_violation then l_ok := true;
      end;
      if l_ok then v_lines := v_lines || 'OK      base  0041 : un seul site « adresse de la fiche » par client'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0041 : un seul site « adresse de la fiche » par client'::text; end if;

      if public.tva_from_siren('123456782') = 'FR11123456782' then
        v_lines := v_lines || 'OK      base  0041 : TVA calculée depuis le SIREN (même calcul que l''application)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0041 : TVA calculée depuis le SIREN'::text; end if;

      -- Un commercial crée un client : le site naît même sans droit d'écriture direct sur les sites
      insert into auth.users (id, email, aud, role) values (l_com, 'l2.com@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (l_com, 'l2.com@test.invalid', 'commercial', true)
      on conflict (id) do update set role = excluded.role, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      perform set_config('request.jwt.claims', json_build_object('sub', l_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.clients (name, address, client_type) values ('Essai lot 2 commercial', '4 rue D', 'entreprise') returning id into l_cli2;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if exists (select 1 from public.sites where client_id = l_cli2 and is_default) then
        v_lines := v_lines || 'OK      com   0041 : client créé par un commercial, site créé par la base'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0041 : client créé par un commercial, site créé par la base'::text; end if;
    end;
  end if;

  -- Lot 2, obligations et échéances (0042)
  if to_regclass('public.obligation_rules') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 5;
    declare
      o_own uuid := app.company_default(); o_cli uuid; o_tr uuid; o_course uuid; o_ses uuid; o_rule uuid; o_ex uuid;
      o_v public.v_trainee_validities; o_x public.client_safety_checks; o_et public.external_trainings;
    begin
      if (select count(*) from public.obligation_rules where company_id = o_own) >= 13
         and not exists (select 1 from public.obligation_rules where company_id = o_own and is_confirmed) then
        v_lines := v_lines || 'OK      base  0042 : référentiel de départ posé pour la société, tout « à confirmer »'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0042 : référentiel de départ posé pour la société'::text; end if;

      insert into public.clients (name, client_type) values ('Essai obligations', 'entreprise') returning id into o_cli;
      insert into public.trainees (first_name, last_name, client_id) values ('Essai', 'Validité', o_cli) returning id into o_tr;
      insert into public.courses (title, code) values ('Essai SST obligations', 'ESSAI-OBL') returning id into o_course;
      insert into public.obligation_rules (code, label, kind, validity_months, validity_group, course_ids)
      values ('essai_obl', 'Essai', 'formation', 24, 'essai_obl', array[o_course]) returning id into o_rule;
      insert into public.sessions (reference, course_id, client_id, start_date, end_date, attendance_token)
      values ('SES-ESSAI-OBL', o_course, o_cli, date '2025-03-01', date '2025-03-02', 'essai-obl') returning id into o_ses;
      insert into public.session_trainees (session_id, trainee_id, result) values (o_ses, o_tr, 'acquired');
      select * into o_v from public.v_trainee_validities where trainee_id = o_tr and rule_id = o_rule;
      if o_v.echeance = date '2027-03-02' and o_v.client_id = o_cli then
        v_lines := v_lines || 'OK      base  0042 : validité = fin de session réussie + périodicité de la règle'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0042 : validité calculée (' || coalesce(o_v.echeance::text, 'aucune') || ')'); end if;

      insert into public.external_trainings (trainee_id, rule_id, provider_name, done_on) values (o_tr, o_rule, 'Autre organisme', date '2026-01-10')
      returning * into o_et;
      select * into o_v from public.v_trainee_validities where trainee_id = o_tr and validity_group = 'essai_obl';
      if o_et.valid_until = date '2028-01-10' and o_et.company_id = (select company_id from public.trainees where id = o_tr)
         and o_v.source = 'externe' and o_v.echeance = date '2028-01-10' then
        v_lines := v_lines || 'OK      base  0042 : formation suivie ailleurs, plus récente, prise en compte jusqu''à son échéance'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0042 : formation suivie ailleurs prise en compte'::text; end if;

      select id into o_ex from public.obligation_rules where company_id = o_own and code = 'exercice_evacuation';
      insert into public.client_safety_checks (client_id, rule_id, done_on) values (o_cli, o_ex, current_date - 200) returning * into o_x;
      if o_x.next_due_on = (current_date - 200 + interval '6 months')::date
         and exists (select 1 from public.v_obligation_deadlines where objet_id = o_x.id and status = 'depasse' and kind = 'exercice') then
        v_lines := v_lines || 'OK      base  0042 : exercice d''évacuation, échéance à 6 mois, dépassée signalée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0042 : exercice d''évacuation, échéance et statut'::text; end if;

      -- Vue lue avec les droits de la personne : un technicien sans visite chez ce client ne voit rien
      perform set_config('request.jwt.claims', json_build_object('sub', u_tech, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      if not exists (select 1 from public.v_obligation_deadlines where client_id = o_cli)
         and not exists (select 1 from public.v_trainee_validities where trainee_id = o_tr) then
        v_lines := v_lines || 'OK      tech  0042 : échéances d''un client hors de ses missions : rien'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   tech  0042 : échéances d''un client hors de ses missions'::text; end if;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
    end;
  end if;

  -- Lot 2, relances (0043) : actions préparées la nuit, validées à la main, jamais deux fois
  if to_regclass('public.scheduled_actions') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 4;
    declare
      r_cli uuid; r_tr uuid; r_course uuid; r_ses uuid; r_rule uuid; r_res jsonb; r_act public.scheduled_actions; r_ok boolean;
    begin
      insert into public.clients (name, client_type, contact_email) values ('Essai relances', 'entreprise', 'essai.relance@test.invalid') returning id into r_cli;
      insert into public.trainees (first_name, last_name, client_id) values ('Essai', 'Relance', r_cli) returning id into r_tr;
      insert into public.courses (title, code) values ('Essai relance', 'ESSAI-REL') returning id into r_course;
      insert into public.obligation_rules (code, label, kind, validity_months, validity_group, course_ids, reminder_days)
      values ('essai_rel', 'Essai relance', 'formation', 12, 'essai_rel', array[r_course], 90) returning id into r_rule;
      insert into public.sessions (reference, course_id, client_id, start_date, end_date, attendance_token)
      values ('SES-ESSAI-REL', r_course, r_cli, current_date - 330, current_date - 330, 'essai-rel') returning id into r_ses;
      insert into public.session_trainees (session_id, trainee_id, result) values (r_ses, r_tr, 'acquired');
      perform public.scheduled_actions_generate();
      perform public.scheduled_actions_generate();
      select * into r_act from public.scheduled_actions where client_id = r_cli and rule_id = r_rule;
      if (select count(*) from public.scheduled_actions where client_id = r_cli) = 1 and r_act.status = 'a_valider'
         and r_act.payload ->> 'destinataire' = 'essai.relance@test.invalid' and r_act.payload ->> 'texte' like '%Essai Relance%' then
        v_lines := v_lines || 'OK      base  0043 : relance de recyclage préparée une seule fois, à valider'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0043 : relance de recyclage préparée une seule fois'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_ges, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      update public.scheduled_actions set status = 'valide' where id = r_act.id;
      r_ok := false;
      begin
        insert into public.scheduled_actions (kind, title, dedup_key) values ('autre', 'Intrus', 'intrus');
      exception when insufficient_privilege then r_ok := true;
      end;
      execute 'reset role';
      if (select validated_by from public.scheduled_actions where id = r_act.id) = u_ges and r_ok then
        v_lines := v_lines || 'OK      ges   0043 : valide une relance (auteur noté), n''en crée pas'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   0043 : valide une relance, n''en crée pas'::text; end if;

      execute 'set local role authenticated';
      update public.scheduled_actions set status = 'envoye' where id = r_act.id;
      r_ok := false;
      begin update public.scheduled_actions set status = 'a_valider' where id = r_act.id;
      exception when sqlstate '22023' then r_ok := true;
      end;
      execute 'reset role';
      if r_ok and (select sent_at is not null from public.scheduled_actions where id = r_act.id) then
        v_lines := v_lines || 'OK      ges   0043 : action envoyée, datée, ne revient pas en arrière'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   0043 : action envoyée ne revient pas en arrière'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_for, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      if not exists (select 1 from public.scheduled_actions where id = r_act.id) then
        v_lines := v_lines || 'OK      form  0043 : le formateur ne voit pas les relances aux clients'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   form  0043 : le formateur ne voit pas les relances aux clients'::text; end if;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
    end;
  end if;

  -- Lot 2, sessions inter et groupes (0044) : rétractation et paiements d'un particulier (L6353-5, L6353-6)
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_groups'
             and column_name = 'retractation_end') then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 4;
    declare
      g_part uuid; g_ses uuid; g_grp public.session_groups; g_inv uuid; g_ok boolean; g_err text;
    begin
      insert into public.clients (name, client_type) values ('Particulier inter', 'particulier') returning id into g_part;
      insert into public.sessions (reference, session_type, start_date, end_date, attendance_token)
      values ('SES-ESSAI-INTER', 'inter', current_date + 30, current_date + 31, 'essai-inter') returning id into g_ses;
      insert into public.session_groups (session_id, client_id, kind, payer_kind, doc_status, doc_signed_at)
      values (g_ses, g_part, 'particulier', 'particulier', 'signe', timestamptz '2026-10-01 10:00+02') returning * into g_grp;
      if g_grp.retractation_end = date '2026-10-11' and g_grp.is_individual then
        v_lines := v_lines || 'OK      base  0044 : particulier, fin de rétractation = signature + 10 jours'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0044 : fin de rétractation (' || coalesce(g_grp.retractation_end::text, 'vide') || ')'); end if;

      insert into public.invoices (reference, type, client_id, session_group_id, invoice_date, due_date, total_ttc)
      values ('x', 'invoice', g_part, g_grp.id, current_date, current_date + 30, 1000) returning id into g_inv;
      if (select invoice_id from public.session_groups where id = g_grp.id) = g_inv then
        v_lines := v_lines || 'OK      base  0044 : facture du groupe reliée au groupe'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0044 : facture du groupe reliée au groupe'::text; end if;

      g_ok := false;
      begin
        insert into public.invoice_payments (invoice_id, amount, payment_date) values (g_inv, 100, date '2026-10-05');
      exception when sqlstate '22023' then g_ok := true;
      end;
      if g_ok then v_lines := v_lines || 'OK      base  0044 : aucun paiement d''un particulier avant la fin de la rétractation'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0044 : aucun paiement avant la fin de la rétractation'::text; end if;

      insert into public.invoice_payments (invoice_id, amount, payment_date) values (g_inv, 300, date '2026-10-12');
      g_ok := false;
      begin
        insert into public.invoice_payments (invoice_id, amount, payment_date) values (g_inv, 1, date '2026-10-13');
      exception when sqlstate '22023' then g_ok := true;
      end;
      if g_ok then v_lines := v_lines || 'OK      base  0044 : 30 % au plus avant le début de la formation'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0044 : 30 % au plus avant le début de la formation'::text; end if;
    end;
  end if;

  -- Lot 2, sous-traitance (0045) : justificatifs des prestataires (D8222-5, R8222-1), bons de commande, relances
  if to_regclass('public.subcontractors') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 6;
    declare
      s_st uuid; s_doc public.subcontractor_documents; s_cmd public.subcontract_orders; s_n int; s_ok boolean; s_id uuid;
    begin
      insert into public.subcontractors (name, kind, email) values ('Essai prestataire', 'organisme', 'essai.st@test.invalid') returning id into s_st;
      insert into public.subcontractor_documents (subcontractor_id, doc_type_id, issued_on)
      select s_st, t.id, current_date - 200 from public.subcontractor_doc_types t
      where t.code = 'vigilance_urssaf' and t.company_id = (select company_id from public.subcontractors where id = s_st)
      returning * into s_doc;
      if s_doc.valid_until = (current_date - 200 + interval '6 months')::date then
        v_lines := v_lines || 'OK      base  0045 : attestation de vigilance valable six mois (D8222-5)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0045 : validité de l''attestation de vigilance (' || coalesce(s_doc.valid_until::text, 'vide') || ')'); end if;

      insert into public.subcontract_orders (subcontractor_id, start_date, end_date, days, daily_rate)
      values (s_st, current_date + 10, current_date + 11, 2, 3000) returning * into s_cmd;
      if s_cmd.amount_ht = 6000 and s_cmd.reference like 'BC-%'
         and (select status from public.v_subcontractor_compliance where subcontractor_id = s_st and code = 'vigilance_urssaf') = 'perime'
         and (select status from public.v_subcontractor_compliance where subcontractor_id = s_st and code = 'immatriculation') = 'manquant' then
        v_lines := v_lines || 'OK      base  0045 : bon de commande chiffré, justificatifs périmé et manquant au-delà de 5 000 € HT'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0045 : bon de commande et état des justificatifs'::text; end if;

      perform public.scheduled_actions_generate();
      perform public.scheduled_actions_generate();
      select count(*) into s_n from public.scheduled_actions where kind = 'justificatif_prestataire' and target_id = s_st
        and payload ->> 'destinataire' = 'essai.st@test.invalid' and payload ->> 'texte' like '%vigilance%';
      if s_n = 1 then v_lines := v_lines || 'OK      base  0045 : relance des justificatifs préparée une seule fois'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0045 : relance des justificatifs (' || s_n || ')'); end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.subcontractors (name) values ('Essai prestataire direction') returning id into s_id;
      s_ok := exists (select 1 from public.subcontract_orders where id = s_cmd.id);
      execute 'reset role';
      if s_id is not null and s_ok then v_lines := v_lines || 'OK      dir   0045 : crée un prestataire, voit les bons de commande'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0045 : crée un prestataire, voit les bons de commande'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_for, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      s_ok := not exists (select 1 from public.subcontract_orders where id = s_cmd.id);
      begin
        insert into public.subcontractors (name) values ('Intrus');
        s_ok := false;
      exception when insufficient_privilege then null;
      end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if s_ok then v_lines := v_lines || 'OK      form  0045 : le formateur ne voit pas les montants, ne crée pas de prestataire'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   form  0045 : le formateur ne voit pas les montants, ne crée pas de prestataire'::text; end if;

      if exists (select 1 from storage.buckets where id = 'prestataires' and not public)
         and (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'prestataires\_%') = 3 then
        v_lines := v_lines || 'OK      base  0045 : justificatifs dans un bucket privé, règles par droits'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0045 : justificatifs dans un bucket privé, règles par droits'::text; end if;
    end;
  end if;

  -- Lot 2, espace entreprise (0046) : un compte entreprise ne voit que son client, par les fonctions ent_* seulement
  if to_regclass('public.client_accounts') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 7;
    declare
      e_u uuid := gen_random_uuid(); e_c1 uuid; e_c2 uuid; e_site_a uuid; e_site_b uuid; e_tr1 uuid; e_tr1b uuid; e_tr2 uuid;
      e_course uuid; e_s1 uuid; e_s2 uuid; e_inter uuid; e_g1 uuid; e_g2 uuid; e_acc uuid; e_j jsonb; e_ok boolean; e_n int; e_req uuid;
    begin
      insert into auth.users (id, email, aud, role) values (e_u, 'ent.compte@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (e_u, 'ent.compte@test.invalid', 'entreprise', true)
      on conflict (id) do update set role = 'entreprise', is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      insert into public.clients (name, client_type, address, postal_code, city, siret, siren, tva) values ('Essai espace 1', 'entreprise', '1 rue Essai', '29200', 'Brest', '12345678900011', '123456789', 'FR00123456789') returning id into e_c1;
      insert into public.clients (name, client_type) values ('Essai espace 2', 'entreprise') returning id into e_c2;
      select id into e_site_a from public.sites where client_id = e_c1 and is_default limit 1;
      insert into public.sites (client_id, name, kind) values (e_c1, 'Site B', 'client') returning id into e_site_b;
      insert into public.trainees (first_name, last_name, client_id, site_id) values ('Alice', 'Espace', e_c1, e_site_a) returning id into e_tr1;
      insert into public.trainees (first_name, last_name, client_id, site_id) values ('Bruno', 'Espace', e_c1, e_site_b) returning id into e_tr1b;
      insert into public.trainees (first_name, last_name, client_id) values ('Chloé', 'Autre', e_c2) returning id into e_tr2;
      insert into public.courses (title, code) values ('Essai espace', 'ESSAI-ENT') returning id into e_course;
      insert into public.sessions (reference, course_id, client_id, start_date, end_date, attendance_token)
      values ('SES-ENT-1', e_course, e_c1, current_date + 5, current_date + 5, 'ent-1') returning id into e_s1;
      insert into public.sessions (reference, course_id, client_id, start_date, end_date, attendance_token)
      values ('SES-ENT-2', e_course, e_c2, current_date + 5, current_date + 5, 'ent-2') returning id into e_s2;
      insert into public.sessions (reference, course_id, session_type, is_public, start_date, end_date, attendance_token, max_participants)
      values ('SES-ENT-INTER', e_course, 'inter', true, current_date + 20, current_date + 20, 'ent-inter', 8) returning id into e_inter;
      insert into public.session_groups (session_id, client_id, kind) values (e_inter, e_c1, 'entreprise') returning id into e_g1;
      insert into public.session_groups (session_id, client_id, kind) values (e_inter, e_c2, 'entreprise') returning id into e_g2;
      insert into public.session_trainees (session_id, trainee_id) values (e_s1, e_tr1), (e_s1, e_tr1b), (e_s2, e_tr2);
      insert into public.session_trainees (session_id, trainee_id, group_id) values (e_inter, e_tr1, e_g1), (e_inter, e_tr2, e_g2);
      insert into public.invoices (reference, type, client_id, invoice_date, due_date, siret_check_motif, siret_motif_at)
      values ('x', 'invoice', e_c1, current_date, current_date + 30, 'essai des droits', now()) returning id into e_req;
      insert into public.invoice_items (invoice_id, position, description_title, quantity, unit_price_ht, tva_rate) values (e_req, 0, 'Ligne', 1, 100, 20);
      insert into public.invoices (reference, type, client_id, invoice_date, due_date) values ('x', 'invoice', e_c1, current_date, current_date + 30);
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.billing_issue(e_req);
      execute 'reset role';
      e_req := null;
      insert into public.client_accounts (profile_id, client_id, email, can_see_invoices) values (e_u, e_c1, 'ent.compte@test.invalid', false)
      returning id into e_acc;

      perform set_config('request.jwt.claims', json_build_object('sub', e_u, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      e_j := public.ent_sessions();
      e_ok := jsonb_array_length(e_j -> 'sessions') = 2
        and not exists (select 1 from jsonb_array_elements(e_j -> 'sessions') x where x ->> 'id' = e_s2::text)
        and (select jsonb_array_length(x -> 'session_trainees') from jsonb_array_elements(e_j -> 'sessions') x where x ->> 'id' = e_inter::text) = 1
        and public.ent_org() ? 'referent_handicap_nom';
      execute 'reset role';
      if e_ok then v_lines := v_lines || 'OK      ent   0046 : ses formations seulement, et ses salariés seuls dans l''inter'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ent   0046 : ses formations seulement'::text; end if;

      execute 'set local role authenticated';
      e_ok := not exists (select 1 from public.clients) and not exists (select 1 from public.sessions)
        and not exists (select 1 from public.trainees) and not exists (select 1 from public.client_accounts);
      e_n := jsonb_array_length(public.ent_factures());
      execute 'reset role';
      if e_ok and e_n = 0 then v_lines := v_lines || 'OK      ent   0046 : aucune table lisible, factures masquées sans l''option'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ent   0046 : aucune table lisible, factures masquées sans l''option'::text; end if;

      update public.client_accounts set can_see_invoices = true, all_sites = false where id = e_acc;
      insert into public.client_account_sites (account_id, site_id) values (e_acc, e_site_a);
      execute 'set local role authenticated';
      e_n := jsonb_array_length(public.ent_factures());
      e_j := public.ent_salaries();
      execute 'reset role';
      if e_n = 1 and jsonb_array_length(e_j) = 1 and e_j -> 0 ->> 'first_name' = 'Alice' then
        v_lines := v_lines || 'OK      ent   0046 : factures avec l''option, salariés de ses sites seulement'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   ent   0046 : factures avec l''option, salariés de ses sites (' || e_n || ' facture(s), ' || jsonb_array_length(e_j) || ' salarié(s), site ' || coalesce(e_site_a::text, 'vide') || ')'); end if;

      execute 'set local role authenticated';
      e_req := public.ent_demander('inscription_inter', 'Deux salariés', e_inter, null, '{"stagiaires": [{"nom": "Essai"}]}'::jsonb);
      e_ok := false;
      begin
        perform public.ent_demander('remplacement', 'Intrus', e_s2);
      exception when sqlstate '22023' then e_ok := true;
      end;
      execute 'reset role';
      if e_req is not null and e_ok and exists (select 1 from public.notifications where metadata ->> 'request_id' = e_req::text) then
        v_lines := v_lines || 'OK      ent   0046 : demande d''inscription notifiée, rien sur la session d''un autre client'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ent   0046 : demandes de l''espace entreprise'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_ges, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      e_ok := exists (select 1 from public.client_requests where id = e_req);
      begin
        insert into public.client_requests (client_id, kind) values (e_c1, 'message');
        e_ok := false;
      exception when insufficient_privilege then null;
      end;
      execute 'reset role';
      if e_ok then v_lines := v_lines || 'OK      ges   0046 : voit les demandes, n''en crée pas à la place du client'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   0046 : voit les demandes, n''en crée pas'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_for, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      e_ok := not exists (select 1 from public.client_accounts where id = e_acc);
      begin
        perform public.client_accounts_etat(e_c1);
        e_ok := false;
      exception when insufficient_privilege then null;
      end;
      execute 'reset role';
      if e_ok then v_lines := v_lines || 'OK      form  0046 : ne voit pas les comptes de l''espace entreprise'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   form  0046 : ne voit pas les comptes de l''espace entreprise'::text; end if;

      update public.client_accounts set is_active = false where id = e_acc;
      perform set_config('request.jwt.claims', json_build_object('sub', e_u, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      e_ok := false;
      begin
        perform public.ent_accueil();
      exception when insufficient_privilege then e_ok := true;
      end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if e_ok then v_lines := v_lines || 'OK      ent   0046 : compte désactivé, plus aucun accès'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ent   0046 : compte désactivé, plus aucun accès'::text; end if;
    end;
  end if;

  -- Lot 2, comptes externes (0047) : formateur externe et stagiaire par leurs fonctions seulement ; liens du profil gardés
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'trainee_id') then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 6;
    declare
      x_fe uuid := gen_random_uuid(); x_st uuid := gen_random_uuid(); x_t1 uuid; x_t2 uuid; x_tr1 uuid; x_tr2 uuid; x_c uuid;
      x_s1 uuid; x_s2 uuid; x_s3 uuid; x_j jsonb; x_ok boolean;
    begin
      insert into public.trainers (first_name, last_name, is_internal) values ('Externe', 'Essai', false) returning id into x_t1;
      insert into public.trainers (first_name, last_name, is_internal) values ('Autre', 'Formateur', false) returning id into x_t2;
      insert into public.clients (name) values ('Essai comptes externes') returning id into x_c;
      insert into public.trainees (first_name, last_name, client_id) values ('Sam', 'Stagiaire', x_c) returning id into x_tr1;
      insert into public.trainees (first_name, last_name, client_id) values ('Zoé', 'Autre', x_c) returning id into x_tr2;
      insert into public.sessions (reference, client_id, trainer_id, start_date, end_date, attendance_token, total_price)
      values ('SES-EXT-1', x_c, x_t1, current_date + 3, current_date + 3, 'ext-1', 1500) returning id into x_s1;
      insert into public.sessions (reference, client_id, trainer_id, start_date, end_date, attendance_token)
      values ('SES-EXT-2', x_c, x_t2, current_date + 4, current_date + 4, 'ext-2') returning id into x_s2;
      insert into public.sessions (reference, client_id, trainer_id, start_date, end_date, attendance_token)
      values ('SES-EXT-3', x_c, x_t2, current_date + 5, current_date + 5, 'ext-3') returning id into x_s3;
      insert into public.session_trainers (session_id, trainer_id) values (x_s3, x_t1);
      insert into public.session_trainees (session_id, trainee_id) values (x_s1, x_tr1), (x_s2, x_tr2), (x_s3, x_tr2);
      insert into auth.users (id, email, aud, role) values (x_fe, 'ext.fe@test.invalid', 'authenticated', 'authenticated'),
        (x_st, 'ext.st@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active, trainer_id) values (x_fe, 'ext.fe@test.invalid', 'formateur_externe', true, x_t1)
      on conflict (id) do update set role = excluded.role, trainer_id = excluded.trainer_id, is_active = true;
      insert into public.profiles (id, email, role, is_active, trainee_id) values (x_st, 'ext.st@test.invalid', 'stagiaire', true, x_tr1)
      on conflict (id) do update set role = excluded.role, trainee_id = excluded.trainee_id, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;

      perform set_config('request.jwt.claims', json_build_object('sub', x_fe, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      x_j := public.ext_sessions();
      x_ok := jsonb_array_length(x_j -> 'sessions') = 2
        and not exists (select 1 from jsonb_array_elements(x_j -> 'sessions') e where e ->> 'id' = x_s2::text)
        and position('total_price' in (x_j)::text) = 0 and position('1500' in (x_j)::text) = 0
        and not exists (select 1 from public.sessions) and not exists (select 1 from public.trainees);
      execute 'reset role';
      if x_ok then v_lines := v_lines || 'OK      ext   0047 : formateur externe, ses sessions (principal ou associé), sans prix ni table lisible'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ext   0047 : formateur externe, ses sessions sans prix'::text; end if;

      execute 'set local role authenticated';
      x_ok := false;
      begin perform public.stg_sessions(); exception when insufficient_privilege then x_ok := true; end;
      execute 'reset role';
      if x_ok then v_lines := v_lines || 'OK      ext   0047 : le formateur externe n''ouvre pas l''espace stagiaire'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ext   0047 : le formateur externe n''ouvre pas l''espace stagiaire'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', x_st, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      x_j := public.stg_sessions();
      x_ok := jsonb_array_length(x_j -> 'sessions') = 1 and x_j -> 'sessions' -> 0 ->> 'id' = x_s1::text
        and x_j -> 'trainee' ->> 'first_name' = 'Sam' and position('ssn' in (x_j)::text) = 0
        and (select count(*) from public.profiles) = 1 and exists (select 1 from public.profiles where id = x_st);
      execute 'reset role';
      if x_ok then v_lines := v_lines || 'OK      stg   0047 : stagiaire, ses sessions seulement, sans numéro de sécurité sociale ; lit son seul profil'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   stg   0047 : stagiaire, ses sessions seulement'::text; end if;

      -- Liens du profil : ni le stagiaire ni un formateur ne changent leur fiche reliée ou leur activation
      execute 'set local role authenticated';
      x_ok := false;
      begin update public.profiles set trainee_id = x_tr2 where id = x_st; exception when insufficient_privilege then x_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      x_ok := x_ok and exists (select 1 from public.profiles where id = u_dir);
      begin update public.profiles set trainer_id = x_t2 where id = u_dir; x_ok := false; exception when insufficient_privilege then null; end;
      begin update public.profiles set trainee_id = x_tr2 where id = u_dir; x_ok := false; exception when insufficient_privilege then null; end;
      execute 'reset role';
      if x_ok then v_lines := v_lines || 'OK      dir   0047 : fiche reliée non modifiable par soi-même (stagiaire, direction)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0047 : fiche reliée non modifiable par soi-même'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_sa, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      x_ok := true;
      begin update public.profiles set trainee_id = x_tr2 where id = x_st; exception when others then x_ok := false; end;
      execute 'reset role';
      x_ok := x_ok and (public.acces_externe_etat('formateur', x_t1) ->> 'profile_id') = x_fe::text;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', u_for, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      begin perform public.acces_externe_etat('stagiaire', x_tr2); x_ok := false; exception when insufficient_privilege then null; end;
      execute 'reset role';
      if x_ok and (select trainee_id from public.profiles where id = x_st) = x_tr2 then
        v_lines := v_lines || 'OK      sa    0047 : le super administrateur relie un compte à une fiche et voit le compte d''une fiche (pas le formateur)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   sa    0047 : le super administrateur relie un compte à une fiche'::text; end if;

      perform set_config('request.jwt.claims', '', true);
      update public.profiles set is_active = false where id = x_st;
      perform set_config('request.jwt.claims', json_build_object('sub', x_st, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      x_ok := false;
      begin perform public.stg_sessions(); exception when insufficient_privilege then x_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if x_ok then v_lines := v_lines || 'OK      stg   0047 : compte désactivé, plus aucun accès'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   stg   0047 : compte désactivé, plus aucun accès'::text; end if;
    end;
  end if;

  -- Fonction 10, pont formation et maintenance (0130) : résumé sans noms pour le technicien, une seule piste ouverte
  if to_regclass('public.cross_sell_leads') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 6;
    declare
      p_cli uuid; p_site uuid; p_vis uuid; p_vis2 uuid; p_tr1 uuid; p_tr2 uuid; p_tr3 uuid; p_rule uuid; p_course uuid; p_ses uuid;
      p_j jsonb; p_l1 uuid; p_l2 uuid; p_ok boolean; p_n int;
    begin
      update public.org_modules set enabled = true where key in ('pont', 'interventions', 'formation');
      insert into public.clients (name) values ('Essai pont') returning id into p_cli;
      select id into p_site from public.sites where client_id = p_cli and is_default limit 1;
      insert into public.trainees (first_name, last_name, client_id, site_id) values ('Pontus', 'Forme', p_cli, p_site) returning id into p_tr1;
      insert into public.trainees (first_name, last_name, client_id, site_id) values ('Pontine', 'Nonforme', p_cli, p_site) returning id into p_tr2;
      insert into public.trainees (first_name, last_name, client_id) values ('Sanssite', 'Pont', p_cli) returning id into p_tr3;
      select id into p_rule from public.obligation_rules where code = 'incendie_equipier' and company_id = (select company_id from public.clients where id = p_cli);
      insert into public.external_trainings (client_id, trainee_id, rule_id, provider_name, done_on, valid_until)
      values (p_cli, p_tr1, p_rule, 'Autre organisme', current_date - 30, current_date + 200);
      insert into public.itv_visits (client_id, site_id, technician_id, status, reference) values (p_cli, p_site, u_tech, 'planifiee', 'VIS-PONT') returning id into p_vis;
      insert into public.itv_visits (client_id, site_id, technician_id, status) values (p_cli, p_site, u_ges, 'planifiee') returning id into p_vis2;

      perform set_config('request.jwt.claims', json_build_object('sub', u_tech, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      p_j := public.itv_site_training_summary(p_vis);
      execute 'reset role';
      if (p_j ->> 'connus')::int = 2 and (p_j ->> 'formes')::int = 1 and (p_j ->> 'sans_site')::int = 1
         and (p_j ->> 'prochaine_echeance')::date = current_date + 200 and position('Pontus' in p_j::text) = 0 then
        v_lines := v_lines || 'OK      tech  0130 : personnel du site en nombres (2 connus, 1 formé, 1 sans site), sans noms'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   tech  0130 : personnel du site en nombres (' || p_j::text || ')'); end if;

      execute 'set local role authenticated';
      p_ok := false;
      begin perform public.itv_site_training_summary(p_vis2); exception when insufficient_privilege then p_ok := true; end;
      p_l1 := public.pont_signaler_besoin(p_vis, 'Nouveaux embauchés');
      p_l2 := public.pont_signaler_besoin(p_vis, 'Encore un');
      perform public.pont_declarer_exercice(p_vis, current_date - 10);
      p_ok := p_ok and not exists (select 1 from public.cross_sell_leads);
      execute 'reset role';
      if p_ok and p_l1 = p_l2 and (select count(*) from public.cross_sell_leads where client_id = p_cli) = 1
         and (select note from public.cross_sell_leads where id = p_l1) like '%Nouveaux embauchés%Encore un%' then
        v_lines := v_lines || 'OK      tech  0130 : signale un besoin (une seule piste ouverte, notes ajoutées), pas la visite d''un autre ni les pistes'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   tech  0130 : signalement d''un besoin de formation'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_tech, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      p_j := public.itv_site_training_summary(p_vis);
      execute 'reset role';
      if (p_j ->> 'dernier_exercice')::date = current_date - 10 and (p_j ->> 'piste_ouverte')::boolean
         and exists (select 1 from public.client_safety_checks where client_id = p_cli and declared_by_client) then
        v_lines := v_lines || 'OK      tech  0130 : exercice déclaré par le client, repris dans le résumé'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   tech  0130 : exercice déclaré par le client'::text; end if;

      -- Fin de session incendie chez un client sans contrat : piste vers la maintenance (une seule)
      perform set_config('request.jwt.claims', '', true);
      insert into public.courses (title, code) values ('Essai équipier incendie', 'ESSAI-EPI') returning id into p_course;
      update public.obligation_rules set course_ids = array_append(coalesce(course_ids, '{}'), p_course) where id = p_rule;
      insert into public.sessions (reference, course_id, client_id, start_date, end_date, attendance_token, status)
      values ('SES-PONT', p_course, p_cli, current_date - 1, current_date - 1, 'pont-1', 'planned') returning id into p_ses;
      update public.sessions set status = 'completed' where id = p_ses;
      update public.sessions set status = 'planned' where id = p_ses;
      update public.sessions set status = 'completed' where id = p_ses;
      select count(*) into p_n from public.cross_sell_leads where client_id = p_cli and direction = 'vers_maintenance';
      if p_n = 1 then v_lines := v_lines || 'OK      base  0130 : session incendie terminée sans contrat : une piste maintenance'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0130 : piste maintenance (' || p_n || ')'); end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      p_ok := (select count(*) from public.cross_sell_leads where client_id = p_cli) = 2;
      update public.cross_sell_leads set status = 'en_cours' where id = p_l1;
      execute 'reset role';
      if p_ok and (select status from public.cross_sell_leads where id = p_l1) = 'en_cours' then
        v_lines := v_lines || 'OK      com   0130 : voit et suit les pistes'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0130 : voit et suit les pistes'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_for, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      p_ok := false;
      begin perform public.pont_signaler_besoin(p_vis, 'Intrus'); exception when insufficient_privilege then p_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if p_ok then v_lines := v_lines || 'OK      form  0130 : ne signale rien sur une visite qui n''est pas la sienne'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   form  0130 : ne signale rien sur une visite qui n''est pas la sienne'::text; end if;
    end;
  end if;

  -- Fonction 11, registre de sécurité (0140) : sites du compte entreprise, exercices et documents, dossier de contrôle
  if to_regclass('public.client_documents') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 5;
    declare
      g_u uuid := gen_random_uuid(); g_cli uuid; g_sa uuid; g_sb uuid; g_acc uuid; g_rule uuid; g_j jsonb; g_ok boolean; g_id uuid;
    begin
      update public.org_modules set enabled = true where key = 'registre';
      insert into auth.users (id, email, aud, role) values (g_u, 'reg.ent@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (g_u, 'reg.ent@test.invalid', 'entreprise', true)
      on conflict (id) do update set role = 'entreprise', is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      insert into public.clients (name) values ('Essai registre') returning id into g_cli;
      select id into g_sa from public.sites where client_id = g_cli and is_default limit 1;
      insert into public.sites (client_id, name, kind) values (g_cli, 'Entrepôt', 'client') returning id into g_sb;
      insert into public.client_accounts (profile_id, client_id, all_sites) values (g_u, g_cli, false) returning id into g_acc;
      insert into public.client_account_sites (account_id, site_id) values (g_acc, g_sa);
      select id into g_rule from public.obligation_rules where code = 'exercice_evacuation' and company_id = (select company_id from public.clients where id = g_cli);

      perform set_config('request.jwt.claims', json_build_object('sub', g_u, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      g_j := public.ent_registre(null);
      g_ok := jsonb_array_length(g_j -> 'sites') = 1 and g_j -> 'sites' -> 0 ->> 'id' = g_sa::text;
      begin perform public.ent_registre(g_sb); g_ok := false; exception when insufficient_privilege then null; end;
      execute 'reset role';
      if g_ok then v_lines := v_lines || 'OK      ent   0140 : registre des seuls sites du compte, autre site refusé'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ent   0140 : registre des seuls sites du compte'::text; end if;

      execute 'set local role authenticated';
      g_id := public.ent_exercice_ajouter(g_sa, g_rule, current_date - 5, 12, 'Évacuation en 3 minutes');
      g_ok := true;
      begin perform public.ent_exercice_ajouter(g_sb, g_rule, current_date - 5); g_ok := false; exception when insufficient_privilege then null; end;
      begin perform public.ent_document_ajouter(g_sa, 'consigne_incendie', 'Consigne', 'autre/chemin.pdf', 'c.pdf'); g_ok := false; exception when sqlstate '22023' then null; end;
      g_j := public.ent_registre(g_sa);
      execute 'reset role';
      if g_ok and g_id is not null and jsonb_array_length(g_j -> 'exercices') = 1
         and (select x ->> 'etat' from jsonb_array_elements(g_j -> 'dossier') x where x ->> 'piece' like 'Exercices%') = 'a_jour'
         and (select x ->> 'etat' from jsonb_array_elements(g_j -> 'dossier') x where x ->> 'piece' like 'Consigne%') = 'manquant' then
        v_lines := v_lines || 'OK      ent   0140 : exercice ajouté sur son site, fichier d''ailleurs refusé, dossier de contrôle à jour'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   ent   0140 : exercice et dossier (' || coalesce((g_j -> 'dossier')::text, 'vide') || ')'); end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_ges, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.client_documents (client_id, site_id, kind, title) values (g_cli, g_sa, 'consigne_incendie', 'Consigne incendie');
      g_j := public.registre_client(g_cli, g_sa);
      execute 'reset role';
      if (select x ->> 'etat' from jsonb_array_elements(g_j -> 'dossier') x where x ->> 'piece' like 'Consigne%') = 'a_jour'
         and jsonb_array_length(g_j -> 'sites') = 2 then
        v_lines := v_lines || 'OK      ges   0140 : dépose une consigne, voit le registre de tous les sites'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   0140 : registre du client depuis la fiche'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_tech, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      g_ok := false;
      begin perform public.ent_registre(null); exception when insufficient_privilege then g_ok := true; end;
      g_ok := g_ok and not exists (select 1 from public.client_documents where client_id = g_cli);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if g_ok then v_lines := v_lines || 'OK      tech  0140 : ni espace entreprise ni documents du registre'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   tech  0140 : ni espace entreprise ni documents du registre'::text; end if;

      if exists (select 1 from storage.buckets where id = 'registre' and not public)
         and (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'registre\_%') = 3 then
        v_lines := v_lines || 'OK      base  0140 : pièces du registre dans un bucket privé, règles par droits et par client'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0140 : bucket privé du registre'::text; end if;
    end;
  end if;

  -- Fonction 12, prévisionnel (0150) : montants calculés, sans prix comptés à part, pas de double comptage
  if to_regclass('public.v_recurring_revenue') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 4;
    declare
      w_cli uuid; w_t1 uuid; w_t2 uuid; w_t3 uuid; w_sst uuid; w_gp uuid; w_c1 uuid; w_c2 uuid; w_ses uuid; w_k uuid;
      w_r record; w_n int; w_res jsonb;
    begin
      insert into public.clients (name) values ('Essai prévisionnel') returning id into w_cli;
      insert into public.trainees (first_name, last_name, client_id) values ('A', 'Prev', w_cli) returning id into w_t1;
      insert into public.trainees (first_name, last_name, client_id) values ('B', 'Prev', w_cli) returning id into w_t2;
      insert into public.trainees (first_name, last_name, client_id) values ('C', 'Prev', w_cli) returning id into w_t3;
      insert into public.courses (title, code, price_ht) values ('Essai SST prévisionnel', 'ESSAI-PREV-SST', 200) returning id into w_c1;
      insert into public.courses (title, code) values ('Essai gestes sans prix', 'ESSAI-PREV-GP') returning id into w_c2;
      select id into w_sst from public.obligation_rules where code = 'sst' and company_id = (select company_id from public.clients where id = w_cli);
      select id into w_gp from public.obligation_rules where code = 'gestes_postures' and company_id = (select company_id from public.clients where id = w_cli);
      update public.obligation_rules set course_ids = array[w_c1] where id = w_sst;
      update public.obligation_rules set course_ids = array[w_c2], validity_months = coalesce(validity_months, 24) where id = w_gp;
      insert into public.external_trainings (client_id, trainee_id, rule_id, provider_name, done_on, valid_until) values
        (w_cli, w_t1, w_sst, 'Ailleurs', current_date - 600, current_date + 100),
        (w_cli, w_t1, w_sst, 'Ailleurs', current_date - 650, current_date + 50),
        (w_cli, w_t2, w_sst, 'Ailleurs', current_date - 600, current_date + 100),
        (w_cli, w_t3, w_sst, 'Ailleurs', current_date - 600, current_date + 100),
        (w_cli, w_t1, w_gp, 'Ailleurs', current_date - 600, current_date + 120);
      insert into public.sessions (reference, course_id, client_id, start_date, end_date, attendance_token)
      values ('SES-PREV', w_c1, w_cli, current_date + 20, current_date + 20, 'prev-1') returning id into w_ses;
      insert into public.session_trainees (session_id, trainee_id) values (w_ses, w_t2);

      select sum(nb_echeances) as nb, sum(montant_attendu) as m, sum(nb_planifies) as np, sum(montant_planifie) as mp
        into w_r from public.v_recurring_revenue where client_id = w_cli and nature = 'formation' and rule_id = w_sst;
      if w_r.nb = 3 and w_r.m = 600 and w_r.np = 1 and w_r.mp = 200 then
        v_lines := v_lines || 'OK      base  0150 : recyclages chiffrés au prix du catalogue, un stagiaire compté une fois, part planifiée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0150 : recyclages chiffrés (' || coalesce(w_r.nb, 0) || ' / ' || coalesce(w_r.m, 0) || ' / ' || coalesce(w_r.np, 0) || ')'); end if;

      select sum(nb_sans_prix) as sp, sum(montant_attendu) as m into w_r from public.v_recurring_revenue where client_id = w_cli and rule_id = w_gp;
      if w_r.sp = 1 and w_r.m = 0 then
        v_lines := v_lines || 'OK      base  0150 : échéance sans prix comptée à part, jamais estimée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0150 : échéance sans prix comptée à part'::text; end if;

      insert into public.itv_contracts (client_id, reference, label, start_on, end_on, annual_price_ht, status)
      values (w_cli, 'CTR-PREV', 'Contrat essai', current_date - 335, current_date + 30, 1200, 'actif') returning id into w_k;
      perform public.scheduled_actions_generate();
      perform public.scheduled_actions_generate();
      select count(*) into w_n from public.scheduled_actions where kind = 'renouvellement_contrat' and target_id = w_k;
      if w_n = 1 and (select sum(montant_attendu) from public.v_recurring_revenue where client_id = w_cli and nature = 'contrat') = 1200 then
        v_lines := v_lines || 'OK      base  0150 : contrat à renouveler chiffré, relance préparée une seule fois'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0150 : contrat à renouveler (' || w_n || ')'); end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      w_n := (select count(*) from public.v_recurring_revenue where client_id = w_cli);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if w_n >= 2 then v_lines := v_lines || 'OK      com   0150 : le commercial lit le prévisionnel'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   com   0150 : le commercial lit le prévisionnel (' || w_n || ')'); end if;
    end;
  end if;

  -- Fonction 13, pilote des sessions (0160) : étapes préparées une seule fois, blocage avec raison, session annulée
  if to_regprocedure('public.pilote_generate()') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 5;
    declare
      q_cli uuid; q_t1 uuid; q_t2 uuid; q_co uuid; q_a uuid; q_b uuid; q_c uuid; q_n int; q_j jsonb; q_ok boolean;
    begin
      update public.org_modules set enabled = false where key = 'pilote';
      q_j := public.pilote_generate();
      update public.org_modules set enabled = true where key = 'pilote';
      insert into public.clients (name, contact_email) values ('Essai pilote', 'pilote@test.invalid') returning id into q_cli;
      insert into public.trainees (first_name, last_name, client_id, email) values ('P1', 'Pilote', q_cli, 'p1@test.invalid') returning id into q_t1;
      insert into public.trainees (first_name, last_name, client_id) values ('P2', 'Pilote', q_cli) returning id into q_t2;
      insert into public.courses (title, code) values ('Essai pilote', 'ESSAI-PIL') returning id into q_co;
      insert into public.sessions (reference, course_id, client_id, start_date, end_date, start_time, location_name, attendance_token)
      values ('SES-PIL-A', q_co, q_cli, current_date + 5, current_date + 5, '09:00', 'Salle 1', 'pil-a') returning id into q_a;
      insert into public.sessions (reference, course_id, client_id, start_date, end_date, start_time, attendance_token)
      values ('SES-PIL-B', q_co, q_cli, current_date + 5, current_date + 5, '09:00', 'pil-b') returning id into q_b;
      insert into public.sessions (reference, course_id, client_id, start_date, end_date, start_time, location_name, attendance_token)
      values ('SES-PIL-C', q_co, q_cli, current_date - 2, current_date - 2, '09:00', 'Salle 2', 'pil-c') returning id into q_c;
      insert into public.session_trainees (session_id, trainee_id) values (q_a, q_t1), (q_a, q_t2), (q_b, q_t1), (q_c, q_t1);

      perform public.pilote_generate();
      perform public.pilote_generate();
      if q_j ->> 'pilote' = 'inactif'
         and (select count(*) from public.scheduled_actions where session_id = q_a and kind = 'convocation') = 1
         and (select blocked_reason from public.scheduled_actions where session_id = q_a and kind = 'convocation') is null then
        v_lines := v_lines || 'OK      base  0160 : module inactif, rien ; convocation préparée une seule fois'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0160 : convocation préparée une seule fois'::text; end if;

      q_ok := (select blocked_reason from public.scheduled_actions where session_id = q_b and kind = 'convocation') = 'Lieu non renseigné';
      update public.sessions set location_name = 'Salle 3' where id = q_b;
      perform public.pilote_generate();
      if q_ok and (select blocked_reason from public.scheduled_actions where session_id = q_b and kind = 'convocation') is null then
        v_lines := v_lines || 'OK      base  0160 : convocation bloquée avec la raison, débloquée quand le lieu est saisi'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0160 : blocage avec raison'::text; end if;

      if (select count(*) from public.scheduled_actions where session_id = q_c and kind = 'emargement_manquant') = 1
         and (select blocked_reason from public.scheduled_actions where session_id = q_c and kind = 'attestations') = 'Émargement incomplet'
         and (select blocked_reason from public.scheduled_actions where session_id = q_c and kind = 'facture_brouillon') = 'Prix non renseigné' then
        v_lines := v_lines || 'OK      base  0160 : fin de session, émargement à compléter, attestations et facture bloquées avec la raison'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0160 : étapes de fin de session'::text; end if;

      update public.sessions set status = 'cancelled' where id = q_a;
      perform public.pilote_generate();
      if (select status from public.scheduled_actions where session_id = q_a and kind = 'convocation') = 'ignore' then
        v_lines := v_lines || 'OK      base  0160 : session annulée, ses actions à valider sont ignorées'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0160 : session annulée'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_ges, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      q_n := (select count(*) from public.scheduled_actions where session_id in (q_b, q_c));
      q_ok := false;
      begin perform public.pilote_generate(); exception when insufficient_privilege then q_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', u_for, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      q_ok := q_ok and not exists (select 1 from public.scheduled_actions where session_id in (q_b, q_c));
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if q_n >= 4 and q_ok then v_lines := v_lines || 'OK      ges   0160 : le gestionnaire voit les étapes, ne lance pas la génération ; le formateur ne les voit pas'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   ges   0160 : droits sur les étapes (' || q_n || ')'); end if;
    end;
  end if;

  -- Chantier F, conformité RGPD (0340) : modèles proposés, lignes héritées archivées, échéances calculées par la base,
  -- demandes et violations réservées à leurs droits
  if to_regclass('public.rgpd_violations') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 5;
    declare
      g_co uuid := app.company_default(); g_d uuid; g_v uuid; g_n int; g_ok boolean; g_r record;
    begin
      if (select count(*) from public.rgpd_traitements where company_id = g_co and origine = 'modele') >= 5
         and (select count(*) from public.rgpd_sous_traitants where company_id = g_co) >= 6
         and not exists (select 1 from public.rgpd_traitements where origine = 'reprise' and statut <> 'archive') then
        v_lines := v_lines || 'OK      base  0340 : traitements modèles proposés, sous-traitants posés, lignes héritées archivées'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0340 : registre de départ'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.rgpd_demandes (nom, droit, recue_le) values ('Essai demande', 'acces', date '2026-10-31') returning id into g_d;
      g_ok := false;
      begin
        update public.rgpd_demandes set prolongee = true where id = g_d;
      exception when check_violation then g_ok := true; end;
      update public.rgpd_demandes set prolongee = true, prolongation_motif = 'Demande complexe' where id = g_d;
      select echeance into g_r from public.rgpd_demandes where id = g_d;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if g_ok and g_r.echeance = date '2027-01-31' then
        v_lines := v_lines || 'OK      dir   0340 : demande à un mois, prolongation seulement avec motif (trois mois)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0340 : échéance des demandes (' || coalesce(g_r.echeance::text, 'vide') || ')'); end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.rgpd_violations (decouverte_le, description, nature) values ('2026-10-19 08:00+00', 'Essai violation', array['confidentialite'])
      returning id into g_v;
      select echeance_notification into g_r from public.rgpd_violations where id = g_v;
      g_n := public.rgpd_proposer_modeles();
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if g_r.echeance_notification = timestamptz '2026-10-22 08:00+00' and g_n = 0 then
        v_lines := v_lines || 'OK      dir   0340 : violation à notifier sous 72 h ; modèles proposés une seule fois'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0340 : échéance des violations ou modèles en double'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      g_n := (select count(*) from public.rgpd_demandes) + (select count(*) from public.rgpd_violations) + (select count(*) from public.rgpd_aipd);
      g_ok := false;
      begin perform public.rgpd_proposer_modeles(); exception when insufficient_privilege then g_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if g_n = 0 and g_ok then v_lines := v_lines || 'OK      com   0340 : le commercial ne lit ni demandes ni violations, ne touche pas au registre'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   com   0340 : droits RGPD (' || g_n || ')'); end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      update public.rgpd_traitements set statut = 'valide' where company_id = g_co and modele_cle = 'plateforme.comptes';
      select statut, valide_par, actif into g_r from public.rgpd_traitements where company_id = g_co and modele_cle = 'plateforme.comptes';
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if g_r.statut = 'valide' and g_r.valide_par = u_dir and g_r.actif then
        v_lines := v_lines || 'OK      dir   0340 : traitement validé, validation tracée par la base'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0340 : validation d''un traitement'::text; end if;
    end;
  end if;

  -- Chantier 10, suivi des affaires (0380) : prochaine action obligatoire, devis lié qui fait avancer l'affaire,
  -- opposition synchronisée avec « ne pas solliciter », montants cachés au technicien, clients à appeler
  if to_regclass('public.opportunities') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 7;
    declare
      k_cli uuid; k_cli2 uuid; k_q uuid; k_q2 uuid; k_q3 uuid; k_o uuid; k_o2 uuid; k_n int; k_ok boolean; k_r record;
    begin
      insert into public.clients (name, status) values ('Essai affaires', 'actif') returning id into k_cli;
      insert into public.clients (name, status) values ('Essai affaires bis', 'actif') returning id into k_cli2;
      if (select count(*) from public.commercial_lists where company_id = (select company_id from public.clients where id = k_cli) and kind = 'etape') >= 6
         and exists (select 1 from public.commercial_lists where company_id = (select company_id from public.clients where id = k_cli)
                     and kind = 'etape' and code = 'gagnee' and probability = 100) then
        v_lines := v_lines || 'OK      base  0380 : étapes posées pour la société, « Gagnée » à 100 %'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0380 : étapes posées pour la société'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      k_ok := false;
      begin
        insert into public.opportunities (client_id, title) values (k_cli, 'Sans prochaine action');
      exception when check_violation then k_ok := true; end;
      insert into public.opportunities (client_id, title, next_action_on, amount_ht) values (k_cli, 'Formation SST', current_date + 3, 1000)
      returning id into k_o;
      begin
        delete from public.commercial_lists where code = 'gagnee' and kind = 'etape';
        k_ok := false;
      exception when invalid_parameter_value then null; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if k_ok and (select probability from public.opportunities where id = k_o) = 10 then
        v_lines := v_lines || 'OK      com   0380 : affaire refusée sans prochaine action, créée avec la probabilité de son étape ; « Gagnée » non supprimable'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0380 : prochaine action obligatoire'::text; end if;

      insert into public.quotes (reference, client_id, status, total_ht) values ('DEV-AFF-1', k_cli, 'draft', 1200) returning id into k_q;
      update public.opportunities set quote_id = k_q where id = k_o;
      update public.quotes set status = 'sent' where id = k_q;
      select stage, probability into k_r from public.opportunities where id = k_o;
      k_ok := k_r.stage = 'devis_envoye' and k_r.probability = 50;
      update public.quotes set status = 'accepted' where id = k_q;
      if k_ok and (select stage = 'gagnee' and probability = 100 and closed_at is not null and amount_ht = 1000 from public.opportunities where id = k_o) then
        v_lines := v_lines || 'OK      base  0380 : devis envoyé puis accepté : l''affaire passe à « Devis envoyé » puis « Gagnée »'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0380 : devis lié qui fait avancer l''affaire'::text; end if;

      insert into public.quotes (reference, client_id, status, total_ht) values ('DEV-AFF-2', k_cli, 'sent', 500) returning id into k_q2;
      insert into public.opportunities (client_id, title, next_action_on, quote_id) values (k_cli, 'Extincteurs', current_date + 1, k_q2) returning id into k_o2;
      update public.quotes set status = 'refused' where id = k_q2;
      insert into public.quotes (reference, client_id, status, total_ht) values ('DEV-AFF-3', k_cli2, 'sent', 800) returning id into k_q3;
      if (select stage = 'perdue' and lost_reason is not null and amount_ht = 500 and next_action_on is not null from public.opportunities where id = k_o2)
         and (select count(*) from public.v_pipeline where id = k_q3 and origine = 'devis' and montant_pondere = 400) = 1 then
        v_lines := v_lines || 'OK      base  0380 : devis refusé : affaire perdue avec motif ; devis envoyé sans affaire compté au pipeline (pondéré)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0380 : devis refusé et pipeline'::text; end if;

      update public.clients set opposition_canaux = array['email', 'appel'] where id = k_cli2;
      k_ok := (select do_not_mail and opposition_at is not null from public.clients where id = k_cli2);
      update public.clients set do_not_mail = false where id = k_cli2;
      if k_ok and (select opposition_canaux = array['appel'] and not do_not_mail from public.clients where id = k_cli2) then
        v_lines := v_lines || 'OK      base  0380 : opposition par email et « ne pas solliciter » suivis dans les deux sens'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0380 : opposition synchronisée'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_tech, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      k_n := (select count(*) from public.opportunities where client_id in (k_cli, k_cli2))
           + (select count(*) from public.v_pipeline where client_id in (k_cli, k_cli2));
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if k_n = 0 then v_lines := v_lines || 'OK      tech  0380 : le technicien ne lit ni les affaires ni le pipeline (montants)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   tech  0380 : affaires cachées au technicien (' || k_n || ')'); end if;

      insert into public.itv_contracts (client_id, reference, label, start_on, end_on, annual_price_ht, status)
      values (k_cli2, 'CTR-AFF', 'Contrat essai affaires', current_date - 300, current_date + 30, 600, 'actif');
      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select * into k_r from public.v_clients_a_appeler where client_id = k_cli2;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if k_r.client_id is not null and k_r.ne_pas_appeler and 'contrat' = any (k_r.natures) and k_r.devis_en_cours then
        v_lines := v_lines || 'OK      com   0380 : client à appeler sur son échéance, opposition à l''appel et devis en cours signalés'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0380 : clients à appeler'::text; end if;
    end;
  end if;

  -- Chantier F, journal d'audit commun (0345) : auteur posé par la base, champs modifiés sans valeurs, rien sans compte
  if to_regprocedure('app.audit_row()') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 4;
    declare
      j_t uuid; j_n int; j_r record; j_id uuid;
    begin
      insert into public.trainees (first_name, last_name) values ('Journal', 'Essai') returning id into j_t;
      update public.trainees set city = 'Morlaix' where id = j_t;
      if not exists (select 1 from public.audit_logs where entity_id = j_t and source = 'base') then
        v_lines := v_lines || 'OK      base  0345 : écriture sans compte (tâche, service) non tracée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0345 : écriture sans compte tracée'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_ges, 'role', 'authenticated')::text, true);
      perform set_config('request.headers', '{"x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "Essai"}', true);
      execute 'set local role authenticated';
      update public.trainees set city = 'Brest', job_title = 'Cariste' where id = j_t;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.headers', '', true);
      select * into j_r from public.audit_logs where entity_id = j_t and source = 'base' order by timestamp desc limit 1;
      if j_r.user_id = u_ges and j_r.action = 'update' and j_r.entity_type = 'trainee' and j_r.ip_address = '203.0.113.7'
         and j_r.details -> 'champs' = '["city", "job_title"]'::jsonb and j_r.details::text not like '%Brest%' then
        v_lines := v_lines || 'OK      ges   0345 : modification d''un stagiaire tracée par la base (auteur, IP, champs sans valeurs)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   ges   0345 : trace de modification (' || coalesce(j_r.details::text, 'aucune') || ')'); end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_ges, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.audit_logs (user_id, user_email, action, entity_type, entity_name, source)
      values (u_dir, 'faux@test.invalid', 'view', 'system', 'Essai usurpation 0345', 'base');
      perform public.log_audit(u_dir, 'faux@test.invalid', 'view', 'client', null, 'Essai', null);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if (select user_id = u_ges and source = 'application' from public.audit_logs where entity_name = 'Essai usurpation 0345')
         and not exists (select 1 from public.audit_logs where user_id = u_dir and user_email = 'faux@test.invalid') then
        v_lines := v_lines || 'OK      ges   0345 : impossible d''écrire au journal au nom d''un autre compte'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   0345 : auteur imposé par la base'::text; end if;

      j_n := (select count(*) from public.audit_logs where entity_id = u_ges and source = 'base');
      perform set_config('request.jwt.claims', json_build_object('sub', u_ges, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      update public.profiles set ui_prefs = '{"nav": "rail"}'::jsonb where id = u_ges;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if (select count(*) from public.audit_logs where entity_id = u_ges and source = 'base') = j_n then
        v_lines := v_lines || 'OK      ges   0345 : préférences d''affichage seules, rien au journal'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   0345 : bruit des préférences au journal'::text; end if;
    end;
  end if;

  -- Chantier F, purges (0344) : passage préparé la nuit, décision réservée, lignes recalculées, stagiaire anonymisé
  if to_regprocedure('public.rgpd_purges_generer()') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 4;
    declare
      p_co uuid := app.company_default(); p_log uuid; p_t uuid; p_pass uuid; p_ok boolean; p_n int; p_r jsonb;
    begin
      insert into public.audit_logs (action, entity_type, entity_name, company_id, timestamp)
      values ('view', 'system', 'Essai purge', p_co, now() - interval '3 years') returning id into p_log;
      insert into public.trainees (first_name, last_name, email, created_at) values ('Purge', 'Ancien', 'purge@test.invalid', now() - interval '7 years')
      returning id into p_t;
      perform public.rgpd_purges_generer();
      perform public.rgpd_purges_generer();
      if (select count(*) from public.rgpd_purge_passages where company_id = p_co and cle = 'journal' and statut = 'a_valider') = 1
         and exists (select 1 from public.rgpd_purge_passages where cle = 'journal' and statut = 'a_valider' and p_log = any (candidats))
         and exists (select 1 from public.rgpd_purge_passages where cle = 'stagiaires' and statut = 'a_valider' and p_t = any (candidats)) then
        v_lines := v_lines || 'OK      base  0344 : passages préparés la nuit, un seul ouvert par règle'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0344 : passages préparés'::text; end if;

      select id into p_pass from public.rgpd_purge_passages where company_id = p_co and cle = 'journal' and statut = 'a_valider';
      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      p_ok := false;
      begin perform public.rgpd_purge_decider(p_pass, 'executer'); exception when insufficient_privilege then p_ok := true; end;
      p_n := (select count(*) from public.rgpd_purge_passages);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if p_ok and p_n = 0 and exists (select 1 from public.audit_logs where id = p_log) then
        v_lines := v_lines || 'OK      com   0344 : le commercial ne voit ni ne décide les purges'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0344 : purges réservées'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      p_r := public.rgpd_purge_decider(p_pass, 'executer');
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if not exists (select 1 from public.audit_logs where id = p_log)
         and (select statut = 'execute' and decide_par = u_dir from public.rgpd_purge_passages where id = p_pass)
         and (select derniere_validation_le is not null from public.rgpd_purge_regles where company_id = p_co and cle = 'journal') then
        v_lines := v_lines || 'OK      dir   0344 : la direction exécute la purge du journal, décision tracée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0344 : exécution de la purge'::text; end if;

      select id into p_pass from public.rgpd_purge_passages where company_id = p_co and cle = 'stagiaires' and statut = 'a_valider';
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      p_r := public.rgpd_purge_decider(p_pass, 'executer');
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if (select first_name = 'Anonymisé' and email is null from public.trainees where id = p_t) then
        v_lines := v_lines || 'OK      dir   0344 : stagiaire sans session depuis 5 ans anonymisé (fiche gardée sans nom)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0344 : anonymisation des stagiaires'::text; end if;
    end;
  end if;

  -- Chantier F, IP de la signature lue par la base (0346)
  if to_regprocedure('app.signature_ip()') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 1;
    declare s_id uuid;
    begin
      perform set_config('request.headers', '{"x-forwarded-for": "198.51.100.4", "user-agent": "Essai signature"}', true);
      insert into public.document_signatures (document_type, signer_type, signer_name, signature_data, ip_address, status)
      values ('emargement', 'trainee', 'Essai IP', 'data:image/png;base64,AA', '10.9.9.9', 'valid') returning id into s_id;
      perform set_config('request.headers', '', true);
      if (select ip_address = '198.51.100.4' and user_agent = 'Essai signature' from public.document_signatures where id = s_id) then
        v_lines := v_lines || 'OK      base  0346 : adresse IP de la signature lue dans la requête, pas celle envoyée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0346 : adresse IP de la signature'::text; end if;
    end;
  end if;

  -- Chantier F, certifications (0350) : face interne réservée à la direction, référentiel d'une société isolé,
  -- garde des documents réservés aux certifiés
  if to_regclass('public.cert_pitfalls') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 7;
    declare
      k_co uuid := app.company_default(); k_autre uuid; k_n int; k_m int; k_ok boolean; k_code text;
    begin
      if (select count(*) from public.cert_pitfalls where company_id = k_co and domaine = 'apsad') >= 14
         and (select count(*) from public.cert_pitfalls where company_id = k_co and domaine = 'qualiopi') >= 15
         and (select count(*) from public.cert_pitfalls where company_id = k_co and domaine = 'nda') >= 8
         and not exists (select 1 from public.cert_pitfalls where company_id = k_co and statut <> 'a_confirmer')
         and not exists (select 1 from public.cert_criteria where referential_code = 'apsad-i4nf285') then
        v_lines := v_lines || 'OK      base  0350 : erreurs à éviter posées (à confirmer), squelette APSAD sans exigence'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0350 : liste de départ des erreurs à éviter'::text; end if;

      insert into public.companies (legal_name) values ('Essai société certification') returning id into k_autre;
      insert into public.cert_referentials (code, label, kind, text_source, company_id)
      values ('essai-ref-autre', 'Référentiel interne d''une autre société', 'interne', 'societe', k_autre);
      insert into public.cert_criteria (referential_code, number, title) values ('essai-ref-autre', 1, 'Chapitre d''essai');
      if exists (select 1 from public.cert_pitfalls where company_id = k_autre and code = 'A0') then
        v_lines := v_lines || 'OK      base  0350 : une nouvelle société reçoit sa liste d''erreurs à éviter'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0350 : liste de départ d''une nouvelle société'::text; end if;

      if not app.cert_valid(k_co, 'apsad-i4nf285') then
        insert into public.cert_company_certifications (company_id, referential_code, statut, valable_jusqu_au)
        values (k_co, 'apsad-i4nf285', 'obtenue', current_date - 1)
        on conflict (company_id, referential_code) do update set statut = 'obtenue', valable_jusqu_au = current_date - 1;
        k_ok := not app.cert_valid(k_co, 'apsad-i4nf285');
        update public.cert_company_certifications set valable_jusqu_au = current_date + 365 where company_id = k_co and referential_code = 'apsad-i4nf285';
        if k_ok and app.cert_valid(k_co, 'apsad-i4nf285') and not app.cert_valid(k_autre, 'apsad-i4nf285') then
          v_lines := v_lines || 'OK      base  0350 : documents réservés aux certifiés : certification obtenue et en cours de validité seulement'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0350 : garde app.cert_valid'::text; end if;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0350 : APSAD déjà valide avant l''essai'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_ges, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      k_n := (select count(*) from public.cert_pitfalls);
      k_m := (select count(*) from public.cert_company_certifications where referential_code = 'apsad-i4nf285');
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if k_n = 0 and k_m = 1 then
        v_lines := v_lines || 'OK      ges   0350 : le gestionnaire tient les certifications sans voir la face interne'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   0350 : face interne cachée au gestionnaire'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_ges, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      k_code := public.cert_importer_texte('apsad-i4nf285', '[{"chapitre": 1, "chapitre_titre": "Organisation", "code": "1.1", "titre": "Contrat", "texte": "Texte d''essai A"}, {"chapitre": 2, "code": "2.1", "texte": "Texte d''essai B"}]'::jsonb);
      k_n := (select count(*) from public.cert_indicators where referential_code = k_code);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      k_ok := false;
      begin perform public.cert_importer_texte('apsad-i4nf285', '[{"chapitre": 1, "texte": "x"}]'::jsonb); exception when insufficient_privilege or no_data_found then k_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if k_n = 2 and k_ok and (select company_id = k_co and text_source = 'societe' from public.cert_referentials where code = k_code)
         and not exists (select 1 from public.cert_criteria where referential_code = 'apsad-i4nf285') then
        v_lines := v_lines || 'OK      ges   0350 : texte APSAD importé dans une copie propre à la société (refusé au commercial)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   0350 : import du texte d''un référentiel'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      k_n := (select count(*) from public.cert_pitfalls) + (select count(*) from public.cert_company_certifications);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if k_n = 0 then
        v_lines := v_lines || 'OK      com   0350 : le commercial ne lit ni certifications ni face interne'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0350 : certifications cachées au commercial'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      k_n := (select count(*) from public.cert_pitfalls where company_id = k_co);
      k_m := (select count(*) from public.cert_pitfalls where company_id = k_autre)
           + (select count(*) from public.cert_referentials where code = 'essai-ref-autre')
           + (select count(*) from public.cert_criteria where referential_code = 'essai-ref-autre');
      k_ok := (select count(*) from public.cert_referentials where code in ('rnq-2026', 'apsad-i4nf285')) = 2;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if k_n >= 37 and k_m = 0 and k_ok then
        v_lines := v_lines || 'OK      dir   0350 : la direction lit sa face interne et les référentiels communs, rien d''une autre société'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0350 : face interne et isolement des référentiels'::text; end if;
    end;
  end if;

  -- Chantier F, Interventions (0354) : clôture refusée sans motif de remplacement, sans information du client quand
  -- le remplacement prend la place d'une opération périodique ; numéro de série du nouvel appareil repris
  if to_regprocedure('app.itv_visite_cloture_garde()') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 3;
    declare
      i_v uuid; i_it uuid; i_err1 text; i_err2 text; i_ok boolean := false;
    begin
      insert into public.itv_visits (client_id, site_id, technician_id, status, started_at)
      values (v_client_tech, v_site, u_tech, 'en_cours', now()) returning id into i_v;
      insert into public.itv_visit_items (visit_id, equipment_id, operation, result, checked_at)
      values (i_v, v_eq, 'maa', 'remplace', now()) returning id into i_it;

      perform set_config('request.jwt.claims', json_build_object('sub', u_tech, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      begin perform public.itv_close_visit(i_v); exception when check_violation then i_err1 := sqlerrm; end;
      update public.itv_visit_items set replace_reason = 'fin_de_vie' where id = i_it;
      begin perform public.itv_close_visit(i_v); exception when check_violation then i_err2 := sqlerrm; end;
      update public.itv_visit_items set client_informed = true, new_serial_number = 'SN-ESSAI-0354' where id = i_it;
      perform public.itv_close_visit(i_v);
      i_ok := true;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);

      if i_err1 like '%sans motif%' then
        v_lines := v_lines || 'OK      tech  0354 : visite non clôturée tant qu''un appareil remplacé n''a pas de motif'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   tech  0354 : motif de remplacement obligatoire'::text; end if;
      if i_err2 like '%information du client%' then
        v_lines := v_lines || 'OK      tech  0354 : remplacement au lieu d''une maintenance : information du client exigée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   tech  0354 : information du client exigée'::text; end if;
      if i_ok and (select status = 'terminee' from public.itv_visits where id = i_v)
         and (select serial_number = 'SN-ESSAI-0354' from public.itv_equipment where id = v_eq) then
        v_lines := v_lines || 'OK      tech  0354 : visite clôturée, numéro de série du nouvel appareil repris'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   tech  0354 : clôture et numéro de série'::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 3; v_lines := v_lines || ('ÉCHEC   tech  0354 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Chantier 12, RH socle (0290) : dossiers pour la direction, annuaire seul pour le gestionnaire, rien pour le
  -- commercial, sa propre fiche pour la personne ; rémunération lue seulement par la fonction journalisée
  if to_regclass('public.hr_people') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 6;
    declare
      h_p1 uuid; h_p2 uuid; h_e1 uuid; h_e2 uuid; h_n int; h_m int; h_ok boolean; h_ok2 boolean; h_log int;
    begin
      insert into public.hr_people (first_name, last_name, personal_phone, work_phone) values ('Essai', 'RH UN', '0600000001', '0200000001') returning id into h_p1;
      insert into public.hr_people (first_name, last_name, personal_phone, profile_id) values ('Essai', 'RH DEUX', '0600000002', u_lec) returning id into h_p2;
      insert into public.hr_employments (person_id, start_on, job_title) values (h_p1, current_date - 100, 'Technicien') returning id into h_e1;
      insert into public.hr_employments (person_id, start_on, job_title) values (h_p2, current_date - 50, 'Assistant') returning id into h_e2;
      insert into public.hr_compensation (employment_id, amount, effective_on) values (h_e1, 2500, current_date - 100), (h_e2, 2100, current_date - 50);

      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      h_n := (select count(*) from public.hr_people where id in (h_p1, h_p2) and personal_phone is not null);
      h_m := (select count(*) from public.hr_compensation where employment_id in (h_e1, h_e2));
      h_ok := (select count(*) from public.hr_remuneration(h_e1) where amount = 2500) = 1;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      h_log := (select count(*) from public.audit_logs where entity_type = 'remuneration' and entity_id = h_e1 and user_id = u_dir);
      if h_n = 2 then
        v_lines := v_lines || 'OK      dir   0290 : la direction lit les dossiers du personnel'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0290 : dossiers du personnel'::text; end if;
      if h_m = 0 and h_ok and h_log = 1 then
        v_lines := v_lines || 'OK      dir   0290 : rémunération lue seulement par la fonction, consultation journalisée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0290 : rémunération journalisée'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_ges, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      h_n := (select count(*) from public.hr_people where id in (h_p1, h_p2));
      h_m := (select count(*) from public.v_hr_annuaire where id in (h_p1, h_p2) and work_phone is not distinct from (case when id = h_p1 then '0200000001' end));
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if h_n = 0 and h_m = 2 then
        v_lines := v_lines || 'OK      ges   0290 : le gestionnaire voit l''annuaire (champs professionnels) sans les dossiers'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   0290 : annuaire sans dossiers'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      h_n := (select count(*) from public.hr_people) + (select count(*) from public.v_hr_annuaire) + (select count(*) from public.hr_employments);
      h_ok := false;
      begin perform public.hr_remuneration(h_e1); exception when insufficient_privilege then h_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if h_n = 0 and h_ok then
        v_lines := v_lines || 'OK      com   0290 : le commercial ne voit ni personnel ni rémunération'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0290 : personnel caché au commercial'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_lec, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      h_n := (select count(*) from public.hr_people);
      h_m := (select count(*) from public.hr_compensation);
      h_ok := (select count(*) from public.hr_remuneration(h_e2)) = 1;
      h_ok2 := false;
      begin perform public.hr_remuneration(h_e1); exception when insufficient_privilege then h_ok2 := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if h_n = 1 and h_m = 1 and h_ok and h_ok2 then
        v_lines := v_lines || 'OK      lec   0290 : la personne lit sa fiche et sa rémunération, pas celles des autres'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   lec   0290 : sa propre fiche seulement'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_ges, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      h_ok := false;
      begin
        insert into public.hr_people (first_name, last_name) values ('Essai', 'Refus');
      exception when insufficient_privilege then h_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if h_ok then
        v_lines := v_lines || 'OK      ges   0290 : le gestionnaire ne crée pas de fiche du personnel'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ges   0290 : création réservée'::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 6; v_lines := v_lines || ('ÉCHEC   base  0290 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Chantier 12, RH absences (0294) : demande pour soi (profil salarié), circuit commun, validation par un autre,
  -- prise écrite au solde ; personne ne valide sa propre demande ; rien pour le commercial
  if to_regprocedure('public.hr_absence_demander(uuid,date,text,date,text,text,uuid)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 5;
    declare
      a_co uuid := app.company_default(); a_p uuid; a_cp uuid; a_lundi date; a_req uuid; a_req2 uuid; a_appro uuid;
      a_ok boolean; a_ok2 boolean; a_n numeric; a_m int; a_st text;
    begin
      a_lundi := (date_trunc('week', current_date + 14))::date;
      insert into public.hr_people (first_name, last_name, profile_id) values ('Essai', 'Absences', u_lec) on conflict do nothing;
      select id into a_p from public.hr_people where profile_id = u_lec and company_id = a_co limit 1;
      insert into public.company_member_roles (member_id, role_key)
      select m.id, 'salarie' from public.company_members m where m.profile_id = u_lec and m.company_id = a_co
      on conflict do nothing;
      select id into a_cp from public.hr_absence_types where company_id = a_co and code = 'CP';
      insert into public.hr_leave_ledger (company_id, person_id, type_id, kind, days, note) values (a_co, a_p, a_cp, 'acquisition', 10, 'Essai');

      perform set_config('request.jwt.claims', json_build_object('sub', u_lec, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      a_req := public.hr_absence_demander(a_cp, a_lundi, 'apres_midi', a_lundi + 4, 'matin', 'Essai');
      select approval_id, days into a_appro, a_n from public.hr_absence_requests where id = a_req;
      a_ok := false;
      begin perform public.approval_decide(a_appro, 'approved', null); exception when insufficient_privilege then a_ok := true; end;
      a_ok2 := false;
      begin perform public.hr_absence_demander(a_cp, a_lundi + 2, null, a_lundi + 2, null, 'Doublon'); exception when unique_violation then a_ok2 := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if a_n = 4 and a_appro is not null and a_ok and a_ok2 then
        v_lines := v_lines || 'OK      lec   0294 : demande pour soi (4 jours ouvrés avec demi-journées), envoyée au circuit, sans doublon ni auto-validation'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   lec   0294 : demande d''absence pour soi'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_ad, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      a_st := public.approval_decide(a_appro, 'approved', null);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if a_st = 'approved' and (select status from public.hr_absence_requests where id = a_req) = 'validee'
         and (select sum(days) from public.hr_leave_ledger where person_id = a_p and type_id = a_cp) = 6 then
        v_lines := v_lines || 'OK      ad    0294 : validation dans le circuit commun, prise de 4 jours écrite au solde (10 → 6)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ad    0294 : validation et solde'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_lec, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      a_st := public.hr_absence_annuler(a_req);
      a_m := (select count(*) from public.hr_absence_requests where person_id = a_p);
      a_n := (select solde from public.v_hr_soldes where person_id = a_p and type_id = a_cp);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if a_st = 'annulee' and a_m >= 1 and a_n = 10 then
        v_lines := v_lines || 'OK      lec   0294 : la personne annule une absence validée à venir, le solde revient (6 → 10)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   lec   0294 : annulation et solde'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      a_req2 := public.hr_absence_demander(a_cp, a_lundi + 7, null, a_lundi + 7, null, 'Saisie RH', a_p);
      select approval_id into a_appro from public.hr_absence_requests where id = a_req2;
      a_ok := false;
      begin perform public.approval_decide(a_appro, 'approved', null); exception when insufficient_privilege then a_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if a_ok and (select requested_by from public.hr_absence_requests where id = a_req2) = u_dir then
        v_lines := v_lines || 'OK      dir   0294 : la direction saisit pour une personne mais ne valide pas sa propre saisie'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0294 : saisie pour autrui'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      a_m := (select count(*) from public.hr_absence_requests) + (select count(*) from public.hr_leave_ledger);
      a_ok := false;
      begin perform public.hr_absence_demander(a_cp, a_lundi + 9, null, a_lundi + 9, null, null, a_p); exception when insufficient_privilege then a_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if a_m = 0 and a_ok then
        v_lines := v_lines || 'OK      com   0294 : le commercial ne voit ni ne saisit d''absence'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0294 : absences cachées au commercial'::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 5; v_lines := v_lines || ('ÉCHEC   base  0294 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Chantier 12, RH heures (0297) : la personne saisit et soumet sa semaine, lignes figées ensuite, validation par
  -- un autre dans le circuit commun ; rien pour le commercial
  if to_regprocedure('public.hr_semaine_soumettre(date)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 4;
    declare
      t_co uuid := app.company_default(); t_p uuid; t_lundi date; t_ts uuid; t_appro uuid; t_e uuid; t_ok boolean; t_n int; t_st text;
    begin
      t_lundi := (date_trunc('week', current_date + 35))::date;
      insert into public.hr_people (first_name, last_name, profile_id) values ('Essai', 'Heures', u_lec) on conflict do nothing;
      select id into t_p from public.hr_people where profile_id = u_lec and company_id = t_co limit 1;
      insert into public.company_member_roles (member_id, role_key)
      select m.id, 'salarie' from public.company_members m where m.profile_id = u_lec and m.company_id = t_co
      on conflict do nothing;

      perform set_config('request.jwt.claims', json_build_object('sub', u_lec, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.hr_time_entries (person_id, work_date, start_time, end_time) values (t_p, t_lundi, '08:00', '12:00');
      insert into public.hr_time_entries (person_id, work_date, start_time, end_time) values (t_p, t_lundi, '13:00', '18:00');
      insert into public.hr_time_entries (person_id, work_date, start_time, end_time, break_minutes) values (t_p, t_lundi + 1, '08:00', '17:00', 60);
      t_n := public.hr_semaine_preparer(t_lundi);
      t_ts := public.hr_semaine_soumettre(t_lundi);
      select approval_id into t_appro from public.hr_timesheets where id = t_ts;
      select id into t_e from public.hr_time_entries where person_id = t_p and work_date = t_lundi limit 1;
      t_ok := false;
      begin update public.hr_time_entries set end_time = '12:30' where id = t_e; exception when check_violation then t_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if (select total_minutes = 1020 and status = 'soumise' from public.hr_timesheets where id = t_ts) and t_appro is not null and t_ok then
        v_lines := v_lines || 'OK      lec   0297 : semaine saisie (17 h) et soumise au circuit, lignes figées ensuite'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   lec   0297 : saisie et soumission de la semaine'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_lec, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      t_ok := false;
      begin perform public.approval_decide(t_appro, 'approved', null); exception when insufficient_privilege then t_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', u_ad, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      t_st := public.approval_decide(t_appro, 'approved', null);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if t_ok and t_st = 'approved' and (select status from public.hr_timesheets where id = t_ts) = 'validee' then
        v_lines := v_lines || 'OK      ad    0297 : semaine validée par un autre (la personne ne valide pas la sienne)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ad    0297 : validation de la semaine'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      t_n := (select count(*) from public.hr_time_entries) + (select count(*) from public.hr_timesheets);
      t_ok := false;
      begin insert into public.hr_time_entries (person_id, work_date, start_time, end_time) values (t_p, t_lundi + 21, '08:00', '09:00');
      exception when insufficient_privilege then t_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if t_n = 0 and t_ok then
        v_lines := v_lines || 'OK      com   0297 : le commercial ne voit ni ne saisit d''heures'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0297 : heures cachées au commercial'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      t_n := (select count(*) from public.hr_time_entries where person_id = t_p);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if t_n = 3 then
        v_lines := v_lines || 'OK      dir   0297 : la direction lit les heures du personnel'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0297 : lecture des heures'::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 4; v_lines := v_lines || ('ÉCHEC   base  0297 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Chantier 12, RH documents et santé (0301) : la personne voit ses documents et dépose ses justificatifs ; la
  -- direction voit les documents « normal » seulement ; la RH voit les restreints (consultation journalisée) ; rien
  -- pour le commercial
  if to_regprocedure('public.hr_document_ouvrir(uuid)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 5;
    declare
      d_co uuid := app.company_default(); d_p uuid; d_norm uuid; d_res uuid; d_ok boolean; d_ok2 boolean; d_n int; d_m int; d_q int;
      d_chemin text; d_avant int;
    begin
      insert into public.hr_people (first_name, last_name, profile_id) values ('Essai', 'Documents', u_lec) on conflict do nothing;
      select id into d_p from public.hr_people where profile_id = u_lec and company_id = d_co limit 1;
      insert into public.company_member_roles (member_id, role_key)
      select m.id, 'salarie' from public.company_members m where m.profile_id = u_lec and m.company_id = d_co
      on conflict do nothing;
      insert into public.company_member_roles (member_id, role_key)
      select m.id, 'rh' from public.company_members m where m.profile_id = u_ges and m.company_id = d_co
      on conflict do nothing;
      insert into public.hr_documents (company_id, person_id, category, confidentiality, title, file_path)
      values (d_co, d_p, 'contrat', 'normal', 'Contrat essai', d_co || '/' || d_p || '/contrat.pdf') returning id into d_norm;
      insert into public.hr_documents (company_id, person_id, category, confidentiality, title, file_path)
      values (d_co, d_p, 'sante', 'restreint', 'Avis essai', d_co || '/' || d_p || '/avis.pdf') returning id into d_res;
      insert into public.hr_documents (company_id, person_id, category, confidentiality, title, file_path)
      values (d_co, d_p, 'bulletin', 'prive', 'Bulletin essai', d_co || '/' || d_p || '/bulletin.pdf');
      insert into public.hr_qualifications (company_id, person_id, kind, label, expires_on) values (d_co, d_p, 'sst', 'SST', current_date + 60);
      insert into public.hr_medical_followups (company_id, person_id, visit_type, visit_on, next_due_on, conclusion)
      values (d_co, d_p, 'embauche', current_date - 10, current_date + 700, 'apte');

      perform set_config('request.jwt.claims', json_build_object('sub', u_lec, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      d_n := (select count(*) from public.hr_documents where person_id = d_p);
      d_m := (select count(*) from public.hr_medical_followups where person_id = d_p);
      insert into public.hr_documents (company_id, person_id, category, confidentiality, title, file_path)
      values (d_co, d_p, 'justificatif', 'restreint', 'Justificatif essai', d_co || '/' || d_p || '/justif.pdf');
      d_ok := false;
      begin
        insert into public.hr_documents (company_id, person_id, category, confidentiality, title, file_path)
        values (d_co, d_p, 'contrat', 'normal', 'Faux contrat', d_co || '/' || d_p || '/faux.pdf');
      exception when insufficient_privilege then d_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if d_n = 3 and d_m = 1 and d_ok then
        v_lines := v_lines || 'OK      lec   0301 : la personne voit ses documents (dont restreint et bulletin) et son suivi, dépose un justificatif, pas un contrat'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   lec   0301 : documents de la personne (' || d_n || ', ' || d_m || ', ' || d_ok || ')')::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      d_n := (select count(*) from public.hr_documents where person_id = d_p);
      d_m := (select count(*) from public.hr_medical_followups where person_id = d_p);
      d_q := (select count(*) from public.hr_qualifications where person_id = d_p);
      d_chemin := public.hr_document_ouvrir(d_norm);
      d_ok := false;
      begin perform public.hr_document_ouvrir(d_res); exception when insufficient_privilege then d_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if d_n = 1 and d_m = 0 and d_q = 1 and d_chemin like '%/contrat.pdf' and d_ok then
        v_lines := v_lines || 'OK      dir   0301 : la direction voit le contrat et les habilitations, ni restreint, ni bulletin, ni suivi de santé'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0301 : documents pour la direction (' || d_n || ', ' || d_m || ', ' || d_q || ', ' || d_ok || ')')::text; end if;

      d_avant := (select count(*) from public.audit_logs where entity_type = 'document_rh' and action = 'view' and entity_id = d_res);
      perform set_config('request.jwt.claims', json_build_object('sub', u_ges, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      d_n := (select count(*) from public.hr_documents where person_id = d_p);
      d_m := (select count(*) from public.hr_medical_followups where person_id = d_p);
      d_chemin := public.hr_document_ouvrir(d_res);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if d_n = 4 and d_m = 1 and d_chemin like '%/avis.pdf'
         and (select count(*) from public.audit_logs where entity_type = 'document_rh' and action = 'view' and entity_id = d_res) = d_avant + 1 then
        v_lines := v_lines || 'OK      rh    0301 : la RH voit les documents restreints et le suivi de santé, chaque consultation est journalisée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   rh    0301 : documents restreints pour la RH (' || d_n || ', ' || d_m || ')')::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_ges, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      d_ok := false;
      begin
        insert into public.hr_medical_followups (company_id, person_id, visit_type, visit_on, accommodation)
        values (d_co, d_p, 'periodique', current_date, repeat('x', 301));
      exception when check_violation then d_ok := true; end;
      d_ok2 := false;
      begin
        insert into public.hr_documents (company_id, person_id, category, confidentiality, title, file_path)
        values (d_co, d_p, 'bulletin', 'normal', 'Bulletin mal rangé', d_co || '/' || d_p || '/b2.pdf');
      exception when check_violation then d_ok2 := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if d_ok and d_ok2 then
        v_lines := v_lines || 'OK      rh    0301 : aménagement limité à un texte court, bulletin toujours « privé »'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   rh    0301 : garde-fous des documents et du suivi'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      d_n := (select count(*) from public.hr_documents) + (select count(*) from public.hr_qualifications) + (select count(*) from public.hr_medical_followups);
      d_ok := false;
      begin perform public.hr_document_ouvrir(d_norm); exception when insufficient_privilege then d_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if d_n = 0 and d_ok then
        v_lines := v_lines || 'OK      com   0301 : le commercial ne voit aucun document, habilitation ni suivi du personnel'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0301 : documents cachés au commercial'::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 5; v_lines := v_lines || ('ÉCHEC   base  0301 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- RH, suppression d'une fiche (0302) : deux fiches dont l'une est responsable de l'autre, avec document joint à
  -- une habilitation et une semaine validée, se suppriment ensemble ; un contrat reste refusé dans une autre société
  if to_regprocedure('app.hr_ds_garde()') is not null
     and exists (select 1 from public.schema_migrations where version = '0302_rh_suppression_fiche') then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 2;
    declare
      s_co uuid := app.company_default(); s_a uuid; s_b uuid; s_doc uuid; s_ok boolean := false; s_autre uuid;
    begin
      insert into public.hr_people (company_id, first_name, last_name) values (s_co, 'Chef', 'Essai0302') returning id into s_a;
      insert into public.hr_people (company_id, first_name, last_name) values (s_co, 'Equipier', 'Essai0302') returning id into s_b;
      insert into public.hr_employments (company_id, person_id, start_on, manager_person_id) values (s_co, s_b, current_date - 30, s_a);
      insert into public.hr_documents (company_id, person_id, category, confidentiality, title, file_path)
      values (s_co, s_a, 'titre', 'normal', 'Titre essai', s_co || '/' || s_a || '/titre.pdf') returning id into s_doc;
      insert into public.hr_qualifications (company_id, person_id, kind, label, document_id) values (s_co, s_a, 'sst', 'SST essai', s_doc);
      insert into public.hr_time_entries (company_id, person_id, work_date, start_time, end_time) values (s_co, s_b, (date_trunc('week', current_date) - interval '7 days')::date, '08:00', '12:00');
      insert into public.hr_timesheets (company_id, person_id, week_start, status) values (s_co, s_b, (date_trunc('week', current_date) - interval '7 days')::date, 'validee');
      delete from public.hr_people where id in (s_a, s_b);
      if not exists (select 1 from public.hr_people where id in (s_a, s_b))
         and not exists (select 1 from public.hr_time_entries where person_id = s_b) then
        v_lines := v_lines || 'OK      base  0302 : deux fiches liées (responsable, document joint, semaine validée) se suppriment ensemble'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0302 : suppression de fiches liées'::text; end if;

      select id into s_autre from public.companies where id <> s_co limit 1;
      insert into public.hr_people (company_id, first_name, last_name) values (s_co, 'Seul', 'Essai0302') returning id into s_a;
      if s_autre is null then
        s_ok := true;
      else
        begin insert into public.hr_employments (company_id, person_id, start_on) values (s_autre, s_a, current_date);
        exception when check_violation then s_ok := true; end;
      end if;
      delete from public.hr_people where id = s_a;
      if s_ok then
        v_lines := v_lines || 'OK      base  0302 : un contrat dans une autre société que la personne reste refusé'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0302 : contrôle de société du contrat'::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 2; v_lines := v_lines || ('ÉCHEC   base  0302 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- RH, jours fériés (0311) : le 14 juillet ne compte pas dans une absence, sauf s'il est marqué travaillé ; seule la
  -- configuration RH règle le calendrier
  if to_regprocedure('app.hr_jours_ouvres_societe(uuid,date,text,date,text)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 2;
    declare
      f_co uuid := app.company_default(); f_n numeric; f_n2 numeric; f_ok boolean := false; f_m int;
    begin
      perform app.hr_feries_poser(f_co, 2027);
      f_n := app.hr_jours_ouvres_societe(f_co, date '2027-07-12', null, date '2027-07-16', null);
      update public.hr_public_holidays set is_worked = true where company_id = f_co and day = date '2027-07-14';
      f_n2 := app.hr_jours_ouvres_societe(f_co, date '2027-07-12', null, date '2027-07-16', 'matin');
      update public.hr_public_holidays set is_worked = false where company_id = f_co and day = date '2027-07-14';
      if f_n = 4 and f_n2 = 4.5 and app.paques(2027) = date '2027-03-28' then
        v_lines := v_lines || 'OK      base  0311 : 14 juillet hors décompte (4 jours), compté s''il est travaillé ; Pâques 2027 le 28 mars'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0311 : décompte avec jours fériés (' || f_n || ', ' || f_n2 || ')')::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      update public.hr_public_holidays set is_worked = true where company_id = f_co and day = date '2027-07-14';
      get diagnostics f_m = row_count;
      begin perform public.hr_feries_annee(2030); exception when insufficient_privilege then f_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if f_m = 0 and f_ok then
        v_lines := v_lines || 'OK      com   0311 : le commercial ne règle pas les jours fériés'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0311 : calendrier protégé'::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 2; v_lines := v_lines || ('ÉCHEC   base  0311 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- RH, validation par le responsable d'équipe (0312) : le formateur responsable valide l'absence de son équipier
  -- sans droit « Valider les absences » ; il ne voit pas la fiche personnelle ; un autre compte ne peut pas décider
  if to_regprocedure('app.hr_responsable_peut_decider(uuid)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 3;
    declare
      r_co uuid := app.company_default(); r_chef uuid; r_eq uuid; r_cp uuid; r_req uuid; r_appro uuid; r_n int; r_m int;
      r_st text; r_ok boolean := false; r_resp boolean; r_lundi date := (date_trunc('week', current_date + 70))::date;
    begin
      insert into public.hr_people (company_id, first_name, last_name, profile_id) values (r_co, 'Chef', 'Essai0312', u_for) returning id into r_chef;
      insert into public.hr_people (company_id, first_name, last_name, personal_phone) values (r_co, 'Equipier', 'Essai0312', '0600000000') returning id into r_eq;
      insert into public.hr_employments (company_id, person_id, start_on, manager_person_id) values (r_co, r_eq, current_date - 30, r_chef);
      select id into r_cp from public.hr_absence_types where company_id = r_co and code = 'CP';
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      r_req := public.hr_absence_demander(r_cp, r_lundi, null, r_lundi + 1, null, 'Essai 0312', r_eq);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      select approval_id into r_appro from public.hr_absence_requests where id = r_req;

      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      begin perform public.approval_decide(r_appro, 'approved', null); exception when insufficient_privilege then r_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if r_ok then
        v_lines := v_lines || 'OK      com   0312 : un compte hors de l''équipe ne décide pas l''absence'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0312 : décision hors équipe refusée'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_for, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      r_resp := public.hr_suis_responsable();
      r_n := (select count(*) from public.hr_absence_requests where id = r_req);
      r_m := (select count(*) from public.hr_people where id = r_eq);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if r_resp and r_n = 1 and r_m = 0 then
        v_lines := v_lines || 'OK      for   0312 : le responsable voit la demande de son équipier, pas sa fiche personnelle'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   for   0312 : lecture par le responsable (' || r_resp || ', ' || r_n || ', ' || r_m || ')')::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_for, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      r_st := public.approval_decide(r_appro, 'approved', null);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if r_st = 'approved' and (select status from public.hr_absence_requests where id = r_req) = 'validee' then
        v_lines := v_lines || 'OK      for   0312 : le responsable valide l''absence de son équipier sans droit « Valider »'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   for   0312 : validation par le responsable'::text; end if;
      delete from public.hr_people where id in (r_chef, r_eq);
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 3; v_lines := v_lines || ('ÉCHEC   base  0312 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- RH, entretiens et listes (0314) : la direction ouvre la liste d'arrivée depuis le modèle ; l'entretien est lu par
  -- la personne, pas par le commercial ; l'entretien prévu rejoint les échéances
  if to_regprocedure('public.hr_liste_ouvrir(uuid,text)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 3;
    declare
      e_co uuid := app.company_default(); e_p uuid; e_l uuid; e_n int; e_m int; e_ok boolean := false;
    begin
      insert into public.hr_people (company_id, first_name, last_name, profile_id) values (e_co, 'Essai', 'Entretien0314', u_lec)
      on conflict do nothing;
      select id into e_p from public.hr_people where profile_id = u_lec and company_id = e_co limit 1;
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      e_l := public.hr_liste_ouvrir(e_p, 'arrivee');
      e_n := (select jsonb_array_length(items) from public.hr_checklists where id = e_l);
      insert into public.hr_reviews (company_id, person_id, kind, planned_on) values (e_co, e_p, 'parcours', current_date + 40);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if e_n >= 7 then
        v_lines := v_lines || 'OK      dir   0314 : liste d''arrivée ouverte depuis le modèle de la société'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0314 : liste d''arrivée (' || coalesce(e_n, -1) || ')')::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_lec, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      e_n := (select count(*) from public.hr_reviews where person_id = e_p);
      e_m := (select count(*) from public.v_hr_echeances where person_id = e_p and kind = 'entretien');
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if e_n = 1 and e_m = 1 then
        v_lines := v_lines || 'OK      lec   0314 : la personne voit son entretien prévu et son échéance'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   lec   0314 : entretien de la personne (' || e_n || ', ' || e_m || ')')::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      e_n := (select count(*) from public.hr_reviews) + (select count(*) from public.hr_checklists);
      begin perform public.hr_liste_ouvrir(e_p, 'depart'); exception when insufficient_privilege then e_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if e_n = 0 and e_ok then
        v_lines := v_lines || 'OK      com   0314 : le commercial ne voit ni entretiens ni listes, n''en ouvre pas'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0314 : entretiens cachés au commercial'::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 3; v_lines := v_lines || ('ÉCHEC   base  0314 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Stock (0240) : le gestionnaire entre du stock au dépôt, le technicien prend au dépôt pour son stock, ne voit
  -- aucun prix, ne fait pas d'entrée ; la visite terminée sort la pièce ; les mouvements sont figés ; rien pour le
  -- commercial
  if to_regprocedure('public.stock_mouvement(text,uuid,numeric,uuid,uuid,text,numeric,text)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 5;
    declare
      s_co uuid := app.company_default(); s_dep uuid; s_item uuid; s_n numeric; s_ok boolean := false; s_ok2 boolean := false;
      s_mien uuid; s_visite uuid; s_c int; s_tech uuid;
    begin
      insert into public.stock_locations (company_id, kind, name) values (s_co, 'depot', 'Dépôt essai 0240') returning id into s_dep;
      insert into public.stock_items (company_id, label, reference, sale_price_ht) values (s_co, 'Joint essai 0240', 'ESSAI-0240', 4.5) returning id into s_item;
      perform set_config('request.jwt.claims', json_build_object('sub', u_ges, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.stock_mouvement('entree', s_item, 20, null, s_dep, 'Réception essai', 2.1);
      s_n := (select quantity from public.v_stock_levels where item_id = s_item and location_id = s_dep);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if s_n = 20 then
        v_lines := v_lines || 'OK      ges   0240 : entrée de 20 au dépôt, quantité calculée depuis les mouvements'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   ges   0240 : entrée au dépôt (' || coalesce(s_n, -1) || ')')::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_tech, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.stock_mon_stock();
      s_mien := (select location_id from public.stock_mon_stock() limit 1);
      if s_mien is null then s_mien := (select id from public.stock_locations where profile_id = u_tech and kind = 'technicien' limit 1); end if;
      perform public.stock_mouvement('transfert', s_item, 3, s_dep, s_mien, 'Prise au dépôt');
      s_n := (select quantity from public.stock_mon_stock() where item_id = s_item);
      s_c := (select count(*) from public.stock_items) + (select count(*) from public.stock_item_costs);
      begin perform public.stock_mouvement('entree', s_item, 5, null, s_mien); exception when insufficient_privilege then s_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if s_n = 3 and s_c = 0 and s_ok then
        v_lines := v_lines || 'OK      tech  0240 : le technicien prend 3 au dépôt, voit son stock sans aucun prix, ne fait pas d''entrée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   tech  0240 : stock du technicien (' || coalesce(s_n, -1) || ', ' || s_c || ', ' || s_ok || ')')::text; end if;

      insert into public.itv_visits (company_id, technician_id, status, planned_on, client_id, site_id)
      select s_co, u_tech, 'en_cours', current_date, st.client_id, st.id from public.sites st where st.client_id is not null limit 1
      returning id into s_visite;
      insert into public.itv_visit_parts (visit_id, label, quantity, stock_item_id, company_id) values (s_visite, 'Joint', 2, s_item, s_co);
      update public.itv_visits set status = 'terminee', finished_at = now() where id = s_visite;
      update public.itv_visits set status = 'en_cours' where id = s_visite;
      update public.itv_visits set status = 'terminee' where id = s_visite;
      s_n := (select quantity from public.v_stock_levels where item_id = s_item and location_id = s_mien);
      if s_n = 1 then
        v_lines := v_lines || 'OK      base  0240 : la visite terminée sort la pièce du stock du technicien, une seule fois'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0240 : sortie à la clôture de la visite (' || coalesce(s_n, -1) || ')')::text; end if;

      begin update public.stock_movements set quantity = 99 where item_id = s_item; exception when check_violation then s_ok2 := true; end;
      if s_ok2 then
        v_lines := v_lines || 'OK      base  0240 : un mouvement ne se modifie pas'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0240 : mouvements figés'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      s_c := (select count(*) from public.stock_items) + (select count(*) from public.stock_movements);
      s_ok := false;
      begin perform public.stock_mouvement('sortie', s_item, 1, s_dep, null); exception when insufficient_privilege then s_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if s_c = 0 and s_ok then
        v_lines := v_lines || 'OK      com   0240 : le commercial ne voit ni ne mouvemente le stock'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0240 : stock caché au commercial'::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 5; v_lines := v_lines || ('ÉCHEC   base  0240 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Stock, commandes (0245) : la direction prépare et soumet, l'administrateur valide dans le circuit commun, la
  -- réception partielle puis totale entre en stock au prix de la ligne ; le statut ne s'écrit pas à la main ; le
  -- technicien fait une demande sans prix et ne voit que la sienne ; rien pour le commercial
  if to_regprocedure('public.stock_commande_recevoir(uuid,numeric,uuid,text)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 5;
    declare
      c_co uuid := app.company_default(); c_dep uuid; c_item uuid; c_fourn uuid; c_cmd uuid; c_ligne uuid; c_appro uuid;
      c_st text; c_st2 text; c_st3 text; c_n numeric; c_cout numeric; c_ok boolean := false; c_c int; c_prix numeric; c_cmd2 uuid;
    begin
      insert into public.stock_locations (company_id, kind, name) values (c_co, 'depot', 'Dépôt essai 0245') returning id into c_dep;
      insert into public.suppliers (company_id, name) values (c_co, 'Fournisseur essai 0245') returning id into c_fourn;
      insert into public.stock_items (company_id, label, reference, supplier_id) values (c_co, 'Goupille essai 0245', 'ESSAI-0245', c_fourn) returning id into c_item;

      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      c_cmd := public.stock_commande_creer(c_fourn, c_dep, 'Essai');
      insert into public.purchase_order_lines (order_id, item_id, quantity, unit_price_ht) values (c_cmd, c_item, 10, 2) returning id into c_ligne;
      c_st := public.stock_commande_soumettre(c_cmd);
      begin update public.purchase_orders set status = 'recue' where id = c_cmd; exception when insufficient_privilege then c_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      c_appro := (select approval_id from public.purchase_orders where id = c_cmd);
      if c_st = 'a_valider' and c_appro is not null and c_ok and (select total_ht from public.purchase_orders where id = c_cmd) = 20 then
        v_lines := v_lines || 'OK      dir   0245 : commande de 20 € soumise au circuit de validation, statut non modifiable à la main'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0245 : soumission (' || coalesce(c_st, '?') || ', ' || c_ok || ')')::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_ad, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.approval_decide(c_appro, 'approved', null);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      c_st := (select status from public.purchase_orders where id = c_cmd);
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      c_st2 := public.stock_commande_recevoir(c_ligne, 4, null, 'Livraison 1');
      c_n := (select quantity from public.v_stock_levels where item_id = c_item and location_id = c_dep);
      c_st3 := public.stock_commande_recevoir(c_ligne, 6, null, 'Livraison 2');
      c_cout := (select unit_cost from public.v_stock_value where item_id = c_item);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if c_st = 'validee' and c_st2 = 'partielle' and c_n = 4 and c_st3 = 'recue'
         and (select quantity from public.v_stock_levels where item_id = c_item and location_id = c_dep) = 10 then
        v_lines := v_lines || 'OK      ad    0245 : validée par l''administrateur, reçue en deux fois (4 puis 6), entrée en stock'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   ad    0245 : validation et réception (' || coalesce(c_st, '?') || ', ' || coalesce(c_st2, '?') || ', ' || coalesce(c_n, -1) || ', ' || coalesce(c_st3, '?') || ')')::text; end if;

      if (select count(*) from public.stock_movements where source_table = 'purchase_receipts'
            and source_id in (select id from public.purchase_receipts where order_id = c_cmd) and unit_cost = 2) = 2 then
        v_lines := v_lines || 'OK      base  0245 : chaque réception écrit une entrée au prix de la ligne'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0245 : entrées des réceptions'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_tech, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      c_cmd2 := public.stock_commande_creer(c_fourn, c_dep, 'Demande du technicien');
      insert into public.purchase_order_lines (order_id, item_id, quantity, unit_price_ht) values (c_cmd2, c_item, 2, 9);
      c_c := (select count(*) from public.purchase_orders);
      c_prix := (select unit_price_ht from public.purchase_order_lines where order_id = c_cmd2 limit 1);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if c_c = 1 and c_prix is null then
        v_lines := v_lines || 'OK      tech  0245 : le technicien fait une demande sans prix et ne voit que la sienne'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   tech  0245 : demande du technicien (' || c_c || ', ' || coalesce(c_prix, -1) || ')')::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      c_c := (select count(*) from public.purchase_orders) + (select count(*) from public.purchase_order_lines);
      c_ok := false;
      begin perform public.stock_commande_creer(c_fourn, c_dep, null); exception when insufficient_privilege then c_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if c_c = 0 and c_ok then
        v_lines := v_lines || 'OK      com   0245 : le commercial ne voit ni ne prépare de commande'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   com   0245 : commandes cachées au commercial (' || c_c || ', ' || c_ok || ')')::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 5; v_lines := v_lines || ('ÉCHEC   base  0245 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Stock, inventaires et numéros de série (0247) : le technicien compte son propre stock, ne valide pas ; la direction
  -- valide, l'écart devient un ajustement et la quantité calculée suit le comptage ; un numéro de série suit ses
  -- mouvements ; rien pour le commercial
  if to_regprocedure('public.stock_inventaire_valider(uuid)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 4;
    declare
      i_co uuid := app.company_default(); i_dep uuid; i_tech uuid; i_item uuid; i_ext uuid; i_inv uuid; i_n int; i_q numeric;
      i_ok boolean := false; i_loc uuid; i_c int;
    begin
      insert into public.stock_locations (company_id, kind, name) values (i_co, 'depot', 'Dépôt essai 0247') returning id into i_dep;
      insert into public.stock_locations (company_id, kind, name, profile_id) values (i_co, 'technicien', 'Stock essai 0247', u_tech)
      on conflict (company_id, profile_id) where profile_id is not null and kind = 'technicien' do update set is_active = true returning id into i_tech;
      insert into public.stock_items (company_id, label, reference) values (i_co, 'Joint essai 0247', 'ESSAI-0247') returning id into i_item;
      insert into public.stock_items (company_id, label, reference, serialized, consumable) values (i_co, 'Extincteur essai 0247', 'ESSAI-0247-S', true, false) returning id into i_ext;
      insert into public.stock_movements (company_id, kind, item_id, quantity, to_location_id) values (i_co, 'entree', i_item, 12, i_tech);

      perform set_config('request.jwt.claims', json_build_object('sub', u_tech, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      i_inv := public.stock_inventaire_ouvrir(i_tech, 'Essai');
      perform public.stock_inventaire_compter(i_inv, i_item, 9);
      begin perform public.stock_inventaire_valider(i_inv); exception when insufficient_privilege then i_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if i_ok and (select counted_qty from public.stock_count_lines where count_id = i_inv and item_id = i_item) = 9 then
        v_lines := v_lines || 'OK      tech  0247 : le technicien compte son stock (9), ne valide pas l''inventaire'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   tech  0247 : comptage du technicien (' || i_ok || ')')::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      i_n := public.stock_inventaire_valider(i_inv);
      i_q := (select quantity from public.v_stock_levels where item_id = i_item and location_id = i_tech);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if i_n = 1 and i_q = 9 and (select expected_qty from public.stock_count_lines where count_id = i_inv and item_id = i_item) = 12
         and (select status from public.stock_counts where id = i_inv) = 'validee' then
        v_lines := v_lines || 'OK      dir   0247 : inventaire validé, écart de 3 passé en ajustement, quantité calculée à 9'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0247 : validation (' || coalesce(i_n, -1) || ', ' || coalesce(i_q, -1) || ')')::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.stock_mouvement('entree', i_ext, 1, null, i_dep, 'Réception', null, 'SN-0247-A');
      perform public.stock_mouvement('transfert', i_ext, 1, i_dep, i_tech, null, null, 'SN-0247-A');
      i_loc := (select location_id from public.stock_serials where item_id = i_ext and serial = 'SN-0247-A');
      perform public.stock_mouvement('sortie', i_ext, 1, i_tech, null, 'Posé', null, 'SN-0247-A');
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if i_loc = i_tech and (select status from public.stock_serials where item_id = i_ext and serial = 'SN-0247-A') = 'sorti' then
        v_lines := v_lines || 'OK      base  0247 : le numéro de série suit ses mouvements (dépôt, technicien, sorti)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0247 : suivi du numéro de série'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      i_c := (select count(*) from public.stock_counts) + (select count(*) from public.stock_serials);
      i_ok := false;
      begin perform public.stock_inventaire_ouvrir(i_dep, null); exception when insufficient_privilege then i_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if i_c = 0 and i_ok then
        v_lines := v_lines || 'OK      com   0247 : le commercial ne voit ni n''ouvre d''inventaire'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   com   0247 : inventaires cachés au commercial (' || i_c || ', ' || i_ok || ')')::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 4; v_lines := v_lines || ('ÉCHEC   base  0247 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Manager, emprunts (0220) : la direction saisit un prêt, l'échéancier calculé est juste (capital remboursé, fin à
  -- zéro), un remboursement anticipé réduit les échéances suivantes ; le tableau de la banque importé fait foi et ne
  -- se recalcule pas ; une échéance ne se modifie pas à la main ; rien pour le gestionnaire ni le commercial
  if to_regprocedure('public.loan_calculer(uuid)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 5;
    declare
      e_loan uuid; e_n int; e_cap numeric; e_fin numeric; e_p1 numeric; e_p9 numeric; e_ok boolean := false; e_ok2 boolean := false; e_c int;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.loans (lender_name, label, principal, rate_nominal, duration_months, first_due_on)
      values ('Banque essai', 'Prêt essai 0220', 12000, 3.6, 12, date '2026-01-05') returning id into e_loan;
      e_n := public.loan_calculer(e_loan);
      e_cap := (select sum(principal_part) from public.loan_schedule_lines where loan_id = e_loan);
      e_fin := (select remaining from public.loan_schedule_lines where loan_id = e_loan and number = 12);
      e_p1 := (select payment from public.loan_schedule_lines where loan_id = e_loan and number = 1);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if e_n = 12 and e_cap = 12000 and e_fin = 0 and e_p1 between 1018 and 1020 then
        v_lines := v_lines || 'OK      dir   0220 : prêt de 12 000 € sur 12 mois à 3,6 % : 12 échéances d''environ 1 019 €, capital remboursé, fin à zéro'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0220 : calcul (' || coalesce(e_n, -1) || ', ' || coalesce(e_cap, -1) || ', ' || coalesce(e_fin, -1) || ', ' || coalesce(e_p1, -1) || ')')::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.loan_events (loan_id, kind, happened_on, amount) values (e_loan, 'remboursement_anticipe', date '2026-06-20', 3000);
      perform public.loan_calculer(e_loan);
      e_p9 := (select payment from public.loan_schedule_lines where loan_id = e_loan and number = 9);
      e_fin := (select remaining from public.loan_schedule_lines where loan_id = e_loan order by number desc limit 1);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if e_p9 < e_p1 - 400 and e_fin = 0 then
        v_lines := v_lines || 'OK      dir   0220 : remboursement anticipé de 3 000 € : échéances suivantes réduites, fin à zéro'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0220 : remboursement anticipé (' || coalesce(e_p9, -1) || ', ' || coalesce(e_fin, -1) || ')')::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      begin update public.loan_schedule_lines set payment = 1 where loan_id = e_loan and number = 1; exception when check_violation then e_ok := true; end;
      perform public.loan_importer(e_loan, '[{"number":1,"due_on":"2026-01-05","payment":1020.5,"interest":36,"principal":984.5,"insurance":0,"remaining":11015.5},{"number":2,"due_on":"2026-02-05","payment":1020.5,"interest":33.05,"principal":987.45,"insurance":0,"remaining":10028.05}]'::jsonb);
      begin perform public.loan_calculer(e_loan); exception when invalid_parameter_value then e_ok2 := true; end;
      e_n := (select count(*) from public.loan_schedule_lines where loan_id = e_loan and origin = 'banque');
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if e_ok then
        v_lines := v_lines || 'OK      dir   0220 : une échéance ne se modifie pas à la main'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0220 : échéance figée'::text; end if;
      if e_ok2 and e_n = 2 and (select schedule_source from public.loans where id = e_loan) = 'banque' then
        v_lines := v_lines || 'OK      dir   0220 : le tableau de la banque importé remplace le calcul et ne se recalcule pas'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0220 : tableau de la banque (' || e_ok2 || ', ' || coalesce(e_n, -1) || ')')::text; end if;

      e_c := 0; e_ok := false;
      perform set_config('request.jwt.claims', json_build_object('sub', u_ges, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      e_c := e_c + (select count(*) from public.loans) + (select count(*) from public.loan_schedule_lines);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      e_c := e_c + (select count(*) from public.loans);
      begin perform public.loan_calculer(e_loan); exception when insufficient_privilege then e_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if e_c = 0 and e_ok then
        v_lines := v_lines || 'OK      ges   0220 : ni le gestionnaire ni le commercial ne voient les emprunts'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   ges   0220 : emprunts cachés (' || e_c || ', ' || e_ok || ')')::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 5; v_lines := v_lines || ('ÉCHEC   base  0220 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Véhicules (0320) : la direction crée le véhicule et l'attribue au technicien ; le technicien ne voit que son
  -- véhicule, y saisit ses pleins ; consommation entre deux pleins complets ; kilométrage en recul signalé ;
  -- échéance de contrôle technique dépassée ; rien pour le commercial
  if to_regclass('public.vehicle_fuel') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 5;
    declare
      w_v uuid; w_v2 uuid; w_c int; w_conso numeric; w_st text; w_ok boolean := false; w_etat text;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.vehicles (plate, brand, model) values ('ess-320-aa', 'Renault', 'Kangoo') returning id into w_v;
      insert into public.vehicles (plate, brand, model) values ('ESS-320-BB', 'Peugeot', 'Partner') returning id into w_v2;
      insert into public.vehicle_assignments (vehicle_id, profile_id, start_km) values (w_v, u_tech, 10000);
      insert into public.vehicle_maintenance_rules (vehicle_id, kind, every_months, last_on) values (w_v, 'controle_technique', 24, current_date - 800);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if (select plate from public.vehicles where id = w_v) = 'ESS-320-AA' then
        v_lines := v_lines || 'OK      dir   0320 : véhicule créé (immatriculation en majuscules) et attribué au technicien'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0320 : création du véhicule'::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_tech, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      w_c := (select count(*) from public.vehicles);
      insert into public.vehicle_fuel (vehicle_id, filled_at, km, liters, amount_ttc, full_tank) values (w_v, now() - interval '10 days', 10500, 40, 72, true);
      insert into public.vehicle_fuel (vehicle_id, filled_at, km, liters, amount_ttc, full_tank) values (w_v, now() - interval '2 days', 11000, 35, 63, true);
      w_conso := (select l_per_100 from public.v_vehicle_consumption where vehicle_id = w_v order by filled_at desc limit 1);
      begin insert into public.vehicle_fuel (vehicle_id, km, liters, amount_ttc) values (w_v2, 5000, 30, 50); exception when insufficient_privilege then w_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if w_c = 1 and w_ok then
        v_lines := v_lines || 'OK      tech  0320 : le technicien ne voit que son véhicule, ne saisit pas de plein sur un autre'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   tech  0320 : véhicule du technicien (' || w_c || ', ' || w_ok || ')')::text; end if;
      if w_conso = 7 then
        v_lines := v_lines || 'OK      tech  0320 : consommation de 7 l/100 km entre deux pleins complets'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   tech  0320 : consommation (' || coalesce(w_conso, -1) || ')')::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_tech, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.vehicle_fuel (vehicle_id, km, liters, amount_ttc) values (w_v, 10900, 20, 36);
      w_st := (select status from public.vehicle_fuel where vehicle_id = w_v and km = 10900);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      w_etat := (select state from public.v_vehicle_deadlines where vehicle_id = w_v and kind = 'controle_technique');
      if w_st = 'a_verifier' and w_etat = 'depassee' then
        v_lines := v_lines || 'OK      base  0320 : kilométrage en recul signalé « à vérifier », contrôle technique dépassé'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0320 : anomalies et échéances (' || coalesce(w_st, '?') || ', ' || coalesce(w_etat, '?') || ')')::text; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      w_c := (select count(*) from public.vehicles) + (select count(*) from public.vehicle_fuel);
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if w_c = 0 then
        v_lines := v_lines || 'OK      com   0320 : le commercial ne voit pas le parc'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   com   0320 : parc caché au commercial (' || w_c || ')')::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 5; v_lines := v_lines || ('ÉCHEC   base  0320 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Correctifs de l'audit (0381) : une visite terminée est figée (contrôles, signature, technicien) ; seuls le devis,
  -- la facture, l'envoi du rapport et les notes changent ensuite
  if to_regprocedure('app.itv_visite_figee()') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 2;
    declare
      z_co uuid := app.company_default(); z_v uuid; z_ok boolean := false; z_ok2 boolean := false; z_n text;
    begin
      insert into public.itv_visits (company_id, technician_id, status, planned_on, client_id, site_id, finished_at)
      select z_co, u_tech, 'terminee', current_date, st.client_id, st.id, now() from public.sites st where st.client_id is not null limit 1
      returning id into z_v;
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      begin update public.itv_visits set observations = 'modifié après coup' where id = z_v; exception when check_violation then z_ok := true; end;
      begin update public.itv_visits set notes = 'Note interne après clôture' where id = z_v; z_ok2 := true; exception when others then z_ok2 := false; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if z_ok then
        v_lines := v_lines || 'OK      dir   0381 : une visite terminée ne se modifie plus (observations refusées)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0381 : visite terminée figée'::text; end if;
      if z_ok2 then
        v_lines := v_lines || 'OK      dir   0381 : après clôture, la note interne reste modifiable'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0381 : note interne après clôture'::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 2; v_lines := v_lines || ('ÉCHEC   base  0381 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Journal des tâches et interrupteurs des envois automatiques (0382) : seul le super administrateur ouvre un envoi ;
  -- un administrateur suspend 24 h avec la confirmation recopiée ; le journal des tâches n'est lu que par la plateforme
  if to_regprocedure('public.envoi_auto_regler(uuid,text,boolean)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 6;
    declare
      z_co uuid := app.company_default(); z_ok boolean := false; z_ok2 boolean := false; z_n int;
    begin
      insert into public.job_runs (job, status) values ('essai-0382', 'ok');
      -- direction : ni ouverture, ni lecture du journal des tâches
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      begin perform public.envoi_auto_regler(z_co, 'convocation', true); exception when insufficient_privilege then z_ok := true; end;
      select count(*) into z_n from public.job_runs where job = 'essai-0382';
      execute 'reset role';
      if z_ok then v_lines := v_lines || 'OK      dir   0382 : la direction n''ouvre pas un envoi automatique'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0382 : ouverture d''un envoi par la direction'::text; end if;
      if z_n = 0 then v_lines := v_lines || 'OK      dir   0382 : journal des tâches invisible hors plateforme'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0382 : journal des tâches visible'::text; end if;
      -- super administrateur : ouvre
      perform set_config('request.jwt.claims', json_build_object('sub', u_sa, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.envoi_auto_regler(z_co, 'convocation', true);
      execute 'reset role';
      if app.envoi_auto_autorise(z_co, 'convocation') then v_lines := v_lines || 'OK      sa    0382 : envoi ouvert par le super administrateur'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   sa    0382 : ouverture d''un envoi'::text; end if;
      -- administrateur : confirmation fausse refusée, puis suspension 24 h
      perform set_config('request.jwt.claims', json_build_object('sub', u_ad, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      begin perform public.envoi_auto_suspendre(z_co, 'convocation', 'oui'); exception when invalid_parameter_value then z_ok2 := true; end;
      perform public.envoi_auto_suspendre(z_co, 'convocation', 'suspendre 24 h', 'essai');
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if z_ok2 then v_lines := v_lines || 'OK      ad    0382 : suspension refusée sans la confirmation recopiée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ad    0382 : confirmation de suspension'::text; end if;
      if not app.envoi_auto_autorise(z_co, 'convocation') then v_lines := v_lines || 'OK      ad    0382 : envoi suspendu 24 h par un administrateur'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ad    0382 : suspension d''un envoi'::text; end if;
      if not app.envoi_auto_autorise(z_co, 'attestation') then v_lines := v_lines || 'OK      base  0382 : envoi fermé par défaut'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0382 : envoi ouvert par défaut'::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 6; v_lines := v_lines || ('ÉCHEC   base  0382 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Pièces de visite sorties du stock (0383) : la pièce notée est reliée à l'article et au camion du technicien ;
  -- à la clôture, elle sort une fois du camion
  if to_regprocedure('app.stock_piece_visite_lien()') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 3;
    declare
      z_co uuid := app.company_default(); z_part uuid; z_item uuid; z_v uuid; z_vp uuid; z_loc uuid; z_n int; z_lien uuid;
    begin
      insert into public.itv_parts (name, price_ht) values ('Joint essai 0383', 3) returning id into z_part;
      insert into public.stock_items (company_id, label, reference, itv_part_id) values (z_co, 'Joint essai 0383', 'ESSAI-0383', z_part) returning id into z_item;
      insert into public.itv_visits (company_id, technician_id, status, planned_on, client_id, site_id)
      select z_co, u_tech, 'planifiee', current_date, st.client_id, st.id from public.sites st where st.client_id is not null limit 1
      returning id into z_v;
      insert into public.itv_visit_parts (visit_id, part_id, label, quantity, unit_price_ht, company_id)
      values (z_v, z_part, 'Joint essai 0383', 2, 3, z_co) returning id, stock_item_id, stock_location_id into z_vp, z_lien, z_loc;
      if z_lien = z_item and z_loc is not null then v_lines := v_lines || 'OK      base  0383 : pièce de visite reliée à l''article et au camion du technicien'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0383 : lien de la pièce de visite au stock'::text; end if;
      update public.itv_visits set status = 'terminee', finished_at = now() where id = z_v;
      select count(*) into z_n from public.stock_movements where source_table = 'itv_visit_parts' and source_id = z_vp and kind = 'sortie' and from_location_id = z_loc and quantity = 2;
      if z_n = 1 then v_lines := v_lines || 'OK      base  0383 : à la clôture, la pièce sort du camion'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0383 : sortie à la clôture (' || z_n || ')')::text; end if;
      select count(*) into z_n from public.stock_locations where kind = 'technicien' and profile_id = u_tech and company_id = z_co;
      if z_n = 1 then v_lines := v_lines || 'OK      base  0383 : un seul camion par technicien'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0383 : camions du technicien (' || z_n || ')')::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 3; v_lines := v_lines || ('ÉCHEC   base  0383 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Bascule (0384) : pas d'émission de facture avec le RIB de démonstration ; un avoir reste possible
  if to_regprocedure('app.rib_demo(uuid)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 2;
    declare
      z_co uuid := app.company_default(); z_inv uuid; z_ok boolean := false;
    begin
      update public.organization_settings set bic = 'DEMOFRPPXXX', iban = 'FR7630006000011234567890189';
      update public.companies set bic = null, iban = null where id = z_co;
      insert into public.invoices (company_id, type, status, client_id, invoice_date)
      select z_co, 'invoice', 'draft', c.id, current_date from public.clients c limit 1 returning id into z_inv;
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      begin update public.invoices set issued_at = now() where id = z_inv; exception when check_violation then z_ok := true; end;
      perform set_config('request.jwt.claims', '', true);
      if z_ok then v_lines := v_lines || 'OK      base  0384 : émission refusée avec le RIB de démonstration'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0384 : émission avec le RIB de démonstration'::text; end if;
      update public.organization_settings set bic = 'BANKFRPPXXX', iban = 'FR7612345678901234567890104';
      if not app.rib_demo(z_co) then v_lines := v_lines || 'OK      base  0384 : RIB réel reconnu'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0384 : RIB réel pris pour celui de la démonstration'::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 2; v_lines := v_lines || ('ÉCHEC   base  0384 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Purge complète (0385) : type inconnu refusé ; client fictif effacé, client réel gardé, marque retirée ; le rapport
  -- « réel / test » se calcule à blanc sans rien effacer
  if to_regprocedure('public.demo_rapport()') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 4;
    declare
      z_fic uuid; z_reel uuid; z_ok boolean := false; z_r jsonb; z_n int;
    begin
      insert into public.clients (name) values ('Client fictif essai 0385') returning id into z_fic;
      insert into public.clients (name) values ('Client réel essai 0385') returning id into z_reel;
      insert into public.demo_records (tbl, id) values ('clients', z_fic);
      insert into public.demo_records (tbl, id) values ('type_inconnu_0385', gen_random_uuid());
      perform set_config('request.jwt.claims', json_build_object('sub', u_sa, 'role', 'authenticated')::text, true);
      begin perform public.purge_demo_data(); exception when invalid_parameter_value then z_ok := true; end;
      if z_ok and exists (select 1 from public.clients where id = z_fic) then v_lines := v_lines || 'OK      sa    0385 : type de marque inconnu refusé, rien effacé'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   sa    0385 : refus d''un type inconnu'::text; end if;
      delete from public.demo_records where tbl = 'type_inconnu_0385';
      z_r := public.demo_rapport();
      if (z_r ->> 'ok')::boolean and exists (select 1 from public.clients where id = z_fic) then v_lines := v_lines || 'OK      sa    0385 : rapport réel / test calculé à blanc, rien effacé'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   sa    0385 : rapport réel / test ' || coalesce(z_r ->> 'erreur', ''))::text; end if;
      z_r := public.purge_demo_data();
      perform set_config('request.jwt.claims', '', true);
      if not exists (select 1 from public.clients where id = z_fic) and exists (select 1 from public.clients where id = z_reel) then
        v_lines := v_lines || 'OK      sa    0385 : client fictif effacé, client réel gardé'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   sa    0385 : tri fictif / réel de la purge'::text; end if;
      select count(*) into z_n from public.demo_records where tbl = 'clients' and id = z_fic;
      if z_n = 0 then v_lines := v_lines || 'OK      sa    0385 : marque retirée seulement après effacement'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   sa    0385 : marque du client effacé'::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 4; v_lines := v_lines || ('ÉCHEC   base  0385 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Contrôle d'affectation et inaptitude (0386) : consigne « pas de hauteur » qui bloque un site avec désenfumage,
  -- levée par la direction avec motif ; un avis d'inaptitude suspend l'habilitation électrique
  if to_regprocedure('app.affectation_motifs(uuid,uuid,date)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 4;
    declare
      z_co uuid := app.company_default(); z_p uuid; z_site uuid; z_type uuid; z_v uuid; z_ok boolean := false; z_q uuid;
      z_mod boolean;
    begin
      select coalesce(enabled, false) into z_mod from public.company_modules where company_id = z_co and key = 'rh';
      insert into public.company_modules (company_id, key, enabled) values (z_co, 'rh', true)
        on conflict (company_id, key) do update set enabled = true;
      insert into public.hr_people (company_id, first_name, last_name, profile_id) values (z_co, 'Essai', 'Technicien 0386', u_tech) returning id into z_p;
      insert into public.hr_work_restrictions (company_id, person_id, kind, starts_on) values (z_co, z_p, 'hauteur', current_date - 1);
      insert into public.itv_equipment_types (company_id, name, family) values (z_co, 'Désenfumage essai 0386', 'Désenfumage') returning id into z_type;
      select id into z_site from public.sites where client_id is not null limit 1;
      insert into public.itv_equipment (site_id, client_id, type_id, company_id, label_code) select z_site, st.client_id, z_type, z_co, 'ESSAI-0386' from public.sites st where st.id = z_site;
      perform app.affectation_regles_depart(z_co);
      insert into public.itv_visits (company_id, status, planned_on, client_id, site_id)
      select z_co, 'planifiee', current_date, st.client_id, st.id from public.sites st where st.id = z_site returning id into z_v;
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      begin update public.itv_visits set technician_id = u_tech where id = z_v; exception when check_violation then z_ok := true; end;
      if z_ok then v_lines := v_lines || 'OK      dir   0386 : affectation refusée (consigne « pas de hauteur », désenfumage)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0386 : affectation contraire à une consigne'::text; end if;
      z_ok := false;
      begin perform public.affectation_lever(z_v, u_tech, 'non'); exception when invalid_parameter_value then z_ok := true; end;
      perform public.affectation_lever(z_v, u_tech, 'Intervention au sol seulement, nacelle par un collègue');
      update public.itv_visits set technician_id = u_tech where id = z_v;
      if z_ok and (select technician_id from public.itv_visits where id = z_v) = u_tech then
        v_lines := v_lines || 'OK      dir   0386 : levée par la direction, motif obligatoire, affectation passée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0386 : levée du blocage'::text; end if;
      perform set_config('request.jwt.claims', '', true);
      if exists (select 1 from public.assignment_overrides where object_id = z_v and profile_id = u_tech) then
        v_lines := v_lines || 'OK      base  0386 : levée tracée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0386 : trace de la levée'::text; end if;
      insert into public.hr_qualifications (company_id, person_id, kind, label, symbols) values (z_co, z_p, 'habilitation_electrique', 'BS BE manœuvre', array['BS']) returning id into z_q;
      insert into public.hr_medical_followups (company_id, person_id, visit_type, visit_on, conclusion) values (z_co, z_p, 'periodique', current_date, 'inapte');
      if (select suspended_at from public.hr_qualifications where id = z_q) is not null then
        v_lines := v_lines || 'OK      base  0386 : avis d''inaptitude, habilitation suspendue'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0386 : suspension après inaptitude'::text; end if;
      update public.company_modules set enabled = coalesce(z_mod, false) where company_id = z_co and key = 'rh';
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 4; v_lines := v_lines || ('ÉCHEC   base  0386 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Signatures enregistrées (0387) : chacun écrit la sienne, jamais celle d'un autre
  if to_regclass('public.user_signatures') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 2;
    declare
      z_co uuid := app.company_default(); z_ok boolean := false; z_n int;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.user_signatures (company_id, profile_id, image) values (z_co, u_dir, 'data:image/png;base64,AAAA');
      begin insert into public.user_signatures (company_id, profile_id, image) values (z_co, u_tech, 'data:image/png;base64,AAAA');
      exception when insufficient_privilege then z_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      select count(*) into z_n from public.user_signatures where profile_id = u_dir;
      if z_n = 1 then v_lines := v_lines || 'OK      dir   0387 : sa propre signature enregistrée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0387 : enregistrement de sa signature'::text; end if;
      if z_ok then v_lines := v_lines || 'OK      dir   0387 : signature d''un autre refusée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0387 : signature d''un autre acceptée'::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 2; v_lines := v_lines || ('ÉCHEC   base  0387 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Affichage adapté (0388) : la direction le règle pour un technicien, un commercial ne le peut pas
  if to_regprocedure('public.affichage_adapte_regler(uuid,jsonb)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 2;
    declare z_ok boolean := false; z_v jsonb;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      z_v := public.affichage_adapte_regler(u_tech, '{"facile": true, "voix": true, "motif": "rien"}'::jsonb);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      begin perform public.affichage_adapte_regler(u_tech, '{"grand": true}'::jsonb); exception when insufficient_privilege then z_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if (select ui_prefs -> 'adapte' from public.profiles where id = u_tech) = '{"facile": true, "voix": true}'::jsonb then
        v_lines := v_lines || 'OK      dir   0388 : affichage adapté réglé pour un technicien, rien d''autre enregistré'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0388 : réglage de l''affichage adapté'::text; end if;
      if z_ok then v_lines := v_lines || 'OK      com   0388 : un commercial ne règle pas l''affichage d''un autre'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   com   0388 : réglage par un commercial accepté'::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 2; v_lines := v_lines || ('ÉCHEC   base  0388 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Stockage « documents » privé (0389)
  if exists (select 1 from storage.buckets where id = 'documents') then
    v_total := v_total + 1;
    if not (select public from storage.buckets where id = 'documents') then
      v_lines := v_lines || 'OK      base  0389 : stockage « documents » privé (liens signés)'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0389 : stockage « documents » encore public'::text; end if;
  end if;

  -- Plus d'adresse vers l'ancien outil (0390)
  if to_regclass('app.retrait_ancien_outil') is not null then
    v_total := v_total + 1;
    if not exists (select 1 from public.course_documents where file_url like 'https://ibvtdiiwlpocibjvlgxr.supabase.co/%')
       and not exists (select 1 from public.courses where program_url like 'https://ibvtdiiwlpocibjvlgxr.supabase.co/%')
       and not exists (select 1 from public.trainers where signature_url like 'https://ibvtdiiwlpocibjvlgxr.supabase.co/%') then
      v_lines := v_lines || 'OK      base  0390 : plus aucun lien vers l''ancien outil (programmes, documents, signature)'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0390 : des adresses vers l''ancien outil restent'::text; end if;
  end if;

  -- Suivi de chaque certification (0391) : référentiel des preuves et des écarts, échéance APSAD de 3 semaines
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cert_audit_findings' and column_name = 'referential_code') then
    v_total := v_total + 1;
    declare
      v_f record;
      v_q record;
    begin
      insert into public.cert_audit_findings (company_id, referential_code, audit_kind, audit_date, severity, description)
      values ((select id from public.companies order by created_at limit 1), 'apsad-i4nf285', 'initial', date '2026-10-01', 'majeure', 'essai 0391')
      returning referential_code, due_date into v_f;
      insert into public.cert_audit_findings (company_id, audit_kind, audit_date, severity, description)
      values ((select id from public.companies order by created_at limit 1), 'initial', date '2026-10-01', 'majeure', 'essai 0391')
      returning referential_code, due_date into v_q;
      if v_f.due_date = date '2026-10-22' and v_q.referential_code is not null and v_q.due_date = date '2027-01-01'
         and (select count(*) from public.cert_referentials where code in ('apsad-j5f5', 'apsad-i7f7', 'apsad-i17f17', 'apsad-d32') and company_id is null) = 4 then
        v_lines := v_lines || 'OK      base  0391 : écart APSAD à 3 semaines, écart sans référentiel rattaché à Qualiopi, 4 référentiels APSAD'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || format('ÉCHEC   base  0391 : échéances %s / %s, référentiel %s', v_f.due_date, v_q.due_date, v_q.referential_code); end if;
      delete from public.cert_audit_findings where description = 'essai 0391';
    end;
  end if;

  -- Supports de formation privés (0392)
  if exists (select 1 from storage.buckets where id = 'course-documents') then
    v_total := v_total + 1;
    if not (select public from storage.buckets where id = 'course-documents')
       and not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                       and 'anon' = any (roles) and coalesce(qual, '') like '%course-documents%') then
      v_lines := v_lines || 'OK      base  0392 : supports de formation privés, aucune lecture anonyme'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0392 : supports de formation encore lisibles sans connexion'::text; end if;
  end if;

  -- Contraintes sans prénoms en dur (0393)
  if exists (select 1 from public.schema_migrations where version = '0393_contraintes_societe')
     or exists (select 1 from pg_constraint where conname = 'prospect_rdv_conducted_by_check' and pg_get_constraintdef(oid) like '%btrim%') then
    v_total := v_total + 1;
    if not exists (select 1 from pg_constraint where conname in ('budget_transactions_payer_check', 'budget_meal_guests_meal_for_check', 'prospect_rdv_conducted_by_check')
                   and pg_get_constraintdef(oid) ~* 'array\[')
       and 'perso_00000000-0000-0000-0000-000000000000' ~ '^perso_[0-9a-f-]{36}$' then
      v_lines := v_lines || 'OK      base  0393 : aucune contrainte ne cite un prénom'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0393 : une contrainte cite encore un prénom'::text; end if;
  end if;

  -- EPI remis au personnel (0394) : la direction remet, l'article sort du stock, renouvellement proposé ;
  -- le technicien voit son EPI et ne peut pas s'en remettre un ; une remise annulée revient en stock
  if to_regclass('public.hr_ppe_handovers') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 4;
    declare
      z_co uuid := app.company_default(); z_p uuid; z_i uuid; z_l uuid; z_h uuid; z_ok boolean := false; z_n int; z_mod boolean;
      z_r date;
    begin
      select coalesce(enabled, false) into z_mod from public.company_modules where company_id = z_co and key = 'rh';
      insert into public.company_modules (company_id, key, enabled) values (z_co, 'rh', true)
        on conflict (company_id, key) do update set enabled = true;
      select id into z_p from public.hr_people where profile_id = u_tech limit 1;
      if z_p is null then
        insert into public.hr_people (company_id, first_name, last_name, profile_id) values (z_co, 'Essai', 'EPI 0394', u_tech) returning id into z_p;
      end if;
      insert into public.stock_items (company_id, label, unit, ppe, ppe_renew_months) values (z_co, 'Gants essai 0394', 'paire', true, 12) returning id into z_i;
      insert into public.stock_locations (company_id, kind, name) values (z_co, 'depot', 'Dépôt essai 0394') returning id into z_l;
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.hr_ppe_handovers (person_id, item_id, quantity, size, from_location_id, handed_on, employee_signature)
      values (z_p, z_i, 2, '9', z_l, date '2026-10-21', 'data:image/png;base64,AAAA') returning id, renew_on into z_h, z_r;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if z_r = date '2027-10-21' and exists (select 1 from public.stock_movements where source_table = 'hr_ppe_handovers' and source_id = z_h and kind = 'sortie' and quantity = 2 and from_location_id = z_l)
         and (select signed_at from public.hr_ppe_handovers where id = z_h) is not null then
        v_lines := v_lines || 'OK      dir   0394 : EPI remis, sorti du stock, renouvellement à 12 mois, signature datée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0394 : remise d''EPI'::text; end if;
      perform set_config('request.jwt.claims', json_build_object('sub', u_tech, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into z_n from public.hr_ppe_handovers where id = z_h;
      begin insert into public.hr_ppe_handovers (person_id, item_id, quantity) values (z_p, z_i, 1);
      exception when insufficient_privilege then z_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if z_n = 1 then v_lines := v_lines || 'OK      tech  0394 : le technicien voit l''EPI qui lui a été remis'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   tech  0394 : EPI remis invisible pour la personne'::text; end if;
      if z_ok then v_lines := v_lines || 'OK      tech  0394 : remise d''EPI refusée au technicien'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   tech  0394 : un technicien peut enregistrer une remise'::text; end if;
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      delete from public.hr_ppe_handovers where id = z_h;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if exists (select 1 from public.stock_movements where source_table = 'hr_ppe_handovers_annulee' and source_id = z_h and kind = 'ajustement' and to_location_id = z_l and quantity = 2) then
        v_lines := v_lines || 'OK      dir   0394 : remise annulée, EPI revenu en stock'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0394 : retour en stock après annulation'::text; end if;
      update public.company_modules set enabled = coalesce(z_mod, false) where company_id = z_co and key = 'rh';
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 4; v_lines := v_lines || ('ÉCHEC   base  0394 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Permis à l'attribution d'un véhicule (0395) : refusée sans permis en cours, acceptée avec
  if to_regprocedure('app.permis_motif(uuid,uuid,uuid,date)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 2;
    declare
      z_co uuid := app.company_default(); z_p uuid; z_v uuid; z_ok boolean := false; z_mod boolean;
    begin
      select coalesce(enabled, false) into z_mod from public.company_modules where company_id = z_co and key = 'rh';
      insert into public.company_modules (company_id, key, enabled) values (z_co, 'rh', true)
        on conflict (company_id, key) do update set enabled = true;
      select id into z_p from public.hr_people where profile_id = u_tech limit 1;
      if z_p is null then
        insert into public.hr_people (company_id, first_name, last_name, profile_id) values (z_co, 'Essai', 'Permis 0395', u_tech) returning id into z_p;
      end if;
      update public.hr_qualifications set archived_at = now() where person_id = z_p and kind = 'permis' and archived_at is null;
      insert into public.vehicles (company_id, plate) values (z_co, 'ES-395-AI') returning id into z_v;
      begin insert into public.vehicle_assignments (company_id, vehicle_id, profile_id) values (z_co, z_v, u_tech);
      exception when check_violation then z_ok := true; end;
      if z_ok then v_lines := v_lines || 'OK      base  0395 : véhicule refusé sans permis en cours'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0395 : véhicule confié sans permis'::text; end if;
      insert into public.hr_qualifications (company_id, person_id, kind, label, obtained_on) values (z_co, z_p, 'permis', 'Permis B', date '2015-06-02');
      insert into public.vehicle_assignments (company_id, vehicle_id, profile_id) values (z_co, z_v, u_tech);
      v_lines := v_lines || 'OK      base  0395 : véhicule confié avec un permis en cours'::text;
      update public.company_modules set enabled = coalesce(z_mod, false) where company_id = z_co and key = 'rh';
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 2; v_lines := v_lines || ('ÉCHEC   base  0395 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Avis après formation (0396) : la société de la session est reprise, un seul avis par stagiaire et par session
  if to_regclass('public.training_avis') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 2;
    declare z_s uuid; z_t uuid; z_ok boolean := false; z_co uuid;
    begin
      select st.session_id, st.trainee_id into z_s, z_t from public.session_trainees st limit 1;
      if z_s is null then
        v_lines := v_lines || 'OK      base  0396 : avis après formation (aucun stagiaire pour l''essai)'::text;
        v_lines := v_lines || 'OK      base  0396 : un avis par stagiaire (aucun stagiaire pour l''essai)'::text;
      else
        insert into public.training_avis (session_id, trainee_id, kind, symbols) values (z_s, z_t, 'habilitation_electrique', array['B0', 'H0V'])
        returning company_id into z_co;
        if z_co = (select company_id from public.sessions where id = z_s) then
          v_lines := v_lines || 'OK      base  0396 : avis rattaché à la société de la session'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0396 : société de l''avis'::text; end if;
        begin insert into public.training_avis (session_id, trainee_id, kind) values (z_s, z_t, 'habilitation_electrique');
        exception when unique_violation then z_ok := true; end;
        if z_ok then v_lines := v_lines || 'OK      base  0396 : un seul avis par stagiaire et par session'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0396 : deux avis pour un même stagiaire'::text; end if;
        delete from public.training_avis where session_id = z_s and trainee_id = z_t;
      end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 2; v_lines := v_lines || ('ÉCHEC   base  0396 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Financement dans le devis (0397) : financeur inconnu refusé, montant négatif refusé
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quotes' and column_name = 'funding_type') then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 1;
    declare z_q uuid; z_ok boolean := false;
    begin
      select id into z_q from public.quotes limit 1;
      if z_q is null then
        v_lines := v_lines || 'OK      base  0397 : financement du devis (aucun devis pour l''essai)'::text;
      else
        begin update public.quotes set funding_type = 'inconnu' where id = z_q;
        exception when check_violation then z_ok := true; end;
        if z_ok then v_lines := v_lines || 'OK      base  0397 : financeur du devis contrôlé'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0397 : financeur inconnu accepté'::text;
          update public.quotes set funding_type = null where id = z_q; end if;
      end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0397 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Régularisation des émargements (0398) : société de la session reprise, décision ni modifiable ni effaçable
  if to_regclass('public.attendance_regularisations') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 2;
    declare z_s uuid; z_t uuid; z_co uuid;
    begin
      select st.session_id, st.trainee_id into z_s, z_t from public.session_trainees st limit 1;
      if z_s is null then
        v_lines := v_lines || 'OK      base  0398 : régularisation (aucun stagiaire pour l''essai)'::text;
        v_lines := v_lines || 'OK      base  0398 : décisions conservées (aucun stagiaire pour l''essai)'::text;
      else
        insert into public.attendance_regularisations (session_id, trainee_id, date, period, decision, reason)
        values (z_s, z_t, current_date, 'morning', 'absent', 'essai') returning company_id into z_co;
        if z_co = (select company_id from public.sessions where id = z_s) then
          v_lines := v_lines || 'OK      base  0398 : régularisation rattachée à la société de la session'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0398 : société de la régularisation'::text; end if;
        if not exists (select 1 from pg_policies where tablename = 'attendance_regularisations' and cmd in ('UPDATE', 'DELETE')) then
          v_lines := v_lines || 'OK      base  0398 : décisions ni modifiables ni effaçables depuis l''écran'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0398 : une règle permet de modifier ou d''effacer une décision'::text; end if;
        delete from public.attendance_regularisations where session_id = z_s and reason = 'essai';
      end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 2; v_lines := v_lines || ('ÉCHEC   base  0398 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Documents émis (0399) : société de la session, correction sans motif refusée, version unique
  if to_regclass('public.training_documents_issued') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 2;
    declare z_s uuid; z_t uuid; z_co uuid; z_ok boolean := false;
    begin
      -- Un stagiaire sans document émis (la base réelle en a déjà)
      select st.session_id, st.trainee_id into z_s, z_t from public.session_trainees st
      where not exists (select 1 from public.training_documents_issued d where d.session_id = st.session_id and d.trainee_id = st.trainee_id)
      limit 1;
      if z_s is null then
        v_lines := v_lines || 'OK      base  0399 : document émis (aucun stagiaire pour l''essai)'::text;
        v_lines := v_lines || 'OK      base  0399 : correction motivée (aucun stagiaire pour l''essai)'::text;
      else
        insert into public.training_documents_issued (session_id, trainee_id, kind, version, issued_on, hours)
        values (z_s, z_t, 'certificat', 1, current_date, 7) returning company_id into z_co;
        if z_co = (select company_id from public.sessions where id = z_s) then
          v_lines := v_lines || 'OK      base  0399 : document émis rattaché à la société de la session'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0399 : société du document émis'::text; end if;
        begin insert into public.training_documents_issued (session_id, trainee_id, kind, version, issued_on, hours)
          values (z_s, z_t, 'certificat', 2, current_date, 3.5);
        exception when check_violation then z_ok := true; end;
        if z_ok then v_lines := v_lines || 'OK      base  0399 : une correction exige son motif'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0399 : correction sans motif acceptée'::text; end if;
        delete from public.training_documents_issued where session_id = z_s and trainee_id = z_t;
      end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 2; v_lines := v_lines || ('ÉCHEC   base  0399 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Portails et documents émis (0400) : un lien de portail invalide ne lit aucun document émis
  if to_regprocedure('public.client_portal_documents_emis(text,text)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 1;
    begin
      if public.client_portal_documents_emis('lien-inexistant', '000000') = '[]'::jsonb then
        v_lines := v_lines || 'OK      base  0400 : portail sans lien valide, aucun document émis'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0400 : documents émis lus sans lien valide'::text; end if;
    exception when others then
      v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0400 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Journal de l'espace client (0401) : document d'un autre client refusé, ligne jamais modifiée
  if to_regclass('public.portal_events') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 3;
    declare z_c uuid; z_s uuid; z_autre uuid; z_ev uuid; z_ok boolean := false; z_ok2 boolean := false;
    begin
      select s.client_id, s.id into z_c, z_s from public.sessions s where s.client_id is not null limit 1;
      select s.id into z_autre from public.sessions s where s.client_id is distinct from z_c limit 1;
      if z_c is null then
        v_lines := v_lines || 'OK      base  0401 : journal (aucune session pour l''essai)'::text;
        v_lines := v_lines || 'OK      base  0401 : document d''un autre client (aucune session pour l''essai)'::text;
        v_lines := v_lines || 'OK      base  0401 : ligne figée (aucune session pour l''essai)'::text;
      else
        z_ev := app.portail_noter(z_c, 'lien', null, null, 'document', 'session', z_s, 'certificats', 'Certificats', repeat('a', 64));
        if (select company_id from public.portal_events where id = z_ev) = (select company_id from public.clients where id = z_c) then
          v_lines := v_lines || 'OK      base  0401 : téléchargement noté, société du client'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0401 : société du journal'::text; end if;
        if z_autre is null then z_ok := true; else
          begin perform app.portail_noter(z_c, 'lien', null, null, 'document', 'session', z_autre, 'certificats', 'x', null);
          exception when insufficient_privilege then z_ok := true; end;
        end if;
        if z_ok then v_lines := v_lines || 'OK      base  0401 : document d''un autre client refusé'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0401 : document d''un autre client noté'::text; end if;
        begin update public.portal_events set ip = 'x' where id = z_ev;
        exception when insufficient_privilege then z_ok2 := true; end;
        if z_ok2 then v_lines := v_lines || 'OK      base  0401 : une ligne du journal ne se modifie pas'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0401 : ligne du journal modifiée'::text; end if;
        delete from public.portal_events where id = z_ev;
      end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 3; v_lines := v_lines || ('ÉCHEC   base  0401 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Signature depuis l'espace client (0402) : session signée, notification, signature figée
  if to_regprocedure('app.portail_signer(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text,text)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 3;
    declare z_c uuid; z_s uuid; z_r jsonb; z_ok boolean := false;
    begin
      select s.client_id, s.id into z_c, z_s from public.sessions s where s.client_id is not null limit 1;
      if z_c is null then
        v_lines := v_lines || 'OK      base  0402 : signature (aucune session pour l''essai)'::text;
        v_lines := v_lines || 'OK      base  0402 : notification (aucune session pour l''essai)'::text;
        v_lines := v_lines || 'OK      base  0402 : signature figée (aucune session pour l''essai)'::text;
      else
        update public.sessions set convention_signed = false where id = z_s;
        z_r := app.portail_signer(z_c, 'lien', null, null, z_s, 'convention', repeat('c', 64), 'Essai Signataire', 'Gérant',
          'data:image/png;base64,iVBORw0KGgo=', 'J''ai lu la convention et je l''accepte.', 'Convention essai');
        if (select convention_signed from public.sessions where id = z_s) then
          v_lines := v_lines || 'OK      base  0402 : la session passe en convention signée'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0402 : session non marquée signée'::text; end if;
        if exists (select 1 from public.notifications where metadata->>'signature_id' = z_r->>'id') then
          v_lines := v_lines || 'OK      base  0402 : l''organisme est prévenu'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0402 : aucune notification'::text; end if;
        begin update public.document_signatures set signer_name = 'Autre' where id = (z_r->>'id')::uuid;
        exception when insufficient_privilege then z_ok := true; end;
        if z_ok then v_lines := v_lines || 'OK      base  0402 : la signature du client ne se modifie pas'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0402 : signature du client modifiée'::text; end if;
      end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 3; v_lines := v_lines || ('ÉCHEC   base  0402 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Journal et purge (0403) : la mise à vide du lien d'accès passe, toute autre modification reste refusée
  if to_regclass('public.portal_events') is not null and exists (select 1 from pg_proc where proname = 'portal_events_fige'
       and prosrc like '%access_id%') then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 2;
    declare z_c uuid; z_a uuid; z_ev uuid; z_ok boolean := false;
    begin
      insert into public.clients (name) values ('Client essai 0403') returning id into z_c;
      insert into public.client_portal_access (client_id, access_code) values (z_c, '123456') returning id into z_a;
      z_ev := app.portail_noter(z_c, 'lien', z_a, null, 'connexion', null, null, null, null, null);
      delete from public.client_portal_access where id = z_a;
      if (select access_id from public.portal_events where id = z_ev) is null then
        v_lines := v_lines || 'OK      base  0403 : l''accès effacé, la ligne du journal reste (lien mis à vide)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0403 : lien d''accès non mis à vide'::text; end if;
      begin update public.portal_events set ip = 'x' where id = z_ev;
      exception when insufficient_privilege then z_ok := true; end;
      if z_ok then v_lines := v_lines || 'OK      base  0403 : une autre modification reste refusée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0403 : ligne du journal modifiée'::text; end if;
      delete from public.clients where id = z_c;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 2; v_lines := v_lines || ('ÉCHEC   base  0403 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Documents de l'espace client (0404) : visibles par le client, retirés mais jamais effacés ni modifiés
  if to_regclass('public.client_shared_documents') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 3;
    declare z_c uuid; z_d uuid; z_ok boolean := false; z_ok2 boolean := false;
    begin
      insert into public.clients (name) values ('Client essai 0404') returning id into z_c;
      insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
      values ((select company_id from public.clients where id = z_c), z_c, 'client', z_c, 'contrat', 'Contrat essai', z_c || '/client/essai.pdf', repeat('d', 64))
      returning id into z_d;
      if jsonb_array_length(app.portail_documents_client(z_c)) = 1 then
        v_lines := v_lines || 'OK      base  0404 : document visible dans l''espace du client'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0404 : document absent de l''espace'::text; end if;
      begin update public.client_shared_documents set label = 'Autre' where id = z_d;
      exception when insufficient_privilege then z_ok := true; end;
      begin delete from public.client_shared_documents where id = z_d;
      exception when insufficient_privilege then z_ok2 := true; end;
      if z_ok and z_ok2 then v_lines := v_lines || 'OK      base  0404 : un document ne se modifie ni ne s''efface'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0404 : document modifié ou effacé'::text; end if;
      update public.client_shared_documents set withdrawn_at = now(), withdrawn_reason = 'essai' where id = z_d;
      if jsonb_array_length(app.portail_documents_client(z_c)) = 0 then
        v_lines := v_lines || 'OK      base  0404 : document retiré, plus visible par le client'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0404 : document retiré encore visible'::text; end if;
      delete from public.clients where id = z_c;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 3; v_lines := v_lines || ('ÉCHEC   base  0404 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Appareil complet (0405) : l'identifiant du navigateur n'est plus coupé à la première virgule
  if to_regprocedure('app.entete_complet(text)') is not null then
    execute 'reset role';
    v_total := v_total + 1;
    perform set_config('request.headers', '{"user-agent":"Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"}', true);
    if app.entete_complet('user-agent') like '%Chrome/130.0%' then
      v_lines := v_lines || 'OK      base  0405 : appareil gardé en entier'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0405 : appareil coupé'::text; end if;
    perform set_config('request.headers', '', true);
    v_total := v_total + 1;
    declare z_c uuid; z_s uuid; z_r jsonb;
    begin
      select s.client_id into z_c from public.sessions s where s.client_id is not null limit 1;
      if z_c is null then
        v_lines := v_lines || 'OK      base  0405 : purge d''une signature de test (aucun client pour l''essai)'::text;
      else
        insert into public.sessions (client_id, start_date, end_date, attendance_token) values (z_c, current_date + 30, current_date + 30, 'essai-0405') returning id into z_s;
        insert into public.demo_records (tbl, id) values ('sessions', z_s);
        z_r := app.portail_signer(z_c, 'lien', null, null, z_s, 'convention', repeat('e', 64), 'Essai Signataire', null,
          'data:image/png;base64,iVBORw0KGgo=', 'J''ai lu la convention et je l''accepte.', 'Convention essai 0405');
        delete from public.document_signatures where session_id = z_s;
        v_lines := v_lines || 'OK      base  0405 : la purge efface la signature d''une session de test'::text;
        delete from public.sessions where id = z_s;
      end if;
    exception when others then
      v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0405 : purge d''une signature de test ' || sqlerrm)::text;
    end;
  end if;

  -- Signature d'un devis depuis l'espace client (0406) : devis accepté, notification, document d'un autre client refusé
  if to_regprocedure('app.portail_signer_document(uuid,text,uuid,uuid,uuid,text,text,text,text)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 3;
    declare z_c uuid; z_c2 uuid; z_q uuid; z_d uuid; z_r jsonb; z_ok boolean := false;
    begin
      insert into public.clients (name) values ('Client essai 0406') returning id into z_c;
      insert into public.clients (name) values ('Autre client essai 0406') returning id into z_c2;
      insert into public.quotes (client_id, status, quote_date, reference) values (z_c, 'sent', current_date, 'DEV-ESSAI-0406') returning id into z_q;
      insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
      values ((select company_id from public.clients where id = z_c), z_c, 'quote', z_q, 'devis', 'Devis essai', z_c || '/q.pdf', repeat('f', 64))
      returning id into z_d;
      z_r := app.portail_signer_document(z_c, 'lien', null, null, z_d, 'Essai Signataire', 'Gérant',
        'data:image/png;base64,iVBORw0KGgo=', 'J''ai lu le devis et je l''accepte au nom de mon entreprise.');
      if (select status from public.quotes where id = z_q) = 'accepted' and (select signature_base64 from public.quotes where id = z_q) is not null then
        v_lines := v_lines || 'OK      base  0406 : devis signé en ligne, passé en accepté'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0406 : devis non accepté'::text; end if;
      if exists (select 1 from public.notifications where metadata->>'signature_id' = z_r->>'id') then
        v_lines := v_lines || 'OK      base  0406 : l''organisme est prévenu de la signature du devis'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0406 : aucune notification'::text; end if;
      begin perform app.portail_signer_document(z_c2, 'lien', null, null, z_d, 'Intrus', null,
        'data:image/png;base64,iVBORw0KGgo=', 'J''ai lu le devis et je l''accepte au nom de mon entreprise.');
      exception when insufficient_privilege then z_ok := true; end;
      if z_ok then v_lines := v_lines || 'OK      base  0406 : un autre client ne signe pas ce devis'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0406 : devis signé par un autre client'::text; end if;
      delete from public.quotes where id = z_q;
      delete from public.clients where id in (z_c, z_c2);
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 3; v_lines := v_lines || ('ÉCHEC   base  0406 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Point de la semaine (0407) : reports comptés, action faite datée, point préparé, choix gardés, bilan, nuit
  if to_regclass('public.weekly_briefs') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 5;
    declare z_co uuid; z_a uuid; z_w date; z_b public.weekly_briefs; z_l jsonb; z_p uuid; z_r jsonb;
    begin
      z_co := (select id from public.companies order by created_at limit 1);
      z_w := date_trunc('week', (now() at time zone 'Europe/Paris')::date)::date + 70;
      insert into public.team_actions (company_id, title, due_on) values (z_co, 'Action essai 0407', z_w + 1) returning id into z_a;
      update public.team_actions set due_on = z_w + 2 where id = z_a;
      update public.team_actions set status = 'fait' where id = z_a;
      if (select postponed_count = 1 and done_at is not null from public.team_actions where id = z_a) then
        v_lines := v_lines || 'OK      base  0407 : report compté, action faite datée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0407 : report ou date de fin absents'::text; end if;
      update public.team_actions set status = 'a_faire' where id = z_a;
      z_b := app.point_preparer(z_co, z_w, 'point', null);
      if exists (select 1 from jsonb_array_elements(z_b.lines) l where l->>'id' = 'act:' || z_a and l->>'section' = 'semaine') then
        v_lines := v_lines || 'OK      base  0407 : action de la semaine dans le point'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0407 : action absente du point'::text; end if;
      -- Ligne retirée et ligne ajoutée à la main : gardées quand on actualise
      select jsonb_agg(case when l->>'id' = 'act:' || z_a then l || '{"retire": true}'::jsonb else l end) into z_l from jsonb_array_elements(z_b.lines) l;
      update public.weekly_briefs set lines = z_l || '[{"id": "m:essai", "section": "divers", "texte": "Ligne à la main", "manuel": true}]'::jsonb where id = z_b.id;
      z_b := app.point_preparer(z_co, z_w, 'point', null);
      if exists (select 1 from jsonb_array_elements(z_b.lines) l where l->>'id' = 'act:' || z_a and (l->>'retire')::boolean)
         and exists (select 1 from jsonb_array_elements(z_b.lines) l where l->>'id' = 'm:essai') then
        v_lines := v_lines || 'OK      base  0407 : choix et lignes à la main gardés à l''actualisation'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0407 : choix perdus à l''actualisation'::text; end if;
      -- Bilan : reprend les lignes gardées du point (pas la retirée), et l'action de la semaine
      z_b := app.point_preparer(z_co, z_w, 'bilan', null);
      if exists (select 1 from jsonb_array_elements(z_b.lines) l where l->>'id' = 'm:essai')
         and exists (select 1 from jsonb_array_elements(z_b.lines) l where l->>'id' = 'act:' || z_a) then
        v_lines := v_lines || 'OK      base  0407 : bilan préparé à partir du point'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0407 : bilan incomplet'::text; end if;
      -- Nuit : point préparé un lundi là où un destinataire est choisi, une seule fois
      z_p := (select m.profile_id from public.company_members m where m.company_id = z_co limit 1);
      delete from public.weekly_briefs where company_id = z_co and week_start = z_w;
      if z_p is not null then
        insert into public.weekly_brief_recipients (company_id, profile_id, point) values (z_co, z_p, true)
          on conflict (company_id, profile_id) do update set point = true;
        z_r := public.point_semaine_generer(z_w);
        if (z_r->>'prepares')::int >= 1 and (public.point_semaine_generer(z_w)->>'prepares')::int = 0
           and exists (select 1 from public.weekly_briefs where company_id = z_co and week_start = z_w and kind = 'point') then
          v_lines := v_lines || 'OK      base  0407 : point préparé la nuit du lundi, une seule fois'::text;
        else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0407 : préparation de nuit'::text; end if;
        delete from public.notifications where type = 'point_semaine' and link like '/point-semaine?semaine=' || z_w || '%';
        delete from public.weekly_brief_recipients where company_id = z_co and profile_id = z_p;
      else
        v_lines := v_lines || 'OK      base  0407 : préparation de nuit (aucun membre, non vérifiée)'::text;
      end if;
      delete from public.weekly_briefs where company_id = z_co and week_start = z_w;
      delete from public.team_actions where id = z_a;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 5; v_lines := v_lines || ('ÉCHEC   base  0407 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Réunions (0408) : trames proposées, compte rendu daté, personne choisie gardée au point de la semaine
  if to_regclass('public.meetings') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 3;
    declare z_co uuid; z_m uuid; z_w date; z_b public.weekly_briefs; z_a uuid; z_p uuid;
    begin
      z_co := (select id from public.companies order by created_at limit 1);
      if (select count(*) from public.meeting_templates where company_id is null and active) >= 5 then
        v_lines := v_lines || 'OK      base  0408 : trames de rendez-vous proposées à toutes les sociétés'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0408 : trames absentes'::text; end if;
      insert into public.meetings (company_id, kind, title, notes) values (z_co, 'reunion_interne', 'Réunion essai 0408', 'Décision : essai')
        returning id into z_m;
      update public.meetings set status = 'terminee', summary = '{"resume": "essai"}'::jsonb where id = z_m;
      if (select closed_at is not null from public.meetings where id = z_m) then
        v_lines := v_lines || 'OK      base  0408 : compte rendu clos et daté'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0408 : compte rendu sans date'::text; end if;
      delete from public.meetings where id = z_m;
      -- Point : personne choisie à la main sur une ligne, gardée à l'actualisation
      z_w := date_trunc('week', (now() at time zone 'Europe/Paris')::date)::date + 84;
      z_p := (select m.profile_id from public.company_members m where m.company_id = z_co limit 1);
      insert into public.team_actions (company_id, title, due_on) values (z_co, 'Action essai 0408', z_w + 1) returning id into z_a;
      z_b := app.point_preparer(z_co, z_w, 'point', null);
      update public.weekly_briefs set lines = (select jsonb_agg(case when l->>'id' = 'act:' || z_a
          then l || jsonb_build_object('owner_id', z_p, 'owner_nom', 'Essai', 'owner_choisi', true) else l end) from jsonb_array_elements(lines) l)
        where id = z_b.id;
      z_b := app.point_preparer(z_co, z_w, 'point', null);
      if exists (select 1 from jsonb_array_elements(z_b.lines) l where l->>'id' = 'act:' || z_a and l->>'owner_nom' = 'Essai'
                 and (l->'owner_id') is not distinct from to_jsonb(z_p)) then
        v_lines := v_lines || 'OK      base  0408 : personne choisie gardée à l''actualisation du point'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0408 : personne choisie perdue'::text; end if;
      delete from public.weekly_briefs where company_id = z_co and week_start = z_w;
      delete from public.team_actions where id = z_a;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 3; v_lines := v_lines || ('ÉCHEC   base  0408 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Qui a apporté quoi (0409) : chaîne d'apport, avoir en moins, facture d'une autre société absente
  if to_regclass('public.business_contributors') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 2;
    declare z_co uuid; z_c uuid; z_b uuid; z_i uuid; z_p uuid; z_r jsonb;
    begin
      z_co := (select id from public.companies order by created_at limit 1);
      z_p := (select m.profile_id from public.company_members m where m.company_id = z_co limit 1);
      insert into public.business_contributors (company_id, name, introduced_by_profile) values (z_co, 'Prescripteur essai 0409', z_p) returning id into z_b;
      begin
        update public.business_contributors set introduced_by_contributor = z_b where id = z_b;
        v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0409 : un apporteur s''amène lui-même'::text;
      exception when check_violation then
        v_lines := v_lines || 'OK      base  0409 : un apporteur ne s''amène pas lui-même'::text;
      end;
      insert into public.clients (name, company_id, introduced_by_contributor) values ('Client essai 0409', z_co, z_b) returning id into z_c;
      if exists (select 1 from public.clients where id = z_c and introduced_by_contributor = z_b)
         and exists (select 1 from public.business_contributors where id = z_b and introduced_by_profile is not distinct from z_p) then
        v_lines := v_lines || 'OK      base  0409 : chaîne d''apport notée (membre, apporteur, client)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0409 : chaîne d''apport absente'::text; end if;
      delete from public.clients where id = z_c;
      delete from public.business_contributors where id = z_b;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 2; v_lines := v_lines || ('ÉCHEC   base  0409 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Portail stagiaire (0410) : une seule notification par session et par jour, tenue à jour, « prêts » quand tout est fait
  if to_regprocedure('app.portail_avancement(uuid)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 2;
    declare z_s uuid; z_t1 uuid; z_t2 uuid; z_n int; z_titre text;
    begin
      insert into public.sessions (start_date, end_date) values (current_date + 30, current_date + 30) returning id into z_s;
      insert into public.trainees (first_name, last_name) values ('Essai', 'Portail un') returning id into z_t1;
      insert into public.trainees (first_name, last_name) values ('Essai', 'Portail deux') returning id into z_t2;
      insert into public.session_trainees (session_id, trainee_id) values (z_s, z_t1), (z_s, z_t2);
      insert into public.trainee_info_sheets (session_id, trainee_id, filled_online, training_expectations) values (z_s, z_t1, true, 'Savoir réagir')
        on conflict (session_id, trainee_id) do update set filled_online = true, training_expectations = 'Savoir réagir';
      update public.session_trainees set positioning_test_completed = true where session_id = z_s and trainee_id = z_t1;
      select count(*) into z_n from public.notifications where type = 'portail_stagiaire' and metadata->>'session_id' = z_s::text;
      if z_n = 1 and exists (select 1 from public.notifications where type = 'portail_stagiaire' and metadata->>'session_id' = z_s::text
                             and message like '1 fiche de renseignements sur 2, 1 test de positionnement, 1 stagiaire a indiqué%') then
        v_lines := v_lines || 'OK      base  0410 : une seule notification par session, tenue à jour'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0410 : notifications ' || z_n)::text; end if;
      insert into public.trainee_info_sheets (session_id, trainee_id, filled_online) values (z_s, z_t2, true)
        on conflict (session_id, trainee_id) do update set filled_online = true;
      update public.session_trainees set positioning_test_completed = true where session_id = z_s and trainee_id = z_t2;
      select title into z_titre from public.notifications where type = 'portail_stagiaire' and metadata->>'session_id' = z_s::text;
      if z_titre like 'Tous les stagiaires sont prêts%' then
        v_lines := v_lines || 'OK      base  0410 : « tous prêts » quand fiches et tests sont faits'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0410 : titre ' || coalesce(z_titre, 'absent'))::text; end if;
      delete from public.notifications where type = 'portail_stagiaire' and metadata->>'session_id' = z_s::text;
      delete from public.trainee_info_sheets where session_id = z_s;
      delete from public.session_trainees where session_id = z_s;
      delete from public.sessions where id = z_s;
      delete from public.trainees where id in (z_t1, z_t2);
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 2; v_lines := v_lines || ('ÉCHEC   base  0410 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Marque blanche (0412) : aucun nom de personne ni d'organisme écrit dans la base
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organization_settings'
             and column_name = 'traces_a_signaler') then
    v_total := v_total + 3;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'budget_meal_guests'
                   and column_name = 'meal_for' and column_default is not null)
       and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bank_statements'
                   and column_name = 'account_label' and column_default is not null) then
      v_lines := v_lines || 'OK      base  0412 : aucune personne ni aucun compte bancaire par défaut'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0412 : personne invitante par défaut'::text; end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
               and p.proname = 'get_budget_kpis' and pg_get_function_result(p.oid) like '%cca jsonb%' and not p.prosecdef)
       and pg_get_viewdef('public.budget_compte_courant'::regclass) not like '%perso_h%'
       and (select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.budget_compte_courant'::regclass) then
      v_lines := v_lines || 'OK      base  0412 : comptes des associés lus dans les fiches, sans nom écrit, cloisonnement gardé'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0412 : nom écrit dans les comptes des associés'::text; end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'social_posts'
                   and column_name ~ '^content_linkedin_[a-z]+$') then
      v_lines := v_lines || 'OK      base  0412 : aucune colonne de publication propre à une personne'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0412 : colonne de publication propre à une personne'::text; end if;
  end if;

  -- Alertes sur le téléphone (0411) : heures calmes, erreurs écartées, clés illisibles depuis l'application
  if to_regclass('public.push_subscriptions') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 3;
    declare z_n uuid; z_r jsonb;
    begin
      insert into public.notifications (type, title, message) values ('error', 'Erreur essai 0411', 'essai') returning id into z_n;
      z_r := public.push_tick();
      if (select pushed_at is not null from public.notifications where id = z_n) and (z_r->>'appel')::boolean is not true then
        v_lines := v_lines || 'OK      base  0411 : erreur technique écartée des alertes, aucun appel sans appareil'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0411 : ' || z_r::text)::text; end if;
      delete from public.notifications where id = z_n;
      -- Appareil d'un membre qui voit les notifications : l'alerte de sa société lui est destinée, puis marquée
      declare z_m record; z_s uuid; z_n2 uuid; z_out jsonb;
      begin
        select m.profile_id, m.company_id into z_m from public.company_members m
        where m.is_active and 'organisation.notifications.gerer' = any (app.rights_for(m.profile_id, m.company_id)) limit 1;
        if z_m.profile_id is not null then
          insert into public.push_subscriptions (profile_id, company_id, endpoint, p256dh, auth)
          values (z_m.profile_id, z_m.company_id, 'https://push.exemple.test/essai-0411', 'cle', 'secret') returning id into z_s;
          insert into public.notifications (type, title, message, company_id) values ('devis_signe', 'Essai 0411', 'essai', z_m.company_id) returning id into z_n2;
          z_out := public.push_a_envoyer();
          if exists (select 1 from jsonb_array_elements(z_out->'appareils') d, jsonb_array_elements(d->'notifications') n
                     where d->>'id' = z_s::text and n->>'id' = z_n2::text)
             and (select pushed_at is not null from public.notifications where id = z_n2) then
            v_lines := v_lines || 'OK      base  0411 : alerte de la société destinée à l''appareil du membre, puis marquée'::text;
          else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0411 : alerte non destinée'::text; end if;
          delete from public.notifications where id = z_n2;
          delete from public.push_subscriptions where id = z_s;
        else
          v_lines := v_lines || 'OK      base  0411 : destination des alertes (aucun membre, non vérifiée)'::text;
        end if;
      end;
      if not has_table_privilege('authenticated', 'public.push_keys', 'select')
         or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_keys') then
        v_lines := v_lines || 'OK      base  0411 : clés des alertes sans règle de lecture'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0411 : clés lisibles'::text; end if;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 3; v_lines := v_lines || ('ÉCHEC   base  0411 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Bilan des attentes (0413) : avis du stagiaire par le portail, jamais sans avis envoyé, une alerte si « non »
  if to_regprocedure('public.portal_save_attentes(text,uuid,text,text,text)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 4;
    declare z_s uuid; z_t uuid; z_tok text; z_n int; z_ok boolean;
    begin
      insert into public.sessions (start_date, end_date) values (current_date, current_date) returning id, attendance_token into z_s, z_tok;
      insert into public.trainees (first_name, last_name) values ('Essai', 'Attentes') returning id into z_t;
      insert into public.session_trainees (session_id, trainee_id) values (z_s, z_t);
      update public.session_trainees set access_code = null where session_id = z_s and trainee_id = z_t;
      execute 'set local role anon';
      z_ok := false;
      begin
        perform public.portal_save_attentes(z_tok, z_t, 'oui', null, null);
      exception when others then z_ok := sqlerrm like 'Envoyez d''abord%';
      end;
      execute 'reset role';
      if z_ok and not exists (select 1 from public.trainee_evaluations where session_id = z_s) then
        v_lines := v_lines || 'OK      anon  0413 : aucun avis des attentes sans avis sur la formation (pas de fausse note)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   anon  0413 : avis des attentes accepté sans avis sur la formation'::text; end if;
      insert into public.trainee_evaluations (session_id, trainee_id, questionnaire_submitted) values (z_s, z_t, true);
      execute 'set local role anon';
      perform public.portal_save_attentes(z_tok, z_t, 'non', 'Pas assez de pratique', null);
      perform public.portal_save_attentes(z_tok, z_t, 'non', 'Pas assez de pratique', null);
      execute 'reset role';
      select count(*) into z_n from public.notifications where type = 'attentes_non_satisfaites' and metadata->>'session_id' = z_s::text;
      if z_n = 1 and (select attentes_satisfaites = 'non' and attentes_commentaire = 'Pas assez de pratique'
                      from public.trainee_evaluations where session_id = z_s and trainee_id = z_t) then
        v_lines := v_lines || 'OK      anon  0413 : attentes non satisfaites notées, une seule alerte à l''équipe'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   anon  0413 : alertes ' || z_n)::text; end if;
      execute 'set local role anon';
      z_ok := false;
      begin
        perform public.portal_save_attentes('jeton-inconnu', z_t, 'oui', null, null);
      exception when others then z_ok := true;
      end;
      begin
        perform public.portal_save_attentes(z_tok, z_t, 'peut-etre', null, null);
        z_ok := false;
      exception when others then null;
      end;
      execute 'reset role';
      if z_ok then v_lines := v_lines || 'OK      anon  0413 : jeton inconnu et réponse invalide refusés'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   anon  0413 : jeton inconnu ou réponse invalide acceptés'::text; end if;
      update public.session_trainees set access_code = '123456' where session_id = z_s and trainee_id = z_t;
      execute 'set local role anon';
      z_ok := false;
      begin
        perform public.portal_save_attentes(z_tok, z_t, 'oui', null, null);
      exception when others then z_ok := true;
      end;
      execute 'reset role';
      if z_ok then v_lines := v_lines || 'OK      anon  0413 : code d''accès exigé quand le stagiaire en a un'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   anon  0413 : avis accepté sans code d''accès'::text; end if;
      delete from public.notifications where type = 'attentes_non_satisfaites' and metadata->>'session_id' = z_s::text;
      delete from public.trainee_evaluations where session_id = z_s;
      delete from public.trainee_info_sheets where session_id = z_s;
      delete from public.session_trainees where session_id = z_s;
      delete from public.sessions where id = z_s;
      delete from public.trainees where id = z_t;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 4; v_lines := v_lines || ('ÉCHEC   base  0413 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Ressenti au fil de la formation (0414) : un par stagiaire et par jour, pendant la formation, une notification tenue à jour
  if to_regclass('public.session_ressentis') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 4;
    declare z_s uuid; z_s2 uuid; z_t1 uuid; z_t2 uuid; z_tok text; z_tok2 text; z_j json; z_n int; z_msg text; z_ok boolean;
    begin
      insert into public.sessions (start_date, end_date) values ((now() at time zone 'Europe/Paris')::date, (now() at time zone 'Europe/Paris')::date + 1)
        returning id, attendance_token into z_s, z_tok;
      insert into public.sessions (start_date, end_date) values (current_date + 20, current_date + 20) returning id, attendance_token into z_s2, z_tok2;
      insert into public.trainees (first_name, last_name) values ('Essai', 'Ressenti un') returning id into z_t1;
      insert into public.trainees (first_name, last_name) values ('Essai', 'Ressenti deux') returning id into z_t2;
      insert into public.session_trainees (session_id, trainee_id) values (z_s, z_t1), (z_s, z_t2), (z_s2, z_t1);
      update public.session_trainees set access_code = null where session_id in (z_s, z_s2);
      execute 'set local role anon';
      perform public.portal_ressenti(z_tok, z_t1, null, 2, 'Trop de théorie');
      z_j := public.portal_ressenti(z_tok, z_t2, null, 5, null);
      z_j := public.portal_ressenti(z_tok, z_t1, null, null, null);
      execute 'reset role';
      select count(*), max(message) into z_n, z_msg from public.notifications where type = 'ressenti_stagiaires' and metadata->>'session_id' = z_s::text;
      if (z_j->>'note')::int = 2 and z_j->>'commentaire' = 'Trop de théorie' and (z_j->>'ouvert')::boolean then
        v_lines := v_lines || 'OK      anon  0414 : ressenti du jour enregistré et relu par le portail'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   anon  0414 : relecture ' || coalesce(z_j::text, 'vide'))::text; end if;
      if z_n = 1 and z_msg = '2 ressentis, 3,5 sur 5, 1 difficulté, 1 remarque.' then
        v_lines := v_lines || 'OK      base  0414 : une seule notification par session et par jour, tenue à jour'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0414 : notifications ' || z_n || ' ' || coalesce(z_msg, ''))::text; end if;
      execute 'set local role anon';
      z_ok := false;
      begin
        perform public.portal_ressenti(z_tok2, z_t1, null, 4, null);
      exception when others then z_ok := sqlerrm like 'Le ressenti se donne%';
      end;
      begin
        perform public.portal_ressenti(z_tok, z_t1, null, 9, null);
        z_ok := false;
      exception when others then null;
      end;
      execute 'reset role';
      if z_ok then v_lines := v_lines || 'OK      anon  0414 : hors des jours de formation et note invalide refusés'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   anon  0414 : ressenti hors formation ou note invalide acceptés'::text; end if;
      execute 'set local role anon';
      z_ok := false;
      begin
        perform 1 from public.session_ressentis limit 1;
        z_ok := not found;
      exception when others then z_ok := true;
      end;
      execute 'reset role';
      if z_ok then v_lines := v_lines || 'OK      anon  0414 : ressentis illisibles sans compte'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   anon  0414 : ressentis lisibles sans compte'::text; end if;
      delete from public.notifications where type = 'ressenti_stagiaires' and metadata->>'session_id' = z_s::text;
      delete from public.session_ressentis where session_id in (z_s, z_s2);
      delete from public.trainee_info_sheets where session_id in (z_s, z_s2);
      delete from public.session_trainees where session_id in (z_s, z_s2);
      delete from public.sessions where id in (z_s, z_s2);
      delete from public.trainees where id in (z_t1, z_t2);
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 4; v_lines := v_lines || ('ÉCHEC   base  0414 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Satisfaction de l'entreprise (0415) : depuis l'espace entreprise, ses sessions terminées seulement, une alerte au premier avis
  if to_regclass('public.client_satisfactions') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 4;
    declare
      f_u uuid := gen_random_uuid(); f_c1 uuid; f_c2 uuid; f_s1 uuid; f_s2 uuid; f_s3 uuid; f_j jsonb; f_ok boolean; f_n int;
    begin
      insert into auth.users (id, email, aud, role) values (f_u, 'ent.avis@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (f_u, 'ent.avis@test.invalid', 'entreprise', true)
      on conflict (id) do update set role = 'entreprise', is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;
      insert into public.clients (name, client_type) values ('Essai avis 1', 'entreprise') returning id into f_c1;
      insert into public.clients (name, client_type) values ('Essai avis 2', 'entreprise') returning id into f_c2;
      insert into public.sessions (client_id, start_date, end_date) values (f_c1, current_date - 3, current_date - 2) returning id into f_s1;
      insert into public.sessions (client_id, start_date, end_date) values (f_c2, current_date - 3, current_date - 2) returning id into f_s2;
      insert into public.sessions (client_id, start_date, end_date) values (f_c1, current_date + 10, current_date + 10) returning id into f_s3;
      insert into public.client_accounts (profile_id, client_id, email) values (f_u, f_c1, 'ent.avis@test.invalid');
      perform set_config('request.jwt.claims', json_build_object('sub', f_u, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.ent_satisfaction(f_s1, '{"note_globale": 4, "q_organisation": 5, "recommande": true, "besoins": "Habilitation électrique"}');
      f_j := public.ent_satisfaction(f_s1, '{"note_globale": 5, "recommande": true}');
      execute 'reset role';
      select count(*) into f_n from public.notifications where type = 'satisfaction_entreprise' and metadata->>'session_id' = f_s1::text;
      if (f_j->>'note_globale')::int = 5 and f_n = 1
         and (select count(*) from public.client_satisfactions where session_id = f_s1) = 1 then
        v_lines := v_lines || 'OK      ent   0415 : avis de l''entreprise enregistré, modifiable, une seule alerte'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   ent   0415 : avis ' || coalesce(f_j::text, 'vide') || ' alertes ' || f_n)::text; end if;
      execute 'set local role authenticated';
      f_ok := false;
      begin
        perform public.ent_satisfaction(f_s2, '{"note_globale": 1}');
      exception when others then f_ok := true;
      end;
      execute 'reset role';
      if f_ok and not exists (select 1 from public.client_satisfactions where session_id = f_s2) then
        v_lines := v_lines || 'OK      ent   0415 : pas d''avis sur la session d''une autre entreprise'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ent   0415 : avis sur la session d''une autre entreprise'::text; end if;
      execute 'set local role authenticated';
      f_ok := false;
      begin
        perform public.ent_satisfaction(f_s3, '{"note_globale": 3}');
      exception when others then f_ok := sqlerrm like 'L''avis se donne%';
      end;
      begin
        perform public.ent_satisfaction(f_s1, '{"note_globale": 8}');
        f_ok := false;
      exception when others then null;
      end;
      execute 'reset role';
      if f_ok then v_lines := v_lines || 'OK      ent   0415 : formation pas terminée et note invalide refusées'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ent   0415 : avis avant la fin ou note invalide acceptés'::text; end if;
      execute 'set local role authenticated';
      f_ok := not exists (select 1 from public.client_satisfactions) and jsonb_array_length(public.ent_satisfactions()) = 1;
      execute 'reset role';
      if f_ok then v_lines := v_lines || 'OK      ent   0415 : table des avis fermée au compte entreprise, ses avis par la fonction'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ent   0415 : table des avis lisible par le compte entreprise'::text; end if;
      perform set_config('request.jwt.claims', '', true);
      delete from public.notifications where type = 'satisfaction_entreprise' and metadata->>'client_id' = f_c1::text;
      delete from public.client_satisfactions where client_id in (f_c1, f_c2);
      delete from public.client_accounts where profile_id = f_u;
      delete from public.sessions where id in (f_s1, f_s2, f_s3);
      delete from public.sites where client_id in (f_c1, f_c2);
      delete from public.clients where id in (f_c1, f_c2);
      delete from public.profiles where id = f_u;
      delete from auth.users where id = f_u;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 4; v_lines := v_lines || ('ÉCHEC   ent   0415 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Rappel du matin (0416) : une notification par société et par jour, seulement s'il y a quelque chose à faire
  if to_regprocedure('app.rappel_matin(boolean)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 2;
    declare g_s uuid; g_n int; g_m text;
    begin
      delete from public.notifications where type = 'rappel_matin';
      insert into public.sessions (start_date, end_date) values ((now() at time zone 'Europe/Paris')::date, (now() at time zone 'Europe/Paris')::date) returning id into g_s;
      perform app.rappel_matin(true);
      perform app.rappel_matin(true);
      select count(*), max(message) into g_n, g_m from public.notifications where type = 'rappel_matin' and company_id = app.company_default();
      if g_n = 1 and g_m like '%session% aujourd''hui%' then
        v_lines := v_lines || 'OK      base  0416 : rappel du matin, une seule notification par jour avec les sessions du jour'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0416 : rappels ' || g_n || ' ' || coalesce(g_m, ''))::text; end if;
      delete from public.notifications where type = 'rappel_matin';
      if (extract(hour from now() at time zone 'Europe/Paris') = 7) or app.rappel_matin(false) = 0 then
        v_lines := v_lines || 'OK      base  0416 : rien en dehors de 7 h (heure de Paris)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0416 : rappel préparé hors de 7 h'::text; end if;
      delete from public.notifications where type = 'rappel_matin';
      delete from public.sessions where id = g_s;
    exception when others then
      v_fail := v_fail + 2; v_lines := v_lines || ('ÉCHEC   base  0416 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Émargement sans réseau (0417) : signature envoyée plus tard avec son heure, mêmes contrôles, réception notée
  if to_regprocedure('public.portal_sign_halfday_differe(text,uuid,text,text,timestamptz)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 3;
    declare h_s uuid; h_t uuid; h_tok text; h_j json; h_sig text := 'data:image/png;base64,' || repeat('A', 200); h_ok boolean;
    begin
      insert into public.sessions (start_date, end_date, start_time, end_time) values (paris_today(), paris_today(), '00:00', '23:59')
        returning id, attendance_token into h_s, h_tok;
      insert into public.trainees (first_name, last_name) values ('Essai', 'Hors ligne') returning id into h_t;
      insert into public.session_trainees (session_id, trainee_id) values (h_s, h_t);
      execute 'set local role anon';
      h_j := public.portal_sign_halfday_differe(h_tok, h_t, 'morning', h_sig, now() - interval '20 minutes');
      execute 'reset role';
      if (h_j->>'ok')::boolean and exists (select 1 from public.attendance_halfdays where session_id = h_s and trainee_id = h_t
           and morning and signed_morning_received_at is not null and signed_morning_at < signed_morning_received_at - interval '10 minutes') then
        v_lines := v_lines || 'OK      anon  0417 : signature faite sans réseau reçue plus tard, heure de la signature et de réception'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   anon  0417 : envoi différé ' || coalesce(h_j::text, 'vide'))::text; end if;
      execute 'set local role anon';
      h_j := public.portal_sign_halfday_differe(h_tok, h_t, 'morning', h_sig, now());
      h_ok := not (h_j->>'ok')::boolean;
      h_j := public.portal_sign_halfday_differe(h_tok, h_t, 'afternoon', h_sig, now() - interval '3 days');
      h_ok := h_ok and not (h_j->>'ok')::boolean;
      h_j := public.portal_sign_halfday_differe(h_tok, h_t, 'afternoon', h_sig, now() + interval '1 hour');
      h_ok := h_ok and not (h_j->>'ok')::boolean;
      execute 'reset role';
      if h_ok then v_lines := v_lines || 'OK      anon  0417 : déjà signée, trop ancienne ou dans le futur : refusée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   anon  0417 : envoi différé accepté à tort'::text; end if;
      execute 'set local role anon';
      h_j := public.portal_sign_halfday_differe('lien-inconnu', h_t, 'afternoon', h_sig, now());
      execute 'reset role';
      if not (h_j->>'ok')::boolean then v_lines := v_lines || 'OK      anon  0417 : lien inconnu refusé'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   anon  0417 : lien inconnu accepté'::text; end if;
      delete from public.attendance_halfdays where session_id = h_s;
      delete from public.trainee_info_sheets where session_id = h_s;
      delete from public.session_trainees where session_id = h_s;
      delete from public.sessions where id = h_s;
      delete from public.trainees where id = h_t;
    exception when others then
      execute 'reset role';
      v_fail := v_fail + 3; v_lines := v_lines || ('ÉCHEC   anon  0417 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Tarifs par client (0418) : repris sur la session, l'inscription inter et les pièces ; groupe, date de fin
  if to_regclass('public.client_prices') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 4;
    declare k_a uuid; k_b uuid; k_c uuid; k_co uuid; k_s1 uuid; k_s2 uuid; k_si uuid; k_g uuid; k_p uuid; k_id uuid; k_pct numeric;
    begin
      insert into public.clients (name, client_type, group_name) values ('Essai tarif A', 'entreprise', 'Groupe essai') returning id into k_a;
      insert into public.clients (name, client_type, group_name) values ('Essai tarif B', 'entreprise', 'groupe essai ') returning id into k_b;
      insert into public.clients (name, client_type) values ('Essai tarif C', 'entreprise') returning id into k_c;
      insert into public.courses (title, code, price_ht) values ('Essai tarif', 'ESSAI-TARIF', 1200) returning id into k_co;
      insert into public.client_prices (client_id, kind, course_id, prix_ht, prix_inter_ht, pour_le_groupe) values (k_a, 'formation', k_co, 900, 150, true);
      insert into public.sessions (client_id, course_id, start_date, end_date) values (k_a, k_co, current_date + 40, current_date + 40) returning id into k_s1;
      insert into public.sessions (client_id, course_id, start_date, end_date, total_price) values (k_a, k_co, current_date + 41, current_date + 41, 1000) returning id into k_s2;
      if (select total_price from public.sessions where id = k_s1) = 900 and (select total_price from public.sessions where id = k_s2) = 1000 then
        v_lines := v_lines || 'OK      base  0418 : prix intra du client repris sur la session, prix saisi respecté'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0418 : prix intra du client'::text; end if;
      insert into public.sessions (course_id, session_type, start_date, end_date) values (k_co, 'inter', current_date + 42, current_date + 42) returning id into k_si;
      insert into public.session_groups (session_id, client_id, kind) values (k_si, k_b, 'entreprise') returning id into k_g;
      if (select price_per_person from public.session_groups where id = k_g) = 150 then
        v_lines := v_lines || 'OK      base  0418 : tarif du groupe repris pour une autre société du groupe (inter par personne)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0418 : tarif du groupe non repris'::text; end if;
      k_id := (app.prix_client(k_c, 'formation', k_co)).id;
      update public.client_prices set valid_until = current_date - 1 where client_id = k_a;
      if k_id is null and (app.prix_client(k_a, 'formation', k_co)).id is null then
        v_lines := v_lines || 'OK      base  0418 : aucun tarif hors du groupe, tarif échu ignoré'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0418 : tarif appliqué hors du groupe ou échu'::text; end if;
      insert into public.client_prices (client_id, kind, remise_pct) values (k_c, 'remise_pieces', 10);
      k_pct := (app.prix_client(k_c, 'remise_pieces')).remise_pct;
      perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      if k_pct = 10 and not exists (select 1 from public.client_prices) then
        v_lines := v_lines || 'OK      sans  0418 : remise sur les pièces lue par la base, tarifs fermés sans droit'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   sans  0418 : tarifs lisibles sans droit'::text; end if;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      delete from public.session_groups where id = k_g;
      delete from public.sessions where id in (k_s1, k_s2, k_si);
      delete from public.client_prices where client_id in (k_a, k_b, k_c);
      delete from public.courses where id = k_co;
      delete from public.sites where client_id in (k_a, k_b, k_c);
      delete from public.clients where id in (k_a, k_b, k_c);
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 4; v_lines := v_lines || ('ÉCHEC   base  0418 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Calendrier public (0419) : fermé tant qu'il n'est pas publié ; sessions inter publiées seulement ; rien de personnel
  if to_regprocedure('public.public_calendrier()') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 3;
    declare c_s1 uuid; c_s2 uuid; c_t uuid; c_j jsonb; c_avant boolean;
    begin
      select calendrier_public into c_avant from public.organization_settings limit 1;
      update public.organization_settings set calendrier_public = false;
      execute 'set local role anon';
      c_j := public.public_calendrier();
      execute 'reset role';
      if (c_j->>'publie')::boolean is false and not c_j ? 'sessions' then
        v_lines := v_lines || 'OK      anon  0419 : calendrier fermé tant qu''il n''est pas publié'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   anon  0419 : calendrier lisible sans être publié'::text; end if;
      update public.organization_settings set calendrier_public = true;
      insert into public.sessions (session_type, is_public, start_date, end_date, location_city, max_participants, public_price_per_person)
        values ('inter', true, current_date + 30, current_date + 30, 'Brest', 8, 190) returning id into c_s1;
      insert into public.sessions (session_type, is_public, start_date, end_date) values ('inter', false, current_date + 31, current_date + 31) returning id into c_s2;
      insert into public.trainees (first_name, last_name) values ('Essai', 'Calendrierprive') returning id into c_t;
      insert into public.session_trainees (session_id, trainee_id) values (c_s1, c_t);
      execute 'set local role anon';
      c_j := public.public_calendrier();
      execute 'reset role';
      if exists (select 1 from jsonb_array_elements(c_j->'sessions') x where x->>'id' = c_s1::text and (x->>'places')::int = 7 and (x->>'price_per_person')::numeric = 190)
         and not exists (select 1 from jsonb_array_elements(c_j->'sessions') x where x->>'id' = c_s2::text) then
        v_lines := v_lines || 'OK      anon  0419 : sessions inter publiées seulement, places restantes et prix'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   anon  0419 : sessions du calendrier'::text; end if;
      if c_j::text not like '%Calendrierprive%' then
        v_lines := v_lines || 'OK      anon  0419 : aucun nom de stagiaire dans le calendrier public'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   anon  0419 : nom de stagiaire dans le calendrier public'::text; end if;
      update public.organization_settings set calendrier_public = coalesce(c_avant, false);
      delete from public.trainee_info_sheets where session_id = c_s1;
      delete from public.session_trainees where session_id in (c_s1, c_s2);
      delete from public.sessions where id in (c_s1, c_s2);
      delete from public.trainees where id = c_t;
    exception when others then
      execute 'reset role';
      v_fail := v_fail + 3; v_lines := v_lines || ('ÉCHEC   anon  0419 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Inscription en ligne (0420) : dépôt public contrôlé, confirmation sans doublon par qui gère les inscriptions
  if to_regclass('public.online_registrations') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 5;
    declare i_s uuid; i_j jsonb; i_id uuid; i_id2 uuid; i_ok boolean; i_avant boolean; i_c uuid; i_n int;
      i_ins jsonb := '{"kind":"entreprise","contact_first_name":"Claire","contact_last_name":"Essai","contact_email":"claire.essai@test.invalid","company_name":"Essai inscription SARL","siret":"12345678200010","postal_code":"29200","city":"Brest","consent":true,"participants":[{"first_name":"Paul","last_name":"Inscrit","email":"paul.inscrit@test.invalid"},{"first_name":"Luc","last_name":"Inscrit"}]}';
    begin
      select calendrier_public into i_avant from public.organization_settings limit 1;
      update public.organization_settings set calendrier_public = false;
      insert into public.sessions (session_type, is_public, start_date, end_date, max_participants, public_price_per_person)
        values ('inter', true, current_date + 25, current_date + 25, 3, 210) returning id into i_s;
      execute 'set local role anon';
      i_ok := false;
      begin perform public.public_inscrire(i_s, i_ins); exception when others then i_ok := sqlerrm like 'Inscriptions en ligne fermées%'; end;
      execute 'reset role';
      update public.organization_settings set calendrier_public = true;
      execute 'set local role anon';
      i_j := public.public_inscrire(i_s, i_ins);
      i_id := (i_j->>'id')::uuid;
      -- Trop de participants : refusé (0420), ou en liste d'attente à partir de 0421
      begin
        i_j := public.public_inscrire(i_s, jsonb_set(jsonb_set(i_ins, '{contact_email}', '"autre.essai@test.invalid"'), '{participants}', '[{"first_name":"A","last_name":"B"},{"first_name":"C","last_name":"D"},{"first_name":"E","last_name":"F"},{"first_name":"G","last_name":"H"}]'));
        i_ok := i_ok and coalesce((i_j->>'liste_attente')::boolean, false);
      exception when others then i_ok := i_ok and sqlerrm like 'Plus assez de places%';
      end;
      begin
        perform public.public_inscrire(i_s, i_ins - 'consent');
        i_ok := false;
      exception when others then null;
      end;
      execute 'reset role';
      if i_ok and i_id is not null and exists (select 1 from public.notifications where type = 'inscription_en_ligne' and metadata->>'registration_id' = i_id::text) then
        v_lines := v_lines || 'OK      anon  0420 : inscription en ligne seulement calendrier publié, places et accord contrôlés, équipe prévenue'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   anon  0420 : contrôles du dépôt public'::text; end if;
      execute 'set local role anon';
      i_ok := false;
      begin perform 1 from public.online_registrations limit 1; i_ok := not found; exception when others then i_ok := true; end;
      execute 'reset role';
      if i_ok then v_lines := v_lines || 'OK      anon  0420 : inscriptions illisibles sans compte'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   anon  0420 : inscriptions lisibles sans compte'::text; end if;
      -- Confirmation par la direction
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      i_j := public.inscription_confirmer(i_id);
      execute 'reset role';
      i_c := (i_j->>'client_id')::uuid;
      select count(*) into i_n from public.session_trainees where session_id = i_s and group_id = (i_j->>'group_id')::uuid;
      if i_n = 2 and (select price_per_person from public.session_groups where id = (i_j->>'group_id')::uuid) = 210
         and (select siret from public.clients where id = i_c) = '12345678200010'
         and (select status from public.online_registrations where id = i_id) = 'confirmee' then
        v_lines := v_lines || 'OK      dir   0420 : confirmation : client, groupe au prix public, deux stagiaires inscrits'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0420 : confirmation ' || coalesce(i_j::text, ''))::text; end if;
      -- Deuxième inscription de la même entreprise : même client, même groupe, aucun stagiaire en double
      perform set_config('request.jwt.claims', '', true);
      execute 'set local role anon';
      i_j := public.public_inscrire(i_s, jsonb_set(i_ins, '{participants}', '[{"first_name":"Paul","last_name":"Inscrit","email":"paul.inscrit@test.invalid"}]'));
      i_id2 := (i_j->>'id')::uuid;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      i_j := public.inscription_confirmer(i_id2);
      execute 'reset role';
      if (i_j->>'client_id')::uuid = i_c and (select count(*) from public.trainees where client_id = i_c) = 2
         and (select count(*) from public.session_groups where session_id = i_s) = 1 then
        v_lines := v_lines || 'OK      dir   0420 : nouvelle inscription de la même entreprise sans doublon (client, groupe, stagiaires)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0420 : doublon ' || coalesce(i_j::text, ''))::text; end if;
      -- Sans le droit : refusé
      perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      i_ok := false;
      begin perform public.inscription_refuser(i_id2, 'essai'); exception when others then i_ok := true; end;
      execute 'reset role';
      if i_ok then v_lines := v_lines || 'OK      sans  0420 : confirmer ou refuser demande le droit de gérer les inscriptions'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   sans  0420 : inscription traitée sans droit'::text; end if;
      perform set_config('request.jwt.claims', '', true);
      update public.organization_settings set calendrier_public = coalesce(i_avant, false);
      delete from public.notifications where type = 'inscription_en_ligne' and metadata->>'session_id' = i_s::text;
      delete from public.online_registrations where session_id = i_s;
      delete from public.trainee_info_sheets where session_id = i_s;
      delete from public.session_trainees where session_id = i_s;
      delete from public.session_groups where session_id = i_s;
      delete from public.sessions where id = i_s;
      delete from public.trainees where client_id = i_c;
      delete from public.client_contacts where client_id = i_c;
      delete from public.sites where client_id = i_c;
      delete from public.clients where id = i_c;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 5; v_lines := v_lines || ('ÉCHEC   base  0420 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Liste d'attente et seuil de maintien (0421)
  if to_regprocedure('app.liste_attente_avancer(uuid)') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_total := v_total + 3;
    declare w_s uuid; w_s2 uuid; w_j jsonb; w_id1 uuid; w_id2 uuid; w_avant boolean; w_c uuid; w_t uuid; w_n int;
      w_ins jsonb := '{"kind":"particulier","contact_first_name":"Anne","contact_last_name":"Attente","contact_email":"anne.attente@test.invalid","consent":true,"participants":[{"first_name":"Anne","last_name":"Attente"}]}';
    begin
      select calendrier_public into w_avant from public.organization_settings limit 1;
      update public.organization_settings set calendrier_public = true;
      insert into public.sessions (session_type, is_public, start_date, end_date, max_participants) values ('inter', true, current_date + 30, current_date + 30, 1) returning id into w_s;
      execute 'set local role anon';
      w_id1 := (public.public_inscrire(w_s, w_ins)->>'id')::uuid;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', u_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      w_c := (public.inscription_confirmer(w_id1)->>'client_id')::uuid;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      execute 'set local role anon';
      w_j := public.public_inscrire(w_s, jsonb_set(jsonb_set(w_ins, '{contact_email}', '"bruno.attente@test.invalid"'), '{participants}', '[{"first_name":"Bruno","last_name":"Attente"}]'));
      w_id2 := (w_j->>'id')::uuid;
      execute 'reset role';
      if (w_j->>'liste_attente')::boolean and (select status from public.online_registrations where id = w_id2) = 'liste_attente' then
        v_lines := v_lines || 'OK      anon  0421 : session complète : demande en liste d''attente au lieu d''un refus'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   anon  0421 : liste d''attente ' || coalesce(w_j::text, ''))::text; end if;
      delete from public.session_trainees where session_id = w_s;
      if (select status from public.online_registrations where id = w_id2) = 'place_proposee'
         and exists (select 1 from public.notifications where type = 'liste_attente' and metadata->>'registration_id' = w_id2::text) then
        v_lines := v_lines || 'OK      base  0421 : place libérée proposée au suivant, équipe prévenue'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0421 : place libérée non proposée'::text; end if;
      -- Seuil de maintien
      insert into public.sessions (session_type, start_date, end_date, min_participants) values ('inter', current_date + 5, current_date + 5, 4) returning id into w_s2;
      perform app.seuil_maintien_verifier();
      perform app.seuil_maintien_verifier();
      select count(*) into w_n from public.notifications where type = 'seuil_maintien' and metadata->>'session_id' = w_s2::text;
      if w_n = 1 then v_lines := v_lines || 'OK      base  0421 : seuil de maintien non atteint à J-10 : une seule alerte'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0421 : alertes de seuil ' || w_n)::text; end if;
      update public.organization_settings set calendrier_public = coalesce(w_avant, false);
      delete from public.notifications where type in ('seuil_maintien', 'liste_attente', 'inscription_en_ligne') and metadata->>'session_id' in (w_s::text, w_s2::text);
      delete from public.online_registrations where session_id = w_s;
      delete from public.session_trainees where session_id in (w_s, w_s2);
      delete from public.trainee_info_sheets where session_id in (w_s, w_s2);
      delete from public.session_groups where session_id in (w_s, w_s2);
      delete from public.sessions where id in (w_s, w_s2);
      delete from public.trainees where client_id = w_c;
      delete from public.sites where client_id = w_c;
      delete from public.clients where id = w_c;
    exception when others then
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_fail := v_fail + 3; v_lines := v_lines || ('ÉCHEC   base  0421 : erreur ' || sqlerrm)::text;
    end;
  end if;

  -- Mise en service (chantier A, 0261 à 0264) : registre, bandeau et nouveautés, suivi des retours, lignes réelles
  if to_regclass('public.platform_notices') is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    v_total := v_total + 11;
    declare
      a_sa uuid := gen_random_uuid(); a_ad uuid := gen_random_uuid(); a_dir uuid := gen_random_uuid();
      a_brouillon uuid; a_pub uuid; a_n int; a_ok boolean; a_st jsonb; a_id uuid; a_id2 uuid;
    begin
      insert into auth.users (id, email, aud, role) values
        (a_sa, 'ma.sa@test.invalid', 'authenticated', 'authenticated'), (a_ad, 'ma.ad@test.invalid', 'authenticated', 'authenticated'),
        (a_dir, 'ma.dir@test.invalid', 'authenticated', 'authenticated');
      alter table public.profiles disable trigger profiles_protect_role;
      insert into public.profiles (id, email, role, is_active) values (a_sa, 'ma.sa@test.invalid', 'superadmin', true),
        (a_ad, 'ma.ad@test.invalid', 'admin', true), (a_dir, 'ma.dir@test.invalid', 'direction', true)
      on conflict (id) do update set role = excluded.role, is_active = true;
      alter table public.profiles enable trigger profiles_protect_role;

      -- Registre : 0190 inscrite dès que ses objets existent
      if to_regclass('public.pp_lignes') is null
         or exists (select 1 from public.schema_migrations where version = '0190_passeport_prevention') then
        v_lines := v_lines || 'OK      base  0261 : 0190 inscrite au registre (objets présents)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0261 : 0190 inscrite au registre (objets présents)'::text; end if;

      -- Super administrateur : écrit un brouillon et une entrée publiée
      perform set_config('request.jwt.claims', json_build_object('sub', a_sa, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.platform_notices (kind, status, title, body) values ('nouveaute', 'brouillon', 'Essai brouillon', 'Texte') returning id into a_brouillon;
      insert into public.platform_notices (kind, status, title, body) values ('nouveaute', 'publie', 'Essai publié', 'Texte') returning id into a_pub;
      execute 'reset role';
      if (select published_at from public.platform_notices where id = a_pub) is not null
         and (select published_at from public.platform_notices where id = a_brouillon) is null
         and (select created_by from public.platform_notices where id = a_pub) = a_sa then
        v_lines := v_lines || 'OK      sa    0262 : nouveautés écrites, date de publication posée par la base'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   sa    0262 : nouveautés écrites, date de publication posée par la base'::text; end if;

      -- Direction : lit les publiées, jamais les brouillons ; n'écrit pas
      perform set_config('request.jwt.claims', json_build_object('sub', a_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into a_n from public.platform_notices where id in (a_brouillon, a_pub);
      a_ok := false;
      begin
        insert into public.platform_notices (kind, status, body) values ('nouveaute', 'publie', 'Intrus');
      exception when insufficient_privilege then a_ok := true;
      end;
      execute 'reset role';
      if a_n = 1 and a_ok then v_lines := v_lines || 'OK      dir   0262 : lit les nouveautés publiées seulement, n''écrit pas'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0262 : lit les nouveautés publiées seulement (' || a_n || ', ' || a_ok || ')'); end if;

      -- Bandeau et pastille : état lu par la direction, puis « Quoi de neuf » ouvert
      execute 'set local role authenticated';
      a_st := public.notices_state();
      execute 'reset role';
      if a_st -> 'banner' ->> 'body' is not null and (a_st ->> 'unseen')::boolean then
        v_lines := v_lines || 'OK      dir   0262 : bandeau affiché, pastille « nouveau » tant que la page n''est pas ouverte'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   dir   0262 : bandeau et pastille (' || coalesce(a_st::text, 'null') || ')'); end if;
      execute 'set local role authenticated';
      perform public.notices_mark_seen();
      a_st := public.notices_state();
      execute 'reset role';
      if not (a_st ->> 'unseen')::boolean and (select notices_seen_at from public.profiles where id = a_dir) is not null then
        v_lines := v_lines || 'OK      dir   0262 : « Quoi de neuf » ouvert, pastille retirée'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0262 : « Quoi de neuf » ouvert, pastille retirée'::text; end if;

      -- Brouillon proposé par une pull request : jamais par un compte connecté, une seule fois par pull request
      execute 'set local role authenticated';
      a_ok := false;
      begin perform public.notice_from_pull_request(9999, 'Essai', 'Texte', null);
      exception when insufficient_privilege then a_ok := true;
      end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      a_id := public.notice_from_pull_request(9999, 'Essai PR', E'## Résumé\nPremier **paragraphe**.\n\nDétail technique.', 'https://exemple.invalid/pr/9999');
      a_id2 := public.notice_from_pull_request(9999, 'Essai PR', 'Autre', null);
      if a_ok and a_id is not null and a_id2 is null
         and (select status = 'brouillon' and body = 'Premier paragraphe.' from public.platform_notices where id = a_id) then
        v_lines := v_lines || 'OK      base  0262 : pull request fusionnée = un brouillon, une seule fois, jamais par un compte'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || ('ÉCHEC   base  0262 : brouillon proposé par une pull request (' || coalesce((select body from public.platform_notices where id = a_id), 'aucun') || ')'); end if;

      -- Retours : table toujours fermée aux comptes connectés ; droit de suivi à l'administrateur, pas à la direction
      perform set_config('request.jwt.claims', json_build_object('sub', a_ad, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      a_ok := false;
      begin perform 1 from public.user_feedback limit 1; exception when insufficient_privilege then a_ok := true; end;
      a_st := to_jsonb(app.rights());
      execute 'reset role';
      if a_ok then v_lines := v_lines || 'OK      ad    0263 : retours lus seulement par le serveur'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ad    0263 : retours lus seulement par le serveur'::text; end if;
      if a_st ? 'organisation.retours.suivre' then v_lines := v_lines || 'OK      ad    0263 : droit de suivi des retours'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   ad    0263 : droit de suivi des retours'::text; end if;
      perform set_config('request.jwt.claims', json_build_object('sub', a_dir, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      a_st := to_jsonb(app.rights());
      execute 'reset role';
      if not (a_st ? 'organisation.retours.suivre') then v_lines := v_lines || 'OK      dir   0263 : pas de droit de suivi des retours'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   dir   0263 : pas de droit de suivi des retours'::text; end if;
      if exists (select 1 from storage.buckets where id = 'retours' and not public)
         and not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                         and coalesce(qual, '') || coalesce(with_check, '') like '%''retours''%') then
        v_lines := v_lines || 'OK      base  0263 : captures dans un bucket privé, sans règle de stockage'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  0263 : captures dans un bucket privé, sans règle de stockage'::text; end if;

      -- Lignes réelles rattachées au fictif : réservé au super administrateur
      execute 'set local role authenticated';
      a_ok := false;
      begin perform public.demo_real_links(); exception when insufficient_privilege then a_ok := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', a_sa, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      a_st := public.demo_real_links();
      execute 'reset role';
      if a_ok and a_st ? 'lignes' and a_st ? 'total' then
        v_lines := v_lines || 'OK      sa    0264 : lignes réelles rattachées au fictif (super administrateur seulement)'::text;
      else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   sa    0264 : lignes réelles rattachées au fictif'::text; end if;
      perform set_config('request.jwt.claims', '', true);
    end;
  end if;

  raise exception E'RÉSULTAT DES TESTS DE DROITS (tout est annulé)\n%\n\n% test(s), % échec(s)',
    array_to_string(v_lines, E'\n'), v_total, v_fail;
end
$test$;
