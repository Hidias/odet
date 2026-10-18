-- 0370-0375_droits_retour.sql : retour arrière des droits composés (chantier C1b, migrations 0370 à 0375).
-- FICHIER GÉNÉRÉ par scripts/securite/regles.py. Ne pas modifier à la main.
-- Remet exactement l'état d'après C1a : règles d'accès de 0082 (écriture « rôles ») et de 0273, fonctions
-- app.member_role et app.companies_guard d'origine, contraintes de rôle d'origine ; supprime les tables, vues et
-- fonctions de C1b. Les profils attribués dans company_member_roles (table de C1a) sont gardés.
-- Refuse de s'exécuter si un compte a le rôle de base « membre » (lui donner un autre rôle d'abord).

do $$
begin
  if exists (select 1 from public.profiles where role = 'membre')
     or exists (select 1 from public.company_members where role = 'membre') then
    raise exception 'Retour arrière impossible : des comptes ont le rôle de base « membre » ; leur donner un autre rôle d''abord';
  end if;
end $$;

-- 1. Règles d'accès d'avant C1b
-- Suppression des règles nommées du générateur (lire, créer, modifier, supprimer) ; les autres règles
-- (règle restrictive des notifications de 0070, etc.) ne sont pas touchées
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['accounting_periods', 'app_versions', 'approval_delegations', 'approval_requests', 'approval_rules', 'attendance_halfdays', 'attendance_proxy_signatures', 'attendances', 'audit_logs', 'audits_internes', 'bank_statements', 'bpf_declarations', 'budget_actions', 'budget_categories', 'budget_emails_sent', 'budget_meal_guests', 'budget_pipeline', 'budget_receipts', 'budget_rules', 'budget_settings', 'budget_transaction_invoices', 'budget_transactions', 'call_arguments', 'call_objections', 'cert_audit_findings', 'cert_criteria', 'cert_documents', 'cert_indicator_status', 'cert_indicators', 'cert_proofs', 'cert_referentials', 'cert_settings', 'client_contacts', 'client_interactions', 'client_portal_access', 'client_providers', 'clients', 'company_member_rights', 'company_member_roles', 'completude_alerts', 'completude_tracking', 'course_document_downloads', 'course_documents', 'course_equipment', 'course_questions', 'courses', 'dashboard_widget_configs', 'demo_records', 'document_signatures', 'documents', 'duerp_actions', 'duerp_equipements', 'duerp_formations_reglementaires', 'duerp_habilitations', 'duerp_projects', 'duerp_risk_categories', 'duerp_risk_templates', 'duerp_risks', 'duerp_sector_templates', 'duerp_units', 'duerp_verifications', 'equipment_catalog', 'evaluations_cold', 'import_logs', 'invoice_emails_sent', 'invoice_items', 'invoice_payments', 'invoice_relances', 'invoice_sessions', 'invoices', 'itv_contracts', 'itv_equipment', 'itv_equipment_types', 'itv_parts', 'itv_settings', 'itv_technicians', 'itv_visit_items', 'itv_visit_parts', 'itv_visits', 'mailing_blocklist', 'mailing_campaigns', 'mailing_email_status', 'mailing_segments', 'mailing_sends', 'mailing_templates', 'non_conformites', 'non_conformities', 'notifications', 'offer_items', 'offer_restrictions', 'offers', 'org_modules', 'org_settings', 'organization_settings', 'permission_profile_rights', 'permission_profiles', 'permissions', 'phoning_sessions', 'positioning_questions_ref', 'positioning_results', 'positioning_themes', 'process_categories', 'process_connections', 'process_responsibles', 'process_steps', 'process_versions', 'processes', 'profiles', 'programme_versions', 'prospect_calls', 'prospect_email_logs', 'prospect_needs_analysis', 'prospect_rdv', 'prospection_massive', 'psh_requests', 'qualiopi_documents', 'qualiopi_indicators', 'quality_alerts', 'quality_doc_versions', 'quality_documents', 'quality_roles', 'quiz_attempts', 'quote_items', 'quotes', 'rdv_emails_sent', 'rdv_kit_documents', 'reclamations', 'rgpd_traitements', 'schema_migrations', 'session_checklists', 'session_costs', 'session_document_access', 'session_documents', 'session_emails_sent', 'session_equipment', 'session_fundings', 'session_groups', 'session_needs_analysis', 'session_qualiopi', 'session_trainees', 'session_trainers', 'sessions', 'signature_alerts_sent', 'sites', 'social_media_library', 'social_posts', 'social_tokens', 'sst_certifications', 'theme_questions', 'trainee_documents', 'trainee_evaluations', 'trainee_info_sheets', 'trainee_objectives', 'trainee_positioning_tests', 'trainees', 'trainees_archive', 'trainer_certificates', 'trainer_evaluations', 'trainer_interviews', 'trainer_qualifications', 'trainer_trainings', 'trainers', 'training_themes', 'uploaded_documents', 'uploaded_files', 'user_email_configs', 'user_planning_events', 'veille_qualiopi', 'veille_sources'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
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

-- audits_internes, bpf_declarations, non_conformites, non_conformities, process_categories, process_connections, process_responsibles, process_steps, process_versions, processes, qualiopi_indicators, quality_alerts, reclamations, rgpd_traitements, veille_qualiopi, veille_sources (module qualite)
select pg_temp.regles(array['audits_internes', 'bpf_declarations', 'non_conformites', 'non_conformities', 'process_categories', 'process_connections', 'process_responsibles', 'process_steps', 'process_versions', 'processes', 'qualiopi_indicators', 'quality_alerts', 'reclamations', 'rgpd_traitements', 'veille_qualiopi', 'veille_sources'], $r$qualite$r$,
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

-- psh_requests (module qualite)
select pg_temp.regles(array['psh_requests'], $r$qualite$r$,
  $r$(select app.can_see_disability())$r$,
  $r$(select app.can_see_disability())$r$,
  $r$(select app.can_see_disability())$r$,
  $r$(select app.can_see_disability())$r$);

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

-- company_member_roles
select pg_temp.regles(array['company_member_roles'], null,
  $r$member_id in (select m.id from public.company_members m)$r$,
  $r$member_id in (select m.id from public.company_members m where app.is_company_admin(m.company_id))$r$,
  $r$member_id in (select m.id from public.company_members m where app.is_company_admin(m.company_id))$r$,
  $r$member_id in (select m.id from public.company_members m where app.is_company_admin(m.company_id))$r$);

-- 2. Vues et fonctions de C1b
drop view if exists public.itv_parts_terrain, public.itv_settings_terrain, public.itv_visit_parts_terrain;
drop function if exists public.itv_visit_part_add(uuid, uuid, text, numeric), public.itv_visit_part_set_quantity(uuid, numeric),
  public.itv_visit_part_remove(uuid), app.itv_can_edit_visit_parts(uuid), app.itv_visit_part_json(uuid);
drop function if exists public.approval_required(text, numeric, uuid), public.approval_submit(text, text, uuid, numeric, uuid, text),
  public.approval_decide(uuid, text, text), public.approval_cancel(uuid),
  public.approval_delegate(uuid, timestamptz, text, text, timestamptz), public.approval_delegation_revoke(uuid),
  app.approval_rule_for(uuid, text, uuid);
drop trigger if exists company_member_roles_guard on public.company_member_roles;
drop index if exists public.company_member_roles_member_idx;

-- 3. Tables de C1b
drop table if exists public.approval_requests, public.approval_delegations, public.approval_rules,
  public.company_member_rights, public.permission_profile_rights, public.permission_profiles,
  public.offer_items, public.offer_restrictions;
alter table public.companies drop column if exists offer_id;
drop table if exists public.offers, public.permissions;

drop function if exists public.my_rights(), public.external_accountant_set_quotes(boolean), app.approval_can_decide(uuid, text, text, uuid, text), app.offer_allows(uuid, text, text),
  app.societes_avec_droit(text), app.a_le_droit_dans(uuid, text), app.a_le_droit(text), app.rights(),
  app.rights_for(uuid, uuid), app.profiles_for(uuid, uuid), app.role_of(uuid),
  app.profile_rights_company(), app.permission_profiles_guard(), app.profile_rights_guard(),
  app.member_rights_guard(), app.member_roles_guard();

-- 4. Fonctions de C1a dans leur version d'origine (0271, 0272)
create or replace function app.member_role(p_role text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_role in ('admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture')
              then p_role end
$$;

create or replace function app.companies_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    if (new.support_access_mode, new.support_access_hours) is distinct from (old.support_access_mode, old.support_access_hours)
       and coalesce(current_setting('odet.changement_acces_support', true), '') <> 'oui' then
      raise exception 'Le mode d''accès de support ne se change que par l''administrateur de la société'
        using errcode = '42501';
    end if;
    if (new.full_license, new.is_instance_owner) is distinct from (old.full_license, old.is_instance_owner)
       and not app.is_superadmin() then
      raise exception 'Licence et société n° 1 : réservées au super administrateur' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;

-- 5. Contraintes de rôle d'origine (0080, 0270)
alter table public.company_members drop constraint if exists company_members_role_check;
alter table public.company_members add constraint company_members_role_check
  check (role in ('admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture'));
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role = any (array[
  'superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture',
  'entreprise', 'formateur_externe', 'stagiaire'
]::text[]));

-- 6. Registre des migrations
delete from public.schema_migrations where version in ('0370_droits_tables', '0371_droits_fonctions',
  '0372_droits_catalogue', '0373_droits_regles', '0374_droits_prix_terrain', '0375_droits_validations');
