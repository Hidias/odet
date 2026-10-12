-- Purge des données d'Access Formation importées pour la démonstration (exécution unique, 12/10/2026).
-- Garde l'outillage : catalogue, questions de quiz et de positionnement, thèmes, matériel, modèles DUERP,
-- processus et documents qualité, veille, paramètres, modules, profils, comptes email.
-- Vide toutes les données d'activité : clients, stagiaires, sessions, évaluations, devis, factures, prospection, DUERP clients.
-- Une sauvegarde complète a été faite juste avant (workflow « Sauvegarde de nuit », exécution manuelle du 12/10).

begin;

truncate table
  attendance_proxy_signatures, attendances, attendance_halfdays, course_document_downloads,
  session_trainees, session_trainers, session_checklists, session_equipment, session_documents,
  session_document_access, session_needs_analysis, session_costs, session_emails_sent, session_fundings,
  session_groups, signature_alerts_sent, non_conformities, reclamations, psh_requests, uploaded_documents,
  trainee_positioning_tests, trainee_objectives, trainee_info_sheets, trainee_evaluations, trainee_documents,
  evaluations_cold, trainer_evaluations, sst_certifications, positioning_results, quiz_attempts, document_signatures,
  invoice_items, invoice_payments, invoice_sessions, invoice_relances, budget_transaction_invoices, invoices,
  quote_items, quotes,
  rdv_emails_sent, prospect_calls, prospect_rdv, prospect_needs_analysis, prospect_email_logs,
  duerp_equipements, duerp_verifications, duerp_habilitations, duerp_actions, duerp_risks, duerp_units, duerp_projects,
  client_interactions, client_portal_access, client_providers, budget_meal_guests, sites, client_contacts,
  sessions, trainees, clients,
  non_conformites, quality_alerts, completude_tracking, notifications, mailing_blocklist
cascade;

-- Données bancaires et prospection d'Access
truncate table budget_receipts, budget_transactions cascade;
truncate table prospection_massive cascade;

-- Formateur d'Access (Maxime Langlais) : n'appartient pas à GLD
delete from trainer_certificates where trainer_id = '06048463-24cb-4989-998f-2b84d8a3a196';
delete from trainer_interviews where trainer_id = '06048463-24cb-4989-998f-2b84d8a3a196';
delete from trainer_trainings where trainer_id = '06048463-24cb-4989-998f-2b84d8a3a196';
update courses set default_trainer_id = null where default_trainer_id = '06048463-24cb-4989-998f-2b84d8a3a196';
delete from trainers where id = '06048463-24cb-4989-998f-2b84d8a3a196';

-- Compte de test technique : désactivé et renommé (n'apparaît plus dans les listes d'équipe)
update profiles set first_name = 'Compte', last_name = 'Test', is_active = false where email = 'test.claude@odet-demo.fr';

commit;
