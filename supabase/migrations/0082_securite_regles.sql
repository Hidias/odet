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
