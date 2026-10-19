-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c1_0376) : ne pas modifier à la main.
-- Essai en transaction annulée : 0376_maintenance_nuit.sql, puis tous les tests de droits. Se termine TOUJOURS par
-- l'erreur volontaire « RÉSULTAT DES TESTS DE DROITS » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0376_maintenance_nuit.sql =====
-- 0376_maintenance_nuit.sql : écritures automatiques de la nuit (chantier 1, branche ecrans/maintenance-nuit).
--
-- Avant : le tableau de bord, les Indicateurs et la page Factures écrivaient en base à leur ouverture, pour le
-- compte connecté (sessions passées « terminées », rappels du jour, alertes qualité, factures « dues » ou « en
-- retard »). Pour les comptes Lecture, Formateur ou Comptable externe, ces écritures étaient refusées par la base.
-- Après : une seule fonction de la base, public.daily_maintenance(), lancée chaque nuit par la tâche planifiée
-- (api/maintenance-nuit.js), fait ces écritures. Les pages ne les font plus.
--
-- Idempotente : relancée le même jour, elle ne refait rien. Dates à l'heure de Paris.
-- Exécution réservée à service_role (tâche planifiée) : ni anon ni authenticated.
-- Aucune nouvelle table. Retour arrière : supabase/rollback/0376_maintenance_nuit_retour.sql

create or replace function public.daily_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_dow int := extract(isodow from v_today)::int; -- 1 = lundi, 6 = samedi
  v_debut timestamptz := (v_today::timestamp at time zone 'Europe/Paris');
  v_sessions int := 0;
  v_notifs int := 0;
  v_alertes int := 0;
  v_retard int := 0;
  v_dues int := 0;
  v_cert int := 0;
  n record;
begin
  -- 1. Sessions passées : « terminée » le lendemain de la fin (sauf statut verrouillé)
  update public.sessions s
     set status = 'completed', updated_at = now()
   where s.status is distinct from 'completed'
     and coalesce(s.status_locked, false) = false
     and s.end_date is not null
     and s.end_date < v_today;
  get diagnostics v_sessions = row_count;

  -- 2. Rappels du jour (une notification par type et par jour)
  for n in
    select * from (values
      (v_dow = 1, 'veille', 'Veille réglementaire à réaliser', 'Rappel hebdomadaire', '/veille-qualiopi'),
      (v_dow = 6, 'materiel', 'Vérification matériel', 'Rappel hebdomadaire', '/parametres'),
      (extract(day from v_today) = 1 and extract(month from v_today) = 7, 'audit', 'Audit interne annuel',
       'Planifiez votre audit', '/qualiopi'),
      (extract(day from v_today) = 1 and extract(month from v_today) = 8, 'revue_direction', 'Revue de direction',
       'Revue annuelle à réaliser', '/qualiopi')
    ) as r(actif, type, title, message, link)
    where r.actif
  loop
    if not exists (select 1 from public.notifications where type = n.type and created_at >= v_debut) then
      insert into public.notifications (type, title, message, link) values (n.type, n.title, n.message, n.link);
      v_notifs := v_notifs + 1;
    end if;
  end loop;

  -- Échéances de certification (NDA, audits, BPF) : fonction existante, une fois par seuil
  if to_regprocedure('public.cert_daily_notifications()') is not null then
    v_cert := public.cert_daily_notifications();
  end if;

  -- 3. Alertes qualité : notes de 1 à 3 dans les évaluations à chaud, une alerte par stagiaire, session et critère
  insert into public.quality_alerts (session_id, trainee_id, criterion_key, criterion_label, score, status)
  select e.session_id, e.trainee_id, c.cle, c.libelle, c.note, 'pending'
  from public.trainee_evaluations e
  cross join lateral (values
    ('q_org_documents', 'Communication des documents', e.q_org_documents),
    ('q_org_accueil', 'Accueil sur le lieu', e.q_org_accueil),
    ('q_org_locaux', 'Qualité des locaux', e.q_org_locaux),
    ('q_org_materiel', 'Adéquation des moyens matériels', e.q_org_materiel),
    ('q_contenu_organisation', 'Organisation et déroulement', e.q_contenu_organisation),
    ('q_contenu_supports', 'Qualité des supports pédagogiques', e.q_contenu_supports),
    ('q_contenu_duree', 'Durée de la formation', e.q_contenu_duree),
    ('q_contenu_programme', 'Respect du programme', e.q_contenu_programme),
    ('q_formateur_pedagogie', 'Pédagogie du formateur', e.q_formateur_pedagogie),
    ('q_formateur_expertise', 'Expertise du formateur', e.q_formateur_expertise),
    ('q_formateur_progression', 'Progression de la formation', e.q_formateur_progression),
    ('q_formateur_moyens', 'Moyens mis à disposition', e.q_formateur_moyens),
    ('q_global_adequation', 'Adéquation formation/métier', e.q_global_adequation),
    ('q_global_competences', 'Amélioration des connaissances', e.q_global_competences)
  ) as c(cle, libelle, note)
  where e.session_id is not null and e.trainee_id is not null
    and c.note between 1 and 3
    and not exists (select 1 from public.quality_alerts a
                    where a.session_id = e.session_id and a.trainee_id = e.trainee_id and a.criterion_key = c.cle);
  get diagnostics v_alertes = row_count;

  -- 4. Factures envoyées : « en retard » après l'échéance, « due » avant (avoirs exclus ; une facture due
  --    aujourd'hui n'est pas en retard)
  update public.invoices
     set status = 'overdue', updated_at = now()
   where coalesce(type, 'invoice') <> 'credit_note'
     and status in ('sent', 'due')
     and due_date is not null and due_date < v_today;
  get diagnostics v_retard = row_count;

  update public.invoices
     set status = 'due', updated_at = now()
   where coalesce(type, 'invoice') <> 'credit_note'
     and status = 'sent'
     and (due_date is null or due_date >= v_today);
  get diagnostics v_dues = row_count;

  return jsonb_build_object('jour', v_today, 'sessions_terminees', v_sessions, 'rappels', v_notifs,
                            'echeances_certification', v_cert, 'alertes_qualite', v_alertes,
                            'factures_en_retard', v_retard, 'factures_dues', v_dues);
end
$$;

revoke all on function public.daily_maintenance() from public, anon, authenticated;
grant execute on function public.daily_maintenance() to service_role;

insert into public.schema_migrations (version) values ('0376_maintenance_nuit') on conflict (version) do nothing;

-- ===== supabase/tests/droits_chantier2.sql =====
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
      -- Budget (module désactivé sur odet-gld : seul le super administrateur lit)
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
      ('ent', 'ne lit pas les comptes', 'select count(*) from public.profiles', 'vide'),
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
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'pp\_%'
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
      delete from public.support_access_grants where company_id in (c_a, c_b);
      delete from public.company_modules where company_id in (c_a, c_b);
      delete from public.company_members where company_id in (c_a, c_b);
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
      delete from public.company_members where company_id in (c_x, c_y);
      delete from public.companies where id in (c_x, c_y);
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

  raise exception E'RÉSULTAT DES TESTS DE DROITS (tout est annulé)\n%\n\n% test(s), % échec(s)',
    array_to_string(v_lines, E'\n'), v_total, v_fail;
end
$test$;
