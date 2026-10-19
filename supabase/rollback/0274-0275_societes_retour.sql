-- 0274-0275_societes_retour.sql : retour arrière du rattachement des données aux sociétés (chantier C2).
-- FICHIER GÉNÉRÉ par scripts/securite/societes_c2.py. Ne pas modifier à la main.
-- Retire les règles d'isolement, les déclencheurs, les colonnes company_id et company_ids posées par 0274 (la colonne
-- facultative de user_feedback, de 0260, est remise facultative sans clé étrangère), puis les fonctions.
-- Refusé s'il existe plus d'une société : les données d'une deuxième société ne doivent pas se mélanger.

do $$
begin
  if (select count(*) from public.companies) > 1 then
    raise exception 'Retour arrière refusé : plusieurs sociétés existent, leurs données se mélangeraient';
  end if;
end
$$;

-- sessions
do $$
begin
  if to_regclass('public.sessions') is not null then
    execute 'drop policy if exists sessions_societe_lire on public.sessions';
    execute 'drop policy if exists sessions_societe_creer on public.sessions';
    execute 'drop policy if exists sessions_societe_modifier on public.sessions';
    execute 'drop policy if exists sessions_societe_supprimer on public.sessions';
    execute 'drop trigger if exists sessions_societe on public.sessions';
    execute 'drop trigger if exists sessions_societes on public.sessions';
    execute 'alter table public.sessions drop constraint if exists sessions_company_fk';
    execute 'drop index if exists public.sessions_company_idx';
    execute 'drop index if exists public.sessions_company_ids_idx';
    execute 'alter table public.sessions drop column if exists company_ids';
    execute 'alter table public.sessions drop column if exists company_id';
  end if;
end
$$;
-- trainees
do $$
begin
  if to_regclass('public.trainees') is not null then
    execute 'drop policy if exists trainees_societe_lire on public.trainees';
    execute 'drop policy if exists trainees_societe_creer on public.trainees';
    execute 'drop policy if exists trainees_societe_modifier on public.trainees';
    execute 'drop policy if exists trainees_societe_supprimer on public.trainees';
    execute 'drop trigger if exists trainees_societe on public.trainees';
    execute 'drop trigger if exists trainees_societes on public.trainees';
    execute 'alter table public.trainees drop constraint if exists trainees_company_fk';
    execute 'drop index if exists public.trainees_company_idx';
    execute 'drop index if exists public.trainees_company_ids_idx';
    execute 'alter table public.trainees drop column if exists company_ids';
    execute 'alter table public.trainees drop column if exists company_id';
  end if;
end
$$;
-- invoices
do $$
begin
  if to_regclass('public.invoices') is not null then
    execute 'drop policy if exists invoices_societe_lire on public.invoices';
    execute 'drop policy if exists invoices_societe_creer on public.invoices';
    execute 'drop policy if exists invoices_societe_modifier on public.invoices';
    execute 'drop policy if exists invoices_societe_supprimer on public.invoices';
    execute 'drop trigger if exists invoices_societe on public.invoices';
    execute 'drop trigger if exists invoices_societes on public.invoices';
    execute 'alter table public.invoices drop constraint if exists invoices_company_fk';
    execute 'drop index if exists public.invoices_company_idx';
    execute 'drop index if exists public.invoices_company_ids_idx';
    execute 'alter table public.invoices drop column if exists company_ids';
    execute 'alter table public.invoices drop column if exists company_id';
  end if;
end
$$;
-- quotes
do $$
begin
  if to_regclass('public.quotes') is not null then
    execute 'drop policy if exists quotes_societe_lire on public.quotes';
    execute 'drop policy if exists quotes_societe_creer on public.quotes';
    execute 'drop policy if exists quotes_societe_modifier on public.quotes';
    execute 'drop policy if exists quotes_societe_supprimer on public.quotes';
    execute 'drop trigger if exists quotes_societe on public.quotes';
    execute 'drop trigger if exists quotes_societes on public.quotes';
    execute 'alter table public.quotes drop constraint if exists quotes_company_fk';
    execute 'drop index if exists public.quotes_company_idx';
    execute 'drop index if exists public.quotes_company_ids_idx';
    execute 'alter table public.quotes drop column if exists company_ids';
    execute 'alter table public.quotes drop column if exists company_id';
  end if;
end
$$;
-- invoice_emails_sent
do $$
begin
  if to_regclass('public.invoice_emails_sent') is not null then
    execute 'drop policy if exists invoice_emails_sent_societe_lire on public.invoice_emails_sent';
    execute 'drop policy if exists invoice_emails_sent_societe_creer on public.invoice_emails_sent';
    execute 'drop policy if exists invoice_emails_sent_societe_modifier on public.invoice_emails_sent';
    execute 'drop policy if exists invoice_emails_sent_societe_supprimer on public.invoice_emails_sent';
    execute 'drop trigger if exists invoice_emails_sent_societe on public.invoice_emails_sent';
    execute 'drop trigger if exists invoice_emails_sent_societes on public.invoice_emails_sent';
    execute 'alter table public.invoice_emails_sent drop constraint if exists invoice_emails_sent_company_fk';
    execute 'drop index if exists public.invoice_emails_sent_company_idx';
    execute 'drop index if exists public.invoice_emails_sent_company_ids_idx';
    execute 'alter table public.invoice_emails_sent drop column if exists company_ids';
    execute 'alter table public.invoice_emails_sent drop column if exists company_id';
  end if;
end
$$;
-- itv_visits
do $$
begin
  if to_regclass('public.itv_visits') is not null then
    execute 'drop policy if exists itv_visits_societe_lire on public.itv_visits';
    execute 'drop policy if exists itv_visits_societe_creer on public.itv_visits';
    execute 'drop policy if exists itv_visits_societe_modifier on public.itv_visits';
    execute 'drop policy if exists itv_visits_societe_supprimer on public.itv_visits';
    execute 'drop trigger if exists itv_visits_societe on public.itv_visits';
    execute 'drop trigger if exists itv_visits_societes on public.itv_visits';
    execute 'alter table public.itv_visits drop constraint if exists itv_visits_company_fk';
    execute 'drop index if exists public.itv_visits_company_idx';
    execute 'drop index if exists public.itv_visits_company_ids_idx';
    execute 'alter table public.itv_visits drop column if exists company_ids';
    execute 'alter table public.itv_visits drop column if exists company_id';
  end if;
end
$$;
-- itv_contracts
do $$
begin
  if to_regclass('public.itv_contracts') is not null then
    execute 'drop policy if exists itv_contracts_societe_lire on public.itv_contracts';
    execute 'drop policy if exists itv_contracts_societe_creer on public.itv_contracts';
    execute 'drop policy if exists itv_contracts_societe_modifier on public.itv_contracts';
    execute 'drop policy if exists itv_contracts_societe_supprimer on public.itv_contracts';
    execute 'drop trigger if exists itv_contracts_societe on public.itv_contracts';
    execute 'drop trigger if exists itv_contracts_societes on public.itv_contracts';
    execute 'alter table public.itv_contracts drop constraint if exists itv_contracts_company_fk';
    execute 'drop index if exists public.itv_contracts_company_idx';
    execute 'drop index if exists public.itv_contracts_company_ids_idx';
    execute 'alter table public.itv_contracts drop column if exists company_ids';
    execute 'alter table public.itv_contracts drop column if exists company_id';
  end if;
end
$$;
-- itv_equipment
do $$
begin
  if to_regclass('public.itv_equipment') is not null then
    execute 'drop policy if exists itv_equipment_societe_lire on public.itv_equipment';
    execute 'drop policy if exists itv_equipment_societe_creer on public.itv_equipment';
    execute 'drop policy if exists itv_equipment_societe_modifier on public.itv_equipment';
    execute 'drop policy if exists itv_equipment_societe_supprimer on public.itv_equipment';
    execute 'drop trigger if exists itv_equipment_societe on public.itv_equipment';
    execute 'drop trigger if exists itv_equipment_societes on public.itv_equipment';
    execute 'alter table public.itv_equipment drop constraint if exists itv_equipment_company_fk';
    execute 'drop index if exists public.itv_equipment_company_idx';
    execute 'drop index if exists public.itv_equipment_company_ids_idx';
    execute 'alter table public.itv_equipment drop column if exists company_ids';
    execute 'alter table public.itv_equipment drop column if exists company_id';
  end if;
end
$$;
-- budget_actions
do $$
begin
  if to_regclass('public.budget_actions') is not null then
    execute 'drop policy if exists budget_actions_societe_lire on public.budget_actions';
    execute 'drop policy if exists budget_actions_societe_creer on public.budget_actions';
    execute 'drop policy if exists budget_actions_societe_modifier on public.budget_actions';
    execute 'drop policy if exists budget_actions_societe_supprimer on public.budget_actions';
    execute 'drop trigger if exists budget_actions_societe on public.budget_actions';
    execute 'drop trigger if exists budget_actions_societes on public.budget_actions';
    execute 'alter table public.budget_actions drop constraint if exists budget_actions_company_fk';
    execute 'drop index if exists public.budget_actions_company_idx';
    execute 'drop index if exists public.budget_actions_company_ids_idx';
    execute 'alter table public.budget_actions drop column if exists company_ids';
    execute 'alter table public.budget_actions drop column if exists company_id';
  end if;
end
$$;
-- budget_categories
do $$
begin
  if to_regclass('public.budget_categories') is not null then
    execute 'drop policy if exists budget_categories_societe_lire on public.budget_categories';
    execute 'drop policy if exists budget_categories_societe_creer on public.budget_categories';
    execute 'drop policy if exists budget_categories_societe_modifier on public.budget_categories';
    execute 'drop policy if exists budget_categories_societe_supprimer on public.budget_categories';
    execute 'drop trigger if exists budget_categories_societe on public.budget_categories';
    execute 'drop trigger if exists budget_categories_societes on public.budget_categories';
    execute 'alter table public.budget_categories drop constraint if exists budget_categories_company_fk';
    execute 'drop index if exists public.budget_categories_company_idx';
    execute 'drop index if exists public.budget_categories_company_ids_idx';
    execute 'alter table public.budget_categories drop column if exists company_ids';
    execute 'alter table public.budget_categories drop column if exists company_id';
  end if;
end
$$;
-- budget_emails_sent
do $$
begin
  if to_regclass('public.budget_emails_sent') is not null then
    execute 'drop policy if exists budget_emails_sent_societe_lire on public.budget_emails_sent';
    execute 'drop policy if exists budget_emails_sent_societe_creer on public.budget_emails_sent';
    execute 'drop policy if exists budget_emails_sent_societe_modifier on public.budget_emails_sent';
    execute 'drop policy if exists budget_emails_sent_societe_supprimer on public.budget_emails_sent';
    execute 'drop trigger if exists budget_emails_sent_societe on public.budget_emails_sent';
    execute 'drop trigger if exists budget_emails_sent_societes on public.budget_emails_sent';
    execute 'alter table public.budget_emails_sent drop constraint if exists budget_emails_sent_company_fk';
    execute 'drop index if exists public.budget_emails_sent_company_idx';
    execute 'drop index if exists public.budget_emails_sent_company_ids_idx';
    execute 'alter table public.budget_emails_sent drop column if exists company_ids';
    execute 'alter table public.budget_emails_sent drop column if exists company_id';
  end if;
end
$$;
-- budget_meal_guests
do $$
begin
  if to_regclass('public.budget_meal_guests') is not null then
    execute 'drop policy if exists budget_meal_guests_societe_lire on public.budget_meal_guests';
    execute 'drop policy if exists budget_meal_guests_societe_creer on public.budget_meal_guests';
    execute 'drop policy if exists budget_meal_guests_societe_modifier on public.budget_meal_guests';
    execute 'drop policy if exists budget_meal_guests_societe_supprimer on public.budget_meal_guests';
    execute 'drop trigger if exists budget_meal_guests_societe on public.budget_meal_guests';
    execute 'drop trigger if exists budget_meal_guests_societes on public.budget_meal_guests';
    execute 'alter table public.budget_meal_guests drop constraint if exists budget_meal_guests_company_fk';
    execute 'drop index if exists public.budget_meal_guests_company_idx';
    execute 'drop index if exists public.budget_meal_guests_company_ids_idx';
    execute 'alter table public.budget_meal_guests drop column if exists company_ids';
    execute 'alter table public.budget_meal_guests drop column if exists company_id';
  end if;
end
$$;
-- budget_pipeline
do $$
begin
  if to_regclass('public.budget_pipeline') is not null then
    execute 'drop policy if exists budget_pipeline_societe_lire on public.budget_pipeline';
    execute 'drop policy if exists budget_pipeline_societe_creer on public.budget_pipeline';
    execute 'drop policy if exists budget_pipeline_societe_modifier on public.budget_pipeline';
    execute 'drop policy if exists budget_pipeline_societe_supprimer on public.budget_pipeline';
    execute 'drop trigger if exists budget_pipeline_societe on public.budget_pipeline';
    execute 'drop trigger if exists budget_pipeline_societes on public.budget_pipeline';
    execute 'alter table public.budget_pipeline drop constraint if exists budget_pipeline_company_fk';
    execute 'drop index if exists public.budget_pipeline_company_idx';
    execute 'drop index if exists public.budget_pipeline_company_ids_idx';
    execute 'alter table public.budget_pipeline drop column if exists company_ids';
    execute 'alter table public.budget_pipeline drop column if exists company_id';
  end if;
end
$$;
-- budget_rules
do $$
begin
  if to_regclass('public.budget_rules') is not null then
    execute 'drop policy if exists budget_rules_societe_lire on public.budget_rules';
    execute 'drop policy if exists budget_rules_societe_creer on public.budget_rules';
    execute 'drop policy if exists budget_rules_societe_modifier on public.budget_rules';
    execute 'drop policy if exists budget_rules_societe_supprimer on public.budget_rules';
    execute 'drop trigger if exists budget_rules_societe on public.budget_rules';
    execute 'drop trigger if exists budget_rules_societes on public.budget_rules';
    execute 'alter table public.budget_rules drop constraint if exists budget_rules_company_fk';
    execute 'drop index if exists public.budget_rules_company_idx';
    execute 'drop index if exists public.budget_rules_company_ids_idx';
    execute 'alter table public.budget_rules drop column if exists company_ids';
    execute 'alter table public.budget_rules drop column if exists company_id';
  end if;
end
$$;
-- budget_settings
do $$
begin
  if to_regclass('public.budget_settings') is not null then
    execute 'drop policy if exists budget_settings_societe_lire on public.budget_settings';
    execute 'drop policy if exists budget_settings_societe_creer on public.budget_settings';
    execute 'drop policy if exists budget_settings_societe_modifier on public.budget_settings';
    execute 'drop policy if exists budget_settings_societe_supprimer on public.budget_settings';
    execute 'drop trigger if exists budget_settings_societe on public.budget_settings';
    execute 'drop trigger if exists budget_settings_societes on public.budget_settings';
    execute 'alter table public.budget_settings drop constraint if exists budget_settings_company_fk';
    execute 'drop index if exists public.budget_settings_company_idx';
    execute 'drop index if exists public.budget_settings_company_ids_idx';
    execute 'alter table public.budget_settings drop column if exists company_ids';
    execute 'alter table public.budget_settings drop column if exists company_id';
  end if;
end
$$;
-- budget_transactions
do $$
begin
  if to_regclass('public.budget_transactions') is not null then
    execute 'drop policy if exists budget_transactions_societe_lire on public.budget_transactions';
    execute 'drop policy if exists budget_transactions_societe_creer on public.budget_transactions';
    execute 'drop policy if exists budget_transactions_societe_modifier on public.budget_transactions';
    execute 'drop policy if exists budget_transactions_societe_supprimer on public.budget_transactions';
    execute 'drop trigger if exists budget_transactions_societe on public.budget_transactions';
    execute 'drop trigger if exists budget_transactions_societes on public.budget_transactions';
    execute 'alter table public.budget_transactions drop constraint if exists budget_transactions_company_fk';
    execute 'drop index if exists public.budget_transactions_company_idx';
    execute 'drop index if exists public.budget_transactions_company_ids_idx';
    execute 'alter table public.budget_transactions drop column if exists company_ids';
    execute 'alter table public.budget_transactions drop column if exists company_id';
  end if;
end
$$;
-- bank_statements
do $$
begin
  if to_regclass('public.bank_statements') is not null then
    execute 'drop policy if exists bank_statements_societe_lire on public.bank_statements';
    execute 'drop policy if exists bank_statements_societe_creer on public.bank_statements';
    execute 'drop policy if exists bank_statements_societe_modifier on public.bank_statements';
    execute 'drop policy if exists bank_statements_societe_supprimer on public.bank_statements';
    execute 'drop trigger if exists bank_statements_societe on public.bank_statements';
    execute 'drop trigger if exists bank_statements_societes on public.bank_statements';
    execute 'alter table public.bank_statements drop constraint if exists bank_statements_company_fk';
    execute 'drop index if exists public.bank_statements_company_idx';
    execute 'drop index if exists public.bank_statements_company_ids_idx';
    execute 'alter table public.bank_statements drop column if exists company_ids';
    execute 'alter table public.bank_statements drop column if exists company_id';
  end if;
end
$$;
-- accounting_periods
do $$
begin
  if to_regclass('public.accounting_periods') is not null then
    execute 'drop policy if exists accounting_periods_societe_lire on public.accounting_periods';
    execute 'drop policy if exists accounting_periods_societe_creer on public.accounting_periods';
    execute 'drop policy if exists accounting_periods_societe_modifier on public.accounting_periods';
    execute 'drop policy if exists accounting_periods_societe_supprimer on public.accounting_periods';
    execute 'drop trigger if exists accounting_periods_societe on public.accounting_periods';
    execute 'drop trigger if exists accounting_periods_societes on public.accounting_periods';
    execute 'alter table public.accounting_periods drop constraint if exists accounting_periods_company_fk';
    execute 'drop index if exists public.accounting_periods_company_idx';
    execute 'drop index if exists public.accounting_periods_company_ids_idx';
    execute 'alter table public.accounting_periods drop column if exists company_ids';
    execute 'alter table public.accounting_periods drop column if exists company_id';
  end if;
end
$$;
-- bpf_declarations
do $$
begin
  if to_regclass('public.bpf_declarations') is not null then
    execute 'drop policy if exists bpf_declarations_societe_lire on public.bpf_declarations';
    execute 'drop policy if exists bpf_declarations_societe_creer on public.bpf_declarations';
    execute 'drop policy if exists bpf_declarations_societe_modifier on public.bpf_declarations';
    execute 'drop policy if exists bpf_declarations_societe_supprimer on public.bpf_declarations';
    execute 'drop trigger if exists bpf_declarations_societe on public.bpf_declarations';
    execute 'drop trigger if exists bpf_declarations_societes on public.bpf_declarations';
    execute 'alter table public.bpf_declarations drop constraint if exists bpf_declarations_company_fk';
    execute 'drop index if exists public.bpf_declarations_company_idx';
    execute 'drop index if exists public.bpf_declarations_company_ids_idx';
    execute 'alter table public.bpf_declarations drop column if exists company_ids';
    execute 'alter table public.bpf_declarations drop column if exists company_id';
  end if;
