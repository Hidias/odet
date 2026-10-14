-- FICHIER GÉNÉRÉ par scripts/securite/essai.py : ne pas modifier à la main.
-- Essai du chantier 2 en transaction annulée : migrations 0080 à 0086, puis tests de droits.
-- Le script se termine TOUJOURS par une erreur volontaire « RÉSULTAT DES TESTS DE DROITS » :
-- tout est annulé, rien n'est enregistré. Il ne contient aucune validation de transaction.

-- Pas de BEGIN : l'éditeur envoie le texte en un seul message, exécuté dans une seule transaction implicite ;
-- l'erreur finale l'annule entièrement et la connexion reste propre.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '180s', true);

-- ===== 0080_securite_urgences.sql =====
-- 0080_securite_urgences.sql : défauts graves relevés le 14/10/2026 (chantier 2, sécurité des accès).
-- 1. Les tâches planifiées (cron_call_vercel et les fonctions *_tick) n'étaient pas réservées au
--    planificateur : tout compte connecté pouvait les appeler et faire partir le secret des tâches
--    vers une adresse de son choix. Elles ne sont plus exécutables que par le planificateur (postgres)
--    et le serveur (service_role), et l'adresse appelée est contrôlée.
-- 2. La table des clés de chiffrement était lisible et modifiable par tout compte connecté.
-- 3. Le déchiffrement du numéro de sécurité sociale n'est plus appelable directement.
-- 4. Les droits TRUNCATE, TRIGGER et REFERENCES des rôles de l'API sont retirés (aucun usage).
-- 5. Les rôles des futurs comptes externes (entreprise, formateur externe, stagiaire) sont admis
--    par la contrainte de profiles. Aucun écran ne permet encore de les attribuer.
-- 0. Avant toute modification, l'état des droits est photographié dans app.etat_avant_chantier2
--    (règles d'accès, définitions et droits des fonctions, droits sur les tables, buckets). Les scripts
--    de retour arrière (supabase/rollback/) le relisent pour tout remettre exactement comme avant.
-- Migration idempotente. Retour arrière : supabase/rollback/0080-0086_securite_retour.sql (les sept migrations ensemble)

-- 0. Photographie de l'état avant le chantier 2 (une seule fois) --------------------------------------

create schema if not exists app;
revoke all on schema app from public;

create table if not exists app.etat_avant_chantier2 (
  id bigserial primary key,
  kind text not null,          -- policy, function, function_acl, table_acl, bucket, view
  name text not null,
  definition text not null,
  taken_at timestamptz not null default now()
);
revoke all on table app.etat_avant_chantier2 from public, anon, authenticated;

do $$
begin
  if exists (select 1 from app.etat_avant_chantier2) then
    return;
  end if;

  insert into app.etat_avant_chantier2 (kind, name, definition)
  select 'policy', schemaname || '.' || tablename || '.' || policyname,
         format('create policy %I on %I.%I as %s for %s to %s%s%s;',
           policyname, schemaname, tablename, permissive, cmd,
           (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') from unnest(roles) r),
           case when qual is not null then ' using (' || qual || ')' else '' end,
           case when with_check is not null then ' with check (' || with_check || ')' else '' end)
  from pg_policies where schemaname in ('public', 'storage');

  insert into app.etat_avant_chantier2 (kind, name, definition)
  select 'function', p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');

  insert into app.etat_avant_chantier2 (kind, name, definition)
  select 'function_acl', p.oid::regprocedure::text,
         coalesce((select string_agg(case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end, ',')
                   from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.privilege_type = 'EXECUTE'), '')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');

  insert into app.etat_avant_chantier2 (kind, name, definition)
  select 'table_acl', table_name || '|' || grantee, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
  group by table_name, grantee;

  insert into app.etat_avant_chantier2 (kind, name, definition)
  select 'bucket', id, public::text from storage.buckets;

  insert into app.etat_avant_chantier2 (kind, name, definition)
  select 'view', c.relname, pg_get_viewdef(c.oid)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('trainees_safe', 'v_trainee_session_complete');

  insert into app.etat_avant_chantier2 (kind, name, definition)
  select 'profiles_role_check', 'profiles_role_check', pg_get_constraintdef(oid)
  from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_role_check';
end $$;

-- 1. Tâches planifiées -----------------------------------------------------------------------

create or replace function public.cron_call_vercel(p_path text)
returns bigint
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_secret text;
  v_url text;
  v_id bigint;
begin
  -- Seules les routes de l'API de l'application peuvent être appelées
  if p_path is null or p_path !~ '^/api/[a-z0-9/_-]+(\?[a-zA-Z0-9_=&%.-]*)?$' then
    raise exception 'Chemin refusé' using errcode = '42501';
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_secret is null then
    raise exception 'Clé cron_secret absente du coffre-fort Supabase';
  end if;

  select rtrim(decrypted_secret, '/') into v_url from vault.decrypted_secrets where name = 'app_url';
  if v_url is null or v_url = '' then
    raise exception 'Adresse de l''application (app_url) absente du coffre-fort Supabase';
  end if;

  select net.http_get(
    url := v_url || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 60000
  ) into v_id;

  return v_id;
end;
$function$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('cron_call_vercel', 'mailing_tick', 'signature_tick', 'signature_weekly_tick', 'social_tick')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to postgres, service_role', r.sig);
  end loop;
end $$;

-- 2. Clés de chiffrement ------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = '_encryption_keys'
  loop
    execute format('drop policy %I on public._encryption_keys', r.policyname);
  end loop;
end $$;
alter table public._encryption_keys enable row level security;
revoke all on table public._encryption_keys from public, anon, authenticated;
grant all on table public._encryption_keys to service_role;

-- 3. Déchiffrement du numéro de sécurité sociale -------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('decrypt_ssn', 'encrypt_ssn')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- 4. Droits sans usage sur les tables -------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
  loop
    execute format('revoke truncate, trigger, references on table public.%I from anon, authenticated', r.relname);
  end loop;
end $$;

alter default privileges for role postgres in schema public revoke truncate, trigger, references on tables from anon, authenticated;

-- 5. Rôles des comptes externes prévus -------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role = any (array[
  'superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture',
  'entreprise', 'formateur_externe', 'stagiaire'
]::text[]));

insert into public.schema_migrations (version) values ('0080_securite_urgences') on conflict (version) do nothing;

-- ===== 0081_securite_fonctions_aide.sql =====
-- 0081_securite_fonctions_aide.sql : fonctions d'aide utilisées par les règles d'accès (chantier 2).
-- Elles vivent dans le schéma app, non exposé par l'API : on ne peut pas les appeler comme des RPC.
-- Toutes sont stables et appelées dans les règles sous la forme (select app.xxx()) pour n'être
-- évaluées qu'une fois par requête, et non une fois par ligne.
--
-- Rôle effectif (app.role()) :
--   superadmin, admin, direction, gestionnaire, formateur, commercial, comptable, lecture
--   technicien  : compte « lecture » coché technicien actif, module Interventions actif
--                 (même règle que le mode terrain de l'application, fieldOnly)
--   entreprise, formateur_externe, stagiaire : comptes externes prévus (lot 2), aucun accès aux tables
--   null        : pas de profil, ou profil désactivé
-- Migration idempotente. Retour arrière : supabase/rollback/0080-0086_securite_retour.sql (les sept migrations ensemble)

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- Rôle effectif de l'utilisateur connecté
create or replace function app.role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.role = 'lecture'
     and exists (select 1 from public.itv_technicians t where t.profile_id = p.id and t.is_active)
     and exists (select 1 from public.org_modules m where m.key = 'interventions' and m.enabled)
    then 'technicien'
    else p.role
  end
  from public.profiles p
  where p.id = (select auth.uid()) and p.is_active
$$;

-- Module activé dans org_modules
create or replace function app.module_on(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select m.enabled from public.org_modules m where m.key = p_key), false)
$$;

-- Super administrateur actif
create or replace function app.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.role() = 'superadmin', false)
$$;

-- Personnel de l'organisme (comptes internes, technicien compris)
create or replace function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.role() = any (array[
    'superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture', 'technicien'
  ]), false)
$$;

-- Sessions dont l'utilisateur est le formateur (fiche formateur reliée au compte)
create or replace function app.trainer_session_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.sessions s
  join public.profiles p on p.id = (select auth.uid()) and p.is_active and p.trainer_id is not null
  where s.trainer_id = p.trainer_id
  union
  select st.session_id
  from public.session_trainers st
  join public.profiles p on p.id = (select auth.uid()) and p.is_active and p.trainer_id is not null
  where st.trainer_id = p.trainer_id
$$;

-- Stagiaires inscrits aux sessions du formateur
create or replace function app.trainer_trainee_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct st.trainee_id
  from public.session_trainees st
  where st.session_id in (select app.trainer_session_ids())
$$;

-- Visites attribuées au technicien
create or replace function app.tech_visit_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id from public.itv_visits v where v.technician_id = (select auth.uid())
$$;

-- Clients des visites du technicien
create or replace function app.tech_client_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct v.client_id from public.itv_visits v
  where v.technician_id = (select auth.uid()) and v.client_id is not null
$$;

