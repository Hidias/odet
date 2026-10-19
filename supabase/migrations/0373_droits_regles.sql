-- 0373_droits_regles.sql : règles d'accès par droits élémentaires (chantier C1b).
-- FICHIER GÉNÉRÉ par scripts/securite/regles.py : même matrice que 0082, écriture « droits ».
-- Ne pas modifier à la main : modifier la matrice ou le catalogue, relancer le script.
--
-- Chaque règle demande un droit nommé à la fonction unique app.a_le_droit(code) (0371), évaluée une fois par requête.
-- Les modèles de profils qui reprennent un rôle (0372) ont exactement les droits que la matrice donnait à ce rôle :
-- aucun compte ne change d'accès, sauf le technicien qui ne lit plus aucun prix en base (itv_parts, itv_settings,
-- itv_visit_parts : lecture réservée à « Voir les prix des interventions » ; vues sans prix en 0374).
-- Les gardes de module, les règles propres (handicap, budget privé, Passeport, suivi formatif, stockage) et la règle
-- restrictive des notifications (0070) sont inchangées.
-- Migration idempotente. Retour arrière : supabase/rollback/0370-0375_droits_retour.sql

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

-- ===== Tables de la matrice du chantier 2 =====

-- accounting_periods, bank_statements, budget_actions, budget_categories, budget_emails_sent, budget_meal_guests, budget_pipeline, budget_receipts, budget_rules, budget_settings, budget_transaction_invoices (module finance ou comptabilite)
select pg_temp.regles(array['accounting_periods', 'bank_statements', 'budget_actions', 'budget_categories', 'budget_emails_sent', 'budget_meal_guests', 'budget_pipeline', 'budget_receipts', 'budget_rules', 'budget_settings', 'budget_transaction_invoices'], $r$finance|comptabilite$r$,
  $r$(select app.a_le_droit('finance.budget.gerer'))$r$,
  $r$(select app.a_le_droit('finance.budget.gerer'))$r$,
  $r$(select app.a_le_droit('finance.budget.gerer'))$r$,
  $r$(select app.a_le_droit('finance.budget.gerer'))$r$);

-- app_versions
select pg_temp.regles(array['app_versions'], null,
  $r$(select app.a_le_droit('organisation.reglages.voir'))$r$,
  $r$(select app.a_le_droit('plateforme.administrer'))$r$,
  $r$(select app.a_le_droit('plateforme.administrer'))$r$,
  $r$(select app.a_le_droit('plateforme.administrer'))$r$);