end
$$;
-- cert_audit_findings
do $$
begin
  if to_regclass('public.cert_audit_findings') is not null then
    execute 'drop policy if exists cert_audit_findings_societe_lire on public.cert_audit_findings';
    execute 'drop policy if exists cert_audit_findings_societe_creer on public.cert_audit_findings';
    execute 'drop policy if exists cert_audit_findings_societe_modifier on public.cert_audit_findings';
    execute 'drop policy if exists cert_audit_findings_societe_supprimer on public.cert_audit_findings';
    execute 'drop trigger if exists cert_audit_findings_societe on public.cert_audit_findings';
    execute 'drop trigger if exists cert_audit_findings_societes on public.cert_audit_findings';
    execute 'alter table public.cert_audit_findings drop constraint if exists cert_audit_findings_company_fk';
    execute 'drop index if exists public.cert_audit_findings_company_idx';
    execute 'drop index if exists public.cert_audit_findings_company_ids_idx';
    execute 'alter table public.cert_audit_findings drop column if exists company_ids';
    execute 'alter table public.cert_audit_findings drop column if exists company_id';
  end if;
end
$$;
-- cert_documents
do $$
begin
  if to_regclass('public.cert_documents') is not null then
    execute 'drop policy if exists cert_documents_societe_lire on public.cert_documents';
    execute 'drop policy if exists cert_documents_societe_creer on public.cert_documents';
    execute 'drop policy if exists cert_documents_societe_modifier on public.cert_documents';
    execute 'drop policy if exists cert_documents_societe_supprimer on public.cert_documents';
    execute 'drop trigger if exists cert_documents_societe on public.cert_documents';
    execute 'drop trigger if exists cert_documents_societes on public.cert_documents';
    execute 'alter table public.cert_documents drop constraint if exists cert_documents_company_fk';
    execute 'drop index if exists public.cert_documents_company_idx';
    execute 'drop index if exists public.cert_documents_company_ids_idx';
    execute 'alter table public.cert_documents drop column if exists company_ids';
    execute 'alter table public.cert_documents drop column if exists company_id';
  end if;
end
$$;
-- cert_indicator_status
do $$
begin
  if to_regclass('public.cert_indicator_status') is not null then
    execute 'drop policy if exists cert_indicator_status_societe_lire on public.cert_indicator_status';
    execute 'drop policy if exists cert_indicator_status_societe_creer on public.cert_indicator_status';
    execute 'drop policy if exists cert_indicator_status_societe_modifier on public.cert_indicator_status';
    execute 'drop policy if exists cert_indicator_status_societe_supprimer on public.cert_indicator_status';
    execute 'drop trigger if exists cert_indicator_status_societe on public.cert_indicator_status';
    execute 'drop trigger if exists cert_indicator_status_societes on public.cert_indicator_status';
    execute 'alter table public.cert_indicator_status drop constraint if exists cert_indicator_status_company_fk';
    execute 'drop index if exists public.cert_indicator_status_company_idx';
    execute 'drop index if exists public.cert_indicator_status_company_ids_idx';
    execute 'alter table public.cert_indicator_status drop column if exists company_ids';
    execute 'alter table public.cert_indicator_status drop column if exists company_id';
  end if;
end
$$;
-- cert_proofs
do $$
begin
  if to_regclass('public.cert_proofs') is not null then
    execute 'drop policy if exists cert_proofs_societe_lire on public.cert_proofs';
    execute 'drop policy if exists cert_proofs_societe_creer on public.cert_proofs';
    execute 'drop policy if exists cert_proofs_societe_modifier on public.cert_proofs';
    execute 'drop policy if exists cert_proofs_societe_supprimer on public.cert_proofs';
    execute 'drop trigger if exists cert_proofs_societe on public.cert_proofs';
    execute 'drop trigger if exists cert_proofs_societes on public.cert_proofs';
    execute 'alter table public.cert_proofs drop constraint if exists cert_proofs_company_fk';
    execute 'drop index if exists public.cert_proofs_company_idx';
    execute 'drop index if exists public.cert_proofs_company_ids_idx';
    execute 'alter table public.cert_proofs drop column if exists company_ids';
    execute 'alter table public.cert_proofs drop column if exists company_id';
  end if;
end
$$;
-- cert_settings
do $$
begin
  if to_regclass('public.cert_settings') is not null then
    execute 'drop policy if exists cert_settings_societe_lire on public.cert_settings';
    execute 'drop policy if exists cert_settings_societe_creer on public.cert_settings';
    execute 'drop policy if exists cert_settings_societe_modifier on public.cert_settings';
    execute 'drop policy if exists cert_settings_societe_supprimer on public.cert_settings';
    execute 'drop trigger if exists cert_settings_societe on public.cert_settings';
    execute 'drop trigger if exists cert_settings_societes on public.cert_settings';
    execute 'alter table public.cert_settings drop constraint if exists cert_settings_company_fk';
    execute 'drop index if exists public.cert_settings_company_idx';
    execute 'drop index if exists public.cert_settings_company_ids_idx';
    execute 'alter table public.cert_settings drop column if exists company_ids';
    execute 'alter table public.cert_settings drop column if exists company_id';
  end if;
end
$$;
-- duerp_projects
do $$
begin
  if to_regclass('public.duerp_projects') is not null then
    execute 'drop policy if exists duerp_projects_societe_lire on public.duerp_projects';
    execute 'drop policy if exists duerp_projects_societe_creer on public.duerp_projects';
    execute 'drop policy if exists duerp_projects_societe_modifier on public.duerp_projects';
    execute 'drop policy if exists duerp_projects_societe_supprimer on public.duerp_projects';
    execute 'drop trigger if exists duerp_projects_societe on public.duerp_projects';
    execute 'drop trigger if exists duerp_projects_societes on public.duerp_projects';
    execute 'alter table public.duerp_projects drop constraint if exists duerp_projects_company_fk';
    execute 'drop index if exists public.duerp_projects_company_idx';
    execute 'drop index if exists public.duerp_projects_company_ids_idx';
    execute 'alter table public.duerp_projects drop column if exists company_ids';
    execute 'alter table public.duerp_projects drop column if exists company_id';
  end if;
end
$$;
-- pp_envois
do $$
begin
  if to_regclass('public.pp_envois') is not null then
    execute 'drop policy if exists pp_envois_societe_lire on public.pp_envois';
    execute 'drop policy if exists pp_envois_societe_creer on public.pp_envois';
    execute 'drop policy if exists pp_envois_societe_modifier on public.pp_envois';
    execute 'drop policy if exists pp_envois_societe_supprimer on public.pp_envois';
    execute 'drop trigger if exists pp_envois_societe on public.pp_envois';
    execute 'drop trigger if exists pp_envois_societes on public.pp_envois';
    execute 'alter table public.pp_envois drop constraint if exists pp_envois_company_fk';
    execute 'drop index if exists public.pp_envois_company_idx';
    execute 'drop index if exists public.pp_envois_company_ids_idx';
    execute 'alter table public.pp_envois drop column if exists company_ids';
    execute 'alter table public.pp_envois drop column if exists company_id';
  end if;
end
$$;
-- pp_accuses
do $$
begin
  if to_regclass('public.pp_accuses') is not null then
    execute 'drop policy if exists pp_accuses_societe_lire on public.pp_accuses';
    execute 'drop policy if exists pp_accuses_societe_creer on public.pp_accuses';
    execute 'drop policy if exists pp_accuses_societe_modifier on public.pp_accuses';
    execute 'drop policy if exists pp_accuses_societe_supprimer on public.pp_accuses';
    execute 'drop trigger if exists pp_accuses_societe on public.pp_accuses';
    execute 'drop trigger if exists pp_accuses_societes on public.pp_accuses';
    execute 'alter table public.pp_accuses drop constraint if exists pp_accuses_company_fk';
    execute 'drop index if exists public.pp_accuses_company_idx';
    execute 'drop index if exists public.pp_accuses_company_ids_idx';
    execute 'alter table public.pp_accuses drop column if exists company_ids';
    execute 'alter table public.pp_accuses drop column if exists company_id';
  end if;
end
$$;
-- pp_fichiers
do $$
begin
  if to_regclass('public.pp_fichiers') is not null then
    execute 'drop policy if exists pp_fichiers_societe_lire on public.pp_fichiers';
    execute 'drop policy if exists pp_fichiers_societe_creer on public.pp_fichiers';
    execute 'drop policy if exists pp_fichiers_societe_modifier on public.pp_fichiers';
    execute 'drop policy if exists pp_fichiers_societe_supprimer on public.pp_fichiers';
    execute 'drop trigger if exists pp_fichiers_societe on public.pp_fichiers';
    execute 'drop trigger if exists pp_fichiers_societes on public.pp_fichiers';
    execute 'alter table public.pp_fichiers drop constraint if exists pp_fichiers_company_fk';
    execute 'drop index if exists public.pp_fichiers_company_idx';
    execute 'drop index if exists public.pp_fichiers_company_ids_idx';
    execute 'alter table public.pp_fichiers drop column if exists company_ids';
    execute 'alter table public.pp_fichiers drop column if exists company_id';
  end if;
end
$$;
-- prospection_massive
do $$
begin
  if to_regclass('public.prospection_massive') is not null then
    execute 'drop policy if exists prospection_massive_societe_lire on public.prospection_massive';
    execute 'drop policy if exists prospection_massive_societe_creer on public.prospection_massive';
    execute 'drop policy if exists prospection_massive_societe_modifier on public.prospection_massive';
    execute 'drop policy if exists prospection_massive_societe_supprimer on public.prospection_massive';
    execute 'drop trigger if exists prospection_massive_societe on public.prospection_massive';
    execute 'drop trigger if exists prospection_massive_societes on public.prospection_massive';
    execute 'alter table public.prospection_massive drop constraint if exists prospection_massive_company_fk';
    execute 'drop index if exists public.prospection_massive_company_idx';
    execute 'drop index if exists public.prospection_massive_company_ids_idx';
    execute 'alter table public.prospection_massive drop column if exists company_ids';
    execute 'alter table public.prospection_massive drop column if exists company_id';
  end if;
end
$$;
-- prospect_calls
do $$
begin
  if to_regclass('public.prospect_calls') is not null then
    execute 'drop policy if exists prospect_calls_societe_lire on public.prospect_calls';
    execute 'drop policy if exists prospect_calls_societe_creer on public.prospect_calls';
    execute 'drop policy if exists prospect_calls_societe_modifier on public.prospect_calls';
    execute 'drop policy if exists prospect_calls_societe_supprimer on public.prospect_calls';
    execute 'drop trigger if exists prospect_calls_societe on public.prospect_calls';
    execute 'drop trigger if exists prospect_calls_societes on public.prospect_calls';
    execute 'alter table public.prospect_calls drop constraint if exists prospect_calls_company_fk';
    execute 'drop index if exists public.prospect_calls_company_idx';
    execute 'drop index if exists public.prospect_calls_company_ids_idx';
    execute 'alter table public.prospect_calls drop column if exists company_ids';
    execute 'alter table public.prospect_calls drop column if exists company_id';
  end if;
end
$$;
-- prospect_rdv
do $$
begin
  if to_regclass('public.prospect_rdv') is not null then
    execute 'drop policy if exists prospect_rdv_societe_lire on public.prospect_rdv';
    execute 'drop policy if exists prospect_rdv_societe_creer on public.prospect_rdv';
    execute 'drop policy if exists prospect_rdv_societe_modifier on public.prospect_rdv';
    execute 'drop policy if exists prospect_rdv_societe_supprimer on public.prospect_rdv';
    execute 'drop trigger if exists prospect_rdv_societe on public.prospect_rdv';
    execute 'drop trigger if exists prospect_rdv_societes on public.prospect_rdv';
    execute 'alter table public.prospect_rdv drop constraint if exists prospect_rdv_company_fk';
    execute 'drop index if exists public.prospect_rdv_company_idx';
    execute 'drop index if exists public.prospect_rdv_company_ids_idx';
    execute 'alter table public.prospect_rdv drop column if exists company_ids';
    execute 'alter table public.prospect_rdv drop column if exists company_id';
  end if;
end
$$;
-- prospect_email_logs
do $$
begin
  if to_regclass('public.prospect_email_logs') is not null then
    execute 'drop policy if exists prospect_email_logs_societe_lire on public.prospect_email_logs';
    execute 'drop policy if exists prospect_email_logs_societe_creer on public.prospect_email_logs';
    execute 'drop policy if exists prospect_email_logs_societe_modifier on public.prospect_email_logs';
    execute 'drop policy if exists prospect_email_logs_societe_supprimer on public.prospect_email_logs';
    execute 'drop trigger if exists prospect_email_logs_societe on public.prospect_email_logs';
    execute 'drop trigger if exists prospect_email_logs_societes on public.prospect_email_logs';
    execute 'alter table public.prospect_email_logs drop constraint if exists prospect_email_logs_company_fk';
    execute 'drop index if exists public.prospect_email_logs_company_idx';
    execute 'drop index if exists public.prospect_email_logs_company_ids_idx';
    execute 'alter table public.prospect_email_logs drop column if exists company_ids';
    execute 'alter table public.prospect_email_logs drop column if exists company_id';
  end if;
end
$$;
-- prospect_needs_analysis
do $$
begin
  if to_regclass('public.prospect_needs_analysis') is not null then
    execute 'drop policy if exists prospect_needs_analysis_societe_lire on public.prospect_needs_analysis';
    execute 'drop policy if exists prospect_needs_analysis_societe_creer on public.prospect_needs_analysis';
    execute 'drop policy if exists prospect_needs_analysis_societe_modifier on public.prospect_needs_analysis';
    execute 'drop policy if exists prospect_needs_analysis_societe_supprimer on public.prospect_needs_analysis';
    execute 'drop trigger if exists prospect_needs_analysis_societe on public.prospect_needs_analysis';
    execute 'drop trigger if exists prospect_needs_analysis_societes on public.prospect_needs_analysis';
    execute 'alter table public.prospect_needs_analysis drop constraint if exists prospect_needs_analysis_company_fk';
    execute 'drop index if exists public.prospect_needs_analysis_company_idx';
    execute 'drop index if exists public.prospect_needs_analysis_company_ids_idx';
    execute 'alter table public.prospect_needs_analysis drop column if exists company_ids';
    execute 'alter table public.prospect_needs_analysis drop column if exists company_id';
  end if;
end
$$;
-- phoning_sessions
do $$
begin
  if to_regclass('public.phoning_sessions') is not null then
    execute 'drop policy if exists phoning_sessions_societe_lire on public.phoning_sessions';
    execute 'drop policy if exists phoning_sessions_societe_creer on public.phoning_sessions';
    execute 'drop policy if exists phoning_sessions_societe_modifier on public.phoning_sessions';
    execute 'drop policy if exists phoning_sessions_societe_supprimer on public.phoning_sessions';
    execute 'drop trigger if exists phoning_sessions_societe on public.phoning_sessions';
    execute 'drop trigger if exists phoning_sessions_societes on public.phoning_sessions';
    execute 'alter table public.phoning_sessions drop constraint if exists phoning_sessions_company_fk';
    execute 'drop index if exists public.phoning_sessions_company_idx';
    execute 'drop index if exists public.phoning_sessions_company_ids_idx';
    execute 'alter table public.phoning_sessions drop column if exists company_ids';
    execute 'alter table public.phoning_sessions drop column if exists company_id';
  end if;
end
$$;
-- rdv_emails_sent
do $$
begin
  if to_regclass('public.rdv_emails_sent') is not null then
    execute 'drop policy if exists rdv_emails_sent_societe_lire on public.rdv_emails_sent';
    execute 'drop policy if exists rdv_emails_sent_societe_creer on public.rdv_emails_sent';
    execute 'drop policy if exists rdv_emails_sent_societe_modifier on public.rdv_emails_sent';
    execute 'drop policy if exists rdv_emails_sent_societe_supprimer on public.rdv_emails_sent';
    execute 'drop trigger if exists rdv_emails_sent_societe on public.rdv_emails_sent';
    execute 'drop trigger if exists rdv_emails_sent_societes on public.rdv_emails_sent';
    execute 'alter table public.rdv_emails_sent drop constraint if exists rdv_emails_sent_company_fk';
    execute 'drop index if exists public.rdv_emails_sent_company_idx';
    execute 'drop index if exists public.rdv_emails_sent_company_ids_idx';
    execute 'alter table public.rdv_emails_sent drop column if exists company_ids';
    execute 'alter table public.rdv_emails_sent drop column if exists company_id';
  end if;
end
$$;
-- rdv_kit_documents
do $$
begin
  if to_regclass('public.rdv_kit_documents') is not null then
    execute 'drop policy if exists rdv_kit_documents_societe_lire on public.rdv_kit_documents';
    execute 'drop policy if exists rdv_kit_documents_societe_creer on public.rdv_kit_documents';
    execute 'drop policy if exists rdv_kit_documents_societe_modifier on public.rdv_kit_documents';
    execute 'drop policy if exists rdv_kit_documents_societe_supprimer on public.rdv_kit_documents';
    execute 'drop trigger if exists rdv_kit_documents_societe on public.rdv_kit_documents';
    execute 'drop trigger if exists rdv_kit_documents_societes on public.rdv_kit_documents';
    execute 'alter table public.rdv_kit_documents drop constraint if exists rdv_kit_documents_company_fk';
    execute 'drop index if exists public.rdv_kit_documents_company_idx';
    execute 'drop index if exists public.rdv_kit_documents_company_ids_idx';
    execute 'alter table public.rdv_kit_documents drop column if exists company_ids';
    execute 'alter table public.rdv_kit_documents drop column if exists company_id';
  end if;
end
$$;
-- mailing_campaigns
do $$
begin
  if to_regclass('public.mailing_campaigns') is not null then
    execute 'drop policy if exists mailing_campaigns_societe_lire on public.mailing_campaigns';
    execute 'drop policy if exists mailing_campaigns_societe_creer on public.mailing_campaigns';
    execute 'drop policy if exists mailing_campaigns_societe_modifier on public.mailing_campaigns';
    execute 'drop policy if exists mailing_campaigns_societe_supprimer on public.mailing_campaigns';
    execute 'drop trigger if exists mailing_campaigns_societe on public.mailing_campaigns';
    execute 'drop trigger if exists mailing_campaigns_societes on public.mailing_campaigns';
    execute 'alter table public.mailing_campaigns drop constraint if exists mailing_campaigns_company_fk';
    execute 'drop index if exists public.mailing_campaigns_company_idx';
    execute 'drop index if exists public.mailing_campaigns_company_ids_idx';
    execute 'alter table public.mailing_campaigns drop column if exists company_ids';
    execute 'alter table public.mailing_campaigns drop column if exists company_id';
  end if;
