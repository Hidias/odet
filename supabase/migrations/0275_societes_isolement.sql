-- 0275_societes_isolement.sql : isolement des données entre sociétés (chantier C2).
-- FICHIER GÉNÉRÉ par scripts/securite/societes_c2.py. Ne pas modifier à la main.
--
-- Quatre règles restrictives par table de classe A, B ou C, en plus des règles existantes (chantier 2 et C1b, qui
-- décident toujours qui voit et modifie quoi) : une ligne n'est lue que si sa société est lisible pour le compte, et
-- n'est créée, modifiée ou supprimée que dans la société courante.
--   app.societes_lisibles() : sociétés de ses appartenances (super administrateur : sociétés ouvertes au support) ;
--     comptes externes (entreprise, formateur externe, stagiaire) : toutes, leurs règles les limitant à leurs objets ;
--   app.societes_ecriture() : la société courante (aucune en vue groupe) ; comptes externes : toutes.
-- Avec une seule société, aucun accès ne change. Les portails (anonymes) et les tâches (clé de service) ne sont pas
-- concernés : ils passent par des fonctions qui déduisent la société de l'objet.
-- Idempotente. Retour arrière : supabase/rollback/0274-0275_societes_retour.sql

create or replace function app.societes_lisibles()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.companies c where (select app.role()) = any (array['entreprise', 'formateur_externe', 'stagiaire'])
  union
  select v from app.visible_companies() v where not coalesce((select app.role()) = any (array['entreprise', 'formateur_externe', 'stagiaire']), false)
$$;

create or replace function app.societes_ecriture()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.companies c where (select app.role()) = any (array['entreprise', 'formateur_externe', 'stagiaire'])
  union
  select app.current_company() where app.current_company() is not null
    and not coalesce((select app.role()) = any (array['entreprise', 'formateur_externe', 'stagiaire']), false)
$$;

revoke all on function app.societes_lisibles(), app.societes_ecriture() from public, anon;
grant execute on function app.societes_lisibles(), app.societes_ecriture() to authenticated, service_role;

create or replace function pg_temp.isoler(p_table text, p_partage boolean)
returns void
language plpgsql
as $f$
declare
  v_lire text := case when p_partage then 'company_ids && array(select app.societes_lisibles())'
                      else 'company_id in (select app.societes_lisibles())' end;
  v_ecrire text := case when p_partage then 'company_ids && array(select app.societes_ecriture())'
                        else 'company_id in (select app.societes_ecriture())' end;
begin
  if to_regclass('public.' || p_table) is null then
    return;
  end if;
  -- Table du serveur seul (aucune règle pour les comptes connectés) : rien à isoler, elle reste fermée
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p_table
                 and policyname not like '%\_societe\_%' and 'authenticated' = any (roles)) then
    return;
  end if;
  execute format('alter table public.%I enable row level security', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_societe_lire', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_societe_creer', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_societe_modifier', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_societe_supprimer', p_table);
  execute format('create policy %I on public.%I as restrictive for select to authenticated using (%s)', p_table || '_societe_lire', p_table, v_lire);
  execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (%s)', p_table || '_societe_creer', p_table, v_ecrire);
  execute format('create policy %I on public.%I as restrictive for update to authenticated using (%s) with check (%s)', p_table || '_societe_modifier', p_table, v_ecrire, v_ecrire);
  execute format('create policy %I on public.%I as restrictive for delete to authenticated using (%s)', p_table || '_societe_supprimer', p_table, v_ecrire);
end
$f$;