-- Visites des clients du technicien (historique d'un client, toutes visites confondues)
create or replace function app.tech_scope_visit_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id from public.itv_visits v
  where v.client_id in (select app.tech_client_ids())
$$;

revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
alter default privileges for role postgres in schema app revoke execute on functions from public, anon;

-- Index utilisés par les règles
create index if not exists sessions_trainer_id_idx on public.sessions (trainer_id);
create index if not exists session_trainers_trainer_id_idx on public.session_trainers (trainer_id);
create index if not exists session_trainees_session_id_idx on public.session_trainees (session_id);
create index if not exists session_trainees_trainee_id_idx on public.session_trainees (trainee_id);
create index if not exists itv_visits_technician_id_idx on public.itv_visits (technician_id);
create index if not exists itv_visits_client_id_idx on public.itv_visits (client_id);
create index if not exists itv_equipment_client_id_idx on public.itv_equipment (client_id);
create index if not exists itv_visit_items_visit_id_idx on public.itv_visit_items (visit_id);
create index if not exists itv_visit_parts_visit_id_idx on public.itv_visit_parts (visit_id);
create index if not exists sites_client_id_idx on public.sites (client_id);
create index if not exists client_contacts_client_id_idx on public.client_contacts (client_id);
create index if not exists attendance_halfdays_session_id_idx on public.attendance_halfdays (session_id);
create index if not exists trainee_objectives_session_id_idx on public.trainee_objectives (session_id);
create index if not exists trainee_evaluations_session_id_idx on public.trainee_evaluations (session_id);
create index if not exists evaluations_cold_session_id_idx on public.evaluations_cold (session_id);
create index if not exists trainee_info_sheets_session_id_idx on public.trainee_info_sheets (session_id);
create index if not exists dashboard_widget_configs_user_id_idx on public.dashboard_widget_configs (user_id);
create index if not exists user_planning_events_user_id_idx on public.user_planning_events (user_id);
create index if not exists profiles_trainer_id_idx on public.profiles (trainer_id);

insert into public.schema_migrations (version) values ('0081_securite_fonctions_aide') on conflict (version) do nothing;

-- ===== 0082_securite_regles.sql =====
-- 0082_securite_regles.sql : règles d'accès par rôle, une règle par action et par table (chantier 2).
-- FICHIER GÉNÉRÉ par scripts/securite/regles.py à partir de la matrice validée le 14/10/2026.
-- Ne pas modifier à la main : modifier la matrice, relancer le script.
--
-- Principe :
--   * chaque table listée perd toutes ses règles et en reçoit au plus quatre (lire, créer, modifier, supprimer),
--     pour le rôle authenticated ; une action sans règle est interdite ;
--   * les rôles sont lus par app.role(), évaluée une fois par requête ;
--   * un module désactivé rend ses tables inaccessibles, sauf au super administrateur en lecture ;
--   * anon ne lit et n'écrit plus aucune table : les portails passent par des fonctions à jeton.
-- Migration idempotente. Retour arrière : supabase/rollback/0080-0086_securite_retour.sql (les sept migrations ensemble)

-- Groupes de rôles de la matrice : (select app.grp('mgr')) vaut vrai si le rôle effectif est dans le groupe.
create or replace function app.grp(p_group text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.role() = any (case p_group
    when 'adm' then array['admin', 'superadmin']
    when 'all' then array['admin', 'commercial', 'comptable', 'direction', 'formateur', 'gestionnaire', 'lecture', 'superadmin', 'technicien']
    when 'com_cpt' then array['commercial', 'comptable']
    when 'edit' then array['admin', 'commercial', 'direction', 'formateur', 'gestionnaire', 'superadmin']
    when 'edit_cpt' then array['admin', 'commercial', 'comptable', 'direction', 'formateur', 'gestionnaire', 'superadmin']
    when 'factu' then array['admin', 'commercial', 'comptable', 'direction', 'gestionnaire', 'superadmin']
    when 'fin' then array['admin', 'comptable', 'direction', 'superadmin']
    when 'int' then array['admin', 'commercial', 'comptable', 'direction', 'formateur', 'gestionnaire', 'lecture', 'superadmin']
    when 'itv_terrain' then array['admin', 'commercial', 'direction', 'formateur', 'gestionnaire', 'lecture', 'superadmin', 'technicien']
    when 'mgr' then array['admin', 'direction', 'gestionnaire', 'superadmin']
    when 'sa' then array['superadmin']
    when 'sales' then array['admin', 'commercial', 'direction', 'gestionnaire', 'superadmin']
    when 'sess_read' then array['admin', 'commercial', 'comptable', 'direction', 'gestionnaire', 'lecture', 'superadmin']
    when 'staff' then array['admin', 'commercial', 'direction', 'formateur', 'gestionnaire', 'lecture', 'superadmin']
    when 'suivi' then array['admin', 'commercial', 'direction', 'gestionnaire', 'lecture', 'superadmin']
    when 'validation' then array['admin', 'direction', 'superadmin']
    else array[]::text[] end), false)
$$;
revoke all on function app.grp(text) from public, anon;
grant execute on function app.grp(text) to authenticated, service_role;

-- Aucune table pour anon ; les nouvelles tables non plus
do $$
declare r record;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
  loop
    execute format('revoke all on table public.%I from anon', r.relname);
  end loop;
end $$;
alter default privileges for role postgres in schema public revoke all on tables from anon;

-- Suppression de toutes les règles existantes des tables couvertes par la matrice
do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename = any (array[
      'accounting_periods', 'app_versions', 'attendance_halfdays', 'attendance_proxy_signatures', 'attendances',
      'audit_logs', 'audits_internes', 'bank_statements', 'bpf_declarations', 'budget_actions', 'budget_categories',
      'budget_emails_sent', 'budget_meal_guests', 'budget_pipeline', 'budget_receipts', 'budget_rules', 'budget_settings',
      'budget_transaction_invoices', 'budget_transactions', 'call_arguments', 'call_objections', 'cert_audit_findings',
      'cert_criteria', 'cert_documents', 'cert_indicator_status', 'cert_indicators', 'cert_proofs', 'cert_referentials',
      'cert_settings', 'client_contacts', 'client_interactions', 'client_portal_access', 'client_providers',
      'clients', 'completude_alerts', 'completude_tracking', 'course_document_downloads', 'course_documents',
      'course_equipment', 'course_questions', 'courses', 'dashboard_widget_configs', 'demo_records', 'document_signatures',
      'documents', 'duerp_actions', 'duerp_equipements', 'duerp_formations_reglementaires', 'duerp_habilitations',
      'duerp_projects', 'duerp_risk_categories', 'duerp_risk_templates', 'duerp_risks', 'duerp_sector_templates',
      'duerp_units', 'duerp_verifications', 'email_sync_cursors', 'equipment_catalog', 'evaluations_cold', 'import_logs',
      'invoice_emails_sent', 'invoice_items', 'invoice_payments', 'invoice_relances', 'invoice_sessions', 'invoices',
      'itv_contracts', 'itv_equipment', 'itv_equipment_types', 'itv_parts', 'itv_settings', 'itv_technicians',
      'itv_visit_items', 'itv_visit_parts', 'itv_visits', 'mailing_blocklist', 'mailing_campaigns', 'mailing_email_status',
      'mailing_reply_cursors', 'mailing_segments', 'mailing_sends', 'mailing_templates', 'non_conformites', 'non_conformities',
      'notifications', 'org_modules', 'org_settings', 'organization_settings', 'phoning_sessions', 'positioning_questions_ref',
      'positioning_results', 'positioning_themes', 'process_categories', 'process_connections', 'process_responsibles',
      'process_steps', 'process_versions', 'processes', 'profiles', 'programme_versions', 'prospect_calls', 'prospect_email_logs',
      'prospect_needs_analysis', 'prospect_rdv', 'prospection_massive', 'psh_requests', 'qualiopi_documents',
      'qualiopi_indicators', 'quality_alerts', 'quality_doc_versions', 'quality_documents', 'quality_roles',
      'quiz_attempts', 'quote_items', 'quotes', 'rdv_emails_sent', 'rdv_kit_documents', 'reclamations', 'rgpd_traitements',
      'schema_migrations', 'session_checklists', 'session_costs', 'session_document_access', 'session_documents',
      'session_emails_sent', 'session_equipment', 'session_fundings', 'session_groups', 'session_needs_analysis',
      'session_qualiopi', 'session_trainees', 'session_trainers', 'sessions', 'signature_alerts_sent', 'sites',
      'social_media_library', 'social_posts', 'social_tokens', 'sst_certifications', 'theme_questions', 'trainee_documents',
      'trainee_evaluations', 'trainee_info_sheets', 'trainee_objectives', 'trainee_positioning_tests', 'trainees',
      'trainees_archive', 'trainer_certificates', 'trainer_evaluations', 'trainer_interviews', 'trainer_qualifications',
      'trainer_trainings', 'trainers', 'training_themes', 'uploaded_documents', 'uploaded_files', 'user_email_configs',
      'user_planning_events', 'veille_qualiopi', 'veille_sources'
    ])
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- Pose des règles d'une liste de tables : une règle par action, garde du module ajoutée ici.
-- Lecture : module actif, ou super administrateur. Écriture : module actif.
create or replace function pg_temp.regles(p_tables text[], p_module text, p_sel text, p_ins text, p_upd text, p_del text)
returns void
language plpgsql
as $f$
declare
  t text;
  v_on text;
  v_sel text := p_sel; v_ins text := p_ins; v_upd text := p_upd; v_del text := p_del;
begin
  if p_module is not null then
    select '(' || string_agg(format('(select app.module_on(%L))', m), ' or ') || ')' into v_on
    from unnest(string_to_array(p_module, '|')) m;
    if v_sel is not null then v_sel := format('((%s and %s) or (select app.is_superadmin()))', v_on, v_sel); end if;
    if v_ins is not null then v_ins := format('(%s and %s)', v_on, v_ins); end if;
    if v_upd is not null then v_upd := format('(%s and %s)', v_on, v_upd); end if;
    if v_del is not null then v_del := format('(%s and %s)', v_on, v_del); end if;
  end if;
  foreach t in array p_tables loop
    execute format('alter table public.%I enable row level security', t);
    if v_sel is not null then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_lire', t, v_sel);
    end if;
    if v_ins is not null then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_creer', t, v_ins);
    end if;
    if v_upd is not null then
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_modifier', t, v_upd, v_upd);
    end if;
    if v_del is not null then
      execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_supprimer', t, v_del);
    end if;
  end loop;
end
$f$;


-- Tables réservées au serveur (clé service_role) : aucune règle
alter table public.email_sync_cursors enable row level security;
alter table public.mailing_reply_cursors enable row level security;

-- accounting_periods, bank_statements, budget_actions, budget_categories, budget_emails_sent, budget_meal_guests, budget_pipeline, budget_receipts, budget_rules, budget_settings, budget_transaction_invoices (module finance ou comptabilite)
select pg_temp.regles(array['accounting_periods', 'bank_statements', 'budget_actions', 'budget_categories', 'budget_emails_sent', 'budget_meal_guests', 'budget_pipeline', 'budget_receipts', 'budget_rules', 'budget_settings', 'budget_transaction_invoices'], $r$finance|comptabilite$r$,
  $r$(select app.grp('fin'))$r$,
  $r$(select app.grp('fin'))$r$,
  $r$(select app.grp('fin'))$r$,
  $r$(select app.grp('fin'))$r$);

-- app_versions
select pg_temp.regles(array['app_versions'], null,
  $r$(select app.grp('all'))$r$,
  $r$(select app.grp('sa'))$r$,
  $r$(select app.grp('sa'))$r$,
  $r$(select app.grp('sa'))$r$);

-- attendance_halfdays, attendance_proxy_signatures, attendances, document_signatures
select pg_temp.regles(array['attendance_halfdays', 'attendance_proxy_signatures', 'attendances', 'document_signatures'], null,
  $r$((select app.grp('suivi')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.grp('mgr')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.grp('mgr')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  $r$(select app.grp('mgr'))$r$);

-- audit_logs
select pg_temp.regles(array['audit_logs'], null,
  $r$(select app.grp('adm'))$r$,
  $r$(select app.grp('all'))$r$,
  null,
  null);

-- audits_internes, bpf_declarations, non_conformites, non_conformities, process_categories, process_connections, process_responsibles, process_steps, process_versions, processes, psh_requests, qualiopi_indicators, quality_alerts, reclamations, rgpd_traitements, veille_qualiopi, veille_sources (module qualite)
select pg_temp.regles(array['audits_internes', 'bpf_declarations', 'non_conformites', 'non_conformities', 'process_categories', 'process_connections', 'process_responsibles', 'process_steps', 'process_versions', 'processes', 'psh_requests', 'qualiopi_indicators', 'quality_alerts', 'reclamations', 'rgpd_traitements', 'veille_qualiopi', 'veille_sources'], $r$qualite$r$,
  $r$(select app.grp('staff'))$r$,
  $r$(select app.grp('edit'))$r$,
  $r$(select app.grp('mgr'))$r$,
  $r$(select app.grp('mgr'))$r$);

-- budget_transactions (module finance ou comptabilite)
select pg_temp.regles(array['budget_transactions'], $r$finance|comptabilite$r$,
  $r$((select app.grp('fin')) and (is_private = false or private_owner = ((select auth.jwt()) ->> 'email')))$r$,
  $r$((select app.grp('fin')) and (is_private = false or private_owner = ((select auth.jwt()) ->> 'email')))$r$,
  $r$((select app.grp('fin')) and (is_private = false or private_owner = ((select auth.jwt()) ->> 'email')))$r$,
  $r$((select app.grp('fin')) and (is_private = false or private_owner = ((select auth.jwt()) ->> 'email')))$r$);

-- call_arguments, call_objections, import_logs, phoning_sessions, prospect_calls, prospect_email_logs, prospect_needs_analysis, prospect_rdv, rdv_emails_sent, rdv_kit_documents (module prospection)
select pg_temp.regles(array['call_arguments', 'call_objections', 'import_logs', 'phoning_sessions', 'prospect_calls', 'prospect_email_logs', 'prospect_needs_analysis', 'prospect_rdv', 'rdv_emails_sent', 'rdv_kit_documents'], $r$prospection$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$);

-- cert_audit_findings, cert_criteria, cert_documents, cert_indicator_status, cert_indicators, cert_proofs, cert_referentials, cert_settings (module certification)
select pg_temp.regles(array['cert_audit_findings', 'cert_criteria', 'cert_documents', 'cert_indicator_status', 'cert_indicators', 'cert_proofs', 'cert_referentials', 'cert_settings'], $r$certification$r$,
  $r$(select app.grp('mgr'))$r$,
  $r$(select app.grp('mgr'))$r$,
  $r$(select app.grp('mgr'))$r$,
  $r$(select app.grp('mgr'))$r$);

-- client_contacts, sites
select pg_temp.regles(array['client_contacts', 'sites'], null,
  $r$((select app.grp('int')) or ((select app.role()) = 'technicien' and client_id in (select app.tech_client_ids())))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$);

-- client_interactions
select pg_temp.regles(array['client_interactions'], null,
  $r$(select app.grp('int'))$r$,
  $r$(select app.grp('edit_cpt'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('mgr'))$r$);

-- client_portal_access, client_providers
select pg_temp.regles(array['client_portal_access', 'client_providers'], null,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$);

-- clients
select pg_temp.regles(array['clients'], null,
  $r$((select app.grp('int')) or ((select app.role()) = 'technicien' and id in (select app.tech_client_ids())))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('mgr'))$r$);

-- completude_alerts, completude_tracking
select pg_temp.regles(array['completude_alerts', 'completude_tracking'], null,
  $r$(select app.grp('int'))$r$,
  $r$(select app.grp('int'))$r$,
  $r$(select app.grp('int'))$r$,
  $r$(select app.grp('mgr'))$r$);

-- course_document_downloads
select pg_temp.regles(array['course_document_downloads'], null,
  $r$((select app.grp('suivi')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.grp('sales')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  null,
  $r$(select app.grp('mgr'))$r$);

-- course_documents, course_equipment, courses, equipment_catalog, programme_versions, qualiopi_documents, quality_documents, trainer_qualifications, training_themes
select pg_temp.regles(array['course_documents', 'course_equipment', 'courses', 'equipment_catalog', 'programme_versions', 'qualiopi_documents', 'quality_documents', 'trainer_qualifications', 'training_themes'], null,
  $r$(select app.grp('int'))$r$,
  $r$(select app.grp('mgr'))$r$,
  $r$(select app.grp('mgr'))$r$,
  $r$(select app.grp('mgr'))$r$);

-- course_questions, positioning_questions_ref, positioning_themes, theme_questions
select pg_temp.regles(array['course_questions', 'positioning_questions_ref', 'positioning_themes', 'theme_questions'], null,
  $r$(select app.grp('int'))$r$,
  $r$(select app.grp('edit'))$r$,
  $r$(select app.grp('edit'))$r$,
  $r$(select app.grp('mgr'))$r$);

-- dashboard_widget_configs, user_email_configs
select pg_temp.regles(array['dashboard_widget_configs', 'user_email_configs'], null,
  $r$((select app.grp('all')) and user_id = (select auth.uid()))$r$,
  $r$((select app.grp('all')) and user_id = (select auth.uid()))$r$,
  $r$((select app.grp('all')) and user_id = (select auth.uid()))$r$,
  $r$((select app.grp('all')) and user_id = (select auth.uid()))$r$);

-- demo_records, schema_migrations
select pg_temp.regles(array['demo_records', 'schema_migrations'], null,
  $r$(select app.grp('sa'))$r$,
  null,
  null,
  null);

-- documents, uploaded_documents, uploaded_files
select pg_temp.regles(array['documents', 'uploaded_documents', 'uploaded_files'], null,
  $r$(select app.grp('staff'))$r$,
  $r$(select app.grp('edit'))$r$,
  $r$(select app.grp('edit'))$r$,
  $r$(select app.grp('mgr'))$r$);

-- duerp_actions, duerp_equipements, duerp_formations_reglementaires, duerp_habilitations, duerp_projects, duerp_risk_categories, duerp_risk_templates, duerp_risks, duerp_sector_templates, duerp_units, duerp_verifications (module duerp)
select pg_temp.regles(array['duerp_actions', 'duerp_equipements', 'duerp_formations_reglementaires', 'duerp_habilitations', 'duerp_projects', 'duerp_risk_categories', 'duerp_risk_templates', 'duerp_risks', 'duerp_sector_templates', 'duerp_units', 'duerp_verifications'], $r$duerp$r$,
  $r$(select app.grp('mgr'))$r$,
  $r$(select app.grp('mgr'))$r$,
  $r$(select app.grp('mgr'))$r$,
  $r$(select app.grp('mgr'))$r$);

-- evaluations_cold, trainee_evaluations, trainer_evaluations
select pg_temp.regles(array['evaluations_cold', 'trainee_evaluations', 'trainer_evaluations'], null,
  $r$((select app.grp('suivi')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.grp('mgr')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  $r$(select app.grp('sa'))$r$,
  $r$(select app.grp('sa'))$r$);

-- invoice_emails_sent, invoice_relances
select pg_temp.regles(array['invoice_emails_sent', 'invoice_relances'], null,
  $r$(select app.grp('factu'))$r$,
  $r$(select app.grp('factu'))$r$,
  $r$(select app.grp('factu'))$r$,
  $r$(select app.grp('mgr'))$r$);

-- invoice_items, invoice_payments, invoice_sessions
select pg_temp.regles(array['invoice_items', 'invoice_payments', 'invoice_sessions'], null,
  $r$(select app.grp('factu'))$r$,
  $r$(select app.grp('factu'))$r$,
  $r$(select app.grp('factu'))$r$,
  $r$(select app.grp('factu'))$r$);

-- invoices
select pg_temp.regles(array['invoices'], null,
  $r$(select app.grp('factu'))$r$,
  $r$(select app.grp('factu'))$r$,
  $r$(select app.grp('factu'))$r$,
  $r$((select app.grp('mgr')) or ((select app.grp('com_cpt')) and status = 'draft'))$r$);

-- itv_contracts (module interventions)
select pg_temp.regles(array['itv_contracts'], $r$interventions$r$,
  $r$(select app.grp('staff'))$r$,
  $r$(select app.grp('mgr'))$r$,
  $r$(select app.grp('mgr'))$r$,
  $r$(select app.grp('mgr'))$r$);

-- itv_equipment (module interventions)
select pg_temp.regles(array['itv_equipment'], $r$interventions$r$,
  $r$((select app.grp('staff')) or ((select app.role()) = 'technicien' and client_id in (select app.tech_client_ids())))$r$,
  $r$((select app.grp('mgr')) or ((select app.role()) = 'technicien' and client_id in (select app.tech_client_ids())))$r$,
  $r$((select app.grp('mgr')) or ((select app.role()) = 'technicien' and client_id in (select app.tech_client_ids())))$r$,
  $r$(select app.grp('mgr'))$r$);

-- itv_equipment_types, itv_parts, itv_settings, itv_technicians (module interventions)
select pg_temp.regles(array['itv_equipment_types', 'itv_parts', 'itv_settings', 'itv_technicians'], $r$interventions$r$,
  $r$(select app.grp('itv_terrain'))$r$,
  $r$(select app.grp('mgr'))$r$,
  $r$(select app.grp('mgr'))$r$,
  $r$(select app.grp('mgr'))$r$);

-- itv_visit_items, itv_visit_parts (module interventions)
select pg_temp.regles(array['itv_visit_items', 'itv_visit_parts'], $r$interventions$r$,
  $r$((select app.grp('staff')) or ((select app.role()) = 'technicien' and visit_id in (select app.tech_scope_visit_ids())))$r$,
  $r$((select app.grp('mgr')) or ((select app.role()) = 'technicien' and visit_id in (select app.tech_visit_ids())))$r$,
  $r$((select app.grp('mgr')) or ((select app.role()) = 'technicien' and visit_id in (select app.tech_visit_ids())))$r$,
  $r$((select app.grp('mgr')) or ((select app.role()) = 'technicien' and visit_id in (select app.tech_visit_ids())))$r$);

-- itv_visits (module interventions)
select pg_temp.regles(array['itv_visits'], $r$interventions$r$,
  $r$((select app.grp('staff')) or ((select app.role()) = 'technicien' and client_id in (select app.tech_client_ids())))$r$,
  $r$((select app.grp('mgr')) or (((select app.role()) = 'technicien' and technician_id = (select auth.uid())) and client_id in (select app.tech_client_ids())))$r$,
  $r$((select app.grp('mgr')) or ((select app.role()) = 'technicien' and technician_id = (select auth.uid())))$r$,
  $r$(select app.grp('mgr'))$r$);

-- mailing_blocklist, mailing_campaigns, mailing_email_status, mailing_segments, mailing_sends, mailing_templates (module mailing)
select pg_temp.regles(array['mailing_blocklist', 'mailing_campaigns', 'mailing_email_status', 'mailing_segments', 'mailing_sends', 'mailing_templates'], $r$mailing$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$);

-- notifications
select pg_temp.regles(array['notifications'], null,
  $r$(select app.grp('int'))$r$,
  $r$(select app.grp('int'))$r$,
  $r$(select app.grp('int'))$r$,
  $r$(select app.grp('adm'))$r$);

-- org_modules, quality_roles
select pg_temp.regles(array['org_modules', 'quality_roles'], null,
  $r$(select app.grp('all'))$r$,
  $r$(select app.grp('adm'))$r$,
  $r$(select app.grp('adm'))$r$,
  $r$(select app.grp('adm'))$r$);

-- org_settings, organization_settings
select pg_temp.regles(array['org_settings', 'organization_settings'], null,
  $r$(select app.grp('all'))$r$,
  $r$(select app.grp('adm'))$r$,
  $r$(select app.grp('adm'))$r$,
  $r$(select app.grp('sa'))$r$);

-- positioning_results, sst_certifications, trainee_info_sheets, trainee_objectives, trainee_positioning_tests
select pg_temp.regles(array['positioning_results', 'sst_certifications', 'trainee_info_sheets', 'trainee_objectives', 'trainee_positioning_tests'], null,
  $r$((select app.grp('suivi')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.grp('mgr')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.grp('mgr')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.grp('mgr')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$);

-- profiles
select pg_temp.regles(array['profiles'], null,
  $r$(select app.grp('all'))$r$,
  $r$(select app.grp('adm'))$r$,
  $r$(id = (select auth.uid()) or (select app.role()) = 'superadmin' or ((select app.role()) = 'admin' and role <> 'superadmin'))$r$,
  $r$((select app.role()) = 'superadmin' or ((select app.role()) = 'admin' and role <> 'superadmin'))$r$);

-- prospection_massive (module prospection)
select pg_temp.regles(array['prospection_massive'], $r$prospection$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('mgr'))$r$);

-- quality_doc_versions
select pg_temp.regles(array['quality_doc_versions'], null,
  $r$(select app.grp('int'))$r$,
  $r$(select app.grp('validation'))$r$,
  null,
  null);

-- quiz_attempts
select pg_temp.regles(array['quiz_attempts'], null,
  $r$((select app.grp('suivi')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  null,
  $r$(select app.grp('sa'))$r$,
  $r$(select app.grp('sa'))$r$);

-- quote_items
select pg_temp.regles(array['quote_items'], null,
  $r$(select app.grp('factu'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$);

-- quotes
select pg_temp.regles(array['quotes'], null,
  $r$(select app.grp('factu'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('mgr'))$r$);

-- session_checklists, session_document_access, session_documents, session_emails_sent, session_equipment, session_needs_analysis, session_qualiopi
select pg_temp.regles(array['session_checklists', 'session_document_access', 'session_documents', 'session_emails_sent', 'session_equipment', 'session_needs_analysis', 'session_qualiopi'], null,
  $r$((select app.grp('suivi')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.grp('sales')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.grp('sales')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.grp('mgr')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$);

-- session_costs, trainees_archive, trainer_certificates, trainer_interviews, trainer_trainings
select pg_temp.regles(array['session_costs', 'trainees_archive', 'trainer_certificates', 'trainer_interviews', 'trainer_trainings'], null,
  $r$(select app.grp('mgr'))$r$,
  $r$(select app.grp('mgr'))$r$,
  $r$(select app.grp('mgr'))$r$,
  $r$(select app.grp('mgr'))$r$);

-- session_fundings, session_groups, session_trainers
select pg_temp.regles(array['session_fundings', 'session_groups', 'session_trainers'], null,
  $r$((select app.grp('sess_read')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$);

-- session_trainees
select pg_temp.regles(array['session_trainees'], null,
  $r$((select app.grp('sess_read')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.grp('sales')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.grp('sales')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.grp('sales')) or ((select app.role()) = 'formateur' and session_id in (select app.trainer_session_ids())))$r$);

-- sessions
select pg_temp.regles(array['sessions'], null,
  $r$((select app.grp('sess_read')) or ((select app.role()) = 'formateur' and id in (select app.trainer_session_ids())))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$((select app.grp('sales')) or ((select app.role()) = 'formateur' and id in (select app.trainer_session_ids())))$r$,
  $r$(select app.grp('mgr'))$r$);

-- signature_alerts_sent
select pg_temp.regles(array['signature_alerts_sent'], null,
  $r$(select app.grp('mgr'))$r$,
  null,
  null,
  null);

-- social_media_library, social_posts (module social)
select pg_temp.regles(array['social_media_library', 'social_posts'], $r$social$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$,
  $r$(select app.grp('sales'))$r$);

-- social_tokens (module social)
select pg_temp.regles(array['social_tokens'], $r$social$r$,
  $r$(select app.grp('adm'))$r$,
  null,
  null,
  null);

-- trainee_documents
select pg_temp.regles(array['trainee_documents'], null,
  $r$((select app.grp('suivi')) or ((select app.role()) = 'formateur' and trainee_id in (select app.trainer_trainee_ids())))$r$,
  $r$((select app.grp('mgr')) or ((select app.role()) = 'formateur' and trainee_id in (select app.trainer_trainee_ids())))$r$,
  $r$((select app.grp('mgr')) or ((select app.role()) = 'formateur' and trainee_id in (select app.trainer_trainee_ids())))$r$,
  $r$(select app.grp('mgr'))$r$);

-- trainees
select pg_temp.regles(array['trainees'], null,
  $r$((select app.grp('sess_read')) or ((select app.role()) = 'formateur' and id in (select app.trainer_trainee_ids())))$r$,
  $r$(select app.grp('edit'))$r$,
  $r$((select app.grp('sales')) or ((select app.role()) = 'formateur' and id in (select app.trainer_trainee_ids())))$r$,
  $r$(select app.grp('mgr'))$r$);

-- trainers
select pg_temp.regles(array['trainers'], null,
  $r$(select app.grp('int'))$r$,
  $r$(select app.grp('mgr'))$r$,
  $r$((select app.grp('mgr')) or ((select app.role()) = 'formateur' and id = (select p.trainer_id from public.profiles p where p.id = (select auth.uid()))))$r$,
  $r$(select app.grp('mgr'))$r$);

-- user_planning_events
select pg_temp.regles(array['user_planning_events'], null,
  $r$(select app.grp('int'))$r$,
  $r$(((select app.grp('int')) and user_id = (select auth.uid())) or (select app.grp('mgr')))$r$,
  $r$(((select app.grp('int')) and user_id = (select auth.uid())) or (select app.grp('mgr')))$r$,
  $r$(((select app.grp('int')) and user_id = (select auth.uid())) or (select app.grp('mgr')))$r$);

-- pp_* : Passeport de prévention (module passeport) ; pp_nir : serveur seulement
do $$
declare r record;
begin
  for r in select p.tablename, p.policyname from pg_policies p
           where p.schemaname = 'public' and p.tablename like 'pp\_%' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
  for r in select tablename from pg_tables where schemaname = 'public' and tablename like 'pp\_%' loop
    if r.tablename = 'pp_nir' then
      execute 'alter table public.pp_nir enable row level security';
      execute 'revoke all on table public.pp_nir from anon, authenticated';
    else
      perform pg_temp.regles(array[r.tablename], 'passeport',
        '(select app.grp(''mgr''))', '(select app.grp(''mgr''))', '(select app.grp(''mgr''))', '(select app.grp(''mgr''))');
    end if;
  end loop;
end $$;

insert into public.schema_migrations (version) values ('0082_securite_regles') on conflict (version) do nothing;

-- ===== 0083_securite_numero_secu.sql =====
-- 0083_securite_numero_secu.sql : le numéro de sécurité sociale quitte les tables lisibles (chantier 2, Q3).
-- Avant : le numéro était une colonne de trainees et de trainee_info_sheets, lisible par tout compte
-- connecté et renvoyé en entier par le portail stagiaire avec le seul jeton de session.
-- Après :
--   * le numéro vit dans la table trainee_ssn, sans aucune règle d'accès : seules les fonctions
--     contrôlées par rôle le lisent ou l'écrivent ;
--   * partout dans l'application, le numéro n'est affiché que masqué (3 derniers chiffres au plus,
--     décision du 14/10) : get_trainee_with_ssn renvoie la forme masquée ; le numéro complet ne sort
--     que côté serveur (déclaration Passeport de prévention) ;
--   * les anciennes colonnes restent (aucun code existant ne casse) mais un déclencheur déplace
--     toute valeur écrite vers trainee_ssn et les remet à vide ;
--   * trainees.ssn_present et trainee_info_sheets.ssn_present disent seulement si le numéro est connu ;
--   * get_trainee_with_ssn (lecture) : direction, gestion et formateur de la session ;
--     save_trainee_with_ssn (écriture) : personnel autorisé à modifier le stagiaire.
-- La fonction save_trainee_with_ssn écrivait un texte chiffré avec une clé écrite en dur, illisible
-- ensuite : elle enregistre désormais le numéro saisi.
-- Migration idempotente. Retour arrière : supabase/rollback/0080-0086_securite_retour.sql (les sept migrations ensemble)

create table if not exists public.trainee_ssn (
  trainee_id uuid primary key references public.trainees(id) on delete cascade deferrable initially deferred,
  ssn text not null,
  updated_at timestamptz not null default now()
);
alter table public.trainee_ssn enable row level security;
revoke all on table public.trainee_ssn from public, anon, authenticated;
grant all on table public.trainee_ssn to service_role;

alter table public.trainees add column if not exists ssn_present boolean not null default false;
alter table public.trainee_info_sheets add column if not exists ssn_present boolean not null default false;

-- Reprise des numéros déjà saisis (aucun au 14/10/2026 sur odet-gld)
insert into public.trainee_ssn (trainee_id, ssn)
select t.id, regexp_replace(t.social_security_number, '\s', '', 'g')
from public.trainees t
where nullif(trim(t.social_security_number), '') is not null
on conflict (trainee_id) do nothing;

insert into public.trainee_ssn (trainee_id, ssn)
select distinct on (i.trainee_id) i.trainee_id, regexp_replace(i.ssn, '\s', '', 'g')
from public.trainee_info_sheets i
where nullif(trim(i.ssn), '') is not null
order by i.trainee_id, i.filled_at desc nulls last
on conflict (trainee_id) do nothing;

-- Déclencheur sur trainees : le numéro écrit part dans trainee_ssn
create or replace function public.trainee_ssn_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_ssn text := nullif(regexp_replace(coalesce(new.social_security_number, ''), '\s', '', 'g'), '');
begin
  if new.id is null then
    new.id := gen_random_uuid();
  end if;
  if coalesce(new.refused_ssn, false) then
    delete from public.trainee_ssn where trainee_id = new.id;
    new.ssn_present := false;
  elsif v_ssn is not null then
    insert into public.trainee_ssn (trainee_id, ssn, updated_at) values (new.id, v_ssn, now())
    on conflict (trainee_id) do update set ssn = excluded.ssn, updated_at = now();
    new.ssn_present := true;
  elsif tg_op = 'INSERT' then
    new.ssn_present := false;
  end if;
  new.social_security_number := null;
  new.ssn_encrypted := null;
  return new;
end
$function$;

-- La clé étrangère de trainee_ssn est vérifiée en fin de transaction : à l'insertion d'un stagiaire,
-- son numéro peut être rangé avant que la ligne trainees n'existe.
drop trigger if exists a_trainee_ssn_capture on public.trainees;
create trigger a_trainee_ssn_capture before insert or update on public.trainees
  for each row execute function public.trainee_ssn_capture();

-- Déclencheur sur trainee_info_sheets : même règle, rattachée au stagiaire
create or replace function public.info_sheet_ssn_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_ssn text := nullif(regexp_replace(coalesce(new.ssn, ''), '\s', '', 'g'), '');
begin
  if coalesce(new.ssn_refused, false) then
    delete from public.trainee_ssn where trainee_id = new.trainee_id;
    update public.trainees set ssn_present = false where id = new.trainee_id and ssn_present;
    new.ssn_present := false;
  elsif v_ssn is not null then
    insert into public.trainee_ssn (trainee_id, ssn, updated_at) values (new.trainee_id, v_ssn, now())
    on conflict (trainee_id) do update set ssn = excluded.ssn, updated_at = now();
    update public.trainees set ssn_present = true where id = new.trainee_id and not ssn_present;
    new.ssn_present := true;
  else
    new.ssn_present := exists (select 1 from public.trainee_ssn s where s.trainee_id = new.trainee_id);
  end if;
  new.ssn := null;
  return new;
end
$function$;

drop trigger if exists a_info_sheet_ssn_capture on public.trainee_info_sheets;
create trigger a_info_sheet_ssn_capture before insert or update on public.trainee_info_sheets
  for each row execute function public.info_sheet_ssn_capture();

-- Les numéros déjà présents sortent des colonnes lisibles
update public.trainees t set
  ssn_present = exists (select 1 from public.trainee_ssn s where s.trainee_id = t.id) and not coalesce(t.refused_ssn, false),
  social_security_number = null,
  ssn_encrypted = null
where t.social_security_number is not null or t.ssn_encrypted is not null
   or t.ssn_present is distinct from (exists (select 1 from public.trainee_ssn s where s.trainee_id = t.id) and not coalesce(t.refused_ssn, false));

update public.trainee_info_sheets i set
  ssn_present = exists (select 1 from public.trainee_ssn s where s.trainee_id = i.trainee_id),
  ssn = null
where i.ssn is not null
   or i.ssn_present is distinct from exists (select 1 from public.trainee_ssn s where s.trainee_id = i.trainee_id);

-- Complétude : « Numéro SS manquant » lit désormais ssn_present
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.detect_completude_blockers()'::regprocedure) into v_def;
  if position('ssn_present' in v_def) = 0 then
    v_def := replace(v_def, 'AND (t.social_security_number IS NULL OR t.social_security_number = '''')', 'AND NOT coalesce(t.ssn_present, false)');
    v_def := replace(v_def, '(t.social_security_number IS NOT NULL AND t.social_security_number != '''')', 'coalesce(t.ssn_present, false)');
    if position('social_security_number' in v_def) > 0 then
      raise exception 'detect_completude_blockers : remplacement incomplet';
    end if;
    execute v_def;
  end if;
end $$;

-- Lecture du numéro, masqué (3 derniers chiffres), par le personnel autorisé
create or replace function public.get_trainee_with_ssn(p_id uuid)
returns table(id uuid, first_name text, last_name text, email text, phone text, social_security_number text,
              client_id uuid, notes text, birth_date date, refused_ssn boolean, has_disability boolean,
              disability_details text, disability_adaptations text, created_at timestamptz, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_role text := app.role();
begin
  if not (v_role = any (array['superadmin', 'admin', 'direction', 'gestionnaire'])
          or (v_role = 'formateur' and p_id in (select app.trainer_trainee_ids()))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return query
  select t.id, t.first_name::text, t.last_name::text, t.email::text, t.phone::text,
         (select repeat('•', greatest(length(s.ssn) - 3, 0)) || right(s.ssn, 3) from public.trainee_ssn s where s.trainee_id = t.id),
         t.client_id, t.notes, t.birth_date, t.refused_ssn, t.has_disability,
         t.disability_details, t.disability_adaptations, t.created_at, t.updated_at
  from public.trainees t
  where t.id = p_id;
end
$function$;

-- Écriture d'un stagiaire avec son numéro par le personnel autorisé
create or replace function public.save_trainee_with_ssn(
  p_id uuid, p_first_name text, p_last_name text, p_email text default null, p_phone text default null,
  p_ssn text default null, p_client_id uuid default null, p_notes text default null, p_birth_date date default null,
  p_refused_ssn boolean default false, p_has_disability boolean default false, p_disability_details text default null,
  p_disability_adaptations text default null, p_csp text default null, p_job_title text default null,
  p_gender text default null)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_role text := app.role();
begin
  if not (v_role = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial'])
          or (v_role = 'formateur' and p_id in (select app.trainer_trainee_ids()))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.trainees set
    first_name = p_first_name,
    last_name = p_last_name,
    email = p_email,
    phone = p_phone,
    social_security_number = case when coalesce(p_refused_ssn, false) then null else nullif(trim(p_ssn), '') end,
    client_id = p_client_id,
    notes = p_notes,
    birth_date = p_birth_date,
    refused_ssn = coalesce(p_refused_ssn, false),
    has_disability = coalesce(p_has_disability, false),
    disability_details = p_disability_details,
    disability_adaptations = p_disability_adaptations,
    csp = coalesce(p_csp, csp),
    job_title = coalesce(p_job_title, job_title),
    gender = coalesce(p_gender, gender),
    updated_at = now()
  where id = p_id;
end
$function$;

-- Vues : plus de numéro en clair
create or replace view public.trainees_safe with (security_invoker = true) as
select id, first_name, last_name, email, phone,
       case when ssn_present then '***-**-*****'::text else null::text end as social_security_number_masked,
       ssn_present as has_ssn,
       client_id, notes, birth_date, refused_ssn, has_disability, disability_details, disability_adaptations,
       created_at, updated_at
from public.trainees;

create or replace view public.v_trainee_session_complete with (security_invoker = true) as
select st.id as session_trainee_id, st.session_id, st.trainee_id, t.first_name, t.last_name,
  (((t.first_name)::text || ' '::text) || (t.last_name)::text) as full_name,
  t.email, t.phone, t.birth_date, t.birth_place, t.address, t.postal_code, t.city,
  null::character varying(15) as social_security_number,
  t.refused_ssn, t.job_title, t.csp, t.gender, t.has_disability, t.disability_details, t.disability_adaptations,
  t.client_id, c.name as client_name, s.reference as session_reference, s.start_date, s.end_date,
  s.status as session_status, s.location_name, s.course_id, co.title as course_title, co.duration_hours,
  st.registration_date, st.result, st.presence_complete, st.early_departure, st.departure_date,
  st.departure_reason, st.admin_observation, st.remediation_proposal, st.access_code, st.forprev_card_sent,
  st.certificate_sent_individual, st.cold_eval_sent_individual, tis.id as info_sheet_id,
  tis.training_expectations, tis.last_training_year, tis.highest_diploma, tis.rgpd_consent,
  tis.rgpd_consent_date, tis.filled_at as info_sheet_filled_at, tis.filled_online as info_sheet_filled_online
from session_trainees st
  join trainees t on t.id = st.trainee_id
  join sessions s on s.id = st.session_id
  left join clients c on c.id = t.client_id
  left join courses co on co.id = s.course_id
  left join trainee_info_sheets tis on tis.trainee_id = st.trainee_id and tis.session_id = st.session_id;
revoke all on public.trainees_safe, public.v_trainee_session_complete from anon;

insert into public.schema_migrations (version) values ('0083_securite_numero_secu') on conflict (version) do nothing;

-- ===== 0084_securite_portails.sql =====
-- 0084_securite_portails.sql : les portails publics ne passent plus que par des fonctions à jeton (chantier 2).
-- 1. Portail stagiaire : quand le stagiaire a un code d'accès, la vérification du code délivre un ticket
--    (valable 12 heures) exigé ensuite pour lire ou modifier ses données. Le numéro de sécurité sociale
--    n'est plus jamais renvoyé : seulement « connu ou non » et ses 3 derniers chiffres (décision du 14/10 : masque au plus restrictif).
--    Les fonctions gardent leurs noms ; le ticket est un paramètre facultatif ajouté à la fin.
-- 2. Documents du stagiaire : lus et tracés par portal_documents et portal_log_download
--    (avant : lecture directe de course_documents et session_document_access par anon).
-- 3. Formulaire public de réclamation : public_reclamation_session et public_reclamation_submit
--    (avant : lecture directe de sessions par anon, refusée depuis 0013 : le formulaire était cassé).
-- Migration idempotente. Retour arrière : supabase/rollback/0080-0086_securite_retour.sql (les sept migrations ensemble)

alter table public.session_trainees add column if not exists portal_ticket text;
alter table public.session_trainees add column if not exists portal_ticket_expires_at timestamptz;

-- Contrôle commun : jeton de session, stagiaire inscrit, ticket si le stagiaire a un code
create or replace function app.portal_session_for(p_token text, p_trainee_id uuid, p_ticket text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_session_id uuid;
  v_st record;
begin
  select s.id into v_session_id from public.sessions s where s.attendance_token = p_token;
  if v_session_id is null or p_token is null or p_token = '' then
    raise exception 'Token invalide';
  end if;
  select st.access_code, st.portal_ticket, st.portal_ticket_expires_at into v_st
  from public.session_trainees st
  where st.session_id = v_session_id and st.trainee_id = p_trainee_id;
  if not found then
    raise exception 'Stagiaire non trouvé dans cette session';
  end if;
  if v_st.access_code is not null then
    if p_ticket is null or v_st.portal_ticket is null or v_st.portal_ticket <> p_ticket
       or v_st.portal_ticket_expires_at is null or v_st.portal_ticket_expires_at < now() then
      raise exception 'Code d''accès requis' using errcode = '42501';
    end if;
  end if;
  return v_session_id;
end
$function$;
revoke all on function app.portal_session_for(text, uuid, text) from public, anon, authenticated;

-- Vérification du code : délivre le ticket
create or replace function public.verify_trainee_access_code(p_session_trainee_id uuid, p_access_code character varying)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_session_trainee record;
  v_ticket text;
begin
  select * into v_session_trainee
  from session_trainees
  where id = p_session_trainee_id
  for update;

  if not found then
    return json_build_object('success', false, 'error', 'Stagiaire non trouvé');
  end if;

  if v_session_trainee.access_code_locked = true then
    return json_build_object('success', false, 'error', 'Compte verrouillé. Contactez l''administrateur.');
  end if;

  if v_session_trainee.access_code = p_access_code then
    v_ticket := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    update session_trainees
    set access_code_attempts = 0,
        access_code_locked = false,
        portal_ticket = v_ticket,
        portal_ticket_expires_at = now() + interval '12 hours'
    where id = p_session_trainee_id;
    return json_build_object('success', true, 'ticket', v_ticket);
  else
    update session_trainees
    set access_code_attempts = coalesce(access_code_attempts, 0) + 1,
        access_code_locked = case when coalesce(access_code_attempts, 0) + 1 >= 5 then true else false end,
        access_code_locked_at = case when coalesce(access_code_attempts, 0) + 1 >= 5 then now() else null end
    where id = p_session_trainee_id;

    if coalesce(v_session_trainee.access_code_attempts, 0) + 1 >= 5 then
      return json_build_object('success', false, 'error', 'Trop de tentatives. Compte verrouillé.');
    else
      return json_build_object('success', false, 'error', 'Code incorrect',
        'attempts_remaining', 5 - (coalesce(v_session_trainee.access_code_attempts, 0) + 1));
    end if;
  end if;
end;
$function$;

-- Lecture des données du stagiaire (sans numéro de sécurité sociale)
drop function if exists public.load_trainee_data(text, uuid);
create or replace function public.load_trainee_data(p_token text, p_trainee_id uuid, p_ticket text default null)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_session_id uuid;
  v_result json;
  v_trainee record;
  v_info_sheet record;
  v_theme_id uuid;
  v_ssn text;
begin
  v_session_id := app.portal_session_for(p_token, p_trainee_id, p_ticket);

  select * into v_trainee from trainees where id = p_trainee_id;
  select * into v_info_sheet from trainee_info_sheets where session_id = v_session_id and trainee_id = p_trainee_id;
  select c.theme_id into v_theme_id from sessions s join courses c on c.id = s.course_id where s.id = v_session_id;
  select s.ssn into v_ssn from trainee_ssn s where s.trainee_id = p_trainee_id;

  select json_build_object(
    'gender', v_trainee.gender,
    'info_sheet', json_build_object(
      'id', v_info_sheet.id,
      'session_id', v_session_id,
      'trainee_id', p_trainee_id,
      'email', coalesce(v_trainee.email, v_info_sheet.email),
      'ssn', null,
      'ssn_on_file', v_ssn is not null,
      'ssn_last3', case when v_ssn is not null then right(v_ssn, 3) end,
      'ssn_refused', coalesce(v_trainee.refused_ssn, v_info_sheet.ssn_refused, false),
      'csp', coalesce(v_trainee.csp, v_info_sheet.csp),
      'job_title', coalesce(v_trainee.job_title, v_info_sheet.job_title),
      'last_training_year', v_info_sheet.last_training_year,
      'highest_diploma', v_info_sheet.highest_diploma,
      'training_expectations', v_info_sheet.training_expectations,
      'rgpd_consent', v_info_sheet.rgpd_consent,
      'rgpd_consent_date', v_info_sheet.rgpd_consent_date,
      'filled_at', v_info_sheet.filled_at,
      'filled_online', v_info_sheet.filled_online
    ),
    'attendance', (
      select json_agg(row_to_json(a.*))
      from attendance_halfdays a
      where a.session_id = v_session_id and a.trainee_id = p_trainee_id
    ),
    'evaluation', (
      select row_to_json(e.*)
      from trainee_evaluations e
      where e.session_id = v_session_id and e.trainee_id = p_trainee_id
    ),
    'positioning_questions', (
      select json_agg(json_build_object(
        'id', tq.id, 'question_text', tq.question_text, 'question_type', tq.question_type,
        'options', tq.options, 'position', tq.position, 'score', tq.score, 'critical', tq.critical
      ) order by tq.position)
      from theme_questions tq
      where tq.theme_id = v_theme_id
    ),
    'positioning_test_completed', (
      select positioning_test_completed from session_trainees
      where session_id = v_session_id and trainee_id = p_trainee_id
    )
  ) into v_result;

  return v_result;
end;
$function$;

-- Mise à jour de la fiche du stagiaire (numéro vide = numéro conservé)
drop function if exists public.update_trainee_data(text, uuid, jsonb);
create or replace function public.update_trainee_data(p_token text, p_trainee_id uuid, p_data jsonb, p_ticket text default null)
returns json
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform app.portal_session_for(p_token, p_trainee_id, p_ticket);

  update trainees set
    first_name = coalesce(p_data->>'first_name', first_name),
    last_name = coalesce(p_data->>'last_name', last_name),
    email = coalesce(p_data->>'email', email),
    phone = coalesce(p_data->>'phone', phone),
    birth_date = coalesce((p_data->>'birth_date')::date, birth_date),
    social_security_number = nullif(regexp_replace(coalesce(p_data->>'social_security_number', ''), '\s', '', 'g'), ''),
    refused_ssn = coalesce((p_data->>'refused_ssn')::boolean, refused_ssn),
    csp = coalesce(p_data->>'csp', csp),
    job_title = coalesce(p_data->>'job_title', job_title),
    gender = coalesce(p_data->>'gender', gender),
    updated_at = now()
  where id = p_trainee_id;

  return json_build_object('success', true, 'id', p_trainee_id);
end;
$function$;

-- Fiche de renseignements (numéro vide = numéro conservé)
drop function if exists public.save_trainee_info(text, uuid, jsonb);
create or replace function public.save_trainee_info(p_token text, p_trainee_id uuid, p_data jsonb, p_ticket text default null)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_session_id uuid;
  v_id uuid;
begin
  v_session_id := app.portal_session_for(p_token, p_trainee_id, p_ticket);

  insert into trainee_info_sheets (
    session_id, trainee_id, email, ssn, ssn_refused, last_training_year,
    highest_diploma, csp, job_title, training_expectations, rgpd_consent,
    rgpd_consent_date, filled_at, filled_online
  ) values (
    v_session_id, p_trainee_id, p_data->>'email',
    nullif(regexp_replace(coalesce(p_data->>'ssn', ''), '\s', '', 'g'), ''),
    coalesce((p_data->>'ssn_refused')::boolean, false),
    (p_data->>'last_training_year')::integer, p_data->>'highest_diploma',
    p_data->>'csp', p_data->>'job_title', p_data->>'training_expectations',
    coalesce((p_data->>'rgpd_consent')::boolean, false),
    coalesce((p_data->>'rgpd_consent_date')::timestamptz, now()),
    coalesce((p_data->>'filled_at')::timestamptz, now()),
    coalesce((p_data->>'filled_online')::boolean, true)
  )
  on conflict (session_id, trainee_id)
  do update set
    email = excluded.email, ssn = excluded.ssn, ssn_refused = excluded.ssn_refused,
    last_training_year = excluded.last_training_year, highest_diploma = excluded.highest_diploma,
    csp = excluded.csp, job_title = excluded.job_title,
    training_expectations = excluded.training_expectations, rgpd_consent = excluded.rgpd_consent,
    rgpd_consent_date = excluded.rgpd_consent_date, filled_at = excluded.filled_at,
    filled_online = excluded.filled_online
  returning id into v_id;

  return json_build_object('success', true, 'id', v_id);
end;
$function$;

-- Documents du stagiaire activés pour la session
create or replace function public.portal_documents(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_session_id uuid;
  v_course_id uuid;
begin
  select s.id, s.course_id into v_session_id, v_course_id from sessions s where s.attendance_token = p_token;
  if v_session_id is null or p_token is null or p_token = '' then
    raise exception 'Token invalide';
  end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', d.id, 'course_id', d.course_id, 'type', d.type, 'title', d.title,
      'file_url', d.file_url, 'file_name', d.file_name, 'file_size', d.file_size
    ) order by d.title)
    from course_documents d
    join session_document_access a on a.document_id = d.id and a.session_id = v_session_id and a.is_active
    where d.course_id = v_course_id and d.type = 'document_stagiaire'
  ), '[]'::json);
end;
$function$;

-- Traçabilité d'un téléchargement (Qualiopi)
create or replace function public.portal_log_download(p_token text, p_document_id uuid, p_trainee_id uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_session_id uuid;
begin
  select s.id into v_session_id from sessions s where s.attendance_token = p_token;
  if v_session_id is null or p_token is null or p_token = '' then
    raise exception 'Token invalide';
  end if;
  if not exists (select 1 from session_document_access a
                 where a.session_id = v_session_id and a.document_id = p_document_id and a.is_active) then
    raise exception 'Document non disponible';
  end if;
  if p_trainee_id is not null and not exists (select 1 from session_trainees st
                                              where st.session_id = v_session_id and st.trainee_id = p_trainee_id) then
    p_trainee_id := null;
  end if;
  insert into course_document_downloads (document_id, session_id, trainee_id)
  values (p_document_id, v_session_id, p_trainee_id);
  return json_build_object('ok', true);
end;
$function$;

-- Réclamation publique : vérification du numéro de session
create or replace function public.public_reclamation_session(p_reference text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_ref text := upper(trim(coalesce(p_reference, '')));
  v json;
begin
  if length(v_ref) < 4 or length(v_ref) > 50 then
    return null;
  end if;
  if v_ref not like 'SES-%' then
    v_ref := 'SES-' || v_ref;
  end if;
  select json_build_object('id', s.id, 'reference', s.reference, 'title', coalesce(c.title, 'Formation'),
                           'start_date', s.start_date, 'end_date', s.end_date)
  into v
  from sessions s left join courses c on c.id = s.course_id
  where upper(s.reference) = v_ref
  limit 1;
  return v;
end;
$function$;

-- Réclamation publique : enregistrement et notification
create or replace function public.public_reclamation_submit(
  p_session_id uuid, p_full_name text, p_email text, p_phone text default null,
  p_company text default null, p_message text default null)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_ref text;
  v_title text;
begin
  if coalesce(trim(p_full_name), '') = '' or coalesce(trim(p_email), '') = '' or coalesce(trim(p_message), '') = '' then
    raise exception 'Champs obligatoires manquants';
  end if;
  if length(p_full_name) > 200 or length(p_email) > 200 or length(coalesce(p_phone, '')) > 50
     or length(coalesce(p_company, '')) > 200 or length(p_message) > 10000 then
    raise exception 'Texte trop long';
  end if;
  select s.reference, coalesce(c.title, 'Formation') into v_ref, v_title
  from sessions s left join courses c on c.id = s.course_id where s.id = p_session_id;
  if v_ref is null then
    raise exception 'Session introuvable';
  end if;

  insert into reclamations (source, canal, session_id, subject, description, status)
  values ('stagiaire', 'formulaire', p_session_id, 'Réclamation - ' || trim(p_full_name),
    '**Réclamation reçue via formulaire public**' || E'\n\n' ||
    '**Informations du réclamant:**' || E'\n' ||
    '- Nom: ' || trim(p_full_name) || E'\n' ||
    '- Email: ' || trim(p_email) || E'\n' ||
    '- Téléphone: ' || coalesce(nullif(trim(p_phone), ''), 'Non renseigné') || E'\n' ||
    '- Entreprise: ' || coalesce(nullif(trim(p_company), ''), 'Non renseignée') || E'\n\n' ||
    '**Session concernée:**' || E'\n' ||
    '- Référence: ' || v_ref || E'\n' ||
    '- Formation: ' || v_title || E'\n\n' ||
    '**Message:**' || E'\n' || trim(p_message),
    'open');

  insert into notifications (type, title, message, link, metadata)
  values ('reclamation', 'Nouvelle réclamation reçue', trim(p_full_name) || ' - ' || v_ref, '/non-conformites',
          jsonb_build_object('fullName', trim(p_full_name), 'email', trim(p_email), 'sessionRef', v_ref));

  return json_build_object('ok', true);
end;
$function$;

-- Droits d'exécution des fonctions du portail
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('verify_trainee_access_code', 'load_trainee_data', 'update_trainee_data', 'save_trainee_info',
                        'portal_documents', 'portal_log_download', 'public_reclamation_session', 'public_reclamation_submit')
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('grant execute on function %s to anon, authenticated, service_role', r.sig);
  end loop;
end $$;

insert into public.schema_migrations (version) values ('0084_securite_portails') on conflict (version) do nothing;

-- ===== 0085_securite_fonctions.sql =====
-- 0085_securite_fonctions.sql : fonctions du schéma public (chantier 2).
-- 1. search_path fixé sur toutes les fonctions qui n'en avaient pas.
-- 2. Les fonctions de déclencheur s'exécutent avec les droits de leur propriétaire : leurs effets de bord
--    (fiche de renseignements créée à l'inscription, client passé actif, synchronisations) ne dépendent
--    plus des règles d'accès de la personne qui a déclenché l'écriture.
-- 3. Droits d'exécution : anon n'exécute que les fonctions des portails ; les fonctions internes
--    (appelées par d'autres fonctions, des déclencheurs ou le serveur) ne sont plus exécutables par
--    les comptes connectés.
-- 4. Contrôle du rôle ajouté en tête des fonctions SECURITY DEFINER qui lisaient ou modifiaient des
--    données sans le vérifier (marqueur « garde chantier 2 »).
-- Migration idempotente. Retour arrière : supabase/rollback/0080-0086_securite_retour.sql (les sept migrations ensemble)

-- Contrôles par session utilisés par les fonctions de présence et de signature ------------------------

create or replace function app.can_read_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.role() = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial', 'lecture'])
    or (app.role() = 'formateur' and p_session_id in (select app.trainer_session_ids())),
  false)
$$;

create or replace function app.can_edit_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.role() = any (array['superadmin', 'admin', 'direction', 'gestionnaire'])
    or (app.role() = 'formateur' and p_session_id in (select app.trainer_session_ids())),
  false)
$$;

create or replace function app.require_roles(p_roles text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(app.role() = any (p_roles), false) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
end
$$;

revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
revoke all on function app.portal_session_for(text, uuid, text) from authenticated;

-- 1 et 2. search_path et déclencheurs --------------------------------------------------------------------

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.prorettype = 'trigger'::regtype as is_trigger, p.prosecdef,
           exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as has_path
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    if not r.has_path then
      execute format('alter function %s set search_path = public', r.sig);
    end if;
    if r.is_trigger and not r.prosecdef then
      execute format('alter function %s security definer', r.sig);
    end if;
  end loop;
end $$;

-- 4. Contrôles du rôle ----------------------------------------------------------------------------------

-- Insère p_guard juste après le premier BEGIN du corps d'une fonction plpgsql (une seule fois)
create or replace function app.inject_guard(p_sig regprocedure, p_guard text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def text := pg_get_functiondef(p_sig);
  v_body_start int;
  v_pos int;
begin
  if position('garde chantier 2' in v_def) > 0 then
    return;
  end if;
  v_body_start := strpos(v_def, '$function$');
  v_pos := regexp_instr(v_def, '\mbegin\M', v_body_start, 1, 1, 'i');
  if v_body_start = 0 or v_pos = 0 then
    raise exception 'Garde impossible à poser sur %', p_sig;
  end if;
  v_def := substr(v_def, 1, v_pos - 1) || E'\n  /* garde chantier 2 */ ' || p_guard || E'\n' || substr(v_def, v_pos);
  execute v_def;
end
$$;
revoke all on function app.inject_guard(regprocedure, text) from public, anon, authenticated;

-- Remplace une portion exacte du corps (une seule fois, erreur si le texte attendu est absent)
create or replace function app.replace_in_function(p_sig regprocedure, p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def text := pg_get_functiondef(p_sig);
begin
  if position('garde chantier 2' in v_def) > 0 then
    return;
  end if;
  if position(p_old in v_def) = 0 then
    raise exception 'Texte attendu absent de %', p_sig;
  end if;
  execute replace(v_def, p_old, p_new);
end
$$;
revoke all on function app.replace_in_function(regprocedure, text, text) from public, anon, authenticated;

do $$
declare
  v_auth_check text := E'IF auth.uid() IS NULL THEN\n    RETURN json_build_object(''ok'', false, ''error'', ''Connexion Campus requise'');\n  END IF;';
  v_mgr text := 'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'']);';
begin
  -- Présence et signatures : formateur de la session ou gestion
  perform app.replace_in_function('public.set_trainee_absent(uuid, uuid, boolean, text, text)'::regprocedure, v_auth_check,
    E'/* garde chantier 2 */ IF NOT app.can_edit_session(p_session_id) THEN\n    RETURN json_build_object(''ok'', false, ''error'', ''Accès refusé à cette session'');\n  END IF;');
  perform app.replace_in_function('public.trainer_proxy_sign(uuid, uuid, date, text, text, text, text, text, text, text, text)'::regprocedure, v_auth_check,
    E'/* garde chantier 2 */ IF NOT app.can_edit_session(p_session_id) THEN\n    RETURN json_build_object(''ok'', false, ''error'', ''Accès refusé à cette session'');\n  END IF;');
  perform app.replace_in_function('public.trainer_sign_halfday(uuid, uuid, date, text, text, timestamptz, text)'::regprocedure, v_auth_check,
    E'/* garde chantier 2 */ IF NOT app.can_edit_session(p_session_id) THEN\n    RETURN json_build_object(''ok'', false, ''error'', ''Accès refusé à cette session'');\n  END IF;');
  perform app.replace_in_function('public.get_trainer_sign_data(uuid)'::regprocedure, v_auth_check,
    E'/* garde chantier 2 */ IF NOT app.can_read_session(p_session_id) THEN\n    RETURN json_build_object(''ok'', false, ''error'', ''Accès refusé à cette session'');\n  END IF;');
  perform app.inject_guard('public.admin_regenerate_access_code(uuid)'::regprocedure,
    'if not app.can_edit_session((select st.session_id from public.session_trainees st where st.id = p_session_trainee_id)) then raise exception ''Accès refusé'' using errcode = ''42501''; end if;');
  perform app.inject_guard('public.get_trainee_positioning_test(uuid, uuid)'::regprocedure,
    'if not app.can_read_session(p_session_id) then raise exception ''Accès refusé'' using errcode = ''42501''; end if;');

  -- Données personnelles et purge : direction et gestion
  perform app.inject_guard('public.export_trainee_data(uuid)'::regprocedure, v_mgr);
  perform app.inject_guard('public.purge_trainee(uuid, text)'::regprocedure, v_mgr);
  perform app.inject_guard('public.get_purge_stats()'::regprocedure, v_mgr);

  -- Journal d'audit et déconnexion forcée : administrateurs
  perform app.inject_guard('public.get_audit_logs(text, uuid, text, text, timestamptz, timestamptz, integer)'::regprocedure,
    'perform app.require_roles(array[''superadmin'', ''admin'']);');
  perform app.inject_guard('public.admin_logout_user(text)'::regprocedure,
    'perform app.require_roles(array[''superadmin'', ''admin'']);');

  -- Clients : personnel commercial
  perform app.inject_guard('public.detect_client_links(uuid)'::regprocedure,
    'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'', ''commercial'', ''comptable'', ''formateur'', ''lecture'']);');
  perform app.inject_guard('public.client_contact_sync_primary(uuid)'::regprocedure,
    'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'', ''commercial'']);');

  -- Tableau de bord : seulement pour soi
  perform app.inject_guard('public.init_dashboard_widgets(uuid)'::regprocedure,
    'if p_user_id is distinct from auth.uid() then raise exception ''Accès refusé'' using errcode = ''42501''; end if;');
  perform app.inject_guard('public.save_widget_configs(uuid, jsonb)'::regprocedure,
    'if p_user_id is distinct from auth.uid() then raise exception ''Accès refusé'' using errcode = ''42501''; end if;');

  -- Interventions : le technicien ne clôt que ses visites ; la génération des visites d'un contrat
  -- est réservée à la gestion
  perform app.inject_guard('public.itv_close_visit(uuid)'::regprocedure,
    'if app.role() = ''technicien'' and p_visit not in (select app.tech_visit_ids()) then raise exception ''Accès refusé'' using errcode = ''42501''; end if;');
  perform app.inject_guard('public.itv_generate_contract_visits(uuid, integer)'::regprocedure, v_mgr);
end $$;

-- Budget : lu avec les droits de l'utilisateur (règles du budget, transactions privées comprises)
alter function public.get_budget_kpis() security invoker;

-- Données de démonstration : résumé pour la direction et la gestion seulement
create or replace function public.demo_data_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(app.role() = any (array['superadmin', 'admin', 'direction', 'gestionnaire']), false)
    then (select coalesce(jsonb_object_agg(tbl, n), '{}'::jsonb) from (select tbl, count(*) n from demo_records group by tbl) x)
    else '{}'::jsonb
  end
$$;

-- 3. Droits d'exécution ---------------------------------------------------------------------------------

do $$
declare
  r record;
  anon_ok text[] := array[
    'get_public_branding', 'get_portal_session', 'verify_trainee_access_code', 'load_trainee_data',
    'update_trainee_data', 'save_trainee_info', 'portal_set_email_refused', 'portal_sign_halfday',
    'save_evaluation', 'save_positioning_test_answers', 'portal_quiz_questions', 'portal_quiz_check',
    'portal_quiz_finish', 'portal_quiz_summary', 'portal_documents', 'portal_log_download',
    'public_reclamation_session', 'public_reclamation_submit', 'client_portal_data', 'client_portal_org',
    'published_quality_doc', 'referent_handicap_info', 'quality_demo_names_active'
  ];
  internal text[] := array[
    'cron_call_vercel', 'mailing_tick', 'signature_tick', 'signature_weekly_tick', 'social_tick',
    'decrypt_ssn', 'encrypt_ssn', 'write_halfday_signature', 'refresh_presence_complete', 'signature_refusal',
    'session_missing_signatures', 'signature_alert_mark_sent', 'signature_alerts_due', 'signature_weekly_report',
    'recompute_invoice_credits', 'generate_access_code', 'mailing_claim_next_send', 'mailing_claim_campaign_slot',
    'get_ungeo_postal_codes', 'rls_auto_enable', 'client_portal_check'
  ];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname, p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype) as is_trigger
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    if r.is_trigger or r.proname = any (internal) then
      execute format('revoke execute on function %s from authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    else
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
    end if;
    if r.proname = any (anon_ok) then
      execute format('grant execute on function %s to anon', r.sig);
    end if;
  end loop;
  -- Le planificateur exécute les tâches avec le rôle postgres
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('cron_call_vercel', 'mailing_tick', 'signature_tick', 'signature_weekly_tick', 'social_tick')
  loop
    execute format('grant execute on function %s to postgres', r.sig);
  end loop;
end $$;

alter default privileges for role postgres in schema public revoke execute on functions from public, anon;

insert into public.schema_migrations (version) values ('0085_securite_fonctions') on conflict (version) do nothing;

-- ===== 0086_securite_stockage.sql =====
-- 0086_securite_stockage.sql : fichiers (Storage) par rôle (chantier 2, Q4).
-- Avant : le bucket documents acceptait lecture, envoi, remplacement et suppression par tout visiteur
-- non connecté ; les autres buckets étaient ouverts à tout compte connecté (technicien compris).
-- Après :
--   * plus aucune écriture, suppression ni liste de fichiers par un visiteur non connecté ;
--   * chaque bucket a une règle par action selon la matrice du chantier 2 ;
--   * documents RESTE en lecture par lien public pour l'instant : 33 endroits du code (programmes,
--     cartes FORPREV, courriers, scans d'analyse du besoin, pièces jointes des emails) stockent et
--     relisent le lien public. Le passer en privé demande de servir ces fichiers par liens signés
--     partout (travail séparé, voir le compte rendu du chantier 2). Les chemins ne sont pas
--     listables par un visiteur ;
--   * course-documents, media et trainer-signatures restent lisibles par lien public (supports de
--     formation du portail, logo, signatures imprimées sur les PDF) ;
--   * les règles des buckets certification et interventions (0030, 0050) ne changent pas.
-- Migration idempotente. Retour arrière : supabase/rollback/0080-0086_securite_retour.sql (les sept migrations ensemble)

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname not like 'certification\_%' and policyname not like 'interventions\_%'
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

-- Lecture publique conservée : supports de formation, médias, signatures des formateurs
create policy odet_public_lire on storage.objects for select to anon, authenticated
  using (bucket_id in ('course-documents', 'media', 'trainer-signatures'));

-- documents : personnel de bureau (la lecture par lien public reste possible, voir en tête)
create policy odet_documents_lire on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture']));
create policy odet_documents_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));
create policy odet_documents_modifier on storage.objects for update to authenticated
  using (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']))
  with check (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));
create policy odet_documents_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));

-- Emails de session, pièces jointes, conventions signées : personnel de bureau
create policy odet_bureau_lire on storage.objects for select to authenticated
  using (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture']));
create policy odet_bureau_creer on storage.objects for insert to authenticated
  with check (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));
create policy odet_bureau_modifier on storage.objects for update to authenticated
  using (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']))
  with check (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));
create policy odet_bureau_supprimer on storage.objects for delete to authenticated
  using (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));

-- Campagnes email
create policy odet_mailing_lire on storage.objects for select to authenticated
  using (bucket_id = 'mailing-attachments' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));
create policy odet_mailing_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'mailing-attachments' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));
create policy odet_mailing_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'mailing-attachments' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));

-- Budget et relevés bancaires
create policy odet_finance_lire on storage.objects for select to authenticated
  using (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']));
create policy odet_finance_creer on storage.objects for insert to authenticated
  with check (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']));
create policy odet_finance_modifier on storage.objects for update to authenticated
  using (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']))
  with check (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']));
create policy odet_finance_supprimer on storage.objects for delete to authenticated
  using (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']));

-- Supports de formation : gestion
create policy odet_supports_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'course-documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire']));
create policy odet_supports_modifier on storage.objects for update to authenticated
  using (bucket_id = 'course-documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire']))
  with check (bucket_id = 'course-documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire']));
create policy odet_supports_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'course-documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire']));

-- Médias (logo, réseaux sociaux) : administrateurs et personnel commercial
create policy odet_media_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));
create policy odet_media_modifier on storage.objects for update to authenticated
  using (bucket_id = 'media' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']))
  with check (bucket_id = 'media' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));
create policy odet_media_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));

-- Signatures des formateurs
create policy odet_signatures_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur']));
create policy odet_signatures_modifier on storage.objects for update to authenticated
  using (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur']))
  with check (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur']));
create policy odet_signatures_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur']));

insert into public.schema_migrations (version) values ('0086_securite_stockage') on conflict (version) do nothing;

-- ===== droits_chantier2.sql =====
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
      ('com', 'lit la base prospects', 'select count(*) from public.prospection_massive', 'non_vide'),
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
      ('ad', 'modifie un gestionnaire', 'with x as (update public.profiles set fonction = fonction where id = ''' || u_ges || ''' returning 1) select count(*) from x', '=1'),
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
    select r->>'ticket' into v_ticket from (select public.verify_trainee_access_code(v_st1, v_code) r) x;
    select count(*) into v_n from (select public.load_trainee_data(v_token, v_tr1, v_ticket) d) x
      where d->'info_sheet'->>'ssn' is null and (d->'info_sheet'->>'ssn_on_file')::boolean
        and d->'info_sheet'->>'ssn_last3' = '436';
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

  -- Passeport de prévention (si le module est installé) : pp_nir réservée au serveur
  if to_regclass('public.pp_nir') is not null then
    v_total := v_total + 2;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pp_nir')
       and not has_table_privilege('authenticated', 'public.pp_nir', 'SELECT') then
      v_lines := v_lines || 'OK      base  pp_nir : aucune règle, aucun droit pour les comptes connectés'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  pp_nir : aucune règle, aucun droit pour les comptes connectés'::text; end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'pp\_%'
                   and (coalesce(qual, '') || coalesce(with_check, '')) not like '%app.grp(''mgr'')%') then
      v_lines := v_lines || 'OK      base  tables pp_* réservées à la direction et à la gestion'::text;
    else v_fail := v_fail + 1; v_lines := v_lines || 'ÉCHEC   base  tables pp_* réservées à la direction et à la gestion'::text; end if;
  end if;

  raise exception E'RÉSULTAT DES TESTS DE DROITS (tout est annulé)\n%\n\n% test(s), % échec(s)',
    array_to_string(v_lines, E'\n'), v_total, v_fail;
end
$test$;