end
$$;
-- mailing_segments
do $$
begin
  if to_regclass('public.mailing_segments') is not null then
    execute 'drop policy if exists mailing_segments_societe_lire on public.mailing_segments';
    execute 'drop policy if exists mailing_segments_societe_creer on public.mailing_segments';
    execute 'drop policy if exists mailing_segments_societe_modifier on public.mailing_segments';
    execute 'drop policy if exists mailing_segments_societe_supprimer on public.mailing_segments';
    execute 'drop trigger if exists mailing_segments_societe on public.mailing_segments';
    execute 'drop trigger if exists mailing_segments_societes on public.mailing_segments';
    execute 'alter table public.mailing_segments drop constraint if exists mailing_segments_company_fk';
    execute 'drop index if exists public.mailing_segments_company_idx';
    execute 'drop index if exists public.mailing_segments_company_ids_idx';
    execute 'alter table public.mailing_segments drop column if exists company_ids';
    execute 'alter table public.mailing_segments drop column if exists company_id';
  end if;
end
$$;
-- mailing_email_status
do $$
begin
  if to_regclass('public.mailing_email_status') is not null then
    execute 'drop policy if exists mailing_email_status_societe_lire on public.mailing_email_status';
    execute 'drop policy if exists mailing_email_status_societe_creer on public.mailing_email_status';
    execute 'drop policy if exists mailing_email_status_societe_modifier on public.mailing_email_status';
    execute 'drop policy if exists mailing_email_status_societe_supprimer on public.mailing_email_status';
    execute 'drop trigger if exists mailing_email_status_societe on public.mailing_email_status';
    execute 'drop trigger if exists mailing_email_status_societes on public.mailing_email_status';
    execute 'alter table public.mailing_email_status drop constraint if exists mailing_email_status_company_fk';
    execute 'drop index if exists public.mailing_email_status_company_idx';
    execute 'drop index if exists public.mailing_email_status_company_ids_idx';
    execute 'alter table public.mailing_email_status drop column if exists company_ids';
    execute 'alter table public.mailing_email_status drop column if exists company_id';
  end if;
end
$$;
-- mailing_blocklist
do $$
begin
  if to_regclass('public.mailing_blocklist') is not null then
    execute 'drop policy if exists mailing_blocklist_societe_lire on public.mailing_blocklist';
    execute 'drop policy if exists mailing_blocklist_societe_creer on public.mailing_blocklist';
    execute 'drop policy if exists mailing_blocklist_societe_modifier on public.mailing_blocklist';
    execute 'drop policy if exists mailing_blocklist_societe_supprimer on public.mailing_blocklist';
    execute 'drop trigger if exists mailing_blocklist_societe on public.mailing_blocklist';
    execute 'drop trigger if exists mailing_blocklist_societes on public.mailing_blocklist';
    execute 'alter table public.mailing_blocklist drop constraint if exists mailing_blocklist_company_fk';
    execute 'drop index if exists public.mailing_blocklist_company_idx';
    execute 'drop index if exists public.mailing_blocklist_company_ids_idx';
    execute 'alter table public.mailing_blocklist drop column if exists company_ids';
    execute 'alter table public.mailing_blocklist drop column if exists company_id';
  end if;
end
$$;
-- social_posts
do $$
begin
  if to_regclass('public.social_posts') is not null then
    execute 'drop policy if exists social_posts_societe_lire on public.social_posts';
    execute 'drop policy if exists social_posts_societe_creer on public.social_posts';
    execute 'drop policy if exists social_posts_societe_modifier on public.social_posts';
    execute 'drop policy if exists social_posts_societe_supprimer on public.social_posts';
    execute 'drop trigger if exists social_posts_societe on public.social_posts';
    execute 'drop trigger if exists social_posts_societes on public.social_posts';
    execute 'alter table public.social_posts drop constraint if exists social_posts_company_fk';
    execute 'drop index if exists public.social_posts_company_idx';
    execute 'drop index if exists public.social_posts_company_ids_idx';
    execute 'alter table public.social_posts drop column if exists company_ids';
    execute 'alter table public.social_posts drop column if exists company_id';
  end if;
end
$$;
-- social_media_library
do $$
begin
  if to_regclass('public.social_media_library') is not null then
    execute 'drop policy if exists social_media_library_societe_lire on public.social_media_library';
    execute 'drop policy if exists social_media_library_societe_creer on public.social_media_library';
    execute 'drop policy if exists social_media_library_societe_modifier on public.social_media_library';
    execute 'drop policy if exists social_media_library_societe_supprimer on public.social_media_library';
    execute 'drop trigger if exists social_media_library_societe on public.social_media_library';
    execute 'drop trigger if exists social_media_library_societes on public.social_media_library';
    execute 'alter table public.social_media_library drop constraint if exists social_media_library_company_fk';
    execute 'drop index if exists public.social_media_library_company_idx';
    execute 'drop index if exists public.social_media_library_company_ids_idx';
    execute 'alter table public.social_media_library drop column if exists company_ids';
    execute 'alter table public.social_media_library drop column if exists company_id';
  end if;
end
$$;
-- social_tokens
do $$
begin
  if to_regclass('public.social_tokens') is not null then
    execute 'drop policy if exists social_tokens_societe_lire on public.social_tokens';
    execute 'drop policy if exists social_tokens_societe_creer on public.social_tokens';
    execute 'drop policy if exists social_tokens_societe_modifier on public.social_tokens';
    execute 'drop policy if exists social_tokens_societe_supprimer on public.social_tokens';
    execute 'drop trigger if exists social_tokens_societe on public.social_tokens';
    execute 'drop trigger if exists social_tokens_societes on public.social_tokens';
    execute 'alter table public.social_tokens drop constraint if exists social_tokens_company_fk';
    execute 'drop index if exists public.social_tokens_company_idx';
    execute 'drop index if exists public.social_tokens_company_ids_idx';
    execute 'alter table public.social_tokens drop column if exists company_ids';
    execute 'alter table public.social_tokens drop column if exists company_id';
  end if;
end
$$;
-- non_conformites
do $$
begin
  if to_regclass('public.non_conformites') is not null then
    execute 'drop policy if exists non_conformites_societe_lire on public.non_conformites';
    execute 'drop policy if exists non_conformites_societe_creer on public.non_conformites';
    execute 'drop policy if exists non_conformites_societe_modifier on public.non_conformites';
    execute 'drop policy if exists non_conformites_societe_supprimer on public.non_conformites';
    execute 'drop trigger if exists non_conformites_societe on public.non_conformites';
    execute 'drop trigger if exists non_conformites_societes on public.non_conformites';
    execute 'alter table public.non_conformites drop constraint if exists non_conformites_company_fk';
    execute 'drop index if exists public.non_conformites_company_idx';
    execute 'drop index if exists public.non_conformites_company_ids_idx';
    execute 'alter table public.non_conformites drop column if exists company_ids';
    execute 'alter table public.non_conformites drop column if exists company_id';
  end if;
end
$$;
-- non_conformities
do $$
begin
  if to_regclass('public.non_conformities') is not null then
    execute 'drop policy if exists non_conformities_societe_lire on public.non_conformities';
    execute 'drop policy if exists non_conformities_societe_creer on public.non_conformities';
    execute 'drop policy if exists non_conformities_societe_modifier on public.non_conformities';
    execute 'drop policy if exists non_conformities_societe_supprimer on public.non_conformities';
    execute 'drop trigger if exists non_conformities_societe on public.non_conformities';
    execute 'drop trigger if exists non_conformities_societes on public.non_conformities';
    execute 'alter table public.non_conformities drop constraint if exists non_conformities_company_fk';
    execute 'drop index if exists public.non_conformities_company_idx';
    execute 'drop index if exists public.non_conformities_company_ids_idx';
    execute 'alter table public.non_conformities drop column if exists company_ids';
    execute 'alter table public.non_conformities drop column if exists company_id';
  end if;
end
$$;
-- reclamations
do $$
begin
  if to_regclass('public.reclamations') is not null then
    execute 'drop policy if exists reclamations_societe_lire on public.reclamations';
    execute 'drop policy if exists reclamations_societe_creer on public.reclamations';
    execute 'drop policy if exists reclamations_societe_modifier on public.reclamations';
    execute 'drop policy if exists reclamations_societe_supprimer on public.reclamations';
    execute 'drop trigger if exists reclamations_societe on public.reclamations';
    execute 'drop trigger if exists reclamations_societes on public.reclamations';
    execute 'alter table public.reclamations drop constraint if exists reclamations_company_fk';
    execute 'drop index if exists public.reclamations_company_idx';
    execute 'drop index if exists public.reclamations_company_ids_idx';
    execute 'alter table public.reclamations drop column if exists company_ids';
    execute 'alter table public.reclamations drop column if exists company_id';
  end if;
end
$$;
-- quality_alerts
do $$
begin
  if to_regclass('public.quality_alerts') is not null then
    execute 'drop policy if exists quality_alerts_societe_lire on public.quality_alerts';
    execute 'drop policy if exists quality_alerts_societe_creer on public.quality_alerts';
    execute 'drop policy if exists quality_alerts_societe_modifier on public.quality_alerts';
    execute 'drop policy if exists quality_alerts_societe_supprimer on public.quality_alerts';
    execute 'drop trigger if exists quality_alerts_societe on public.quality_alerts';
    execute 'drop trigger if exists quality_alerts_societes on public.quality_alerts';
    execute 'alter table public.quality_alerts drop constraint if exists quality_alerts_company_fk';
    execute 'drop index if exists public.quality_alerts_company_idx';
    execute 'drop index if exists public.quality_alerts_company_ids_idx';
    execute 'alter table public.quality_alerts drop column if exists company_ids';
    execute 'alter table public.quality_alerts drop column if exists company_id';
  end if;
end
$$;
-- completude_alerts
do $$
begin
  if to_regclass('public.completude_alerts') is not null then
    execute 'drop policy if exists completude_alerts_societe_lire on public.completude_alerts';
    execute 'drop policy if exists completude_alerts_societe_creer on public.completude_alerts';
    execute 'drop policy if exists completude_alerts_societe_modifier on public.completude_alerts';
    execute 'drop policy if exists completude_alerts_societe_supprimer on public.completude_alerts';
    execute 'drop trigger if exists completude_alerts_societe on public.completude_alerts';
    execute 'drop trigger if exists completude_alerts_societes on public.completude_alerts';
    execute 'alter table public.completude_alerts drop constraint if exists completude_alerts_company_fk';
    execute 'drop index if exists public.completude_alerts_company_idx';
    execute 'drop index if exists public.completude_alerts_company_ids_idx';
    execute 'alter table public.completude_alerts drop column if exists company_ids';
    execute 'alter table public.completude_alerts drop column if exists company_id';
  end if;
end
$$;
-- completude_tracking
do $$
begin
  if to_regclass('public.completude_tracking') is not null then
    execute 'drop policy if exists completude_tracking_societe_lire on public.completude_tracking';
    execute 'drop policy if exists completude_tracking_societe_creer on public.completude_tracking';
    execute 'drop policy if exists completude_tracking_societe_modifier on public.completude_tracking';
    execute 'drop policy if exists completude_tracking_societe_supprimer on public.completude_tracking';
    execute 'drop trigger if exists completude_tracking_societe on public.completude_tracking';
    execute 'drop trigger if exists completude_tracking_societes on public.completude_tracking';
    execute 'alter table public.completude_tracking drop constraint if exists completude_tracking_company_fk';
    execute 'drop index if exists public.completude_tracking_company_idx';
    execute 'drop index if exists public.completude_tracking_company_ids_idx';
    execute 'alter table public.completude_tracking drop column if exists company_ids';
    execute 'alter table public.completude_tracking drop column if exists company_id';
  end if;
end
$$;
-- notifications
do $$
begin
  if to_regclass('public.notifications') is not null then
    execute 'drop policy if exists notifications_societe_lire on public.notifications';
    execute 'drop policy if exists notifications_societe_creer on public.notifications';
    execute 'drop policy if exists notifications_societe_modifier on public.notifications';
    execute 'drop policy if exists notifications_societe_supprimer on public.notifications';
    execute 'drop trigger if exists notifications_societe on public.notifications';
    execute 'drop trigger if exists notifications_societes on public.notifications';
    execute 'alter table public.notifications drop constraint if exists notifications_company_fk';
    execute 'drop index if exists public.notifications_company_idx';
    execute 'drop index if exists public.notifications_company_ids_idx';
    execute 'alter table public.notifications drop column if exists company_ids';
    execute 'alter table public.notifications drop column if exists company_id';
  end if;
end
$$;
-- audit_logs
do $$
begin
  if to_regclass('public.audit_logs') is not null then
    execute 'drop policy if exists audit_logs_societe_lire on public.audit_logs';
    execute 'drop policy if exists audit_logs_societe_creer on public.audit_logs';
    execute 'drop policy if exists audit_logs_societe_modifier on public.audit_logs';
    execute 'drop policy if exists audit_logs_societe_supprimer on public.audit_logs';
    execute 'drop trigger if exists audit_logs_societe on public.audit_logs';
    execute 'drop trigger if exists audit_logs_societes on public.audit_logs';
    execute 'alter table public.audit_logs drop constraint if exists audit_logs_company_fk';
    execute 'drop index if exists public.audit_logs_company_idx';
    execute 'drop index if exists public.audit_logs_company_ids_idx';
    execute 'alter table public.audit_logs drop column if exists company_ids';
    execute 'alter table public.audit_logs drop column if exists company_id';
  end if;
end
$$;
-- error_logs
do $$
begin
  if to_regclass('public.error_logs') is not null then
    execute 'drop policy if exists error_logs_societe_lire on public.error_logs';
    execute 'drop policy if exists error_logs_societe_creer on public.error_logs';
    execute 'drop policy if exists error_logs_societe_modifier on public.error_logs';
    execute 'drop policy if exists error_logs_societe_supprimer on public.error_logs';
    execute 'drop trigger if exists error_logs_societe on public.error_logs';
    execute 'drop trigger if exists error_logs_societes on public.error_logs';
    execute 'alter table public.error_logs drop constraint if exists error_logs_company_fk';
    execute 'drop index if exists public.error_logs_company_idx';
    execute 'drop index if exists public.error_logs_company_ids_idx';
    execute 'alter table public.error_logs drop column if exists company_ids';
    execute 'alter table public.error_logs drop column if exists company_id';
  end if;
end
$$;
-- rgpd_traitements
do $$
begin
  if to_regclass('public.rgpd_traitements') is not null then
    execute 'drop policy if exists rgpd_traitements_societe_lire on public.rgpd_traitements';
    execute 'drop policy if exists rgpd_traitements_societe_creer on public.rgpd_traitements';
    execute 'drop policy if exists rgpd_traitements_societe_modifier on public.rgpd_traitements';
    execute 'drop policy if exists rgpd_traitements_societe_supprimer on public.rgpd_traitements';
    execute 'drop trigger if exists rgpd_traitements_societe on public.rgpd_traitements';
    execute 'drop trigger if exists rgpd_traitements_societes on public.rgpd_traitements';
    execute 'alter table public.rgpd_traitements drop constraint if exists rgpd_traitements_company_fk';
    execute 'drop index if exists public.rgpd_traitements_company_idx';
    execute 'drop index if exists public.rgpd_traitements_company_ids_idx';
    execute 'alter table public.rgpd_traitements drop column if exists company_ids';
    execute 'alter table public.rgpd_traitements drop column if exists company_id';
  end if;
end
$$;
-- veille_qualiopi
do $$
begin
  if to_regclass('public.veille_qualiopi') is not null then
    execute 'drop policy if exists veille_qualiopi_societe_lire on public.veille_qualiopi';
    execute 'drop policy if exists veille_qualiopi_societe_creer on public.veille_qualiopi';
    execute 'drop policy if exists veille_qualiopi_societe_modifier on public.veille_qualiopi';
    execute 'drop policy if exists veille_qualiopi_societe_supprimer on public.veille_qualiopi';
    execute 'drop trigger if exists veille_qualiopi_societe on public.veille_qualiopi';
    execute 'drop trigger if exists veille_qualiopi_societes on public.veille_qualiopi';
    execute 'alter table public.veille_qualiopi drop constraint if exists veille_qualiopi_company_fk';
    execute 'drop index if exists public.veille_qualiopi_company_idx';
    execute 'drop index if exists public.veille_qualiopi_company_ids_idx';
    execute 'alter table public.veille_qualiopi drop column if exists company_ids';
    execute 'alter table public.veille_qualiopi drop column if exists company_id';
  end if;
end
$$;
-- veille_sources
do $$
begin
  if to_regclass('public.veille_sources') is not null then
    execute 'drop policy if exists veille_sources_societe_lire on public.veille_sources';
    execute 'drop policy if exists veille_sources_societe_creer on public.veille_sources';
    execute 'drop policy if exists veille_sources_societe_modifier on public.veille_sources';
    execute 'drop policy if exists veille_sources_societe_supprimer on public.veille_sources';
    execute 'drop trigger if exists veille_sources_societe on public.veille_sources';
    execute 'drop trigger if exists veille_sources_societes on public.veille_sources';
    execute 'alter table public.veille_sources drop constraint if exists veille_sources_company_fk';
    execute 'drop index if exists public.veille_sources_company_idx';
    execute 'drop index if exists public.veille_sources_company_ids_idx';
    execute 'alter table public.veille_sources drop column if exists company_ids';
    execute 'alter table public.veille_sources drop column if exists company_id';
  end if;
end
$$;
-- processes
do $$
begin
  if to_regclass('public.processes') is not null then
    execute 'drop policy if exists processes_societe_lire on public.processes';
    execute 'drop policy if exists processes_societe_creer on public.processes';
    execute 'drop policy if exists processes_societe_modifier on public.processes';
    execute 'drop policy if exists processes_societe_supprimer on public.processes';
    execute 'drop trigger if exists processes_societe on public.processes';
    execute 'drop trigger if exists processes_societes on public.processes';
    execute 'alter table public.processes drop constraint if exists processes_company_fk';
    execute 'drop index if exists public.processes_company_idx';
    execute 'drop index if exists public.processes_company_ids_idx';
    execute 'alter table public.processes drop column if exists company_ids';
    execute 'alter table public.processes drop column if exists company_id';
  end if;
end
$$;
-- process_categories
do $$
begin
  if to_regclass('public.process_categories') is not null then
    execute 'drop policy if exists process_categories_societe_lire on public.process_categories';
    execute 'drop policy if exists process_categories_societe_creer on public.process_categories';
    execute 'drop policy if exists process_categories_societe_modifier on public.process_categories';
    execute 'drop policy if exists process_categories_societe_supprimer on public.process_categories';
    execute 'drop trigger if exists process_categories_societe on public.process_categories';
    execute 'drop trigger if exists process_categories_societes on public.process_categories';
    execute 'alter table public.process_categories drop constraint if exists process_categories_company_fk';
    execute 'drop index if exists public.process_categories_company_idx';
    execute 'drop index if exists public.process_categories_company_ids_idx';
    execute 'alter table public.process_categories drop column if exists company_ids';
    execute 'alter table public.process_categories drop column if exists company_id';
  end if;