-- attendance_halfdays, attendance_proxy_signatures, attendances, document_signatures
select pg_temp.regles(array['attendance_halfdays', 'attendance_proxy_signatures', 'attendances', 'document_signatures'], null,
  $r$((select app.a_le_droit('formation.suivi.voir')) or ((select app.a_le_droit('formation.sessions.voir_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.a_le_droit('formation.suivi.gerer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.a_le_droit('formation.suivi.gerer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$(select app.a_le_droit('formation.suivi.gerer'))$r$);

-- audit_logs
select pg_temp.regles(array['audit_logs'], null,
  $r$(select app.a_le_droit('conformite.journal.voir'))$r$,
  $r$(select app.a_le_droit('organisation.journal.ecrire'))$r$,
  null,
  null);

-- audits_internes, bpf_declarations, non_conformites, non_conformities, process_categories, process_connections, process_responsibles, process_steps, process_versions, processes, qualiopi_indicators, quality_alerts, reclamations, rgpd_traitements, veille_qualiopi, veille_sources (module qualite)
select pg_temp.regles(array['audits_internes', 'bpf_declarations', 'non_conformites', 'non_conformities', 'process_categories', 'process_connections', 'process_responsibles', 'process_steps', 'process_versions', 'processes', 'qualiopi_indicators', 'quality_alerts', 'reclamations', 'rgpd_traitements', 'veille_qualiopi', 'veille_sources'], $r$qualite$r$,
  $r$(select app.a_le_droit('qualite.registres.voir'))$r$,
  $r$(select app.a_le_droit('qualite.registres.signaler'))$r$,
  $r$(select app.a_le_droit('qualite.registres.gerer'))$r$,
  $r$(select app.a_le_droit('qualite.registres.gerer'))$r$);

-- budget_transactions (module finance ou comptabilite)
select pg_temp.regles(array['budget_transactions'], $r$finance|comptabilite$r$,
  $r$((select app.a_le_droit('finance.budget.gerer')) and (is_private = false or private_owner = ((select auth.jwt()) ->> 'email')))$r$,
  $r$((select app.a_le_droit('finance.budget.gerer')) and (is_private = false or private_owner = ((select auth.jwt()) ->> 'email')))$r$,
  $r$((select app.a_le_droit('finance.budget.gerer')) and (is_private = false or private_owner = ((select auth.jwt()) ->> 'email')))$r$,
  $r$((select app.a_le_droit('finance.budget.gerer')) and (is_private = false or private_owner = ((select auth.jwt()) ->> 'email')))$r$);

-- call_arguments, call_objections, import_logs, phoning_sessions, prospect_calls, prospect_email_logs, prospect_needs_analysis, prospect_rdv, rdv_emails_sent, rdv_kit_documents (module prospection)
select pg_temp.regles(array['call_arguments', 'call_objections', 'import_logs', 'phoning_sessions', 'prospect_calls', 'prospect_email_logs', 'prospect_needs_analysis', 'prospect_rdv', 'rdv_emails_sent', 'rdv_kit_documents'], $r$prospection$r$,
  $r$(select app.a_le_droit('commercial.prospection.voir'))$r$,
  $r$(select app.a_le_droit('commercial.prospection.gerer'))$r$,
  $r$(select app.a_le_droit('commercial.prospection.gerer'))$r$,
  $r$(select app.a_le_droit('commercial.prospection.gerer'))$r$);

-- cert_audit_findings, cert_criteria, cert_documents, cert_indicator_status, cert_indicators, cert_proofs, cert_referentials, cert_settings (module certification)
select pg_temp.regles(array['cert_audit_findings', 'cert_criteria', 'cert_documents', 'cert_indicator_status', 'cert_indicators', 'cert_proofs', 'cert_referentials', 'cert_settings'], $r$certification$r$,
  $r$(select app.a_le_droit('qualite.certification.gerer'))$r$,
  $r$(select app.a_le_droit('qualite.certification.gerer'))$r$,
  $r$(select app.a_le_droit('qualite.certification.gerer'))$r$,
  $r$(select app.a_le_droit('qualite.certification.gerer'))$r$);

-- client_contacts, sites
select pg_temp.regles(array['client_contacts', 'sites'], null,
  $r$((select app.a_le_droit('clients.fiches.voir')) or ((select app.a_le_droit('interventions.missions.voir')) and client_id in (select app.tech_client_ids())))$r$,
  $r$(select app.a_le_droit('clients.fiches.modifier'))$r$,
  $r$(select app.a_le_droit('clients.fiches.modifier'))$r$,
  $r$(select app.a_le_droit('clients.fiches.modifier'))$r$);

-- client_interactions
select pg_temp.regles(array['client_interactions'], null,
  $r$(select app.a_le_droit('clients.fiches.voir'))$r$,
  $r$(select app.a_le_droit('clients.historique.ecrire'))$r$,
  $r$(select app.a_le_droit('clients.fiches.modifier'))$r$,
  $r$(select app.a_le_droit('clients.fiches.supprimer'))$r$);

-- client_portal_access, client_providers
select pg_temp.regles(array['client_portal_access', 'client_providers'], null,
  $r$(select app.a_le_droit('clients.espace.gerer'))$r$,
  $r$(select app.a_le_droit('clients.espace.gerer'))$r$,
  $r$(select app.a_le_droit('clients.espace.gerer'))$r$,
  $r$(select app.a_le_droit('clients.espace.gerer'))$r$);

-- clients
select pg_temp.regles(array['clients'], null,
  $r$((select app.a_le_droit('clients.fiches.voir')) or ((select app.a_le_droit('interventions.missions.voir')) and id in (select app.tech_client_ids())))$r$,
  $r$(select app.a_le_droit('clients.fiches.modifier'))$r$,
  $r$(select app.a_le_droit('clients.fiches.modifier'))$r$,
  $r$(select app.a_le_droit('clients.fiches.supprimer'))$r$);

-- completude_alerts, completude_tracking
select pg_temp.regles(array['completude_alerts', 'completude_tracking'], null,
  $r$(select app.a_le_droit('qualite.completude.suivre'))$r$,
  $r$(select app.a_le_droit('qualite.completude.suivre'))$r$,
  $r$(select app.a_le_droit('qualite.completude.suivre'))$r$,
  $r$(select app.a_le_droit('qualite.completude.supprimer'))$r$);

-- course_document_downloads
select pg_temp.regles(array['course_document_downloads'], null,
  $r$((select app.a_le_droit('formation.suivi.voir')) or ((select app.a_le_droit('formation.sessions.voir_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.a_le_droit('formation.sessions.preparer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  null,
  $r$(select app.a_le_droit('formation.suivi.gerer'))$r$);

-- course_documents, course_equipment, courses, equipment_catalog, programme_versions, trainer_qualifications, training_themes
select pg_temp.regles(array['course_documents', 'course_equipment', 'courses', 'equipment_catalog', 'programme_versions', 'trainer_qualifications', 'training_themes'], null,
  $r$(select app.a_le_droit('formation.catalogue.voir'))$r$,
  $r$(select app.a_le_droit('formation.catalogue.gerer'))$r$,
  $r$(select app.a_le_droit('formation.catalogue.gerer'))$r$,
  $r$(select app.a_le_droit('formation.catalogue.gerer'))$r$);

-- course_questions, positioning_questions_ref, positioning_themes, theme_questions
select pg_temp.regles(array['course_questions', 'positioning_questions_ref', 'positioning_themes', 'theme_questions'], null,
  $r$(select app.a_le_droit('formation.catalogue.voir'))$r$,
  $r$(select app.a_le_droit('formation.questions.modifier'))$r$,
  $r$(select app.a_le_droit('formation.questions.modifier'))$r$,
  $r$(select app.a_le_droit('formation.catalogue.gerer'))$r$);

-- dashboard_widget_configs, user_email_configs
select pg_temp.regles(array['dashboard_widget_configs', 'user_email_configs'], null,
  $r$((select app.a_le_droit('organisation.preferences.gerer')) and user_id = (select auth.uid()))$r$,
  $r$((select app.a_le_droit('organisation.preferences.gerer')) and user_id = (select auth.uid()))$r$,
  $r$((select app.a_le_droit('organisation.preferences.gerer')) and user_id = (select auth.uid()))$r$,
  $r$((select app.a_le_droit('organisation.preferences.gerer')) and user_id = (select auth.uid()))$r$);

-- demo_records, schema_migrations
select pg_temp.regles(array['demo_records', 'schema_migrations'], null,
  $r$(select app.a_le_droit('plateforme.administrer'))$r$,
  null,
  null,
  null);

-- documents, uploaded_documents, uploaded_files
select pg_temp.regles(array['documents', 'uploaded_documents', 'uploaded_files'], null,
  $r$(select app.a_le_droit('formation.documents.voir'))$r$,
  $r$(select app.a_le_droit('formation.documents.modifier'))$r$,
  $r$(select app.a_le_droit('formation.documents.modifier'))$r$,
  $r$(select app.a_le_droit('formation.documents.supprimer'))$r$);

-- duerp_actions, duerp_equipements, duerp_formations_reglementaires, duerp_habilitations, duerp_projects, duerp_risk_categories, duerp_risk_templates, duerp_risks, duerp_sector_templates, duerp_units, duerp_verifications (module duerp)
select pg_temp.regles(array['duerp_actions', 'duerp_equipements', 'duerp_formations_reglementaires', 'duerp_habilitations', 'duerp_projects', 'duerp_risk_categories', 'duerp_risk_templates', 'duerp_risks', 'duerp_sector_templates', 'duerp_units', 'duerp_verifications'], $r$duerp$r$,
  $r$(select app.a_le_droit('prestations.duerp.gerer'))$r$,
  $r$(select app.a_le_droit('prestations.duerp.gerer'))$r$,
  $r$(select app.a_le_droit('prestations.duerp.gerer'))$r$,
  $r$(select app.a_le_droit('prestations.duerp.gerer'))$r$);

-- evaluations_cold, trainee_evaluations, trainer_evaluations
select pg_temp.regles(array['evaluations_cold', 'trainee_evaluations', 'trainer_evaluations'], null,
  $r$((select app.a_le_droit('formation.suivi.voir')) or ((select app.a_le_droit('formation.sessions.voir_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.a_le_droit('formation.suivi.gerer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$(select app.a_le_droit('plateforme.administrer'))$r$,
  $r$(select app.a_le_droit('plateforme.administrer'))$r$);

-- invoice_emails_sent, invoice_relances
select pg_temp.regles(array['invoice_emails_sent', 'invoice_relances'], null,
  $r$(select app.a_le_droit('facturation.factures.voir'))$r$,
  $r$(select app.a_le_droit('facturation.factures.modifier'))$r$,
  $r$(select app.a_le_droit('facturation.factures.modifier'))$r$,
  $r$(select app.a_le_droit('facturation.factures.supprimer'))$r$);

-- invoice_items, invoice_payments, invoice_sessions
select pg_temp.regles(array['invoice_items', 'invoice_payments', 'invoice_sessions'], null,
  $r$(select app.a_le_droit('facturation.factures.voir'))$r$,
  $r$(select app.a_le_droit('facturation.factures.modifier'))$r$,
  $r$(select app.a_le_droit('facturation.factures.modifier'))$r$,
  $r$(select app.a_le_droit('facturation.factures.modifier'))$r$);

-- invoices
select pg_temp.regles(array['invoices'], null,
  $r$(select app.a_le_droit('facturation.factures.voir'))$r$,
  $r$(select app.a_le_droit('facturation.factures.modifier'))$r$,
  $r$(select app.a_le_droit('facturation.factures.modifier'))$r$,
  $r$((select app.a_le_droit('facturation.factures.supprimer')) or ((select app.a_le_droit('facturation.brouillons.supprimer')) and status = 'draft'))$r$);

-- itv_contracts (module interventions)
select pg_temp.regles(array['itv_contracts'], $r$interventions$r$,
  $r$(select app.a_le_droit('interventions.contrats.voir'))$r$,
  $r$(select app.a_le_droit('interventions.contrats.gerer'))$r$,
  $r$(select app.a_le_droit('interventions.contrats.gerer'))$r$,
  $r$(select app.a_le_droit('interventions.contrats.gerer'))$r$);

-- itv_equipment (module interventions)
select pg_temp.regles(array['itv_equipment'], $r$interventions$r$,
  $r$((select app.a_le_droit('interventions.parc.voir')) or ((select app.a_le_droit('interventions.missions.voir')) and client_id in (select app.tech_client_ids())))$r$,
  $r$((select app.a_le_droit('interventions.parc.gerer')) or ((select app.a_le_droit('interventions.parc.annoter')) and client_id in (select app.tech_client_ids())))$r$,
  $r$((select app.a_le_droit('interventions.parc.gerer')) or ((select app.a_le_droit('interventions.parc.annoter')) and client_id in (select app.tech_client_ids())))$r$,
  $r$(select app.a_le_droit('interventions.parc.gerer'))$r$);

-- itv_equipment_types, itv_technicians (module interventions)
select pg_temp.regles(array['itv_equipment_types', 'itv_technicians'], $r$interventions$r$,
  $r$(select app.a_le_droit('interventions.referentiel.voir'))$r$,
  $r$(select app.a_le_droit('interventions.reglages.gerer'))$r$,
  $r$(select app.a_le_droit('interventions.reglages.gerer'))$r$,
  $r$(select app.a_le_droit('interventions.reglages.gerer'))$r$);

-- itv_parts, itv_settings (module interventions)
select pg_temp.regles(array['itv_parts', 'itv_settings'], $r$interventions$r$,
  $r$(select app.a_le_droit('interventions.tarifs.voir'))$r$,
  $r$(select app.a_le_droit('interventions.reglages.gerer'))$r$,
  $r$(select app.a_le_droit('interventions.reglages.gerer'))$r$,
  $r$(select app.a_le_droit('interventions.reglages.gerer'))$r$);

-- itv_visit_items (module interventions)
select pg_temp.regles(array['itv_visit_items'], $r$interventions$r$,
  $r$((select app.a_le_droit('interventions.visites.voir')) or ((select app.a_le_droit('interventions.missions.voir')) and visit_id in (select app.tech_scope_visit_ids())))$r$,
  $r$((select app.a_le_droit('interventions.visites.gerer')) or ((select app.a_le_droit('interventions.missions.realiser')) and visit_id in (select app.tech_visit_ids())))$r$,
  $r$((select app.a_le_droit('interventions.visites.gerer')) or ((select app.a_le_droit('interventions.missions.realiser')) and visit_id in (select app.tech_visit_ids())))$r$,
  $r$((select app.a_le_droit('interventions.visites.gerer')) or ((select app.a_le_droit('interventions.missions.realiser')) and visit_id in (select app.tech_visit_ids())))$r$);

-- itv_visit_parts (module interventions)
select pg_temp.regles(array['itv_visit_parts'], $r$interventions$r$,
  $r$(select app.a_le_droit('interventions.tarifs.voir'))$r$,
  $r$((select app.a_le_droit('interventions.visites.gerer')) or ((select app.a_le_droit('interventions.missions.realiser')) and visit_id in (select app.tech_visit_ids())))$r$,
  $r$((select app.a_le_droit('interventions.visites.gerer')) or ((select app.a_le_droit('interventions.missions.realiser')) and visit_id in (select app.tech_visit_ids())))$r$,
  $r$((select app.a_le_droit('interventions.visites.gerer')) or ((select app.a_le_droit('interventions.missions.realiser')) and visit_id in (select app.tech_visit_ids())))$r$);

-- itv_visits (module interventions)
select pg_temp.regles(array['itv_visits'], $r$interventions$r$,
  $r$((select app.a_le_droit('interventions.visites.voir')) or ((select app.a_le_droit('interventions.missions.voir')) and client_id in (select app.tech_client_ids())))$r$,
  $r$((select app.a_le_droit('interventions.visites.gerer')) or (((select app.a_le_droit('interventions.missions.realiser')) and technician_id = (select auth.uid())) and client_id in (select app.tech_client_ids())))$r$,
  $r$((select app.a_le_droit('interventions.visites.gerer')) or ((select app.a_le_droit('interventions.missions.realiser')) and technician_id = (select auth.uid())))$r$,
  $r$(select app.a_le_droit('interventions.visites.gerer'))$r$);

-- mailing_blocklist, mailing_campaigns, mailing_email_status, mailing_segments, mailing_sends, mailing_templates (module mailing)
select pg_temp.regles(array['mailing_blocklist', 'mailing_campaigns', 'mailing_email_status', 'mailing_segments', 'mailing_sends', 'mailing_templates'], $r$mailing$r$,
  $r$(select app.a_le_droit('communication.campagnes.gerer'))$r$,
  $r$(select app.a_le_droit('communication.campagnes.gerer'))$r$,
  $r$(select app.a_le_droit('communication.campagnes.gerer'))$r$,
  $r$(select app.a_le_droit('communication.campagnes.gerer'))$r$);

-- notifications
select pg_temp.regles(array['notifications'], null,
  $r$(select app.a_le_droit('organisation.notifications.gerer'))$r$,
  $r$(select app.a_le_droit('organisation.notifications.gerer'))$r$,
  $r$(select app.a_le_droit('organisation.notifications.gerer'))$r$,
  $r$(select app.a_le_droit('organisation.notifications.supprimer'))$r$);

-- org_modules
select pg_temp.regles(array['org_modules'], null,
  $r$(select app.a_le_droit('organisation.reglages.voir'))$r$,
  $r$(select app.a_le_droit('parametres.modules.gerer'))$r$,
  $r$(select app.a_le_droit('parametres.modules.gerer'))$r$,
  $r$(select app.a_le_droit('parametres.modules.gerer'))$r$);

-- org_settings, organization_settings
select pg_temp.regles(array['org_settings', 'organization_settings'], null,
  $r$(select app.a_le_droit('organisation.reglages.voir'))$r$,
  $r$(select app.a_le_droit('parametres.organisme.modifier'))$r$,
  $r$(select app.a_le_droit('parametres.organisme.modifier'))$r$,
  $r$(select app.a_le_droit('plateforme.administrer'))$r$);

-- positioning_results, sst_certifications, trainee_info_sheets, trainee_objectives, trainee_positioning_tests
select pg_temp.regles(array['positioning_results', 'sst_certifications', 'trainee_info_sheets', 'trainee_objectives', 'trainee_positioning_tests'], null,
  $r$((select app.a_le_droit('formation.suivi.voir')) or ((select app.a_le_droit('formation.sessions.voir_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.a_le_droit('formation.suivi.gerer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.a_le_droit('formation.suivi.gerer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.a_le_droit('formation.suivi.gerer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$);

-- profiles
select pg_temp.regles(array['profiles'], null,
  $r$(id = (select auth.uid()) or (select app.a_le_droit('organisation.comptes.voir')))$r$,
  $r$(select app.a_le_droit('parametres.utilisateurs.gerer'))$r$,
  $r$(id = (select auth.uid()) or (select app.a_le_droit('plateforme.administrer')) or ((select app.a_le_droit('parametres.utilisateurs.gerer')) and role <> 'superadmin'))$r$,
  $r$((select app.a_le_droit('plateforme.administrer')) or ((select app.a_le_droit('parametres.utilisateurs.gerer')) and role <> 'superadmin'))$r$);

-- prospection_massive (module prospection)
select pg_temp.regles(array['prospection_massive'], $r$prospection$r$,
  $r$(select app.a_le_droit('commercial.prospection.voir'))$r$,
  $r$(select app.a_le_droit('commercial.prospection.gerer'))$r$,
  $r$(select app.a_le_droit('commercial.prospection.gerer'))$r$,
  $r$(select app.a_le_droit('commercial.prospection.supprimer'))$r$);

-- psh_requests (module qualite)
select pg_temp.regles(array['psh_requests'], $r$qualite$r$,
  $r$(select app.can_see_disability())$r$,
  $r$(select app.can_see_disability())$r$,
  $r$(select app.can_see_disability())$r$,
  $r$(select app.can_see_disability())$r$);

-- qualiopi_documents, quality_documents
select pg_temp.regles(array['qualiopi_documents', 'quality_documents'], null,
  $r$(select app.a_le_droit('qualite.documents.voir'))$r$,
  $r$(select app.a_le_droit('qualite.documents.gerer'))$r$,
  $r$(select app.a_le_droit('qualite.documents.gerer'))$r$,
  $r$(select app.a_le_droit('qualite.documents.gerer'))$r$);

-- quality_doc_versions
select pg_temp.regles(array['quality_doc_versions'], null,
  $r$(select app.a_le_droit('qualite.documents.voir'))$r$,
  $r$(select app.a_le_droit('qualite.documents.valider'))$r$,
  null,
  null);

-- quality_roles
select pg_temp.regles(array['quality_roles'], null,
  $r$(select app.a_le_droit('organisation.reglages.voir'))$r$,
  $r$(select app.a_le_droit('parametres.referents.gerer'))$r$,
  $r$(select app.a_le_droit('parametres.referents.gerer'))$r$,
  $r$(select app.a_le_droit('parametres.referents.gerer'))$r$);

-- quiz_attempts
select pg_temp.regles(array['quiz_attempts'], null,
  $r$((select app.a_le_droit('formation.suivi.voir')) or ((select app.a_le_droit('formation.sessions.voir_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  null,
  $r$(select app.a_le_droit('plateforme.administrer'))$r$,
  $r$(select app.a_le_droit('plateforme.administrer'))$r$);

-- quote_items
select pg_temp.regles(array['quote_items'], null,
  $r$(select app.a_le_droit('commercial.devis.voir'))$r$,
  $r$(select app.a_le_droit('commercial.devis.modifier'))$r$,
  $r$(select app.a_le_droit('commercial.devis.modifier'))$r$,
  $r$(select app.a_le_droit('commercial.devis.modifier'))$r$);

-- quotes
select pg_temp.regles(array['quotes'], null,
  $r$(select app.a_le_droit('commercial.devis.voir'))$r$,
  $r$(select app.a_le_droit('commercial.devis.modifier'))$r$,
  $r$(select app.a_le_droit('commercial.devis.modifier'))$r$,
  $r$(select app.a_le_droit('commercial.devis.supprimer'))$r$);

-- session_checklists, session_document_access, session_documents, session_emails_sent, session_equipment, session_needs_analysis, session_qualiopi
select pg_temp.regles(array['session_checklists', 'session_document_access', 'session_documents', 'session_emails_sent', 'session_equipment', 'session_needs_analysis', 'session_qualiopi'], null,
  $r$((select app.a_le_droit('formation.suivi.voir')) or ((select app.a_le_droit('formation.sessions.voir_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.a_le_droit('formation.sessions.preparer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.a_le_droit('formation.sessions.preparer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.a_le_droit('formation.suivi.gerer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$);

-- session_costs
select pg_temp.regles(array['session_costs'], null,
  $r$(select app.a_le_droit('formation.couts.gerer'))$r$,
  $r$(select app.a_le_droit('formation.couts.gerer'))$r$,
  $r$(select app.a_le_droit('formation.couts.gerer'))$r$,
  $r$(select app.a_le_droit('formation.couts.gerer'))$r$);

-- session_fundings, session_groups, session_trainers
select pg_temp.regles(array['session_fundings', 'session_groups', 'session_trainers'], null,
  $r$((select app.a_le_droit('formation.sessions.voir')) or ((select app.a_le_droit('formation.sessions.voir_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$(select app.a_le_droit('formation.sessions.modifier'))$r$,
  $r$(select app.a_le_droit('formation.sessions.modifier'))$r$,
  $r$(select app.a_le_droit('formation.sessions.modifier'))$r$);

-- session_trainees
select pg_temp.regles(array['session_trainees'], null,
  $r$((select app.a_le_droit('formation.stagiaires.voir')) or ((select app.a_le_droit('formation.sessions.voir_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.a_le_droit('formation.inscriptions.gerer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.a_le_droit('formation.inscriptions.gerer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$((select app.a_le_droit('formation.inscriptions.gerer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$);

-- sessions
select pg_temp.regles(array['sessions'], null,
  $r$((select app.a_le_droit('formation.sessions.voir')) or ((select app.a_le_droit('formation.sessions.voir_siennes')) and id in (select app.trainer_session_ids())))$r$,
  $r$(select app.a_le_droit('formation.sessions.creer'))$r$,
  $r$((select app.a_le_droit('formation.sessions.modifier')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and id in (select app.trainer_session_ids())))$r$,
  $r$(select app.a_le_droit('formation.sessions.supprimer'))$r$);

-- signature_alerts_sent
select pg_temp.regles(array['signature_alerts_sent'], null,
  $r$(select app.a_le_droit('formation.signatures.suivre'))$r$,
  null,
  null,
  null);

-- social_media_library, social_posts (module social)
select pg_temp.regles(array['social_media_library', 'social_posts'], $r$social$r$,
  $r$(select app.a_le_droit('communication.reseaux.gerer'))$r$,
  $r$(select app.a_le_droit('communication.reseaux.gerer'))$r$,
  $r$(select app.a_le_droit('communication.reseaux.gerer'))$r$,
  $r$(select app.a_le_droit('communication.reseaux.gerer'))$r$);

-- social_tokens (module social)
select pg_temp.regles(array['social_tokens'], $r$social$r$,
  $r$(select app.a_le_droit('parametres.reseaux_sociaux.voir'))$r$,
  null,
  null,
  null);

-- trainee_documents
select pg_temp.regles(array['trainee_documents'], null,
  $r$((select app.a_le_droit('formation.suivi.voir')) or ((select app.a_le_droit('formation.stagiaires.voir_siens')) and trainee_id in (select app.trainer_trainee_ids())))$r$,
  $r$((select app.a_le_droit('formation.suivi.gerer')) or ((select app.a_le_droit('formation.stagiaires.modifier_siens')) and trainee_id in (select app.trainer_trainee_ids())))$r$,
  $r$((select app.a_le_droit('formation.suivi.gerer')) or ((select app.a_le_droit('formation.stagiaires.modifier_siens')) and trainee_id in (select app.trainer_trainee_ids())))$r$,
  $r$(select app.a_le_droit('formation.suivi.gerer'))$r$);

-- trainees
select pg_temp.regles(array['trainees'], null,
  $r$((select app.a_le_droit('formation.stagiaires.voir')) or ((select app.a_le_droit('formation.stagiaires.voir_siens')) and id in (select app.trainer_trainee_ids())))$r$,
  $r$(select app.a_le_droit('formation.stagiaires.creer'))$r$,
  $r$((select app.a_le_droit('formation.stagiaires.modifier')) or ((select app.a_le_droit('formation.stagiaires.modifier_siens')) and id in (select app.trainer_trainee_ids())))$r$,
  $r$(select app.a_le_droit('formation.stagiaires.supprimer'))$r$);

-- trainees_archive
select pg_temp.regles(array['trainees_archive'], null,
  $r$(select app.a_le_droit('formation.stagiaires.archives'))$r$,
  $r$(select app.a_le_droit('formation.stagiaires.archives'))$r$,
  $r$(select app.a_le_droit('formation.stagiaires.archives'))$r$,
  $r$(select app.a_le_droit('formation.stagiaires.archives'))$r$);

-- trainer_certificates, trainer_interviews, trainer_trainings
select pg_temp.regles(array['trainer_certificates', 'trainer_interviews', 'trainer_trainings'], null,
  $r$(select app.a_le_droit('formation.formateurs.dossier'))$r$,
  $r$(select app.a_le_droit('formation.formateurs.dossier'))$r$,
  $r$(select app.a_le_droit('formation.formateurs.dossier'))$r$,
  $r$(select app.a_le_droit('formation.formateurs.dossier'))$r$);

-- trainers
select pg_temp.regles(array['trainers'], null,
  $r$(select app.a_le_droit('formation.formateurs.voir'))$r$,
  $r$(select app.a_le_droit('formation.formateurs.gerer'))$r$,
  $r$((select app.a_le_droit('formation.formateurs.gerer')) or ((select app.a_le_droit('formation.formateurs.modifier_sa_fiche')) and id = (select p.trainer_id from public.profiles p where p.id = (select auth.uid()))))$r$,
  $r$(select app.a_le_droit('formation.formateurs.gerer'))$r$);

-- user_planning_events
select pg_temp.regles(array['user_planning_events'], null,
  $r$(select app.a_le_droit('planning.agenda.voir'))$r$,
  $r$(((select app.a_le_droit('planning.agenda.gerer_siens')) and user_id = (select auth.uid())) or (select app.a_le_droit('planning.agenda.gerer_equipe')))$r$,
  $r$(((select app.a_le_droit('planning.agenda.gerer_siens')) and user_id = (select auth.uid())) or (select app.a_le_droit('planning.agenda.gerer_equipe')))$r$,
  $r$(((select app.a_le_droit('planning.agenda.gerer_siens')) and user_id = (select auth.uid())) or (select app.a_le_droit('planning.agenda.gerer_equipe')))$r$);

-- ===== Tables des droits composés et des validations (C1b) =====

-- approval_delegations
select pg_temp.regles(array['approval_delegations'], null,
  $r$(from_profile = (select auth.uid()) or to_profile = (select auth.uid()) or company_id in (select app.societes_avec_droit('manager.validations.voir')))$r$,
  null,
  null,
  null);

-- approval_requests
select pg_temp.regles(array['approval_requests'], null,
  $r$(requested_by = (select auth.uid()) or company_id in (select app.societes_avec_droit('manager.validations.voir')) or app.approval_can_decide(company_id, scope, steps ->> current_step, requested_by, status))$r$,
  null,
  null,
  null);

-- approval_rules
select pg_temp.regles(array['approval_rules'], null,
  $r$company_id in (select app.societes_avec_droit('organisation.reglages.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('validations.circuits.configurer'))$r$,
  $r$company_id in (select app.societes_avec_droit('validations.circuits.configurer'))$r$,
  $r$company_id in (select app.societes_avec_droit('validations.circuits.configurer'))$r$);

-- company_member_rights
select pg_temp.regles(array['company_member_rights'], null,
  $r$(member_id in (select m.id from public.company_members m where m.profile_id = (select auth.uid())) or company_id in (select app.societes_avec_droit('parametres.droits.attribuer')))$r$,
  $r$company_id in (select app.societes_avec_droit('parametres.droits.attribuer'))$r$,
  $r$company_id in (select app.societes_avec_droit('parametres.droits.attribuer'))$r$,
  $r$company_id in (select app.societes_avec_droit('parametres.droits.attribuer'))$r$);

-- company_member_roles
select pg_temp.regles(array['company_member_roles'], null,
  $r$member_id in (select m.id from public.company_members m)$r$,
  $r$member_id in (select m.id from public.company_members m where m.company_id in (select app.societes_avec_droit('parametres.droits.attribuer')))$r$,
  $r$member_id in (select m.id from public.company_members m where m.company_id in (select app.societes_avec_droit('parametres.droits.attribuer')))$r$,
  $r$member_id in (select m.id from public.company_members m where m.company_id in (select app.societes_avec_droit('parametres.droits.attribuer')))$r$);

-- offer_items, offer_restrictions, offers, permissions
select pg_temp.regles(array['offer_items', 'offer_restrictions', 'offers', 'permissions'], null,
  $r$(select app.a_le_droit('organisation.reglages.voir'))$r$,
  $r$(select app.a_le_droit('plateforme.administrer'))$r$,
  $r$(select app.a_le_droit('plateforme.administrer'))$r$,
  $r$(select app.a_le_droit('plateforme.administrer'))$r$);

-- permission_profile_rights, permission_profiles
select pg_temp.regles(array['permission_profile_rights', 'permission_profiles'], null,
  $r$((company_id is null and (select app.a_le_droit('organisation.reglages.voir'))) or company_id in (select app.societes_avec_droit('organisation.reglages.voir')))$r$,
  $r$((company_id is null and (select app.a_le_droit('plateforme.administrer'))) or company_id in (select app.societes_avec_droit('parametres.profils.gerer')))$r$,
  $r$((company_id is null and (select app.a_le_droit('plateforme.administrer'))) or company_id in (select app.societes_avec_droit('parametres.profils.gerer')))$r$,
  $r$((company_id is null and (select app.a_le_droit('plateforme.administrer'))) or company_id in (select app.societes_avec_droit('parametres.profils.gerer')))$r$);

insert into public.schema_migrations (version) values ('0373_droits_regles') on conflict (version) do nothing;