select pg_temp.isoler('sessions', false);
select pg_temp.isoler('trainees', false);
select pg_temp.isoler('invoices', false);
select pg_temp.isoler('quotes', false);
select pg_temp.isoler('invoice_emails_sent', false);
select pg_temp.isoler('itv_visits', false);
select pg_temp.isoler('itv_contracts', false);
select pg_temp.isoler('itv_equipment', false);
select pg_temp.isoler('budget_actions', false);
select pg_temp.isoler('budget_categories', false);
select pg_temp.isoler('budget_emails_sent', false);
select pg_temp.isoler('budget_meal_guests', false);
select pg_temp.isoler('budget_pipeline', false);
select pg_temp.isoler('budget_rules', false);
select pg_temp.isoler('budget_settings', false);
select pg_temp.isoler('budget_transactions', false);
select pg_temp.isoler('bank_statements', false);
select pg_temp.isoler('accounting_periods', false);
select pg_temp.isoler('bpf_declarations', false);
select pg_temp.isoler('cert_audit_findings', false);
select pg_temp.isoler('cert_documents', false);
select pg_temp.isoler('cert_indicator_status', false);
select pg_temp.isoler('cert_proofs', false);
select pg_temp.isoler('cert_settings', false);
select pg_temp.isoler('duerp_projects', false);
select pg_temp.isoler('pp_envois', false);
select pg_temp.isoler('pp_accuses', false);
select pg_temp.isoler('pp_fichiers', false);
select pg_temp.isoler('prospection_massive', false);
select pg_temp.isoler('prospect_calls', false);
select pg_temp.isoler('prospect_rdv', false);
select pg_temp.isoler('prospect_email_logs', false);
select pg_temp.isoler('prospect_needs_analysis', false);
select pg_temp.isoler('phoning_sessions', false);
select pg_temp.isoler('rdv_emails_sent', false);
select pg_temp.isoler('rdv_kit_documents', false);
select pg_temp.isoler('mailing_campaigns', false);
select pg_temp.isoler('mailing_segments', false);
select pg_temp.isoler('mailing_email_status', false);
select pg_temp.isoler('mailing_blocklist', false);
select pg_temp.isoler('social_posts', false);
select pg_temp.isoler('social_media_library', false);
select pg_temp.isoler('social_tokens', false);
select pg_temp.isoler('non_conformites', false);
select pg_temp.isoler('non_conformities', false);
select pg_temp.isoler('reclamations', false);
select pg_temp.isoler('quality_alerts', false);
select pg_temp.isoler('completude_alerts', false);
select pg_temp.isoler('completude_tracking', false);
select pg_temp.isoler('notifications', false);
select pg_temp.isoler('audit_logs', false);
select pg_temp.isoler('error_logs', false);
select pg_temp.isoler('rgpd_traitements', false);
select pg_temp.isoler('veille_qualiopi', false);
select pg_temp.isoler('veille_sources', false);
select pg_temp.isoler('processes', false);
select pg_temp.isoler('process_categories', false);
select pg_temp.isoler('process_responsibles', false);
select pg_temp.isoler('qualiopi_indicators', false);
select pg_temp.isoler('audits_internes', false);
select pg_temp.isoler('documents', false);
select pg_temp.isoler('uploaded_documents', false);
select pg_temp.isoler('uploaded_files', false);
select pg_temp.isoler('import_logs', false);
select pg_temp.isoler('signature_alerts_sent', false);
select pg_temp.isoler('trainees_archive', false);
select pg_temp.isoler('psh_requests', false);
select pg_temp.isoler('client_interactions', false);
select pg_temp.isoler('client_portal_access', false);
select pg_temp.isoler('client_providers', false);
select pg_temp.isoler('user_feedback', false);
select pg_temp.isoler('quote_items', false);
select pg_temp.isoler('invoice_items', false);
select pg_temp.isoler('invoice_sessions', false);
select pg_temp.isoler('invoice_payments', false);
select pg_temp.isoler('invoice_relances', false);
select pg_temp.isoler('session_trainees', false);
select pg_temp.isoler('session_trainers', false);
select pg_temp.isoler('session_checklists', false);
select pg_temp.isoler('session_costs', false);
select pg_temp.isoler('session_document_access', false);
select pg_temp.isoler('session_documents', false);
select pg_temp.isoler('session_emails_sent', false);
select pg_temp.isoler('session_equipment', false);
select pg_temp.isoler('session_fundings', false);
select pg_temp.isoler('session_groups', false);
select pg_temp.isoler('session_needs_analysis', false);
select pg_temp.isoler('session_qualiopi', false);
select pg_temp.isoler('session_sequences', false);
select pg_temp.isoler('attendance_halfdays', false);
select pg_temp.isoler('attendance_proxy_signatures', false);
select pg_temp.isoler('attendances', false);
select pg_temp.isoler('document_signatures', false);
select pg_temp.isoler('trainee_evaluations', false);
select pg_temp.isoler('evaluations_cold', false);
select pg_temp.isoler('trainer_evaluations', false);
select pg_temp.isoler('trainee_info_sheets', false);
select pg_temp.isoler('trainee_objectives', false);
select pg_temp.isoler('trainee_positioning_tests', false);
select pg_temp.isoler('positioning_results', false);
select pg_temp.isoler('quiz_attempts', false);
select pg_temp.isoler('sst_certifications', false);
select pg_temp.isoler('formative_evaluations', false);
select pg_temp.isoler('formative_sheets', false);
select pg_temp.isoler('course_document_downloads', false);
select pg_temp.isoler('pp_lignes', false);
select pg_temp.isoler('trainee_documents', false);
select pg_temp.isoler('trainee_disability', false);
select pg_temp.isoler('trainee_ssn', false);
select pg_temp.isoler('pp_nir', false);
select pg_temp.isoler('itv_visit_items', false);
select pg_temp.isoler('itv_visit_parts', false);
select pg_temp.isoler('duerp_actions', false);
select pg_temp.isoler('duerp_risks', false);
select pg_temp.isoler('duerp_units', false);
select pg_temp.isoler('duerp_equipements', false);
select pg_temp.isoler('duerp_habilitations', false);
select pg_temp.isoler('duerp_verifications', false);
select pg_temp.isoler('budget_receipts', false);
select pg_temp.isoler('budget_transaction_invoices', false);
select pg_temp.isoler('mailing_sends', false);
select pg_temp.isoler('process_steps', false);
select pg_temp.isoler('process_versions', false);
select pg_temp.isoler('process_connections', false);
select pg_temp.isoler('clients', true);
select pg_temp.isoler('client_contacts', true);
select pg_temp.isoler('sites', true);
select pg_temp.isoler('trainers', true);
select pg_temp.isoler('trainer_certificates', true);
select pg_temp.isoler('trainer_interviews', true);
select pg_temp.isoler('trainer_qualifications', true);
select pg_temp.isoler('trainer_trainings', true);
select pg_temp.isoler('courses', true);
select pg_temp.isoler('course_documents', true);
select pg_temp.isoler('course_equipment', true);
select pg_temp.isoler('course_questions', true);
select pg_temp.isoler('course_sequences', true);
select pg_temp.isoler('training_themes', true);
select pg_temp.isoler('theme_questions', true);
select pg_temp.isoler('positioning_questions_ref', true);
select pg_temp.isoler('positioning_themes', true);
select pg_temp.isoler('programme_versions', true);
select pg_temp.isoler('equipment_catalog', true);
select pg_temp.isoler('itv_equipment_types', true);
select pg_temp.isoler('itv_parts', true);
select pg_temp.isoler('itv_technicians', true);
select pg_temp.isoler('mailing_templates', true);
select pg_temp.isoler('call_arguments', true);
select pg_temp.isoler('call_objections', true);
select pg_temp.isoler('quality_documents', true);
select pg_temp.isoler('quality_doc_versions', true);
select pg_temp.isoler('qualiopi_documents', true);
select pg_temp.isoler('pp_course_settings', true);
select pg_temp.isoler('pp_presets', true);

insert into public.schema_migrations (version) values ('0275_societes_isolement') on conflict (version) do nothing;