end
$$;
-- process_responsibles
do $$
begin
  if to_regclass('public.process_responsibles') is not null then
    execute 'drop policy if exists process_responsibles_societe_lire on public.process_responsibles';
    execute 'drop policy if exists process_responsibles_societe_creer on public.process_responsibles';
    execute 'drop policy if exists process_responsibles_societe_modifier on public.process_responsibles';
    execute 'drop policy if exists process_responsibles_societe_supprimer on public.process_responsibles';
    execute 'drop trigger if exists process_responsibles_societe on public.process_responsibles';
    execute 'drop trigger if exists process_responsibles_societes on public.process_responsibles';
    execute 'alter table public.process_responsibles drop constraint if exists process_responsibles_company_fk';
    execute 'drop index if exists public.process_responsibles_company_idx';
    execute 'drop index if exists public.process_responsibles_company_ids_idx';
    execute 'alter table public.process_responsibles drop column if exists company_ids';
    execute 'alter table public.process_responsibles drop column if exists company_id';
  end if;
end
$$;
-- qualiopi_indicators
do $$
begin
  if to_regclass('public.qualiopi_indicators') is not null then
    execute 'drop policy if exists qualiopi_indicators_societe_lire on public.qualiopi_indicators';
    execute 'drop policy if exists qualiopi_indicators_societe_creer on public.qualiopi_indicators';
    execute 'drop policy if exists qualiopi_indicators_societe_modifier on public.qualiopi_indicators';
    execute 'drop policy if exists qualiopi_indicators_societe_supprimer on public.qualiopi_indicators';
    execute 'drop trigger if exists qualiopi_indicators_societe on public.qualiopi_indicators';
    execute 'drop trigger if exists qualiopi_indicators_societes on public.qualiopi_indicators';
    execute 'alter table public.qualiopi_indicators drop constraint if exists qualiopi_indicators_company_fk';
    execute 'drop index if exists public.qualiopi_indicators_company_idx';
    execute 'drop index if exists public.qualiopi_indicators_company_ids_idx';
    execute 'alter table public.qualiopi_indicators drop column if exists company_ids';
    execute 'alter table public.qualiopi_indicators drop column if exists company_id';
  end if;
end
$$;
-- audits_internes
do $$
begin
  if to_regclass('public.audits_internes') is not null then
    execute 'drop policy if exists audits_internes_societe_lire on public.audits_internes';
    execute 'drop policy if exists audits_internes_societe_creer on public.audits_internes';
    execute 'drop policy if exists audits_internes_societe_modifier on public.audits_internes';
    execute 'drop policy if exists audits_internes_societe_supprimer on public.audits_internes';
    execute 'drop trigger if exists audits_internes_societe on public.audits_internes';
    execute 'drop trigger if exists audits_internes_societes on public.audits_internes';
    execute 'alter table public.audits_internes drop constraint if exists audits_internes_company_fk';
    execute 'drop index if exists public.audits_internes_company_idx';
    execute 'drop index if exists public.audits_internes_company_ids_idx';
    execute 'alter table public.audits_internes drop column if exists company_ids';
    execute 'alter table public.audits_internes drop column if exists company_id';
  end if;
end
$$;
-- documents
do $$
begin
  if to_regclass('public.documents') is not null then
    execute 'drop policy if exists documents_societe_lire on public.documents';
    execute 'drop policy if exists documents_societe_creer on public.documents';
    execute 'drop policy if exists documents_societe_modifier on public.documents';
    execute 'drop policy if exists documents_societe_supprimer on public.documents';
    execute 'drop trigger if exists documents_societe on public.documents';
    execute 'drop trigger if exists documents_societes on public.documents';
    execute 'alter table public.documents drop constraint if exists documents_company_fk';
    execute 'drop index if exists public.documents_company_idx';
    execute 'drop index if exists public.documents_company_ids_idx';
    execute 'alter table public.documents drop column if exists company_ids';
    execute 'alter table public.documents drop column if exists company_id';
  end if;
end
$$;
-- uploaded_documents
do $$
begin
  if to_regclass('public.uploaded_documents') is not null then
    execute 'drop policy if exists uploaded_documents_societe_lire on public.uploaded_documents';
    execute 'drop policy if exists uploaded_documents_societe_creer on public.uploaded_documents';
    execute 'drop policy if exists uploaded_documents_societe_modifier on public.uploaded_documents';
    execute 'drop policy if exists uploaded_documents_societe_supprimer on public.uploaded_documents';
    execute 'drop trigger if exists uploaded_documents_societe on public.uploaded_documents';
    execute 'drop trigger if exists uploaded_documents_societes on public.uploaded_documents';
    execute 'alter table public.uploaded_documents drop constraint if exists uploaded_documents_company_fk';
    execute 'drop index if exists public.uploaded_documents_company_idx';
    execute 'drop index if exists public.uploaded_documents_company_ids_idx';
    execute 'alter table public.uploaded_documents drop column if exists company_ids';
    execute 'alter table public.uploaded_documents drop column if exists company_id';
  end if;
end
$$;
-- uploaded_files
do $$
begin
  if to_regclass('public.uploaded_files') is not null then
    execute 'drop policy if exists uploaded_files_societe_lire on public.uploaded_files';
    execute 'drop policy if exists uploaded_files_societe_creer on public.uploaded_files';
    execute 'drop policy if exists uploaded_files_societe_modifier on public.uploaded_files';
    execute 'drop policy if exists uploaded_files_societe_supprimer on public.uploaded_files';
    execute 'drop trigger if exists uploaded_files_societe on public.uploaded_files';
    execute 'drop trigger if exists uploaded_files_societes on public.uploaded_files';
    execute 'alter table public.uploaded_files drop constraint if exists uploaded_files_company_fk';
    execute 'drop index if exists public.uploaded_files_company_idx';
    execute 'drop index if exists public.uploaded_files_company_ids_idx';
    execute 'alter table public.uploaded_files drop column if exists company_ids';
    execute 'alter table public.uploaded_files drop column if exists company_id';
  end if;
end
$$;
-- import_logs
do $$
begin
  if to_regclass('public.import_logs') is not null then
    execute 'drop policy if exists import_logs_societe_lire on public.import_logs';
    execute 'drop policy if exists import_logs_societe_creer on public.import_logs';
    execute 'drop policy if exists import_logs_societe_modifier on public.import_logs';
    execute 'drop policy if exists import_logs_societe_supprimer on public.import_logs';
    execute 'drop trigger if exists import_logs_societe on public.import_logs';
    execute 'drop trigger if exists import_logs_societes on public.import_logs';
    execute 'alter table public.import_logs drop constraint if exists import_logs_company_fk';
    execute 'drop index if exists public.import_logs_company_idx';
    execute 'drop index if exists public.import_logs_company_ids_idx';
    execute 'alter table public.import_logs drop column if exists company_ids';
    execute 'alter table public.import_logs drop column if exists company_id';
  end if;
end
$$;
-- signature_alerts_sent
do $$
begin
  if to_regclass('public.signature_alerts_sent') is not null then
    execute 'drop policy if exists signature_alerts_sent_societe_lire on public.signature_alerts_sent';
    execute 'drop policy if exists signature_alerts_sent_societe_creer on public.signature_alerts_sent';
    execute 'drop policy if exists signature_alerts_sent_societe_modifier on public.signature_alerts_sent';
    execute 'drop policy if exists signature_alerts_sent_societe_supprimer on public.signature_alerts_sent';
    execute 'drop trigger if exists signature_alerts_sent_societe on public.signature_alerts_sent';
    execute 'drop trigger if exists signature_alerts_sent_societes on public.signature_alerts_sent';
    execute 'alter table public.signature_alerts_sent drop constraint if exists signature_alerts_sent_company_fk';
    execute 'drop index if exists public.signature_alerts_sent_company_idx';
    execute 'drop index if exists public.signature_alerts_sent_company_ids_idx';
    execute 'alter table public.signature_alerts_sent drop column if exists company_ids';
    execute 'alter table public.signature_alerts_sent drop column if exists company_id';
  end if;
end
$$;
-- trainees_archive
do $$
begin
  if to_regclass('public.trainees_archive') is not null then
    execute 'drop policy if exists trainees_archive_societe_lire on public.trainees_archive';
    execute 'drop policy if exists trainees_archive_societe_creer on public.trainees_archive';
    execute 'drop policy if exists trainees_archive_societe_modifier on public.trainees_archive';
    execute 'drop policy if exists trainees_archive_societe_supprimer on public.trainees_archive';
    execute 'drop trigger if exists trainees_archive_societe on public.trainees_archive';
    execute 'drop trigger if exists trainees_archive_societes on public.trainees_archive';
    execute 'alter table public.trainees_archive drop constraint if exists trainees_archive_company_fk';
    execute 'drop index if exists public.trainees_archive_company_idx';
    execute 'drop index if exists public.trainees_archive_company_ids_idx';
    execute 'alter table public.trainees_archive drop column if exists company_ids';
    execute 'alter table public.trainees_archive drop column if exists company_id';
  end if;
end
$$;
-- psh_requests
do $$
begin
  if to_regclass('public.psh_requests') is not null then
    execute 'drop policy if exists psh_requests_societe_lire on public.psh_requests';
    execute 'drop policy if exists psh_requests_societe_creer on public.psh_requests';
    execute 'drop policy if exists psh_requests_societe_modifier on public.psh_requests';
    execute 'drop policy if exists psh_requests_societe_supprimer on public.psh_requests';
    execute 'drop trigger if exists psh_requests_societe on public.psh_requests';
    execute 'drop trigger if exists psh_requests_societes on public.psh_requests';
    execute 'alter table public.psh_requests drop constraint if exists psh_requests_company_fk';
    execute 'drop index if exists public.psh_requests_company_idx';
    execute 'drop index if exists public.psh_requests_company_ids_idx';
    execute 'alter table public.psh_requests drop column if exists company_ids';
    execute 'alter table public.psh_requests drop column if exists company_id';
  end if;
end
$$;
-- client_interactions
do $$
begin
  if to_regclass('public.client_interactions') is not null then
    execute 'drop policy if exists client_interactions_societe_lire on public.client_interactions';
    execute 'drop policy if exists client_interactions_societe_creer on public.client_interactions';
    execute 'drop policy if exists client_interactions_societe_modifier on public.client_interactions';
    execute 'drop policy if exists client_interactions_societe_supprimer on public.client_interactions';
    execute 'drop trigger if exists client_interactions_societe on public.client_interactions';
    execute 'drop trigger if exists client_interactions_societes on public.client_interactions';
    execute 'alter table public.client_interactions drop constraint if exists client_interactions_company_fk';
    execute 'drop index if exists public.client_interactions_company_idx';
    execute 'drop index if exists public.client_interactions_company_ids_idx';
    execute 'alter table public.client_interactions drop column if exists company_ids';
    execute 'alter table public.client_interactions drop column if exists company_id';
  end if;
end
$$;
-- client_portal_access
do $$
begin
  if to_regclass('public.client_portal_access') is not null then
    execute 'drop policy if exists client_portal_access_societe_lire on public.client_portal_access';
    execute 'drop policy if exists client_portal_access_societe_creer on public.client_portal_access';
    execute 'drop policy if exists client_portal_access_societe_modifier on public.client_portal_access';
    execute 'drop policy if exists client_portal_access_societe_supprimer on public.client_portal_access';
    execute 'drop trigger if exists client_portal_access_societe on public.client_portal_access';
    execute 'drop trigger if exists client_portal_access_societes on public.client_portal_access';
    execute 'alter table public.client_portal_access drop constraint if exists client_portal_access_company_fk';
    execute 'drop index if exists public.client_portal_access_company_idx';
    execute 'drop index if exists public.client_portal_access_company_ids_idx';
    execute 'alter table public.client_portal_access drop column if exists company_ids';
    execute 'alter table public.client_portal_access drop column if exists company_id';
  end if;
end
$$;
-- client_providers
do $$
begin
  if to_regclass('public.client_providers') is not null then
    execute 'drop policy if exists client_providers_societe_lire on public.client_providers';
    execute 'drop policy if exists client_providers_societe_creer on public.client_providers';
    execute 'drop policy if exists client_providers_societe_modifier on public.client_providers';
    execute 'drop policy if exists client_providers_societe_supprimer on public.client_providers';
    execute 'drop trigger if exists client_providers_societe on public.client_providers';
    execute 'drop trigger if exists client_providers_societes on public.client_providers';
    execute 'alter table public.client_providers drop constraint if exists client_providers_company_fk';
    execute 'drop index if exists public.client_providers_company_idx';
    execute 'drop index if exists public.client_providers_company_ids_idx';
    execute 'alter table public.client_providers drop column if exists company_ids';
    execute 'alter table public.client_providers drop column if exists company_id';
  end if;
end
$$;
-- user_feedback
do $$
begin
  if to_regclass('public.user_feedback') is not null then
    execute 'drop policy if exists user_feedback_societe_lire on public.user_feedback';
    execute 'drop policy if exists user_feedback_societe_creer on public.user_feedback';
    execute 'drop policy if exists user_feedback_societe_modifier on public.user_feedback';
    execute 'drop policy if exists user_feedback_societe_supprimer on public.user_feedback';
    execute 'drop trigger if exists user_feedback_societe on public.user_feedback';
    execute 'drop trigger if exists user_feedback_societes on public.user_feedback';
    execute 'alter table public.user_feedback drop constraint if exists user_feedback_company_fk';
    execute 'drop index if exists public.user_feedback_company_idx';
    execute 'drop index if exists public.user_feedback_company_ids_idx';
    execute 'alter table public.user_feedback drop column if exists company_ids';
    execute 'alter table public.user_feedback alter column company_id drop not null';
    execute 'alter table public.user_feedback alter column company_id drop default';
  end if;
end
$$;
-- quote_items
do $$
begin
  if to_regclass('public.quote_items') is not null then
    execute 'drop policy if exists quote_items_societe_lire on public.quote_items';
    execute 'drop policy if exists quote_items_societe_creer on public.quote_items';
    execute 'drop policy if exists quote_items_societe_modifier on public.quote_items';
    execute 'drop policy if exists quote_items_societe_supprimer on public.quote_items';
    execute 'drop trigger if exists quote_items_societe on public.quote_items';
    execute 'drop trigger if exists quote_items_societes on public.quote_items';
    execute 'alter table public.quote_items drop constraint if exists quote_items_company_fk';
    execute 'drop index if exists public.quote_items_company_idx';
    execute 'drop index if exists public.quote_items_company_ids_idx';
    execute 'alter table public.quote_items drop column if exists company_ids';
    execute 'alter table public.quote_items drop column if exists company_id';
  end if;
end
$$;
-- invoice_items
do $$
begin
  if to_regclass('public.invoice_items') is not null then
    execute 'drop policy if exists invoice_items_societe_lire on public.invoice_items';
    execute 'drop policy if exists invoice_items_societe_creer on public.invoice_items';
    execute 'drop policy if exists invoice_items_societe_modifier on public.invoice_items';
    execute 'drop policy if exists invoice_items_societe_supprimer on public.invoice_items';
    execute 'drop trigger if exists invoice_items_societe on public.invoice_items';
    execute 'drop trigger if exists invoice_items_societes on public.invoice_items';
    execute 'alter table public.invoice_items drop constraint if exists invoice_items_company_fk';
    execute 'drop index if exists public.invoice_items_company_idx';
    execute 'drop index if exists public.invoice_items_company_ids_idx';
    execute 'alter table public.invoice_items drop column if exists company_ids';
    execute 'alter table public.invoice_items drop column if exists company_id';
  end if;
end
$$;
-- invoice_sessions
do $$
begin
  if to_regclass('public.invoice_sessions') is not null then
    execute 'drop policy if exists invoice_sessions_societe_lire on public.invoice_sessions';
    execute 'drop policy if exists invoice_sessions_societe_creer on public.invoice_sessions';
    execute 'drop policy if exists invoice_sessions_societe_modifier on public.invoice_sessions';
    execute 'drop policy if exists invoice_sessions_societe_supprimer on public.invoice_sessions';
    execute 'drop trigger if exists invoice_sessions_societe on public.invoice_sessions';
    execute 'drop trigger if exists invoice_sessions_societes on public.invoice_sessions';
    execute 'alter table public.invoice_sessions drop constraint if exists invoice_sessions_company_fk';
    execute 'drop index if exists public.invoice_sessions_company_idx';
    execute 'drop index if exists public.invoice_sessions_company_ids_idx';
    execute 'alter table public.invoice_sessions drop column if exists company_ids';
    execute 'alter table public.invoice_sessions drop column if exists company_id';
  end if;
end
$$;
-- invoice_payments
do $$
begin
  if to_regclass('public.invoice_payments') is not null then
    execute 'drop policy if exists invoice_payments_societe_lire on public.invoice_payments';
    execute 'drop policy if exists invoice_payments_societe_creer on public.invoice_payments';
    execute 'drop policy if exists invoice_payments_societe_modifier on public.invoice_payments';
    execute 'drop policy if exists invoice_payments_societe_supprimer on public.invoice_payments';
    execute 'drop trigger if exists invoice_payments_societe on public.invoice_payments';
    execute 'drop trigger if exists invoice_payments_societes on public.invoice_payments';
    execute 'alter table public.invoice_payments drop constraint if exists invoice_payments_company_fk';
    execute 'drop index if exists public.invoice_payments_company_idx';
    execute 'drop index if exists public.invoice_payments_company_ids_idx';
    execute 'alter table public.invoice_payments drop column if exists company_ids';
    execute 'alter table public.invoice_payments drop column if exists company_id';
  end if;
end
$$;
-- invoice_relances
do $$
begin
  if to_regclass('public.invoice_relances') is not null then
    execute 'drop policy if exists invoice_relances_societe_lire on public.invoice_relances';
    execute 'drop policy if exists invoice_relances_societe_creer on public.invoice_relances';
    execute 'drop policy if exists invoice_relances_societe_modifier on public.invoice_relances';
    execute 'drop policy if exists invoice_relances_societe_supprimer on public.invoice_relances';
    execute 'drop trigger if exists invoice_relances_societe on public.invoice_relances';
    execute 'drop trigger if exists invoice_relances_societes on public.invoice_relances';
    execute 'alter table public.invoice_relances drop constraint if exists invoice_relances_company_fk';
    execute 'drop index if exists public.invoice_relances_company_idx';
    execute 'drop index if exists public.invoice_relances_company_ids_idx';
    execute 'alter table public.invoice_relances drop column if exists company_ids';
    execute 'alter table public.invoice_relances drop column if exists company_id';
  end if;
end
$$;
-- session_trainees
do $$
begin
  if to_regclass('public.session_trainees') is not null then
    execute 'drop policy if exists session_trainees_societe_lire on public.session_trainees';
    execute 'drop policy if exists session_trainees_societe_creer on public.session_trainees';
    execute 'drop policy if exists session_trainees_societe_modifier on public.session_trainees';
    execute 'drop policy if exists session_trainees_societe_supprimer on public.session_trainees';
    execute 'drop trigger if exists session_trainees_societe on public.session_trainees';
    execute 'drop trigger if exists session_trainees_societes on public.session_trainees';
    execute 'alter table public.session_trainees drop constraint if exists session_trainees_company_fk';
    execute 'drop index if exists public.session_trainees_company_idx';
    execute 'drop index if exists public.session_trainees_company_ids_idx';
    execute 'alter table public.session_trainees drop column if exists company_ids';
    execute 'alter table public.session_trainees drop column if exists company_id';
  end if;
end
$$;
-- session_trainers
do $$
begin
  if to_regclass('public.session_trainers') is not null then
    execute 'drop policy if exists session_trainers_societe_lire on public.session_trainers';
    execute 'drop policy if exists session_trainers_societe_creer on public.session_trainers';
    execute 'drop policy if exists session_trainers_societe_modifier on public.session_trainers';
    execute 'drop policy if exists session_trainers_societe_supprimer on public.session_trainers';
    execute 'drop trigger if exists session_trainers_societe on public.session_trainers';
    execute 'drop trigger if exists session_trainers_societes on public.session_trainers';
    execute 'alter table public.session_trainers drop constraint if exists session_trainers_company_fk';
    execute 'drop index if exists public.session_trainers_company_idx';
    execute 'drop index if exists public.session_trainers_company_ids_idx';
    execute 'alter table public.session_trainers drop column if exists company_ids';
    execute 'alter table public.session_trainers drop column if exists company_id';
  end if;
end
$$;
-- session_checklists
do $$
begin
  if to_regclass('public.session_checklists') is not null then
    execute 'drop policy if exists session_checklists_societe_lire on public.session_checklists';
    execute 'drop policy if exists session_checklists_societe_creer on public.session_checklists';
    execute 'drop policy if exists session_checklists_societe_modifier on public.session_checklists';
    execute 'drop policy if exists session_checklists_societe_supprimer on public.session_checklists';
    execute 'drop trigger if exists session_checklists_societe on public.session_checklists';
    execute 'drop trigger if exists session_checklists_societes on public.session_checklists';
    execute 'alter table public.session_checklists drop constraint if exists session_checklists_company_fk';
    execute 'drop index if exists public.session_checklists_company_idx';
    execute 'drop index if exists public.session_checklists_company_ids_idx';
    execute 'alter table public.session_checklists drop column if exists company_ids';
    execute 'alter table public.session_checklists drop column if exists company_id';
  end if;
end
$$;
-- session_costs
do $$
begin
  if to_regclass('public.session_costs') is not null then
    execute 'drop policy if exists session_costs_societe_lire on public.session_costs';
    execute 'drop policy if exists session_costs_societe_creer on public.session_costs';
    execute 'drop policy if exists session_costs_societe_modifier on public.session_costs';
    execute 'drop policy if exists session_costs_societe_supprimer on public.session_costs';
    execute 'drop trigger if exists session_costs_societe on public.session_costs';
    execute 'drop trigger if exists session_costs_societes on public.session_costs';
    execute 'alter table public.session_costs drop constraint if exists session_costs_company_fk';
    execute 'drop index if exists public.session_costs_company_idx';
    execute 'drop index if exists public.session_costs_company_ids_idx';
    execute 'alter table public.session_costs drop column if exists company_ids';
    execute 'alter table public.session_costs drop column if exists company_id';
  end if;
end
$$;
-- session_document_access
do $$
begin
  if to_regclass('public.session_document_access') is not null then
    execute 'drop policy if exists session_document_access_societe_lire on public.session_document_access';
    execute 'drop policy if exists session_document_access_societe_creer on public.session_document_access';
    execute 'drop policy if exists session_document_access_societe_modifier on public.session_document_access';
    execute 'drop policy if exists session_document_access_societe_supprimer on public.session_document_access';
    execute 'drop trigger if exists session_document_access_societe on public.session_document_access';
    execute 'drop trigger if exists session_document_access_societes on public.session_document_access';
    execute 'alter table public.session_document_access drop constraint if exists session_document_access_company_fk';
    execute 'drop index if exists public.session_document_access_company_idx';
    execute 'drop index if exists public.session_document_access_company_ids_idx';
    execute 'alter table public.session_document_access drop column if exists company_ids';
    execute 'alter table public.session_document_access drop column if exists company_id';
  end if;
end
$$;
-- session_documents
do $$
begin
  if to_regclass('public.session_documents') is not null then
    execute 'drop policy if exists session_documents_societe_lire on public.session_documents';
    execute 'drop policy if exists session_documents_societe_creer on public.session_documents';
    execute 'drop policy if exists session_documents_societe_modifier on public.session_documents';
    execute 'drop policy if exists session_documents_societe_supprimer on public.session_documents';
    execute 'drop trigger if exists session_documents_societe on public.session_documents';
    execute 'drop trigger if exists session_documents_societes on public.session_documents';
    execute 'alter table public.session_documents drop constraint if exists session_documents_company_fk';
    execute 'drop index if exists public.session_documents_company_idx';
    execute 'drop index if exists public.session_documents_company_ids_idx';
    execute 'alter table public.session_documents drop column if exists company_ids';
    execute 'alter table public.session_documents drop column if exists company_id';
  end if;
end
$$;
-- session_emails_sent
do $$
begin
  if to_regclass('public.session_emails_sent') is not null then
    execute 'drop policy if exists session_emails_sent_societe_lire on public.session_emails_sent';
    execute 'drop policy if exists session_emails_sent_societe_creer on public.session_emails_sent';
    execute 'drop policy if exists session_emails_sent_societe_modifier on public.session_emails_sent';
    execute 'drop policy if exists session_emails_sent_societe_supprimer on public.session_emails_sent';
    execute 'drop trigger if exists session_emails_sent_societe on public.session_emails_sent';
    execute 'drop trigger if exists session_emails_sent_societes on public.session_emails_sent';
    execute 'alter table public.session_emails_sent drop constraint if exists session_emails_sent_company_fk';
    execute 'drop index if exists public.session_emails_sent_company_idx';
    execute 'drop index if exists public.session_emails_sent_company_ids_idx';
    execute 'alter table public.session_emails_sent drop column if exists company_ids';
    execute 'alter table public.session_emails_sent drop column if exists company_id';
  end if;
end
$$;
-- session_equipment
do $$
begin
  if to_regclass('public.session_equipment') is not null then
    execute 'drop policy if exists session_equipment_societe_lire on public.session_equipment';
    execute 'drop policy if exists session_equipment_societe_creer on public.session_equipment';
    execute 'drop policy if exists session_equipment_societe_modifier on public.session_equipment';
    execute 'drop policy if exists session_equipment_societe_supprimer on public.session_equipment';
    execute 'drop trigger if exists session_equipment_societe on public.session_equipment';
    execute 'drop trigger if exists session_equipment_societes on public.session_equipment';
    execute 'alter table public.session_equipment drop constraint if exists session_equipment_company_fk';
    execute 'drop index if exists public.session_equipment_company_idx';
    execute 'drop index if exists public.session_equipment_company_ids_idx';
    execute 'alter table public.session_equipment drop column if exists company_ids';
    execute 'alter table public.session_equipment drop column if exists company_id';
  end if;
end
$$;
-- session_fundings
do $$
begin
  if to_regclass('public.session_fundings') is not null then
    execute 'drop policy if exists session_fundings_societe_lire on public.session_fundings';
    execute 'drop policy if exists session_fundings_societe_creer on public.session_fundings';
    execute 'drop policy if exists session_fundings_societe_modifier on public.session_fundings';
    execute 'drop policy if exists session_fundings_societe_supprimer on public.session_fundings';
    execute 'drop trigger if exists session_fundings_societe on public.session_fundings';
    execute 'drop trigger if exists session_fundings_societes on public.session_fundings';
    execute 'alter table public.session_fundings drop constraint if exists session_fundings_company_fk';
    execute 'drop index if exists public.session_fundings_company_idx';
    execute 'drop index if exists public.session_fundings_company_ids_idx';
    execute 'alter table public.session_fundings drop column if exists company_ids';
    execute 'alter table public.session_fundings drop column if exists company_id';
  end if;
end
$$;
-- session_groups
do $$
begin
  if to_regclass('public.session_groups') is not null then
    execute 'drop policy if exists session_groups_societe_lire on public.session_groups';
    execute 'drop policy if exists session_groups_societe_creer on public.session_groups';
    execute 'drop policy if exists session_groups_societe_modifier on public.session_groups';
    execute 'drop policy if exists session_groups_societe_supprimer on public.session_groups';
    execute 'drop trigger if exists session_groups_societe on public.session_groups';
    execute 'drop trigger if exists session_groups_societes on public.session_groups';
    execute 'alter table public.session_groups drop constraint if exists session_groups_company_fk';
    execute 'drop index if exists public.session_groups_company_idx';
    execute 'drop index if exists public.session_groups_company_ids_idx';
    execute 'alter table public.session_groups drop column if exists company_ids';
    execute 'alter table public.session_groups drop column if exists company_id';
  end if;
end
$$;
-- session_needs_analysis
do $$
begin
  if to_regclass('public.session_needs_analysis') is not null then
    execute 'drop policy if exists session_needs_analysis_societe_lire on public.session_needs_analysis';
    execute 'drop policy if exists session_needs_analysis_societe_creer on public.session_needs_analysis';
    execute 'drop policy if exists session_needs_analysis_societe_modifier on public.session_needs_analysis';
    execute 'drop policy if exists session_needs_analysis_societe_supprimer on public.session_needs_analysis';
    execute 'drop trigger if exists session_needs_analysis_societe on public.session_needs_analysis';
    execute 'drop trigger if exists session_needs_analysis_societes on public.session_needs_analysis';
    execute 'alter table public.session_needs_analysis drop constraint if exists session_needs_analysis_company_fk';
    execute 'drop index if exists public.session_needs_analysis_company_idx';
    execute 'drop index if exists public.session_needs_analysis_company_ids_idx';
    execute 'alter table public.session_needs_analysis drop column if exists company_ids';
    execute 'alter table public.session_needs_analysis drop column if exists company_id';
  end if;
end
$$;
-- session_qualiopi
do $$
begin
  if to_regclass('public.session_qualiopi') is not null then
    execute 'drop policy if exists session_qualiopi_societe_lire on public.session_qualiopi';
    execute 'drop policy if exists session_qualiopi_societe_creer on public.session_qualiopi';
    execute 'drop policy if exists session_qualiopi_societe_modifier on public.session_qualiopi';
    execute 'drop policy if exists session_qualiopi_societe_supprimer on public.session_qualiopi';
    execute 'drop trigger if exists session_qualiopi_societe on public.session_qualiopi';
    execute 'drop trigger if exists session_qualiopi_societes on public.session_qualiopi';
    execute 'alter table public.session_qualiopi drop constraint if exists session_qualiopi_company_fk';
    execute 'drop index if exists public.session_qualiopi_company_idx';
    execute 'drop index if exists public.session_qualiopi_company_ids_idx';
    execute 'alter table public.session_qualiopi drop column if exists company_ids';
    execute 'alter table public.session_qualiopi drop column if exists company_id';
  end if;
end
$$;
-- session_sequences
do $$
begin
  if to_regclass('public.session_sequences') is not null then
    execute 'drop policy if exists session_sequences_societe_lire on public.session_sequences';
    execute 'drop policy if exists session_sequences_societe_creer on public.session_sequences';
    execute 'drop policy if exists session_sequences_societe_modifier on public.session_sequences';
    execute 'drop policy if exists session_sequences_societe_supprimer on public.session_sequences';
    execute 'drop trigger if exists session_sequences_societe on public.session_sequences';
    execute 'drop trigger if exists session_sequences_societes on public.session_sequences';
    execute 'alter table public.session_sequences drop constraint if exists session_sequences_company_fk';
    execute 'drop index if exists public.session_sequences_company_idx';
    execute 'drop index if exists public.session_sequences_company_ids_idx';
    execute 'alter table public.session_sequences drop column if exists company_ids';
    execute 'alter table public.session_sequences drop column if exists company_id';
  end if;
end
$$;
-- attendance_halfdays
do $$
begin
  if to_regclass('public.attendance_halfdays') is not null then
    execute 'drop policy if exists attendance_halfdays_societe_lire on public.attendance_halfdays';
    execute 'drop policy if exists attendance_halfdays_societe_creer on public.attendance_halfdays';
    execute 'drop policy if exists attendance_halfdays_societe_modifier on public.attendance_halfdays';
    execute 'drop policy if exists attendance_halfdays_societe_supprimer on public.attendance_halfdays';
    execute 'drop trigger if exists attendance_halfdays_societe on public.attendance_halfdays';
    execute 'drop trigger if exists attendance_halfdays_societes on public.attendance_halfdays';
    execute 'alter table public.attendance_halfdays drop constraint if exists attendance_halfdays_company_fk';
    execute 'drop index if exists public.attendance_halfdays_company_idx';
    execute 'drop index if exists public.attendance_halfdays_company_ids_idx';
    execute 'alter table public.attendance_halfdays drop column if exists company_ids';
    execute 'alter table public.attendance_halfdays drop column if exists company_id';
  end if;
end
$$;
-- attendance_proxy_signatures
do $$
begin
  if to_regclass('public.attendance_proxy_signatures') is not null then
    execute 'drop policy if exists attendance_proxy_signatures_societe_lire on public.attendance_proxy_signatures';
    execute 'drop policy if exists attendance_proxy_signatures_societe_creer on public.attendance_proxy_signatures';
    execute 'drop policy if exists attendance_proxy_signatures_societe_modifier on public.attendance_proxy_signatures';
    execute 'drop policy if exists attendance_proxy_signatures_societe_supprimer on public.attendance_proxy_signatures';
    execute 'drop trigger if exists attendance_proxy_signatures_societe on public.attendance_proxy_signatures';
    execute 'drop trigger if exists attendance_proxy_signatures_societes on public.attendance_proxy_signatures';
    execute 'alter table public.attendance_proxy_signatures drop constraint if exists attendance_proxy_signatures_company_fk';
    execute 'drop index if exists public.attendance_proxy_signatures_company_idx';
    execute 'drop index if exists public.attendance_proxy_signatures_company_ids_idx';
    execute 'alter table public.attendance_proxy_signatures drop column if exists company_ids';
    execute 'alter table public.attendance_proxy_signatures drop column if exists company_id';
  end if;
end
$$;
-- attendances
do $$
begin
  if to_regclass('public.attendances') is not null then
    execute 'drop policy if exists attendances_societe_lire on public.attendances';
    execute 'drop policy if exists attendances_societe_creer on public.attendances';
    execute 'drop policy if exists attendances_societe_modifier on public.attendances';
    execute 'drop policy if exists attendances_societe_supprimer on public.attendances';
    execute 'drop trigger if exists attendances_societe on public.attendances';
    execute 'drop trigger if exists attendances_societes on public.attendances';
    execute 'alter table public.attendances drop constraint if exists attendances_company_fk';
    execute 'drop index if exists public.attendances_company_idx';
    execute 'drop index if exists public.attendances_company_ids_idx';
    execute 'alter table public.attendances drop column if exists company_ids';
    execute 'alter table public.attendances drop column if exists company_id';
  end if;
end
$$;
-- document_signatures
do $$
begin
  if to_regclass('public.document_signatures') is not null then
    execute 'drop policy if exists document_signatures_societe_lire on public.document_signatures';
    execute 'drop policy if exists document_signatures_societe_creer on public.document_signatures';
    execute 'drop policy if exists document_signatures_societe_modifier on public.document_signatures';
    execute 'drop policy if exists document_signatures_societe_supprimer on public.document_signatures';
    execute 'drop trigger if exists document_signatures_societe on public.document_signatures';
    execute 'drop trigger if exists document_signatures_societes on public.document_signatures';
    execute 'alter table public.document_signatures drop constraint if exists document_signatures_company_fk';
    execute 'drop index if exists public.document_signatures_company_idx';
    execute 'drop index if exists public.document_signatures_company_ids_idx';
    execute 'alter table public.document_signatures drop column if exists company_ids';
    execute 'alter table public.document_signatures drop column if exists company_id';
  end if;
end
$$;
-- trainee_evaluations
do $$
begin
  if to_regclass('public.trainee_evaluations') is not null then
    execute 'drop policy if exists trainee_evaluations_societe_lire on public.trainee_evaluations';
    execute 'drop policy if exists trainee_evaluations_societe_creer on public.trainee_evaluations';
    execute 'drop policy if exists trainee_evaluations_societe_modifier on public.trainee_evaluations';
    execute 'drop policy if exists trainee_evaluations_societe_supprimer on public.trainee_evaluations';
    execute 'drop trigger if exists trainee_evaluations_societe on public.trainee_evaluations';
    execute 'drop trigger if exists trainee_evaluations_societes on public.trainee_evaluations';
    execute 'alter table public.trainee_evaluations drop constraint if exists trainee_evaluations_company_fk';
    execute 'drop index if exists public.trainee_evaluations_company_idx';
    execute 'drop index if exists public.trainee_evaluations_company_ids_idx';
    execute 'alter table public.trainee_evaluations drop column if exists company_ids';
    execute 'alter table public.trainee_evaluations drop column if exists company_id';
  end if;
end
$$;
-- evaluations_cold
do $$
begin
  if to_regclass('public.evaluations_cold') is not null then
    execute 'drop policy if exists evaluations_cold_societe_lire on public.evaluations_cold';
    execute 'drop policy if exists evaluations_cold_societe_creer on public.evaluations_cold';
    execute 'drop policy if exists evaluations_cold_societe_modifier on public.evaluations_cold';
    execute 'drop policy if exists evaluations_cold_societe_supprimer on public.evaluations_cold';
    execute 'drop trigger if exists evaluations_cold_societe on public.evaluations_cold';
    execute 'drop trigger if exists evaluations_cold_societes on public.evaluations_cold';
    execute 'alter table public.evaluations_cold drop constraint if exists evaluations_cold_company_fk';
    execute 'drop index if exists public.evaluations_cold_company_idx';
    execute 'drop index if exists public.evaluations_cold_company_ids_idx';
    execute 'alter table public.evaluations_cold drop column if exists company_ids';
    execute 'alter table public.evaluations_cold drop column if exists company_id';
  end if;
end
$$;
-- trainer_evaluations
do $$
begin
  if to_regclass('public.trainer_evaluations') is not null then
    execute 'drop policy if exists trainer_evaluations_societe_lire on public.trainer_evaluations';
    execute 'drop policy if exists trainer_evaluations_societe_creer on public.trainer_evaluations';
    execute 'drop policy if exists trainer_evaluations_societe_modifier on public.trainer_evaluations';
    execute 'drop policy if exists trainer_evaluations_societe_supprimer on public.trainer_evaluations';
    execute 'drop trigger if exists trainer_evaluations_societe on public.trainer_evaluations';
    execute 'drop trigger if exists trainer_evaluations_societes on public.trainer_evaluations';
    execute 'alter table public.trainer_evaluations drop constraint if exists trainer_evaluations_company_fk';
    execute 'drop index if exists public.trainer_evaluations_company_idx';
    execute 'drop index if exists public.trainer_evaluations_company_ids_idx';
    execute 'alter table public.trainer_evaluations drop column if exists company_ids';
    execute 'alter table public.trainer_evaluations drop column if exists company_id';
  end if;
end
$$;
-- trainee_info_sheets
do $$
begin
  if to_regclass('public.trainee_info_sheets') is not null then
    execute 'drop policy if exists trainee_info_sheets_societe_lire on public.trainee_info_sheets';
    execute 'drop policy if exists trainee_info_sheets_societe_creer on public.trainee_info_sheets';
    execute 'drop policy if exists trainee_info_sheets_societe_modifier on public.trainee_info_sheets';
    execute 'drop policy if exists trainee_info_sheets_societe_supprimer on public.trainee_info_sheets';
    execute 'drop trigger if exists trainee_info_sheets_societe on public.trainee_info_sheets';
    execute 'drop trigger if exists trainee_info_sheets_societes on public.trainee_info_sheets';
    execute 'alter table public.trainee_info_sheets drop constraint if exists trainee_info_sheets_company_fk';
    execute 'drop index if exists public.trainee_info_sheets_company_idx';
    execute 'drop index if exists public.trainee_info_sheets_company_ids_idx';
    execute 'alter table public.trainee_info_sheets drop column if exists company_ids';
    execute 'alter table public.trainee_info_sheets drop column if exists company_id';
  end if;
end
$$;
-- trainee_objectives
do $$
begin
  if to_regclass('public.trainee_objectives') is not null then
    execute 'drop policy if exists trainee_objectives_societe_lire on public.trainee_objectives';
    execute 'drop policy if exists trainee_objectives_societe_creer on public.trainee_objectives';
    execute 'drop policy if exists trainee_objectives_societe_modifier on public.trainee_objectives';
    execute 'drop policy if exists trainee_objectives_societe_supprimer on public.trainee_objectives';
    execute 'drop trigger if exists trainee_objectives_societe on public.trainee_objectives';
    execute 'drop trigger if exists trainee_objectives_societes on public.trainee_objectives';
    execute 'alter table public.trainee_objectives drop constraint if exists trainee_objectives_company_fk';
    execute 'drop index if exists public.trainee_objectives_company_idx';
    execute 'drop index if exists public.trainee_objectives_company_ids_idx';
    execute 'alter table public.trainee_objectives drop column if exists company_ids';
    execute 'alter table public.trainee_objectives drop column if exists company_id';
  end if;
end
$$;
-- trainee_positioning_tests
do $$
begin
  if to_regclass('public.trainee_positioning_tests') is not null then
    execute 'drop policy if exists trainee_positioning_tests_societe_lire on public.trainee_positioning_tests';
    execute 'drop policy if exists trainee_positioning_tests_societe_creer on public.trainee_positioning_tests';
    execute 'drop policy if exists trainee_positioning_tests_societe_modifier on public.trainee_positioning_tests';
    execute 'drop policy if exists trainee_positioning_tests_societe_supprimer on public.trainee_positioning_tests';
    execute 'drop trigger if exists trainee_positioning_tests_societe on public.trainee_positioning_tests';
    execute 'drop trigger if exists trainee_positioning_tests_societes on public.trainee_positioning_tests';
    execute 'alter table public.trainee_positioning_tests drop constraint if exists trainee_positioning_tests_company_fk';
    execute 'drop index if exists public.trainee_positioning_tests_company_idx';
    execute 'drop index if exists public.trainee_positioning_tests_company_ids_idx';
    execute 'alter table public.trainee_positioning_tests drop column if exists company_ids';
    execute 'alter table public.trainee_positioning_tests drop column if exists company_id';
  end if;
end
$$;
-- positioning_results
do $$
begin
  if to_regclass('public.positioning_results') is not null then
    execute 'drop policy if exists positioning_results_societe_lire on public.positioning_results';
    execute 'drop policy if exists positioning_results_societe_creer on public.positioning_results';
    execute 'drop policy if exists positioning_results_societe_modifier on public.positioning_results';
    execute 'drop policy if exists positioning_results_societe_supprimer on public.positioning_results';
    execute 'drop trigger if exists positioning_results_societe on public.positioning_results';
    execute 'drop trigger if exists positioning_results_societes on public.positioning_results';
    execute 'alter table public.positioning_results drop constraint if exists positioning_results_company_fk';
    execute 'drop index if exists public.positioning_results_company_idx';
    execute 'drop index if exists public.positioning_results_company_ids_idx';
    execute 'alter table public.positioning_results drop column if exists company_ids';
    execute 'alter table public.positioning_results drop column if exists company_id';
  end if;
end
$$;
-- quiz_attempts
do $$
begin
  if to_regclass('public.quiz_attempts') is not null then
    execute 'drop policy if exists quiz_attempts_societe_lire on public.quiz_attempts';
    execute 'drop policy if exists quiz_attempts_societe_creer on public.quiz_attempts';
    execute 'drop policy if exists quiz_attempts_societe_modifier on public.quiz_attempts';
    execute 'drop policy if exists quiz_attempts_societe_supprimer on public.quiz_attempts';
    execute 'drop trigger if exists quiz_attempts_societe on public.quiz_attempts';
    execute 'drop trigger if exists quiz_attempts_societes on public.quiz_attempts';
    execute 'alter table public.quiz_attempts drop constraint if exists quiz_attempts_company_fk';
    execute 'drop index if exists public.quiz_attempts_company_idx';
    execute 'drop index if exists public.quiz_attempts_company_ids_idx';
    execute 'alter table public.quiz_attempts drop column if exists company_ids';
    execute 'alter table public.quiz_attempts drop column if exists company_id';
  end if;
end
$$;
-- sst_certifications
do $$
begin
  if to_regclass('public.sst_certifications') is not null then
    execute 'drop policy if exists sst_certifications_societe_lire on public.sst_certifications';
    execute 'drop policy if exists sst_certifications_societe_creer on public.sst_certifications';
    execute 'drop policy if exists sst_certifications_societe_modifier on public.sst_certifications';
    execute 'drop policy if exists sst_certifications_societe_supprimer on public.sst_certifications';
    execute 'drop trigger if exists sst_certifications_societe on public.sst_certifications';
    execute 'drop trigger if exists sst_certifications_societes on public.sst_certifications';
    execute 'alter table public.sst_certifications drop constraint if exists sst_certifications_company_fk';
    execute 'drop index if exists public.sst_certifications_company_idx';
    execute 'drop index if exists public.sst_certifications_company_ids_idx';
    execute 'alter table public.sst_certifications drop column if exists company_ids';
    execute 'alter table public.sst_certifications drop column if exists company_id';
  end if;
end
$$;
-- formative_evaluations
do $$
begin
  if to_regclass('public.formative_evaluations') is not null then
    execute 'drop policy if exists formative_evaluations_societe_lire on public.formative_evaluations';
    execute 'drop policy if exists formative_evaluations_societe_creer on public.formative_evaluations';
    execute 'drop policy if exists formative_evaluations_societe_modifier on public.formative_evaluations';
    execute 'drop policy if exists formative_evaluations_societe_supprimer on public.formative_evaluations';
    execute 'drop trigger if exists formative_evaluations_societe on public.formative_evaluations';
    execute 'drop trigger if exists formative_evaluations_societes on public.formative_evaluations';
    execute 'alter table public.formative_evaluations drop constraint if exists formative_evaluations_company_fk';
    execute 'drop index if exists public.formative_evaluations_company_idx';
    execute 'drop index if exists public.formative_evaluations_company_ids_idx';
    execute 'alter table public.formative_evaluations drop column if exists company_ids';
    execute 'alter table public.formative_evaluations drop column if exists company_id';
  end if;
end
$$;
-- formative_sheets
do $$
begin
  if to_regclass('public.formative_sheets') is not null then
    execute 'drop policy if exists formative_sheets_societe_lire on public.formative_sheets';
    execute 'drop policy if exists formative_sheets_societe_creer on public.formative_sheets';
    execute 'drop policy if exists formative_sheets_societe_modifier on public.formative_sheets';
    execute 'drop policy if exists formative_sheets_societe_supprimer on public.formative_sheets';
    execute 'drop trigger if exists formative_sheets_societe on public.formative_sheets';
    execute 'drop trigger if exists formative_sheets_societes on public.formative_sheets';
    execute 'alter table public.formative_sheets drop constraint if exists formative_sheets_company_fk';
    execute 'drop index if exists public.formative_sheets_company_idx';
    execute 'drop index if exists public.formative_sheets_company_ids_idx';
    execute 'alter table public.formative_sheets drop column if exists company_ids';
    execute 'alter table public.formative_sheets drop column if exists company_id';
  end if;
end
$$;
-- course_document_downloads
do $$
begin
  if to_regclass('public.course_document_downloads') is not null then
    execute 'drop policy if exists course_document_downloads_societe_lire on public.course_document_downloads';
    execute 'drop policy if exists course_document_downloads_societe_creer on public.course_document_downloads';
    execute 'drop policy if exists course_document_downloads_societe_modifier on public.course_document_downloads';
    execute 'drop policy if exists course_document_downloads_societe_supprimer on public.course_document_downloads';
    execute 'drop trigger if exists course_document_downloads_societe on public.course_document_downloads';
    execute 'drop trigger if exists course_document_downloads_societes on public.course_document_downloads';
    execute 'alter table public.course_document_downloads drop constraint if exists course_document_downloads_company_fk';
    execute 'drop index if exists public.course_document_downloads_company_idx';
    execute 'drop index if exists public.course_document_downloads_company_ids_idx';
    execute 'alter table public.course_document_downloads drop column if exists company_ids';
    execute 'alter table public.course_document_downloads drop column if exists company_id';
  end if;
end
$$;
-- pp_lignes
do $$
begin
  if to_regclass('public.pp_lignes') is not null then
    execute 'drop policy if exists pp_lignes_societe_lire on public.pp_lignes';
    execute 'drop policy if exists pp_lignes_societe_creer on public.pp_lignes';
    execute 'drop policy if exists pp_lignes_societe_modifier on public.pp_lignes';
    execute 'drop policy if exists pp_lignes_societe_supprimer on public.pp_lignes';
    execute 'drop trigger if exists pp_lignes_societe on public.pp_lignes';
    execute 'drop trigger if exists pp_lignes_societes on public.pp_lignes';
    execute 'alter table public.pp_lignes drop constraint if exists pp_lignes_company_fk';
    execute 'drop index if exists public.pp_lignes_company_idx';
    execute 'drop index if exists public.pp_lignes_company_ids_idx';
    execute 'alter table public.pp_lignes drop column if exists company_ids';
    execute 'alter table public.pp_lignes drop column if exists company_id';
  end if;
end
$$;
-- trainee_documents
do $$
begin
  if to_regclass('public.trainee_documents') is not null then
    execute 'drop policy if exists trainee_documents_societe_lire on public.trainee_documents';
    execute 'drop policy if exists trainee_documents_societe_creer on public.trainee_documents';
    execute 'drop policy if exists trainee_documents_societe_modifier on public.trainee_documents';
    execute 'drop policy if exists trainee_documents_societe_supprimer on public.trainee_documents';
    execute 'drop trigger if exists trainee_documents_societe on public.trainee_documents';
    execute 'drop trigger if exists trainee_documents_societes on public.trainee_documents';
    execute 'alter table public.trainee_documents drop constraint if exists trainee_documents_company_fk';
    execute 'drop index if exists public.trainee_documents_company_idx';
    execute 'drop index if exists public.trainee_documents_company_ids_idx';
    execute 'alter table public.trainee_documents drop column if exists company_ids';
    execute 'alter table public.trainee_documents drop column if exists company_id';
  end if;
end
$$;
-- trainee_disability
do $$
begin
  if to_regclass('public.trainee_disability') is not null then
    execute 'drop policy if exists trainee_disability_societe_lire on public.trainee_disability';
    execute 'drop policy if exists trainee_disability_societe_creer on public.trainee_disability';
    execute 'drop policy if exists trainee_disability_societe_modifier on public.trainee_disability';
    execute 'drop policy if exists trainee_disability_societe_supprimer on public.trainee_disability';
    execute 'drop trigger if exists trainee_disability_societe on public.trainee_disability';
    execute 'drop trigger if exists trainee_disability_societes on public.trainee_disability';
    execute 'alter table public.trainee_disability drop constraint if exists trainee_disability_company_fk';
    execute 'drop index if exists public.trainee_disability_company_idx';
    execute 'drop index if exists public.trainee_disability_company_ids_idx';
    execute 'alter table public.trainee_disability drop column if exists company_ids';
    execute 'alter table public.trainee_disability drop column if exists company_id';
  end if;
end
$$;
-- trainee_ssn
do $$
begin
  if to_regclass('public.trainee_ssn') is not null then
    execute 'drop policy if exists trainee_ssn_societe_lire on public.trainee_ssn';
    execute 'drop policy if exists trainee_ssn_societe_creer on public.trainee_ssn';
    execute 'drop policy if exists trainee_ssn_societe_modifier on public.trainee_ssn';
    execute 'drop policy if exists trainee_ssn_societe_supprimer on public.trainee_ssn';
    execute 'drop trigger if exists trainee_ssn_societe on public.trainee_ssn';
    execute 'drop trigger if exists trainee_ssn_societes on public.trainee_ssn';
    execute 'alter table public.trainee_ssn drop constraint if exists trainee_ssn_company_fk';
    execute 'drop index if exists public.trainee_ssn_company_idx';
    execute 'drop index if exists public.trainee_ssn_company_ids_idx';
    execute 'alter table public.trainee_ssn drop column if exists company_ids';
    execute 'alter table public.trainee_ssn drop column if exists company_id';
  end if;
end
$$;
-- pp_nir
do $$
begin
  if to_regclass('public.pp_nir') is not null then
    execute 'drop policy if exists pp_nir_societe_lire on public.pp_nir';
    execute 'drop policy if exists pp_nir_societe_creer on public.pp_nir';
    execute 'drop policy if exists pp_nir_societe_modifier on public.pp_nir';
    execute 'drop policy if exists pp_nir_societe_supprimer on public.pp_nir';
    execute 'drop trigger if exists pp_nir_societe on public.pp_nir';
    execute 'drop trigger if exists pp_nir_societes on public.pp_nir';
    execute 'alter table public.pp_nir drop constraint if exists pp_nir_company_fk';
    execute 'drop index if exists public.pp_nir_company_idx';
    execute 'drop index if exists public.pp_nir_company_ids_idx';
    execute 'alter table public.pp_nir drop column if exists company_ids';
    execute 'alter table public.pp_nir drop column if exists company_id';
  end if;
end
$$;
-- itv_visit_items
do $$
begin
  if to_regclass('public.itv_visit_items') is not null then
    execute 'drop policy if exists itv_visit_items_societe_lire on public.itv_visit_items';
    execute 'drop policy if exists itv_visit_items_societe_creer on public.itv_visit_items';
    execute 'drop policy if exists itv_visit_items_societe_modifier on public.itv_visit_items';
    execute 'drop policy if exists itv_visit_items_societe_supprimer on public.itv_visit_items';
    execute 'drop trigger if exists itv_visit_items_societe on public.itv_visit_items';
    execute 'drop trigger if exists itv_visit_items_societes on public.itv_visit_items';
    execute 'alter table public.itv_visit_items drop constraint if exists itv_visit_items_company_fk';
    execute 'drop index if exists public.itv_visit_items_company_idx';
    execute 'drop index if exists public.itv_visit_items_company_ids_idx';
    execute 'alter table public.itv_visit_items drop column if exists company_ids';
    execute 'alter table public.itv_visit_items drop column if exists company_id';
  end if;
end
$$;
-- itv_visit_parts
do $$
begin
  if to_regclass('public.itv_visit_parts') is not null then
    execute 'drop policy if exists itv_visit_parts_societe_lire on public.itv_visit_parts';
    execute 'drop policy if exists itv_visit_parts_societe_creer on public.itv_visit_parts';
    execute 'drop policy if exists itv_visit_parts_societe_modifier on public.itv_visit_parts';
    execute 'drop policy if exists itv_visit_parts_societe_supprimer on public.itv_visit_parts';
    execute 'drop trigger if exists itv_visit_parts_societe on public.itv_visit_parts';
    execute 'drop trigger if exists itv_visit_parts_societes on public.itv_visit_parts';
    execute 'alter table public.itv_visit_parts drop constraint if exists itv_visit_parts_company_fk';
    execute 'drop index if exists public.itv_visit_parts_company_idx';
    execute 'drop index if exists public.itv_visit_parts_company_ids_idx';
    execute 'alter table public.itv_visit_parts drop column if exists company_ids';
    execute 'alter table public.itv_visit_parts drop column if exists company_id';
  end if;
end
$$;
-- duerp_actions
do $$
begin
  if to_regclass('public.duerp_actions') is not null then
    execute 'drop policy if exists duerp_actions_societe_lire on public.duerp_actions';
    execute 'drop policy if exists duerp_actions_societe_creer on public.duerp_actions';
    execute 'drop policy if exists duerp_actions_societe_modifier on public.duerp_actions';
    execute 'drop policy if exists duerp_actions_societe_supprimer on public.duerp_actions';
    execute 'drop trigger if exists duerp_actions_societe on public.duerp_actions';
    execute 'drop trigger if exists duerp_actions_societes on public.duerp_actions';
    execute 'alter table public.duerp_actions drop constraint if exists duerp_actions_company_fk';
    execute 'drop index if exists public.duerp_actions_company_idx';
    execute 'drop index if exists public.duerp_actions_company_ids_idx';
    execute 'alter table public.duerp_actions drop column if exists company_ids';
    execute 'alter table public.duerp_actions drop column if exists company_id';
  end if;
end
$$;
-- duerp_risks
do $$
begin
  if to_regclass('public.duerp_risks') is not null then
    execute 'drop policy if exists duerp_risks_societe_lire on public.duerp_risks';
    execute 'drop policy if exists duerp_risks_societe_creer on public.duerp_risks';
    execute 'drop policy if exists duerp_risks_societe_modifier on public.duerp_risks';
    execute 'drop policy if exists duerp_risks_societe_supprimer on public.duerp_risks';
    execute 'drop trigger if exists duerp_risks_societe on public.duerp_risks';
    execute 'drop trigger if exists duerp_risks_societes on public.duerp_risks';
    execute 'alter table public.duerp_risks drop constraint if exists duerp_risks_company_fk';
    execute 'drop index if exists public.duerp_risks_company_idx';
    execute 'drop index if exists public.duerp_risks_company_ids_idx';
    execute 'alter table public.duerp_risks drop column if exists company_ids';
    execute 'alter table public.duerp_risks drop column if exists company_id';
  end if;
end
$$;
-- duerp_units
do $$
begin
  if to_regclass('public.duerp_units') is not null then
    execute 'drop policy if exists duerp_units_societe_lire on public.duerp_units';
    execute 'drop policy if exists duerp_units_societe_creer on public.duerp_units';
    execute 'drop policy if exists duerp_units_societe_modifier on public.duerp_units';
    execute 'drop policy if exists duerp_units_societe_supprimer on public.duerp_units';
    execute 'drop trigger if exists duerp_units_societe on public.duerp_units';
    execute 'drop trigger if exists duerp_units_societes on public.duerp_units';
    execute 'alter table public.duerp_units drop constraint if exists duerp_units_company_fk';
    execute 'drop index if exists public.duerp_units_company_idx';
    execute 'drop index if exists public.duerp_units_company_ids_idx';
    execute 'alter table public.duerp_units drop column if exists company_ids';
    execute 'alter table public.duerp_units drop column if exists company_id';
  end if;
end
$$;
-- duerp_equipements
do $$
begin
  if to_regclass('public.duerp_equipements') is not null then
    execute 'drop policy if exists duerp_equipements_societe_lire on public.duerp_equipements';
    execute 'drop policy if exists duerp_equipements_societe_creer on public.duerp_equipements';
    execute 'drop policy if exists duerp_equipements_societe_modifier on public.duerp_equipements';
    execute 'drop policy if exists duerp_equipements_societe_supprimer on public.duerp_equipements';
    execute 'drop trigger if exists duerp_equipements_societe on public.duerp_equipements';
    execute 'drop trigger if exists duerp_equipements_societes on public.duerp_equipements';
    execute 'alter table public.duerp_equipements drop constraint if exists duerp_equipements_company_fk';
    execute 'drop index if exists public.duerp_equipements_company_idx';
    execute 'drop index if exists public.duerp_equipements_company_ids_idx';
    execute 'alter table public.duerp_equipements drop column if exists company_ids';
    execute 'alter table public.duerp_equipements drop column if exists company_id';
  end if;
end
$$;
-- duerp_habilitations
do $$
begin
  if to_regclass('public.duerp_habilitations') is not null then
    execute 'drop policy if exists duerp_habilitations_societe_lire on public.duerp_habilitations';
    execute 'drop policy if exists duerp_habilitations_societe_creer on public.duerp_habilitations';
    execute 'drop policy if exists duerp_habilitations_societe_modifier on public.duerp_habilitations';
    execute 'drop policy if exists duerp_habilitations_societe_supprimer on public.duerp_habilitations';
    execute 'drop trigger if exists duerp_habilitations_societe on public.duerp_habilitations';
    execute 'drop trigger if exists duerp_habilitations_societes on public.duerp_habilitations';
    execute 'alter table public.duerp_habilitations drop constraint if exists duerp_habilitations_company_fk';
    execute 'drop index if exists public.duerp_habilitations_company_idx';
    execute 'drop index if exists public.duerp_habilitations_company_ids_idx';
    execute 'alter table public.duerp_habilitations drop column if exists company_ids';
    execute 'alter table public.duerp_habilitations drop column if exists company_id';
  end if;
end
$$;
-- duerp_verifications
do $$
begin
  if to_regclass('public.duerp_verifications') is not null then
    execute 'drop policy if exists duerp_verifications_societe_lire on public.duerp_verifications';
    execute 'drop policy if exists duerp_verifications_societe_creer on public.duerp_verifications';
    execute 'drop policy if exists duerp_verifications_societe_modifier on public.duerp_verifications';
    execute 'drop policy if exists duerp_verifications_societe_supprimer on public.duerp_verifications';
    execute 'drop trigger if exists duerp_verifications_societe on public.duerp_verifications';
    execute 'drop trigger if exists duerp_verifications_societes on public.duerp_verifications';
    execute 'alter table public.duerp_verifications drop constraint if exists duerp_verifications_company_fk';
    execute 'drop index if exists public.duerp_verifications_company_idx';
    execute 'drop index if exists public.duerp_verifications_company_ids_idx';
    execute 'alter table public.duerp_verifications drop column if exists company_ids';
    execute 'alter table public.duerp_verifications drop column if exists company_id';
  end if;
end
$$;
-- budget_receipts
do $$
begin
  if to_regclass('public.budget_receipts') is not null then
    execute 'drop policy if exists budget_receipts_societe_lire on public.budget_receipts';
    execute 'drop policy if exists budget_receipts_societe_creer on public.budget_receipts';
    execute 'drop policy if exists budget_receipts_societe_modifier on public.budget_receipts';
    execute 'drop policy if exists budget_receipts_societe_supprimer on public.budget_receipts';
    execute 'drop trigger if exists budget_receipts_societe on public.budget_receipts';
    execute 'drop trigger if exists budget_receipts_societes on public.budget_receipts';
    execute 'alter table public.budget_receipts drop constraint if exists budget_receipts_company_fk';
    execute 'drop index if exists public.budget_receipts_company_idx';
    execute 'drop index if exists public.budget_receipts_company_ids_idx';
    execute 'alter table public.budget_receipts drop column if exists company_ids';
    execute 'alter table public.budget_receipts drop column if exists company_id';
  end if;
end
$$;
-- budget_transaction_invoices
do $$
begin
  if to_regclass('public.budget_transaction_invoices') is not null then
    execute 'drop policy if exists budget_transaction_invoices_societe_lire on public.budget_transaction_invoices';
    execute 'drop policy if exists budget_transaction_invoices_societe_creer on public.budget_transaction_invoices';
    execute 'drop policy if exists budget_transaction_invoices_societe_modifier on public.budget_transaction_invoices';
    execute 'drop policy if exists budget_transaction_invoices_societe_supprimer on public.budget_transaction_invoices';
    execute 'drop trigger if exists budget_transaction_invoices_societe on public.budget_transaction_invoices';
    execute 'drop trigger if exists budget_transaction_invoices_societes on public.budget_transaction_invoices';
    execute 'alter table public.budget_transaction_invoices drop constraint if exists budget_transaction_invoices_company_fk';
    execute 'drop index if exists public.budget_transaction_invoices_company_idx';
    execute 'drop index if exists public.budget_transaction_invoices_company_ids_idx';
    execute 'alter table public.budget_transaction_invoices drop column if exists company_ids';
    execute 'alter table public.budget_transaction_invoices drop column if exists company_id';
  end if;
end
$$;
-- mailing_sends
do $$
begin
  if to_regclass('public.mailing_sends') is not null then
    execute 'drop policy if exists mailing_sends_societe_lire on public.mailing_sends';
    execute 'drop policy if exists mailing_sends_societe_creer on public.mailing_sends';
    execute 'drop policy if exists mailing_sends_societe_modifier on public.mailing_sends';
    execute 'drop policy if exists mailing_sends_societe_supprimer on public.mailing_sends';
    execute 'drop trigger if exists mailing_sends_societe on public.mailing_sends';
    execute 'drop trigger if exists mailing_sends_societes on public.mailing_sends';
    execute 'alter table public.mailing_sends drop constraint if exists mailing_sends_company_fk';
    execute 'drop index if exists public.mailing_sends_company_idx';
    execute 'drop index if exists public.mailing_sends_company_ids_idx';
    execute 'alter table public.mailing_sends drop column if exists company_ids';
    execute 'alter table public.mailing_sends drop column if exists company_id';
  end if;
end
$$;
-- process_steps
do $$
begin
  if to_regclass('public.process_steps') is not null then
    execute 'drop policy if exists process_steps_societe_lire on public.process_steps';
    execute 'drop policy if exists process_steps_societe_creer on public.process_steps';
    execute 'drop policy if exists process_steps_societe_modifier on public.process_steps';
    execute 'drop policy if exists process_steps_societe_supprimer on public.process_steps';
    execute 'drop trigger if exists process_steps_societe on public.process_steps';
    execute 'drop trigger if exists process_steps_societes on public.process_steps';
    execute 'alter table public.process_steps drop constraint if exists process_steps_company_fk';
    execute 'drop index if exists public.process_steps_company_idx';
    execute 'drop index if exists public.process_steps_company_ids_idx';
    execute 'alter table public.process_steps drop column if exists company_ids';
    execute 'alter table public.process_steps drop column if exists company_id';
  end if;
end
$$;
-- process_versions
do $$
begin
  if to_regclass('public.process_versions') is not null then
    execute 'drop policy if exists process_versions_societe_lire on public.process_versions';
    execute 'drop policy if exists process_versions_societe_creer on public.process_versions';
    execute 'drop policy if exists process_versions_societe_modifier on public.process_versions';
    execute 'drop policy if exists process_versions_societe_supprimer on public.process_versions';
    execute 'drop trigger if exists process_versions_societe on public.process_versions';
    execute 'drop trigger if exists process_versions_societes on public.process_versions';
    execute 'alter table public.process_versions drop constraint if exists process_versions_company_fk';
    execute 'drop index if exists public.process_versions_company_idx';
    execute 'drop index if exists public.process_versions_company_ids_idx';
    execute 'alter table public.process_versions drop column if exists company_ids';
    execute 'alter table public.process_versions drop column if exists company_id';
  end if;
end
$$;
-- process_connections
do $$
begin
  if to_regclass('public.process_connections') is not null then
    execute 'drop policy if exists process_connections_societe_lire on public.process_connections';
    execute 'drop policy if exists process_connections_societe_creer on public.process_connections';
    execute 'drop policy if exists process_connections_societe_modifier on public.process_connections';
    execute 'drop policy if exists process_connections_societe_supprimer on public.process_connections';
    execute 'drop trigger if exists process_connections_societe on public.process_connections';
    execute 'drop trigger if exists process_connections_societes on public.process_connections';
    execute 'alter table public.process_connections drop constraint if exists process_connections_company_fk';
    execute 'drop index if exists public.process_connections_company_idx';
    execute 'drop index if exists public.process_connections_company_ids_idx';
    execute 'alter table public.process_connections drop column if exists company_ids';
    execute 'alter table public.process_connections drop column if exists company_id';
  end if;
end
$$;
-- clients
do $$
begin
  if to_regclass('public.clients') is not null then
    execute 'drop policy if exists clients_societe_lire on public.clients';
    execute 'drop policy if exists clients_societe_creer on public.clients';
    execute 'drop policy if exists clients_societe_modifier on public.clients';
    execute 'drop policy if exists clients_societe_supprimer on public.clients';
    execute 'drop trigger if exists clients_societe on public.clients';
    execute 'drop trigger if exists clients_societes on public.clients';
    execute 'alter table public.clients drop constraint if exists clients_company_fk';
    execute 'drop index if exists public.clients_company_idx';
    execute 'drop index if exists public.clients_company_ids_idx';
    execute 'alter table public.clients drop column if exists company_ids';
    execute 'alter table public.clients drop column if exists company_id';
  end if;
end
$$;
-- client_contacts
do $$
begin
  if to_regclass('public.client_contacts') is not null then
    execute 'drop policy if exists client_contacts_societe_lire on public.client_contacts';
    execute 'drop policy if exists client_contacts_societe_creer on public.client_contacts';
    execute 'drop policy if exists client_contacts_societe_modifier on public.client_contacts';
    execute 'drop policy if exists client_contacts_societe_supprimer on public.client_contacts';
    execute 'drop trigger if exists client_contacts_societe on public.client_contacts';
    execute 'drop trigger if exists client_contacts_societes on public.client_contacts';
    execute 'alter table public.client_contacts drop constraint if exists client_contacts_company_fk';
    execute 'drop index if exists public.client_contacts_company_idx';
    execute 'drop index if exists public.client_contacts_company_ids_idx';
    execute 'alter table public.client_contacts drop column if exists company_ids';
    execute 'alter table public.client_contacts drop column if exists company_id';
  end if;
end
$$;
-- sites
do $$
begin
  if to_regclass('public.sites') is not null then
    execute 'drop policy if exists sites_societe_lire on public.sites';
    execute 'drop policy if exists sites_societe_creer on public.sites';
    execute 'drop policy if exists sites_societe_modifier on public.sites';
    execute 'drop policy if exists sites_societe_supprimer on public.sites';
    execute 'drop trigger if exists sites_societe on public.sites';
    execute 'drop trigger if exists sites_societes on public.sites';
    execute 'alter table public.sites drop constraint if exists sites_company_fk';
    execute 'drop index if exists public.sites_company_idx';
    execute 'drop index if exists public.sites_company_ids_idx';
    execute 'alter table public.sites drop column if exists company_ids';
    execute 'alter table public.sites drop column if exists company_id';
  end if;
end
$$;
-- trainers
do $$
begin
  if to_regclass('public.trainers') is not null then
    execute 'drop policy if exists trainers_societe_lire on public.trainers';
    execute 'drop policy if exists trainers_societe_creer on public.trainers';
    execute 'drop policy if exists trainers_societe_modifier on public.trainers';
    execute 'drop policy if exists trainers_societe_supprimer on public.trainers';
    execute 'drop trigger if exists trainers_societe on public.trainers';
    execute 'drop trigger if exists trainers_societes on public.trainers';
    execute 'alter table public.trainers drop constraint if exists trainers_company_fk';
    execute 'drop index if exists public.trainers_company_idx';
    execute 'drop index if exists public.trainers_company_ids_idx';
    execute 'alter table public.trainers drop column if exists company_ids';
    execute 'alter table public.trainers drop column if exists company_id';
  end if;
end
$$;
-- trainer_certificates
do $$
begin
  if to_regclass('public.trainer_certificates') is not null then
    execute 'drop policy if exists trainer_certificates_societe_lire on public.trainer_certificates';
    execute 'drop policy if exists trainer_certificates_societe_creer on public.trainer_certificates';
    execute 'drop policy if exists trainer_certificates_societe_modifier on public.trainer_certificates';
    execute 'drop policy if exists trainer_certificates_societe_supprimer on public.trainer_certificates';
    execute 'drop trigger if exists trainer_certificates_societe on public.trainer_certificates';
    execute 'drop trigger if exists trainer_certificates_societes on public.trainer_certificates';
    execute 'alter table public.trainer_certificates drop constraint if exists trainer_certificates_company_fk';
    execute 'drop index if exists public.trainer_certificates_company_idx';
    execute 'drop index if exists public.trainer_certificates_company_ids_idx';
    execute 'alter table public.trainer_certificates drop column if exists company_ids';
    execute 'alter table public.trainer_certificates drop column if exists company_id';
  end if;
end
$$;
-- trainer_interviews
do $$
begin
  if to_regclass('public.trainer_interviews') is not null then
    execute 'drop policy if exists trainer_interviews_societe_lire on public.trainer_interviews';
    execute 'drop policy if exists trainer_interviews_societe_creer on public.trainer_interviews';
    execute 'drop policy if exists trainer_interviews_societe_modifier on public.trainer_interviews';
    execute 'drop policy if exists trainer_interviews_societe_supprimer on public.trainer_interviews';
    execute 'drop trigger if exists trainer_interviews_societe on public.trainer_interviews';
    execute 'drop trigger if exists trainer_interviews_societes on public.trainer_interviews';
    execute 'alter table public.trainer_interviews drop constraint if exists trainer_interviews_company_fk';
    execute 'drop index if exists public.trainer_interviews_company_idx';
    execute 'drop index if exists public.trainer_interviews_company_ids_idx';
    execute 'alter table public.trainer_interviews drop column if exists company_ids';
    execute 'alter table public.trainer_interviews drop column if exists company_id';
  end if;
end
$$;
-- trainer_qualifications
do $$
begin
  if to_regclass('public.trainer_qualifications') is not null then
    execute 'drop policy if exists trainer_qualifications_societe_lire on public.trainer_qualifications';
    execute 'drop policy if exists trainer_qualifications_societe_creer on public.trainer_qualifications';
    execute 'drop policy if exists trainer_qualifications_societe_modifier on public.trainer_qualifications';
    execute 'drop policy if exists trainer_qualifications_societe_supprimer on public.trainer_qualifications';
    execute 'drop trigger if exists trainer_qualifications_societe on public.trainer_qualifications';
    execute 'drop trigger if exists trainer_qualifications_societes on public.trainer_qualifications';
    execute 'alter table public.trainer_qualifications drop constraint if exists trainer_qualifications_company_fk';
    execute 'drop index if exists public.trainer_qualifications_company_idx';
    execute 'drop index if exists public.trainer_qualifications_company_ids_idx';
    execute 'alter table public.trainer_qualifications drop column if exists company_ids';
    execute 'alter table public.trainer_qualifications drop column if exists company_id';
  end if;
end
$$;
-- trainer_trainings
do $$
begin
  if to_regclass('public.trainer_trainings') is not null then
    execute 'drop policy if exists trainer_trainings_societe_lire on public.trainer_trainings';
    execute 'drop policy if exists trainer_trainings_societe_creer on public.trainer_trainings';
    execute 'drop policy if exists trainer_trainings_societe_modifier on public.trainer_trainings';
    execute 'drop policy if exists trainer_trainings_societe_supprimer on public.trainer_trainings';
    execute 'drop trigger if exists trainer_trainings_societe on public.trainer_trainings';
    execute 'drop trigger if exists trainer_trainings_societes on public.trainer_trainings';
    execute 'alter table public.trainer_trainings drop constraint if exists trainer_trainings_company_fk';
    execute 'drop index if exists public.trainer_trainings_company_idx';
    execute 'drop index if exists public.trainer_trainings_company_ids_idx';
    execute 'alter table public.trainer_trainings drop column if exists company_ids';
    execute 'alter table public.trainer_trainings drop column if exists company_id';
  end if;
end
$$;
-- courses
do $$
begin
  if to_regclass('public.courses') is not null then
    execute 'drop policy if exists courses_societe_lire on public.courses';
    execute 'drop policy if exists courses_societe_creer on public.courses';
    execute 'drop policy if exists courses_societe_modifier on public.courses';
    execute 'drop policy if exists courses_societe_supprimer on public.courses';
    execute 'drop trigger if exists courses_societe on public.courses';
    execute 'drop trigger if exists courses_societes on public.courses';
    execute 'alter table public.courses drop constraint if exists courses_company_fk';
    execute 'drop index if exists public.courses_company_idx';
    execute 'drop index if exists public.courses_company_ids_idx';
    execute 'alter table public.courses drop column if exists company_ids';
    execute 'alter table public.courses drop column if exists company_id';
  end if;
end
$$;
-- course_documents
do $$
begin
  if to_regclass('public.course_documents') is not null then
    execute 'drop policy if exists course_documents_societe_lire on public.course_documents';
    execute 'drop policy if exists course_documents_societe_creer on public.course_documents';
    execute 'drop policy if exists course_documents_societe_modifier on public.course_documents';
    execute 'drop policy if exists course_documents_societe_supprimer on public.course_documents';
    execute 'drop trigger if exists course_documents_societe on public.course_documents';
    execute 'drop trigger if exists course_documents_societes on public.course_documents';
    execute 'alter table public.course_documents drop constraint if exists course_documents_company_fk';
    execute 'drop index if exists public.course_documents_company_idx';
    execute 'drop index if exists public.course_documents_company_ids_idx';
    execute 'alter table public.course_documents drop column if exists company_ids';
    execute 'alter table public.course_documents drop column if exists company_id';
  end if;
end
$$;
-- course_equipment
do $$
begin
  if to_regclass('public.course_equipment') is not null then
    execute 'drop policy if exists course_equipment_societe_lire on public.course_equipment';
    execute 'drop policy if exists course_equipment_societe_creer on public.course_equipment';
    execute 'drop policy if exists course_equipment_societe_modifier on public.course_equipment';
    execute 'drop policy if exists course_equipment_societe_supprimer on public.course_equipment';
    execute 'drop trigger if exists course_equipment_societe on public.course_equipment';
    execute 'drop trigger if exists course_equipment_societes on public.course_equipment';
    execute 'alter table public.course_equipment drop constraint if exists course_equipment_company_fk';
    execute 'drop index if exists public.course_equipment_company_idx';
    execute 'drop index if exists public.course_equipment_company_ids_idx';
    execute 'alter table public.course_equipment drop column if exists company_ids';
    execute 'alter table public.course_equipment drop column if exists company_id';
  end if;
end
$$;
-- course_questions
do $$
begin
  if to_regclass('public.course_questions') is not null then
    execute 'drop policy if exists course_questions_societe_lire on public.course_questions';
    execute 'drop policy if exists course_questions_societe_creer on public.course_questions';
    execute 'drop policy if exists course_questions_societe_modifier on public.course_questions';
    execute 'drop policy if exists course_questions_societe_supprimer on public.course_questions';
    execute 'drop trigger if exists course_questions_societe on public.course_questions';
    execute 'drop trigger if exists course_questions_societes on public.course_questions';
    execute 'alter table public.course_questions drop constraint if exists course_questions_company_fk';
    execute 'drop index if exists public.course_questions_company_idx';
    execute 'drop index if exists public.course_questions_company_ids_idx';
    execute 'alter table public.course_questions drop column if exists company_ids';
    execute 'alter table public.course_questions drop column if exists company_id';
  end if;
end
$$;
-- course_sequences
do $$
begin
  if to_regclass('public.course_sequences') is not null then
    execute 'drop policy if exists course_sequences_societe_lire on public.course_sequences';
    execute 'drop policy if exists course_sequences_societe_creer on public.course_sequences';
    execute 'drop policy if exists course_sequences_societe_modifier on public.course_sequences';
    execute 'drop policy if exists course_sequences_societe_supprimer on public.course_sequences';
    execute 'drop trigger if exists course_sequences_societe on public.course_sequences';
    execute 'drop trigger if exists course_sequences_societes on public.course_sequences';
    execute 'alter table public.course_sequences drop constraint if exists course_sequences_company_fk';
    execute 'drop index if exists public.course_sequences_company_idx';
    execute 'drop index if exists public.course_sequences_company_ids_idx';
    execute 'alter table public.course_sequences drop column if exists company_ids';
    execute 'alter table public.course_sequences drop column if exists company_id';
  end if;
end
$$;
-- training_themes
do $$
begin
  if to_regclass('public.training_themes') is not null then
    execute 'drop policy if exists training_themes_societe_lire on public.training_themes';
    execute 'drop policy if exists training_themes_societe_creer on public.training_themes';
    execute 'drop policy if exists training_themes_societe_modifier on public.training_themes';
    execute 'drop policy if exists training_themes_societe_supprimer on public.training_themes';
    execute 'drop trigger if exists training_themes_societe on public.training_themes';
    execute 'drop trigger if exists training_themes_societes on public.training_themes';
    execute 'alter table public.training_themes drop constraint if exists training_themes_company_fk';
    execute 'drop index if exists public.training_themes_company_idx';
    execute 'drop index if exists public.training_themes_company_ids_idx';
    execute 'alter table public.training_themes drop column if exists company_ids';
    execute 'alter table public.training_themes drop column if exists company_id';
  end if;
end
$$;
-- theme_questions
do $$
begin
  if to_regclass('public.theme_questions') is not null then
    execute 'drop policy if exists theme_questions_societe_lire on public.theme_questions';
    execute 'drop policy if exists theme_questions_societe_creer on public.theme_questions';
    execute 'drop policy if exists theme_questions_societe_modifier on public.theme_questions';
    execute 'drop policy if exists theme_questions_societe_supprimer on public.theme_questions';
    execute 'drop trigger if exists theme_questions_societe on public.theme_questions';
    execute 'drop trigger if exists theme_questions_societes on public.theme_questions';
    execute 'alter table public.theme_questions drop constraint if exists theme_questions_company_fk';
    execute 'drop index if exists public.theme_questions_company_idx';
    execute 'drop index if exists public.theme_questions_company_ids_idx';
    execute 'alter table public.theme_questions drop column if exists company_ids';
    execute 'alter table public.theme_questions drop column if exists company_id';
  end if;
end
$$;
-- positioning_questions_ref
do $$
begin
  if to_regclass('public.positioning_questions_ref') is not null then
    execute 'drop policy if exists positioning_questions_ref_societe_lire on public.positioning_questions_ref';
    execute 'drop policy if exists positioning_questions_ref_societe_creer on public.positioning_questions_ref';
    execute 'drop policy if exists positioning_questions_ref_societe_modifier on public.positioning_questions_ref';
    execute 'drop policy if exists positioning_questions_ref_societe_supprimer on public.positioning_questions_ref';
    execute 'drop trigger if exists positioning_questions_ref_societe on public.positioning_questions_ref';
    execute 'drop trigger if exists positioning_questions_ref_societes on public.positioning_questions_ref';
    execute 'alter table public.positioning_questions_ref drop constraint if exists positioning_questions_ref_company_fk';
    execute 'drop index if exists public.positioning_questions_ref_company_idx';
    execute 'drop index if exists public.positioning_questions_ref_company_ids_idx';
    execute 'alter table public.positioning_questions_ref drop column if exists company_ids';
    execute 'alter table public.positioning_questions_ref drop column if exists company_id';
  end if;
end
$$;
-- positioning_themes
do $$
begin
  if to_regclass('public.positioning_themes') is not null then
    execute 'drop policy if exists positioning_themes_societe_lire on public.positioning_themes';
    execute 'drop policy if exists positioning_themes_societe_creer on public.positioning_themes';
    execute 'drop policy if exists positioning_themes_societe_modifier on public.positioning_themes';
    execute 'drop policy if exists positioning_themes_societe_supprimer on public.positioning_themes';
    execute 'drop trigger if exists positioning_themes_societe on public.positioning_themes';
    execute 'drop trigger if exists positioning_themes_societes on public.positioning_themes';
    execute 'alter table public.positioning_themes drop constraint if exists positioning_themes_company_fk';
    execute 'drop index if exists public.positioning_themes_company_idx';
    execute 'drop index if exists public.positioning_themes_company_ids_idx';
    execute 'alter table public.positioning_themes drop column if exists company_ids';
    execute 'alter table public.positioning_themes drop column if exists company_id';
  end if;
end
$$;
-- programme_versions
do $$
begin
  if to_regclass('public.programme_versions') is not null then
    execute 'drop policy if exists programme_versions_societe_lire on public.programme_versions';
    execute 'drop policy if exists programme_versions_societe_creer on public.programme_versions';
    execute 'drop policy if exists programme_versions_societe_modifier on public.programme_versions';
    execute 'drop policy if exists programme_versions_societe_supprimer on public.programme_versions';
    execute 'drop trigger if exists programme_versions_societe on public.programme_versions';
    execute 'drop trigger if exists programme_versions_societes on public.programme_versions';
    execute 'alter table public.programme_versions drop constraint if exists programme_versions_company_fk';
    execute 'drop index if exists public.programme_versions_company_idx';
    execute 'drop index if exists public.programme_versions_company_ids_idx';
    execute 'alter table public.programme_versions drop column if exists company_ids';
    execute 'alter table public.programme_versions drop column if exists company_id';
  end if;
end
$$;
-- equipment_catalog
do $$
begin
  if to_regclass('public.equipment_catalog') is not null then
    execute 'drop policy if exists equipment_catalog_societe_lire on public.equipment_catalog';
    execute 'drop policy if exists equipment_catalog_societe_creer on public.equipment_catalog';
    execute 'drop policy if exists equipment_catalog_societe_modifier on public.equipment_catalog';
    execute 'drop policy if exists equipment_catalog_societe_supprimer on public.equipment_catalog';
    execute 'drop trigger if exists equipment_catalog_societe on public.equipment_catalog';
    execute 'drop trigger if exists equipment_catalog_societes on public.equipment_catalog';
    execute 'alter table public.equipment_catalog drop constraint if exists equipment_catalog_company_fk';
    execute 'drop index if exists public.equipment_catalog_company_idx';
    execute 'drop index if exists public.equipment_catalog_company_ids_idx';
    execute 'alter table public.equipment_catalog drop column if exists company_ids';
    execute 'alter table public.equipment_catalog drop column if exists company_id';
  end if;
end
$$;
-- itv_equipment_types
do $$
begin
  if to_regclass('public.itv_equipment_types') is not null then
    execute 'drop policy if exists itv_equipment_types_societe_lire on public.itv_equipment_types';
    execute 'drop policy if exists itv_equipment_types_societe_creer on public.itv_equipment_types';
    execute 'drop policy if exists itv_equipment_types_societe_modifier on public.itv_equipment_types';
    execute 'drop policy if exists itv_equipment_types_societe_supprimer on public.itv_equipment_types';
    execute 'drop trigger if exists itv_equipment_types_societe on public.itv_equipment_types';
    execute 'drop trigger if exists itv_equipment_types_societes on public.itv_equipment_types';
    execute 'alter table public.itv_equipment_types drop constraint if exists itv_equipment_types_company_fk';
    execute 'drop index if exists public.itv_equipment_types_company_idx';
    execute 'drop index if exists public.itv_equipment_types_company_ids_idx';
    execute 'alter table public.itv_equipment_types drop column if exists company_ids';
    execute 'alter table public.itv_equipment_types drop column if exists company_id';
  end if;
end
$$;
-- itv_parts
do $$
begin
  if to_regclass('public.itv_parts') is not null then
    execute 'drop policy if exists itv_parts_societe_lire on public.itv_parts';
    execute 'drop policy if exists itv_parts_societe_creer on public.itv_parts';
    execute 'drop policy if exists itv_parts_societe_modifier on public.itv_parts';
    execute 'drop policy if exists itv_parts_societe_supprimer on public.itv_parts';
    execute 'drop trigger if exists itv_parts_societe on public.itv_parts';
    execute 'drop trigger if exists itv_parts_societes on public.itv_parts';
    execute 'alter table public.itv_parts drop constraint if exists itv_parts_company_fk';
    execute 'drop index if exists public.itv_parts_company_idx';
    execute 'drop index if exists public.itv_parts_company_ids_idx';
    execute 'alter table public.itv_parts drop column if exists company_ids';
    execute 'alter table public.itv_parts drop column if exists company_id';
  end if;
end
$$;
-- itv_technicians
do $$
begin
  if to_regclass('public.itv_technicians') is not null then
    execute 'drop policy if exists itv_technicians_societe_lire on public.itv_technicians';
    execute 'drop policy if exists itv_technicians_societe_creer on public.itv_technicians';
    execute 'drop policy if exists itv_technicians_societe_modifier on public.itv_technicians';
    execute 'drop policy if exists itv_technicians_societe_supprimer on public.itv_technicians';
    execute 'drop trigger if exists itv_technicians_societe on public.itv_technicians';
    execute 'drop trigger if exists itv_technicians_societes on public.itv_technicians';
    execute 'alter table public.itv_technicians drop constraint if exists itv_technicians_company_fk';
    execute 'drop index if exists public.itv_technicians_company_idx';
    execute 'drop index if exists public.itv_technicians_company_ids_idx';
    execute 'alter table public.itv_technicians drop column if exists company_ids';
    execute 'alter table public.itv_technicians drop column if exists company_id';
  end if;
end
$$;
-- mailing_templates
do $$
begin
  if to_regclass('public.mailing_templates') is not null then
    execute 'drop policy if exists mailing_templates_societe_lire on public.mailing_templates';
    execute 'drop policy if exists mailing_templates_societe_creer on public.mailing_templates';
    execute 'drop policy if exists mailing_templates_societe_modifier on public.mailing_templates';
    execute 'drop policy if exists mailing_templates_societe_supprimer on public.mailing_templates';
    execute 'drop trigger if exists mailing_templates_societe on public.mailing_templates';
    execute 'drop trigger if exists mailing_templates_societes on public.mailing_templates';
    execute 'alter table public.mailing_templates drop constraint if exists mailing_templates_company_fk';
    execute 'drop index if exists public.mailing_templates_company_idx';
    execute 'drop index if exists public.mailing_templates_company_ids_idx';
    execute 'alter table public.mailing_templates drop column if exists company_ids';
    execute 'alter table public.mailing_templates drop column if exists company_id';
  end if;
end
$$;
-- call_arguments
do $$
begin
  if to_regclass('public.call_arguments') is not null then
    execute 'drop policy if exists call_arguments_societe_lire on public.call_arguments';
    execute 'drop policy if exists call_arguments_societe_creer on public.call_arguments';
    execute 'drop policy if exists call_arguments_societe_modifier on public.call_arguments';
    execute 'drop policy if exists call_arguments_societe_supprimer on public.call_arguments';
    execute 'drop trigger if exists call_arguments_societe on public.call_arguments';
    execute 'drop trigger if exists call_arguments_societes on public.call_arguments';
    execute 'alter table public.call_arguments drop constraint if exists call_arguments_company_fk';
    execute 'drop index if exists public.call_arguments_company_idx';
    execute 'drop index if exists public.call_arguments_company_ids_idx';
    execute 'alter table public.call_arguments drop column if exists company_ids';
    execute 'alter table public.call_arguments drop column if exists company_id';
  end if;
end
$$;
-- call_objections
do $$
begin
  if to_regclass('public.call_objections') is not null then
    execute 'drop policy if exists call_objections_societe_lire on public.call_objections';
    execute 'drop policy if exists call_objections_societe_creer on public.call_objections';
    execute 'drop policy if exists call_objections_societe_modifier on public.call_objections';
    execute 'drop policy if exists call_objections_societe_supprimer on public.call_objections';
    execute 'drop trigger if exists call_objections_societe on public.call_objections';
    execute 'drop trigger if exists call_objections_societes on public.call_objections';
    execute 'alter table public.call_objections drop constraint if exists call_objections_company_fk';
    execute 'drop index if exists public.call_objections_company_idx';
    execute 'drop index if exists public.call_objections_company_ids_idx';
    execute 'alter table public.call_objections drop column if exists company_ids';
    execute 'alter table public.call_objections drop column if exists company_id';
  end if;
end
$$;
-- quality_documents
do $$
begin
  if to_regclass('public.quality_documents') is not null then
    execute 'drop policy if exists quality_documents_societe_lire on public.quality_documents';
    execute 'drop policy if exists quality_documents_societe_creer on public.quality_documents';
    execute 'drop policy if exists quality_documents_societe_modifier on public.quality_documents';
    execute 'drop policy if exists quality_documents_societe_supprimer on public.quality_documents';
    execute 'drop trigger if exists quality_documents_societe on public.quality_documents';
    execute 'drop trigger if exists quality_documents_societes on public.quality_documents';
    execute 'alter table public.quality_documents drop constraint if exists quality_documents_company_fk';
    execute 'drop index if exists public.quality_documents_company_idx';
    execute 'drop index if exists public.quality_documents_company_ids_idx';
    execute 'alter table public.quality_documents drop column if exists company_ids';
    execute 'alter table public.quality_documents drop column if exists company_id';
  end if;
end
$$;
-- quality_doc_versions
do $$
begin
  if to_regclass('public.quality_doc_versions') is not null then
    execute 'drop policy if exists quality_doc_versions_societe_lire on public.quality_doc_versions';
    execute 'drop policy if exists quality_doc_versions_societe_creer on public.quality_doc_versions';
    execute 'drop policy if exists quality_doc_versions_societe_modifier on public.quality_doc_versions';
    execute 'drop policy if exists quality_doc_versions_societe_supprimer on public.quality_doc_versions';
    execute 'drop trigger if exists quality_doc_versions_societe on public.quality_doc_versions';
    execute 'drop trigger if exists quality_doc_versions_societes on public.quality_doc_versions';
    execute 'alter table public.quality_doc_versions drop constraint if exists quality_doc_versions_company_fk';
    execute 'drop index if exists public.quality_doc_versions_company_idx';
    execute 'drop index if exists public.quality_doc_versions_company_ids_idx';
    execute 'alter table public.quality_doc_versions drop column if exists company_ids';
    execute 'alter table public.quality_doc_versions drop column if exists company_id';
  end if;
end
$$;
-- qualiopi_documents
do $$
begin
  if to_regclass('public.qualiopi_documents') is not null then
    execute 'drop policy if exists qualiopi_documents_societe_lire on public.qualiopi_documents';
    execute 'drop policy if exists qualiopi_documents_societe_creer on public.qualiopi_documents';
    execute 'drop policy if exists qualiopi_documents_societe_modifier on public.qualiopi_documents';
    execute 'drop policy if exists qualiopi_documents_societe_supprimer on public.qualiopi_documents';
    execute 'drop trigger if exists qualiopi_documents_societe on public.qualiopi_documents';
    execute 'drop trigger if exists qualiopi_documents_societes on public.qualiopi_documents';
    execute 'alter table public.qualiopi_documents drop constraint if exists qualiopi_documents_company_fk';
    execute 'drop index if exists public.qualiopi_documents_company_idx';
    execute 'drop index if exists public.qualiopi_documents_company_ids_idx';
    execute 'alter table public.qualiopi_documents drop column if exists company_ids';
    execute 'alter table public.qualiopi_documents drop column if exists company_id';
  end if;
end
$$;
-- pp_course_settings
do $$
begin
  if to_regclass('public.pp_course_settings') is not null then
    execute 'drop policy if exists pp_course_settings_societe_lire on public.pp_course_settings';
    execute 'drop policy if exists pp_course_settings_societe_creer on public.pp_course_settings';
    execute 'drop policy if exists pp_course_settings_societe_modifier on public.pp_course_settings';
    execute 'drop policy if exists pp_course_settings_societe_supprimer on public.pp_course_settings';
    execute 'drop trigger if exists pp_course_settings_societe on public.pp_course_settings';
    execute 'drop trigger if exists pp_course_settings_societes on public.pp_course_settings';
    execute 'alter table public.pp_course_settings drop constraint if exists pp_course_settings_company_fk';
    execute 'drop index if exists public.pp_course_settings_company_idx';
    execute 'drop index if exists public.pp_course_settings_company_ids_idx';
    execute 'alter table public.pp_course_settings drop column if exists company_ids';
    execute 'alter table public.pp_course_settings drop column if exists company_id';
  end if;
end
$$;
-- pp_presets
do $$
begin
  if to_regclass('public.pp_presets') is not null then
    execute 'drop policy if exists pp_presets_societe_lire on public.pp_presets';
    execute 'drop policy if exists pp_presets_societe_creer on public.pp_presets';
    execute 'drop policy if exists pp_presets_societe_modifier on public.pp_presets';
    execute 'drop policy if exists pp_presets_societe_supprimer on public.pp_presets';
    execute 'drop trigger if exists pp_presets_societe on public.pp_presets';
    execute 'drop trigger if exists pp_presets_societes on public.pp_presets';
    execute 'alter table public.pp_presets drop constraint if exists pp_presets_company_fk';
    execute 'drop index if exists public.pp_presets_company_idx';
    execute 'drop index if exists public.pp_presets_company_ids_idx';
    execute 'alter table public.pp_presets drop column if exists company_ids';
    execute 'alter table public.pp_presets drop column if exists company_id';
  end if;
end
$$;

drop function if exists app.societes_lisibles();
drop function if exists app.societes_ecriture();
drop function if exists app.societe_du_parent();
drop function if exists app.societes_partage();
drop function if exists app.company_default();

delete from public.schema_migrations where version in ('0274_societes_colonnes', '0275_societes_isolement');
