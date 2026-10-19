-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c2_0274-0275) : ne pas modifier à la main.
-- Essai en transaction annulée : 0274_societes_colonnes.sql, 0275_societes_isolement.sql, puis tous les tests de droits. Se termine TOUJOURS par
-- l'erreur volontaire « RÉSULTAT DES TESTS DE DROITS » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0274_societes_colonnes.sql =====
-- 0274_societes_colonnes.sql : société propriétaire sur chaque donnée existante (chantier C2).
-- FICHIER GÉNÉRÉ par scripts/securite/societes_c2.py. Ne pas modifier à la main.
--
-- Spec multi-sociétés § 3 et § 8 : colonne company_id (et company_ids pour les fiches partageables), remplie par la
-- société qui porte l'instance (société n° 1), non nulle, clé étrangère vers companies, index.
--   A  propre à une société : défaut app.company_default() (société courante, sinon société n° 1) ;
--   B  fille : company_id recopié du parent par déclencheur (app.societe_du_parent) : le parent fait foi ;
--   C  partageable : company_ids (sociétés qui voient la fiche, contient toujours la société d'origine).
-- L'ajout d'une colonne avec valeur par défaut remplit les lignes existantes sans passer par les déclencheurs : les
-- verrous (factures émises) ne sont ni levés ni contournés.
-- Les tables absentes d'une instance sont ignorées. Idempotente.
-- Retour arrière : supabase/rollback/0274-0275_societes_retour.sql

-- Société par défaut d'une écriture : société courante, sinon celle qui porte l'instance (tâches, portails)
create or replace function app.company_default()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_company(), (select c.id from public.companies c where c.is_instance_owner limit 1))
$$;
revoke all on function app.company_default() from public, anon;
grant execute on function app.company_default() to authenticated, service_role;

-- Fille : société du parent (le parent fait foi) ; sans parent, la valeur reçue ou la société par défaut
create or replace function app.societe_du_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent uuid := (to_jsonb(new) ->> tg_argv[1])::uuid;
  v_company uuid;
begin
  if v_parent is not null then
    execute format('select company_id from public.%I where id = $1', tg_argv[0]) into v_company using v_parent;
  end if;
  new.company_id := coalesce(v_company, new.company_id, app.company_default());
  return new;
end
$$;
revoke all on function app.societe_du_parent() from public, anon, authenticated;

-- Partageable : la société d'origine figure toujours parmi les sociétés qui voient la fiche
create or replace function app.societes_partage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.company_id := coalesce(new.company_id, app.company_default());
  if new.company_ids is null or not (new.company_id = any (new.company_ids)) then
    new.company_ids := array_append(coalesce(new.company_ids, '{}'::uuid[]), new.company_id);
  end if;
  return new;
end
$$;
revoke all on function app.societes_partage() from public, anon, authenticated;


-- ===== Classe A : propres à une société =====

-- sessions
do $$
begin
  if to_regclass('public.sessions') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = 'company_id') then
      alter table public.sessions add column company_id uuid not null default app.company_default();
    else
      update public.sessions set company_id = app.company_default() where company_id is null;
      alter table public.sessions alter column company_id set default app.company_default();
      alter table public.sessions alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'sessions_company_fk') then
      alter table public.sessions add constraint sessions_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists sessions_company_idx on public.sessions (company_id);
  end if;
end
$$;

-- trainees
do $$
begin
  if to_regclass('public.trainees') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainees' and column_name = 'company_id') then
      alter table public.trainees add column company_id uuid not null default app.company_default();
    else
      update public.trainees set company_id = app.company_default() where company_id is null;
      alter table public.trainees alter column company_id set default app.company_default();
      alter table public.trainees alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'trainees_company_fk') then
      alter table public.trainees add constraint trainees_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists trainees_company_idx on public.trainees (company_id);
  end if;
end
$$;

-- invoices
do $$
begin
  if to_regclass('public.invoices') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name = 'company_id') then
      alter table public.invoices add column company_id uuid not null default app.company_default();
    else
      update public.invoices set company_id = app.company_default() where company_id is null;
      alter table public.invoices alter column company_id set default app.company_default();
      alter table public.invoices alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'invoices_company_fk') then
      alter table public.invoices add constraint invoices_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists invoices_company_idx on public.invoices (company_id);
  end if;
end
$$;

-- quotes
do $$
begin
  if to_regclass('public.quotes') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quotes' and column_name = 'company_id') then
      alter table public.quotes add column company_id uuid not null default app.company_default();
    else
      update public.quotes set company_id = app.company_default() where company_id is null;
      alter table public.quotes alter column company_id set default app.company_default();
      alter table public.quotes alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'quotes_company_fk') then
      alter table public.quotes add constraint quotes_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists quotes_company_idx on public.quotes (company_id);
  end if;
end
$$;

-- invoice_emails_sent
do $$
begin
  if to_regclass('public.invoice_emails_sent') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_emails_sent' and column_name = 'company_id') then
      alter table public.invoice_emails_sent add column company_id uuid not null default app.company_default();
    else
      update public.invoice_emails_sent set company_id = app.company_default() where company_id is null;
      alter table public.invoice_emails_sent alter column company_id set default app.company_default();
      alter table public.invoice_emails_sent alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'invoice_emails_sent_company_fk') then
      alter table public.invoice_emails_sent add constraint invoice_emails_sent_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists invoice_emails_sent_company_idx on public.invoice_emails_sent (company_id);
  end if;
end
$$;

-- itv_visits
do $$
begin
  if to_regclass('public.itv_visits') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'itv_visits' and column_name = 'company_id') then
      alter table public.itv_visits add column company_id uuid not null default app.company_default();
    else
      update public.itv_visits set company_id = app.company_default() where company_id is null;
      alter table public.itv_visits alter column company_id set default app.company_default();
      alter table public.itv_visits alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'itv_visits_company_fk') then
      alter table public.itv_visits add constraint itv_visits_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists itv_visits_company_idx on public.itv_visits (company_id);
  end if;
end
$$;

-- itv_contracts
do $$
begin
  if to_regclass('public.itv_contracts') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'itv_contracts' and column_name = 'company_id') then
      alter table public.itv_contracts add column company_id uuid not null default app.company_default();
    else
      update public.itv_contracts set company_id = app.company_default() where company_id is null;
      alter table public.itv_contracts alter column company_id set default app.company_default();
      alter table public.itv_contracts alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'itv_contracts_company_fk') then
      alter table public.itv_contracts add constraint itv_contracts_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists itv_contracts_company_idx on public.itv_contracts (company_id);
  end if;
end
$$;

-- itv_equipment
do $$
begin
  if to_regclass('public.itv_equipment') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'itv_equipment' and column_name = 'company_id') then
      alter table public.itv_equipment add column company_id uuid not null default app.company_default();
    else
      update public.itv_equipment set company_id = app.company_default() where company_id is null;
      alter table public.itv_equipment alter column company_id set default app.company_default();
      alter table public.itv_equipment alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'itv_equipment_company_fk') then
      alter table public.itv_equipment add constraint itv_equipment_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists itv_equipment_company_idx on public.itv_equipment (company_id);
  end if;
end
$$;

-- budget_actions
do $$
begin
  if to_regclass('public.budget_actions') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'budget_actions' and column_name = 'company_id') then
      alter table public.budget_actions add column company_id uuid not null default app.company_default();
    else
      update public.budget_actions set company_id = app.company_default() where company_id is null;
      alter table public.budget_actions alter column company_id set default app.company_default();
      alter table public.budget_actions alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'budget_actions_company_fk') then
      alter table public.budget_actions add constraint budget_actions_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists budget_actions_company_idx on public.budget_actions (company_id);
  end if;
end
$$;

-- budget_categories
do $$
begin
  if to_regclass('public.budget_categories') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'budget_categories' and column_name = 'company_id') then
      alter table public.budget_categories add column company_id uuid not null default app.company_default();
    else
      update public.budget_categories set company_id = app.company_default() where company_id is null;
      alter table public.budget_categories alter column company_id set default app.company_default();
      alter table public.budget_categories alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'budget_categories_company_fk') then
      alter table public.budget_categories add constraint budget_categories_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists budget_categories_company_idx on public.budget_categories (company_id);
  end if;
end
$$;

-- budget_emails_sent
do $$
begin
  if to_regclass('public.budget_emails_sent') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'budget_emails_sent' and column_name = 'company_id') then
      alter table public.budget_emails_sent add column company_id uuid not null default app.company_default();
    else
      update public.budget_emails_sent set company_id = app.company_default() where company_id is null;
      alter table public.budget_emails_sent alter column company_id set default app.company_default();
      alter table public.budget_emails_sent alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'budget_emails_sent_company_fk') then
      alter table public.budget_emails_sent add constraint budget_emails_sent_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists budget_emails_sent_company_idx on public.budget_emails_sent (company_id);
  end if;
end
$$;

-- budget_meal_guests
do $$
begin
  if to_regclass('public.budget_meal_guests') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'budget_meal_guests' and column_name = 'company_id') then
      alter table public.budget_meal_guests add column company_id uuid not null default app.company_default();
    else
      update public.budget_meal_guests set company_id = app.company_default() where company_id is null;
      alter table public.budget_meal_guests alter column company_id set default app.company_default();
      alter table public.budget_meal_guests alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'budget_meal_guests_company_fk') then
      alter table public.budget_meal_guests add constraint budget_meal_guests_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists budget_meal_guests_company_idx on public.budget_meal_guests (company_id);
  end if;
end
$$;

-- budget_pipeline
do $$
begin
  if to_regclass('public.budget_pipeline') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'budget_pipeline' and column_name = 'company_id') then
      alter table public.budget_pipeline add column company_id uuid not null default app.company_default();
    else
      update public.budget_pipeline set company_id = app.company_default() where company_id is null;
      alter table public.budget_pipeline alter column company_id set default app.company_default();
      alter table public.budget_pipeline alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'budget_pipeline_company_fk') then
      alter table public.budget_pipeline add constraint budget_pipeline_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists budget_pipeline_company_idx on public.budget_pipeline (company_id);
  end if;
end
$$;

-- budget_rules
do $$
begin
  if to_regclass('public.budget_rules') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'budget_rules' and column_name = 'company_id') then
      alter table public.budget_rules add column company_id uuid not null default app.company_default();
    else
      update public.budget_rules set company_id = app.company_default() where company_id is null;
      alter table public.budget_rules alter column company_id set default app.company_default();
      alter table public.budget_rules alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'budget_rules_company_fk') then
      alter table public.budget_rules add constraint budget_rules_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists budget_rules_company_idx on public.budget_rules (company_id);
  end if;
end
$$;

-- budget_settings
do $$
begin
  if to_regclass('public.budget_settings') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'budget_settings' and column_name = 'company_id') then
      alter table public.budget_settings add column company_id uuid not null default app.company_default();
    else
      update public.budget_settings set company_id = app.company_default() where company_id is null;
      alter table public.budget_settings alter column company_id set default app.company_default();
      alter table public.budget_settings alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'budget_settings_company_fk') then
      alter table public.budget_settings add constraint budget_settings_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists budget_settings_company_idx on public.budget_settings (company_id);
  end if;
end
$$;

-- budget_transactions
do $$
begin
  if to_regclass('public.budget_transactions') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'budget_transactions' and column_name = 'company_id') then
      alter table public.budget_transactions add column company_id uuid not null default app.company_default();
    else
      update public.budget_transactions set company_id = app.company_default() where company_id is null;
      alter table public.budget_transactions alter column company_id set default app.company_default();
      alter table public.budget_transactions alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'budget_transactions_company_fk') then
      alter table public.budget_transactions add constraint budget_transactions_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists budget_transactions_company_idx on public.budget_transactions (company_id);
  end if;
end
$$;

-- bank_statements
do $$
begin
  if to_regclass('public.bank_statements') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bank_statements' and column_name = 'company_id') then
      alter table public.bank_statements add column company_id uuid not null default app.company_default();
    else
      update public.bank_statements set company_id = app.company_default() where company_id is null;
      alter table public.bank_statements alter column company_id set default app.company_default();
      alter table public.bank_statements alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'bank_statements_company_fk') then
      alter table public.bank_statements add constraint bank_statements_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists bank_statements_company_idx on public.bank_statements (company_id);
  end if;
end
$$;

-- accounting_periods
do $$
begin
  if to_regclass('public.accounting_periods') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'accounting_periods' and column_name = 'company_id') then
      alter table public.accounting_periods add column company_id uuid not null default app.company_default();
    else
      update public.accounting_periods set company_id = app.company_default() where company_id is null;
      alter table public.accounting_periods alter column company_id set default app.company_default();
      alter table public.accounting_periods alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'accounting_periods_company_fk') then
      alter table public.accounting_periods add constraint accounting_periods_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists accounting_periods_company_idx on public.accounting_periods (company_id);
  end if;
end
$$;

-- bpf_declarations
do $$
begin
  if to_regclass('public.bpf_declarations') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bpf_declarations' and column_name = 'company_id') then
      alter table public.bpf_declarations add column company_id uuid not null default app.company_default();
    else
      update public.bpf_declarations set company_id = app.company_default() where company_id is null;
      alter table public.bpf_declarations alter column company_id set default app.company_default();
      alter table public.bpf_declarations alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'bpf_declarations_company_fk') then
      alter table public.bpf_declarations add constraint bpf_declarations_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists bpf_declarations_company_idx on public.bpf_declarations (company_id);
  end if;
end
$$;

-- cert_audit_findings
do $$
begin
  if to_regclass('public.cert_audit_findings') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cert_audit_findings' and column_name = 'company_id') then
      alter table public.cert_audit_findings add column company_id uuid not null default app.company_default();
    else
      update public.cert_audit_findings set company_id = app.company_default() where company_id is null;
      alter table public.cert_audit_findings alter column company_id set default app.company_default();
      alter table public.cert_audit_findings alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'cert_audit_findings_company_fk') then
      alter table public.cert_audit_findings add constraint cert_audit_findings_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists cert_audit_findings_company_idx on public.cert_audit_findings (company_id);
  end if;
end
$$;

-- cert_documents
do $$
begin
  if to_regclass('public.cert_documents') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cert_documents' and column_name = 'company_id') then
      alter table public.cert_documents add column company_id uuid not null default app.company_default();
    else
      update public.cert_documents set company_id = app.company_default() where company_id is null;
      alter table public.cert_documents alter column company_id set default app.company_default();
      alter table public.cert_documents alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'cert_documents_company_fk') then
      alter table public.cert_documents add constraint cert_documents_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists cert_documents_company_idx on public.cert_documents (company_id);
  end if;
end
$$;

-- cert_indicator_status
do $$
begin
  if to_regclass('public.cert_indicator_status') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cert_indicator_status' and column_name = 'company_id') then
      alter table public.cert_indicator_status add column company_id uuid not null default app.company_default();
    else
      update public.cert_indicator_status set company_id = app.company_default() where company_id is null;
      alter table public.cert_indicator_status alter column company_id set default app.company_default();
      alter table public.cert_indicator_status alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'cert_indicator_status_company_fk') then
      alter table public.cert_indicator_status add constraint cert_indicator_status_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists cert_indicator_status_company_idx on public.cert_indicator_status (company_id);
  end if;
end
$$;

-- cert_proofs
do $$
begin
  if to_regclass('public.cert_proofs') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cert_proofs' and column_name = 'company_id') then
      alter table public.cert_proofs add column company_id uuid not null default app.company_default();
    else
      update public.cert_proofs set company_id = app.company_default() where company_id is null;
      alter table public.cert_proofs alter column company_id set default app.company_default();
      alter table public.cert_proofs alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'cert_proofs_company_fk') then
      alter table public.cert_proofs add constraint cert_proofs_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists cert_proofs_company_idx on public.cert_proofs (company_id);
  end if;
end
$$;

-- cert_settings
do $$
begin
  if to_regclass('public.cert_settings') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cert_settings' and column_name = 'company_id') then
      alter table public.cert_settings add column company_id uuid not null default app.company_default();
    else
      update public.cert_settings set company_id = app.company_default() where company_id is null;
      alter table public.cert_settings alter column company_id set default app.company_default();
      alter table public.cert_settings alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'cert_settings_company_fk') then
      alter table public.cert_settings add constraint cert_settings_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists cert_settings_company_idx on public.cert_settings (company_id);
  end if;
end
$$;

-- duerp_projects
do $$
begin
  if to_regclass('public.duerp_projects') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'duerp_projects' and column_name = 'company_id') then
      alter table public.duerp_projects add column company_id uuid not null default app.company_default();
    else
      update public.duerp_projects set company_id = app.company_default() where company_id is null;
      alter table public.duerp_projects alter column company_id set default app.company_default();
      alter table public.duerp_projects alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'duerp_projects_company_fk') then
      alter table public.duerp_projects add constraint duerp_projects_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists duerp_projects_company_idx on public.duerp_projects (company_id);
  end if;
end
$$;

-- pp_envois
do $$
begin
  if to_regclass('public.pp_envois') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pp_envois' and column_name = 'company_id') then
      alter table public.pp_envois add column company_id uuid not null default app.company_default();
    else
      update public.pp_envois set company_id = app.company_default() where company_id is null;
      alter table public.pp_envois alter column company_id set default app.company_default();
      alter table public.pp_envois alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'pp_envois_company_fk') then
      alter table public.pp_envois add constraint pp_envois_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists pp_envois_company_idx on public.pp_envois (company_id);
  end if;
end
$$;

-- pp_accuses
do $$
begin
  if to_regclass('public.pp_accuses') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pp_accuses' and column_name = 'company_id') then
      alter table public.pp_accuses add column company_id uuid not null default app.company_default();
    else
      update public.pp_accuses set company_id = app.company_default() where company_id is null;
      alter table public.pp_accuses alter column company_id set default app.company_default();
      alter table public.pp_accuses alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'pp_accuses_company_fk') then
      alter table public.pp_accuses add constraint pp_accuses_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists pp_accuses_company_idx on public.pp_accuses (company_id);
  end if;
end
$$;

-- pp_fichiers
do $$
begin
  if to_regclass('public.pp_fichiers') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pp_fichiers' and column_name = 'company_id') then
      alter table public.pp_fichiers add column company_id uuid not null default app.company_default();
    else
      update public.pp_fichiers set company_id = app.company_default() where company_id is null;
      alter table public.pp_fichiers alter column company_id set default app.company_default();
      alter table public.pp_fichiers alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'pp_fichiers_company_fk') then
      alter table public.pp_fichiers add constraint pp_fichiers_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists pp_fichiers_company_idx on public.pp_fichiers (company_id);
  end if;
end
$$;

-- prospection_massive
do $$
begin
  if to_regclass('public.prospection_massive') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'prospection_massive' and column_name = 'company_id') then
      alter table public.prospection_massive add column company_id uuid not null default app.company_default();
    else
      update public.prospection_massive set company_id = app.company_default() where company_id is null;
      alter table public.prospection_massive alter column company_id set default app.company_default();
      alter table public.prospection_massive alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'prospection_massive_company_fk') then
      alter table public.prospection_massive add constraint prospection_massive_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists prospection_massive_company_idx on public.prospection_massive (company_id);
  end if;
end
$$;

-- prospect_calls
do $$
begin
  if to_regclass('public.prospect_calls') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'prospect_calls' and column_name = 'company_id') then
      alter table public.prospect_calls add column company_id uuid not null default app.company_default();
    else
      update public.prospect_calls set company_id = app.company_default() where company_id is null;
      alter table public.prospect_calls alter column company_id set default app.company_default();
      alter table public.prospect_calls alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'prospect_calls_company_fk') then
      alter table public.prospect_calls add constraint prospect_calls_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists prospect_calls_company_idx on public.prospect_calls (company_id);
  end if;
end
$$;

-- prospect_rdv
do $$
begin
  if to_regclass('public.prospect_rdv') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'prospect_rdv' and column_name = 'company_id') then
      alter table public.prospect_rdv add column company_id uuid not null default app.company_default();
    else
      update public.prospect_rdv set company_id = app.company_default() where company_id is null;
      alter table public.prospect_rdv alter column company_id set default app.company_default();
      alter table public.prospect_rdv alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'prospect_rdv_company_fk') then
      alter table public.prospect_rdv add constraint prospect_rdv_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists prospect_rdv_company_idx on public.prospect_rdv (company_id);
  end if;
end
$$;

-- prospect_email_logs
do $$
begin
  if to_regclass('public.prospect_email_logs') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'prospect_email_logs' and column_name = 'company_id') then
      alter table public.prospect_email_logs add column company_id uuid not null default app.company_default();
    else
      update public.prospect_email_logs set company_id = app.company_default() where company_id is null;
      alter table public.prospect_email_logs alter column company_id set default app.company_default();
      alter table public.prospect_email_logs alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'prospect_email_logs_company_fk') then
      alter table public.prospect_email_logs add constraint prospect_email_logs_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists prospect_email_logs_company_idx on public.prospect_email_logs (company_id);
  end if;
end
$$;

-- prospect_needs_analysis
do $$
begin
  if to_regclass('public.prospect_needs_analysis') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'prospect_needs_analysis' and column_name = 'company_id') then
      alter table public.prospect_needs_analysis add column company_id uuid not null default app.company_default();
    else
      update public.prospect_needs_analysis set company_id = app.company_default() where company_id is null;
      alter table public.prospect_needs_analysis alter column company_id set default app.company_default();
      alter table public.prospect_needs_analysis alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'prospect_needs_analysis_company_fk') then
      alter table public.prospect_needs_analysis add constraint prospect_needs_analysis_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists prospect_needs_analysis_company_idx on public.prospect_needs_analysis (company_id);
  end if;
end
$$;

-- phoning_sessions
do $$
begin
  if to_regclass('public.phoning_sessions') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'phoning_sessions' and column_name = 'company_id') then
      alter table public.phoning_sessions add column company_id uuid not null default app.company_default();
    else
      update public.phoning_sessions set company_id = app.company_default() where company_id is null;
      alter table public.phoning_sessions alter column company_id set default app.company_default();
      alter table public.phoning_sessions alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'phoning_sessions_company_fk') then
      alter table public.phoning_sessions add constraint phoning_sessions_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists phoning_sessions_company_idx on public.phoning_sessions (company_id);
  end if;
end
$$;

-- rdv_emails_sent
do $$
begin
  if to_regclass('public.rdv_emails_sent') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rdv_emails_sent' and column_name = 'company_id') then
      alter table public.rdv_emails_sent add column company_id uuid not null default app.company_default();
    else
      update public.rdv_emails_sent set company_id = app.company_default() where company_id is null;
      alter table public.rdv_emails_sent alter column company_id set default app.company_default();
      alter table public.rdv_emails_sent alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'rdv_emails_sent_company_fk') then
      alter table public.rdv_emails_sent add constraint rdv_emails_sent_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists rdv_emails_sent_company_idx on public.rdv_emails_sent (company_id);
  end if;
end
$$;

-- rdv_kit_documents
do $$
begin
  if to_regclass('public.rdv_kit_documents') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rdv_kit_documents' and column_name = 'company_id') then
      alter table public.rdv_kit_documents add column company_id uuid not null default app.company_default();
    else
      update public.rdv_kit_documents set company_id = app.company_default() where company_id is null;
      alter table public.rdv_kit_documents alter column company_id set default app.company_default();
      alter table public.rdv_kit_documents alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'rdv_kit_documents_company_fk') then
      alter table public.rdv_kit_documents add constraint rdv_kit_documents_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists rdv_kit_documents_company_idx on public.rdv_kit_documents (company_id);
  end if;
end
$$;

-- mailing_campaigns
do $$
begin
  if to_regclass('public.mailing_campaigns') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mailing_campaigns' and column_name = 'company_id') then
      alter table public.mailing_campaigns add column company_id uuid not null default app.company_default();
    else
      update public.mailing_campaigns set company_id = app.company_default() where company_id is null;
      alter table public.mailing_campaigns alter column company_id set default app.company_default();
      alter table public.mailing_campaigns alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'mailing_campaigns_company_fk') then
      alter table public.mailing_campaigns add constraint mailing_campaigns_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists mailing_campaigns_company_idx on public.mailing_campaigns (company_id);
  end if;
end
$$;

-- mailing_segments
do $$
begin
  if to_regclass('public.mailing_segments') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mailing_segments' and column_name = 'company_id') then
      alter table public.mailing_segments add column company_id uuid not null default app.company_default();
    else
      update public.mailing_segments set company_id = app.company_default() where company_id is null;
      alter table public.mailing_segments alter column company_id set default app.company_default();
      alter table public.mailing_segments alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'mailing_segments_company_fk') then
      alter table public.mailing_segments add constraint mailing_segments_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists mailing_segments_company_idx on public.mailing_segments (company_id);
  end if;
end
$$;

-- mailing_email_status
do $$
begin
  if to_regclass('public.mailing_email_status') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mailing_email_status' and column_name = 'company_id') then
      alter table public.mailing_email_status add column company_id uuid not null default app.company_default();
    else
      update public.mailing_email_status set company_id = app.company_default() where company_id is null;
      alter table public.mailing_email_status alter column company_id set default app.company_default();
      alter table public.mailing_email_status alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'mailing_email_status_company_fk') then
      alter table public.mailing_email_status add constraint mailing_email_status_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists mailing_email_status_company_idx on public.mailing_email_status (company_id);
  end if;
end
$$;

-- mailing_blocklist
do $$
begin
  if to_regclass('public.mailing_blocklist') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mailing_blocklist' and column_name = 'company_id') then
      alter table public.mailing_blocklist add column company_id uuid not null default app.company_default();
    else
      update public.mailing_blocklist set company_id = app.company_default() where company_id is null;
      alter table public.mailing_blocklist alter column company_id set default app.company_default();
      alter table public.mailing_blocklist alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'mailing_blocklist_company_fk') then
      alter table public.mailing_blocklist add constraint mailing_blocklist_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists mailing_blocklist_company_idx on public.mailing_blocklist (company_id);
  end if;
end
$$;

-- social_posts
do $$
begin
  if to_regclass('public.social_posts') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'social_posts' and column_name = 'company_id') then
      alter table public.social_posts add column company_id uuid not null default app.company_default();
    else
      update public.social_posts set company_id = app.company_default() where company_id is null;
      alter table public.social_posts alter column company_id set default app.company_default();
      alter table public.social_posts alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'social_posts_company_fk') then
      alter table public.social_posts add constraint social_posts_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists social_posts_company_idx on public.social_posts (company_id);
  end if;
end
$$;

-- social_media_library
do $$
begin
  if to_regclass('public.social_media_library') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'social_media_library' and column_name = 'company_id') then
      alter table public.social_media_library add column company_id uuid not null default app.company_default();
    else
      update public.social_media_library set company_id = app.company_default() where company_id is null;
      alter table public.social_media_library alter column company_id set default app.company_default();
      alter table public.social_media_library alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'social_media_library_company_fk') then
      alter table public.social_media_library add constraint social_media_library_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists social_media_library_company_idx on public.social_media_library (company_id);
  end if;
end
$$;

-- social_tokens
do $$
begin
  if to_regclass('public.social_tokens') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'social_tokens' and column_name = 'company_id') then
      alter table public.social_tokens add column company_id uuid not null default app.company_default();
    else
      update public.social_tokens set company_id = app.company_default() where company_id is null;
      alter table public.social_tokens alter column company_id set default app.company_default();
      alter table public.social_tokens alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'social_tokens_company_fk') then
      alter table public.social_tokens add constraint social_tokens_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists social_tokens_company_idx on public.social_tokens (company_id);
  end if;
end
$$;

-- non_conformites
do $$
begin
  if to_regclass('public.non_conformites') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'non_conformites' and column_name = 'company_id') then
      alter table public.non_conformites add column company_id uuid not null default app.company_default();
    else
      update public.non_conformites set company_id = app.company_default() where company_id is null;
      alter table public.non_conformites alter column company_id set default app.company_default();
      alter table public.non_conformites alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'non_conformites_company_fk') then
      alter table public.non_conformites add constraint non_conformites_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists non_conformites_company_idx on public.non_conformites (company_id);
  end if;
end
$$;

-- non_conformities
do $$
begin
  if to_regclass('public.non_conformities') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'non_conformities' and column_name = 'company_id') then
      alter table public.non_conformities add column company_id uuid not null default app.company_default();
    else
      update public.non_conformities set company_id = app.company_default() where company_id is null;
      alter table public.non_conformities alter column company_id set default app.company_default();
      alter table public.non_conformities alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'non_conformities_company_fk') then
      alter table public.non_conformities add constraint non_conformities_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists non_conformities_company_idx on public.non_conformities (company_id);
  end if;
end
$$;

-- reclamations
do $$
begin
  if to_regclass('public.reclamations') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'reclamations' and column_name = 'company_id') then
      alter table public.reclamations add column company_id uuid not null default app.company_default();
    else
      update public.reclamations set company_id = app.company_default() where company_id is null;
      alter table public.reclamations alter column company_id set default app.company_default();
      alter table public.reclamations alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'reclamations_company_fk') then
      alter table public.reclamations add constraint reclamations_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists reclamations_company_idx on public.reclamations (company_id);
  end if;
end
$$;

-- quality_alerts
do $$
begin
  if to_regclass('public.quality_alerts') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quality_alerts' and column_name = 'company_id') then
      alter table public.quality_alerts add column company_id uuid not null default app.company_default();
    else
      update public.quality_alerts set company_id = app.company_default() where company_id is null;
      alter table public.quality_alerts alter column company_id set default app.company_default();
      alter table public.quality_alerts alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'quality_alerts_company_fk') then
      alter table public.quality_alerts add constraint quality_alerts_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists quality_alerts_company_idx on public.quality_alerts (company_id);
  end if;
end
$$;

-- completude_alerts
do $$
begin
  if to_regclass('public.completude_alerts') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'completude_alerts' and column_name = 'company_id') then
      alter table public.completude_alerts add column company_id uuid not null default app.company_default();
    else
      update public.completude_alerts set company_id = app.company_default() where company_id is null;
      alter table public.completude_alerts alter column company_id set default app.company_default();
      alter table public.completude_alerts alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'completude_alerts_company_fk') then
      alter table public.completude_alerts add constraint completude_alerts_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists completude_alerts_company_idx on public.completude_alerts (company_id);
  end if;
end
$$;

-- completude_tracking
do $$
begin
  if to_regclass('public.completude_tracking') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'completude_tracking' and column_name = 'company_id') then
      alter table public.completude_tracking add column company_id uuid not null default app.company_default();
    else
      update public.completude_tracking set company_id = app.company_default() where company_id is null;
      alter table public.completude_tracking alter column company_id set default app.company_default();
      alter table public.completude_tracking alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'completude_tracking_company_fk') then
      alter table public.completude_tracking add constraint completude_tracking_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists completude_tracking_company_idx on public.completude_tracking (company_id);
  end if;
end
$$;

-- notifications
do $$
begin
  if to_regclass('public.notifications') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'company_id') then
      alter table public.notifications add column company_id uuid not null default app.company_default();
    else
      update public.notifications set company_id = app.company_default() where company_id is null;
      alter table public.notifications alter column company_id set default app.company_default();
      alter table public.notifications alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'notifications_company_fk') then
      alter table public.notifications add constraint notifications_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists notifications_company_idx on public.notifications (company_id);
  end if;
end
$$;

-- audit_logs
do $$
begin
  if to_regclass('public.audit_logs') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'company_id') then
      alter table public.audit_logs add column company_id uuid not null default app.company_default();
    else
      update public.audit_logs set company_id = app.company_default() where company_id is null;
      alter table public.audit_logs alter column company_id set default app.company_default();
      alter table public.audit_logs alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'audit_logs_company_fk') then
      alter table public.audit_logs add constraint audit_logs_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists audit_logs_company_idx on public.audit_logs (company_id);
  end if;
end
$$;

-- error_logs
do $$
begin
  if to_regclass('public.error_logs') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'error_logs' and column_name = 'company_id') then
      alter table public.error_logs add column company_id uuid not null default app.company_default();
    else
      update public.error_logs set company_id = app.company_default() where company_id is null;
      alter table public.error_logs alter column company_id set default app.company_default();
      alter table public.error_logs alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'error_logs_company_fk') then
      alter table public.error_logs add constraint error_logs_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists error_logs_company_idx on public.error_logs (company_id);
  end if;
end
$$;

-- rgpd_traitements
do $$
begin
  if to_regclass('public.rgpd_traitements') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rgpd_traitements' and column_name = 'company_id') then
      alter table public.rgpd_traitements add column company_id uuid not null default app.company_default();
    else
      update public.rgpd_traitements set company_id = app.company_default() where company_id is null;
      alter table public.rgpd_traitements alter column company_id set default app.company_default();
      alter table public.rgpd_traitements alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'rgpd_traitements_company_fk') then
      alter table public.rgpd_traitements add constraint rgpd_traitements_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists rgpd_traitements_company_idx on public.rgpd_traitements (company_id);
  end if;
end
$$;

-- veille_qualiopi
do $$
begin
  if to_regclass('public.veille_qualiopi') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'veille_qualiopi' and column_name = 'company_id') then
      alter table public.veille_qualiopi add column company_id uuid not null default app.company_default();
    else
      update public.veille_qualiopi set company_id = app.company_default() where company_id is null;
      alter table public.veille_qualiopi alter column company_id set default app.company_default();
      alter table public.veille_qualiopi alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'veille_qualiopi_company_fk') then
      alter table public.veille_qualiopi add constraint veille_qualiopi_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists veille_qualiopi_company_idx on public.veille_qualiopi (company_id);
  end if;
end
$$;

-- veille_sources
do $$
begin
  if to_regclass('public.veille_sources') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'veille_sources' and column_name = 'company_id') then
      alter table public.veille_sources add column company_id uuid not null default app.company_default();
    else
      update public.veille_sources set company_id = app.company_default() where company_id is null;
      alter table public.veille_sources alter column company_id set default app.company_default();
      alter table public.veille_sources alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'veille_sources_company_fk') then
      alter table public.veille_sources add constraint veille_sources_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists veille_sources_company_idx on public.veille_sources (company_id);
  end if;
end
$$;

-- processes
do $$
begin
  if to_regclass('public.processes') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'processes' and column_name = 'company_id') then
      alter table public.processes add column company_id uuid not null default app.company_default();
    else
      update public.processes set company_id = app.company_default() where company_id is null;
      alter table public.processes alter column company_id set default app.company_default();
      alter table public.processes alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'processes_company_fk') then
      alter table public.processes add constraint processes_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists processes_company_idx on public.processes (company_id);
  end if;
end
$$;

-- process_categories
do $$
begin
  if to_regclass('public.process_categories') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'process_categories' and column_name = 'company_id') then
      alter table public.process_categories add column company_id uuid not null default app.company_default();
    else
      update public.process_categories set company_id = app.company_default() where company_id is null;
      alter table public.process_categories alter column company_id set default app.company_default();
      alter table public.process_categories alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'process_categories_company_fk') then
      alter table public.process_categories add constraint process_categories_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists process_categories_company_idx on public.process_categories (company_id);
  end if;
end
$$;

-- process_responsibles
do $$
begin
  if to_regclass('public.process_responsibles') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'process_responsibles' and column_name = 'company_id') then
      alter table public.process_responsibles add column company_id uuid not null default app.company_default();
    else
      update public.process_responsibles set company_id = app.company_default() where company_id is null;
      alter table public.process_responsibles alter column company_id set default app.company_default();
      alter table public.process_responsibles alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'process_responsibles_company_fk') then
      alter table public.process_responsibles add constraint process_responsibles_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists process_responsibles_company_idx on public.process_responsibles (company_id);
  end if;
end
$$;

-- qualiopi_indicators
do $$
begin
  if to_regclass('public.qualiopi_indicators') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'qualiopi_indicators' and column_name = 'company_id') then
      alter table public.qualiopi_indicators add column company_id uuid not null default app.company_default();
    else
      update public.qualiopi_indicators set company_id = app.company_default() where company_id is null;
      alter table public.qualiopi_indicators alter column company_id set default app.company_default();
      alter table public.qualiopi_indicators alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'qualiopi_indicators_company_fk') then
      alter table public.qualiopi_indicators add constraint qualiopi_indicators_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists qualiopi_indicators_company_idx on public.qualiopi_indicators (company_id);
  end if;
end
$$;

-- audits_internes
do $$
begin
  if to_regclass('public.audits_internes') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'audits_internes' and column_name = 'company_id') then
      alter table public.audits_internes add column company_id uuid not null default app.company_default();
    else
      update public.audits_internes set company_id = app.company_default() where company_id is null;
      alter table public.audits_internes alter column company_id set default app.company_default();
      alter table public.audits_internes alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'audits_internes_company_fk') then
      alter table public.audits_internes add constraint audits_internes_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists audits_internes_company_idx on public.audits_internes (company_id);
  end if;
end
$$;

-- documents
do $$
begin
  if to_regclass('public.documents') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'company_id') then
      alter table public.documents add column company_id uuid not null default app.company_default();
    else
      update public.documents set company_id = app.company_default() where company_id is null;
      alter table public.documents alter column company_id set default app.company_default();
      alter table public.documents alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'documents_company_fk') then
      alter table public.documents add constraint documents_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists documents_company_idx on public.documents (company_id);
  end if;
end
$$;

-- uploaded_documents
do $$
begin
  if to_regclass('public.uploaded_documents') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'uploaded_documents' and column_name = 'company_id') then
      alter table public.uploaded_documents add column company_id uuid not null default app.company_default();
    else
      update public.uploaded_documents set company_id = app.company_default() where company_id is null;
      alter table public.uploaded_documents alter column company_id set default app.company_default();
      alter table public.uploaded_documents alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'uploaded_documents_company_fk') then
      alter table public.uploaded_documents add constraint uploaded_documents_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists uploaded_documents_company_idx on public.uploaded_documents (company_id);
  end if;
end
$$;

-- uploaded_files
do $$
begin
  if to_regclass('public.uploaded_files') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'uploaded_files' and column_name = 'company_id') then
      alter table public.uploaded_files add column company_id uuid not null default app.company_default();
    else
      update public.uploaded_files set company_id = app.company_default() where company_id is null;
      alter table public.uploaded_files alter column company_id set default app.company_default();
      alter table public.uploaded_files alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'uploaded_files_company_fk') then
      alter table public.uploaded_files add constraint uploaded_files_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists uploaded_files_company_idx on public.uploaded_files (company_id);
  end if;
end
$$;

-- import_logs
do $$
begin
  if to_regclass('public.import_logs') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'import_logs' and column_name = 'company_id') then
      alter table public.import_logs add column company_id uuid not null default app.company_default();
    else
      update public.import_logs set company_id = app.company_default() where company_id is null;
      alter table public.import_logs alter column company_id set default app.company_default();
      alter table public.import_logs alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'import_logs_company_fk') then
      alter table public.import_logs add constraint import_logs_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists import_logs_company_idx on public.import_logs (company_id);
  end if;
end
$$;

-- signature_alerts_sent
do $$
begin
  if to_regclass('public.signature_alerts_sent') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'signature_alerts_sent' and column_name = 'company_id') then
      alter table public.signature_alerts_sent add column company_id uuid not null default app.company_default();
    else
      update public.signature_alerts_sent set company_id = app.company_default() where company_id is null;
      alter table public.signature_alerts_sent alter column company_id set default app.company_default();
      alter table public.signature_alerts_sent alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'signature_alerts_sent_company_fk') then
      alter table public.signature_alerts_sent add constraint signature_alerts_sent_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists signature_alerts_sent_company_idx on public.signature_alerts_sent (company_id);
  end if;
end
$$;

-- trainees_archive
do $$
begin
  if to_regclass('public.trainees_archive') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainees_archive' and column_name = 'company_id') then
      alter table public.trainees_archive add column company_id uuid not null default app.company_default();
    else
      update public.trainees_archive set company_id = app.company_default() where company_id is null;
      alter table public.trainees_archive alter column company_id set default app.company_default();
      alter table public.trainees_archive alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'trainees_archive_company_fk') then
      alter table public.trainees_archive add constraint trainees_archive_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists trainees_archive_company_idx on public.trainees_archive (company_id);
  end if;
end
$$;

-- psh_requests
do $$
begin
  if to_regclass('public.psh_requests') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'psh_requests' and column_name = 'company_id') then
      alter table public.psh_requests add column company_id uuid not null default app.company_default();
    else
      update public.psh_requests set company_id = app.company_default() where company_id is null;
      alter table public.psh_requests alter column company_id set default app.company_default();
      alter table public.psh_requests alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'psh_requests_company_fk') then
      alter table public.psh_requests add constraint psh_requests_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists psh_requests_company_idx on public.psh_requests (company_id);
  end if;
end
$$;

-- client_interactions
do $$
begin
  if to_regclass('public.client_interactions') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_interactions' and column_name = 'company_id') then
      alter table public.client_interactions add column company_id uuid not null default app.company_default();
    else
      update public.client_interactions set company_id = app.company_default() where company_id is null;
      alter table public.client_interactions alter column company_id set default app.company_default();
      alter table public.client_interactions alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'client_interactions_company_fk') then
      alter table public.client_interactions add constraint client_interactions_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists client_interactions_company_idx on public.client_interactions (company_id);
  end if;
end
$$;

-- client_portal_access
do $$
begin
  if to_regclass('public.client_portal_access') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_portal_access' and column_name = 'company_id') then
      alter table public.client_portal_access add column company_id uuid not null default app.company_default();
    else
      update public.client_portal_access set company_id = app.company_default() where company_id is null;
      alter table public.client_portal_access alter column company_id set default app.company_default();
      alter table public.client_portal_access alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'client_portal_access_company_fk') then
      alter table public.client_portal_access add constraint client_portal_access_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists client_portal_access_company_idx on public.client_portal_access (company_id);
  end if;
end
$$;

-- client_providers
do $$
begin
  if to_regclass('public.client_providers') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_providers' and column_name = 'company_id') then
      alter table public.client_providers add column company_id uuid not null default app.company_default();
    else
      update public.client_providers set company_id = app.company_default() where company_id is null;
      alter table public.client_providers alter column company_id set default app.company_default();
      alter table public.client_providers alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'client_providers_company_fk') then
      alter table public.client_providers add constraint client_providers_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists client_providers_company_idx on public.client_providers (company_id);
  end if;
end
$$;

-- user_feedback
do $$
begin
  if to_regclass('public.user_feedback') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_feedback' and column_name = 'company_id') then
      alter table public.user_feedback add column company_id uuid not null default app.company_default();
    else
      update public.user_feedback set company_id = app.company_default() where company_id is null;
      alter table public.user_feedback alter column company_id set default app.company_default();
      alter table public.user_feedback alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'user_feedback_company_fk') then
      alter table public.user_feedback add constraint user_feedback_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists user_feedback_company_idx on public.user_feedback (company_id);
  end if;
end
$$;

-- ===== Classe B : filles, société du parent =====

-- quote_items (parent quotes.quote_id)
do $$
begin
  if to_regclass('public.quote_items') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quote_items' and column_name = 'company_id') then
      alter table public.quote_items add column company_id uuid not null default app.company_default();
    else
      update public.quote_items set company_id = app.company_default() where company_id is null;
      alter table public.quote_items alter column company_id set default app.company_default();
      alter table public.quote_items alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'quote_items_company_fk') then
      alter table public.quote_items add constraint quote_items_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists quote_items_company_idx on public.quote_items (company_id);
    drop trigger if exists quote_items_societe on public.quote_items;
    create trigger quote_items_societe before insert or update of quote_id on public.quote_items
      for each row execute function app.societe_du_parent('quotes', 'quote_id');
  end if;
end
$$;

-- invoice_items (parent invoices.invoice_id)
do $$
begin
  if to_regclass('public.invoice_items') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_items' and column_name = 'company_id') then
      alter table public.invoice_items add column company_id uuid not null default app.company_default();
    else
      update public.invoice_items set company_id = app.company_default() where company_id is null;
      alter table public.invoice_items alter column company_id set default app.company_default();
      alter table public.invoice_items alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'invoice_items_company_fk') then
      alter table public.invoice_items add constraint invoice_items_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists invoice_items_company_idx on public.invoice_items (company_id);
    drop trigger if exists invoice_items_societe on public.invoice_items;
    create trigger invoice_items_societe before insert or update of invoice_id on public.invoice_items
      for each row execute function app.societe_du_parent('invoices', 'invoice_id');
  end if;
end
$$;

-- invoice_sessions (parent invoices.invoice_id)
do $$
begin
  if to_regclass('public.invoice_sessions') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_sessions' and column_name = 'company_id') then
      alter table public.invoice_sessions add column company_id uuid not null default app.company_default();
    else
      update public.invoice_sessions set company_id = app.company_default() where company_id is null;
      alter table public.invoice_sessions alter column company_id set default app.company_default();
      alter table public.invoice_sessions alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'invoice_sessions_company_fk') then
      alter table public.invoice_sessions add constraint invoice_sessions_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists invoice_sessions_company_idx on public.invoice_sessions (company_id);
    drop trigger if exists invoice_sessions_societe on public.invoice_sessions;
    create trigger invoice_sessions_societe before insert or update of invoice_id on public.invoice_sessions
      for each row execute function app.societe_du_parent('invoices', 'invoice_id');
  end if;
end
$$;

-- invoice_payments (parent invoices.invoice_id)
do $$
begin
  if to_regclass('public.invoice_payments') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_payments' and column_name = 'company_id') then
      alter table public.invoice_payments add column company_id uuid not null default app.company_default();
    else
      update public.invoice_payments set company_id = app.company_default() where company_id is null;
      alter table public.invoice_payments alter column company_id set default app.company_default();
      alter table public.invoice_payments alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'invoice_payments_company_fk') then
      alter table public.invoice_payments add constraint invoice_payments_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists invoice_payments_company_idx on public.invoice_payments (company_id);
    drop trigger if exists invoice_payments_societe on public.invoice_payments;
    create trigger invoice_payments_societe before insert or update of invoice_id on public.invoice_payments
      for each row execute function app.societe_du_parent('invoices', 'invoice_id');
  end if;
end
$$;

-- invoice_relances (parent invoices.invoice_id)
do $$
begin
  if to_regclass('public.invoice_relances') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_relances' and column_name = 'company_id') then
      alter table public.invoice_relances add column company_id uuid not null default app.company_default();
    else
      update public.invoice_relances set company_id = app.company_default() where company_id is null;
      alter table public.invoice_relances alter column company_id set default app.company_default();
      alter table public.invoice_relances alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'invoice_relances_company_fk') then
      alter table public.invoice_relances add constraint invoice_relances_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists invoice_relances_company_idx on public.invoice_relances (company_id);
    drop trigger if exists invoice_relances_societe on public.invoice_relances;
    create trigger invoice_relances_societe before insert or update of invoice_id on public.invoice_relances
      for each row execute function app.societe_du_parent('invoices', 'invoice_id');
  end if;
end
$$;

-- session_trainees (parent sessions.session_id)
do $$
begin
  if to_regclass('public.session_trainees') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_trainees' and column_name = 'company_id') then
      alter table public.session_trainees add column company_id uuid not null default app.company_default();
    else
      update public.session_trainees set company_id = app.company_default() where company_id is null;
      alter table public.session_trainees alter column company_id set default app.company_default();
      alter table public.session_trainees alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'session_trainees_company_fk') then
      alter table public.session_trainees add constraint session_trainees_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists session_trainees_company_idx on public.session_trainees (company_id);
    drop trigger if exists session_trainees_societe on public.session_trainees;
    create trigger session_trainees_societe before insert or update of session_id on public.session_trainees
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- session_trainers (parent sessions.session_id)
do $$
begin
  if to_regclass('public.session_trainers') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_trainers' and column_name = 'company_id') then
      alter table public.session_trainers add column company_id uuid not null default app.company_default();
    else
      update public.session_trainers set company_id = app.company_default() where company_id is null;
      alter table public.session_trainers alter column company_id set default app.company_default();
      alter table public.session_trainers alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'session_trainers_company_fk') then
      alter table public.session_trainers add constraint session_trainers_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists session_trainers_company_idx on public.session_trainers (company_id);
    drop trigger if exists session_trainers_societe on public.session_trainers;
    create trigger session_trainers_societe before insert or update of session_id on public.session_trainers
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- session_checklists (parent sessions.session_id)
do $$
begin
  if to_regclass('public.session_checklists') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_checklists' and column_name = 'company_id') then
      alter table public.session_checklists add column company_id uuid not null default app.company_default();
    else
      update public.session_checklists set company_id = app.company_default() where company_id is null;
      alter table public.session_checklists alter column company_id set default app.company_default();
      alter table public.session_checklists alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'session_checklists_company_fk') then
      alter table public.session_checklists add constraint session_checklists_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists session_checklists_company_idx on public.session_checklists (company_id);
    drop trigger if exists session_checklists_societe on public.session_checklists;
    create trigger session_checklists_societe before insert or update of session_id on public.session_checklists
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- session_costs (parent sessions.session_id)
do $$
begin
  if to_regclass('public.session_costs') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_costs' and column_name = 'company_id') then
      alter table public.session_costs add column company_id uuid not null default app.company_default();
    else
      update public.session_costs set company_id = app.company_default() where company_id is null;
      alter table public.session_costs alter column company_id set default app.company_default();
      alter table public.session_costs alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'session_costs_company_fk') then
      alter table public.session_costs add constraint session_costs_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists session_costs_company_idx on public.session_costs (company_id);
    drop trigger if exists session_costs_societe on public.session_costs;
    create trigger session_costs_societe before insert or update of session_id on public.session_costs
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- session_document_access (parent sessions.session_id)
do $$
begin
  if to_regclass('public.session_document_access') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_document_access' and column_name = 'company_id') then
      alter table public.session_document_access add column company_id uuid not null default app.company_default();
    else
      update public.session_document_access set company_id = app.company_default() where company_id is null;
      alter table public.session_document_access alter column company_id set default app.company_default();
      alter table public.session_document_access alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'session_document_access_company_fk') then
      alter table public.session_document_access add constraint session_document_access_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists session_document_access_company_idx on public.session_document_access (company_id);
    drop trigger if exists session_document_access_societe on public.session_document_access;
    create trigger session_document_access_societe before insert or update of session_id on public.session_document_access
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- session_documents (parent sessions.session_id)
do $$
begin
  if to_regclass('public.session_documents') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_documents' and column_name = 'company_id') then
      alter table public.session_documents add column company_id uuid not null default app.company_default();
    else
      update public.session_documents set company_id = app.company_default() where company_id is null;
      alter table public.session_documents alter column company_id set default app.company_default();
      alter table public.session_documents alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'session_documents_company_fk') then
      alter table public.session_documents add constraint session_documents_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists session_documents_company_idx on public.session_documents (company_id);
    drop trigger if exists session_documents_societe on public.session_documents;
    create trigger session_documents_societe before insert or update of session_id on public.session_documents
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- session_emails_sent (parent sessions.session_id)
do $$
begin
  if to_regclass('public.session_emails_sent') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_emails_sent' and column_name = 'company_id') then
      alter table public.session_emails_sent add column company_id uuid not null default app.company_default();
    else
      update public.session_emails_sent set company_id = app.company_default() where company_id is null;
      alter table public.session_emails_sent alter column company_id set default app.company_default();
      alter table public.session_emails_sent alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'session_emails_sent_company_fk') then
      alter table public.session_emails_sent add constraint session_emails_sent_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists session_emails_sent_company_idx on public.session_emails_sent (company_id);
    drop trigger if exists session_emails_sent_societe on public.session_emails_sent;
    create trigger session_emails_sent_societe before insert or update of session_id on public.session_emails_sent
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- session_equipment (parent sessions.session_id)
do $$
begin
  if to_regclass('public.session_equipment') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_equipment' and column_name = 'company_id') then
      alter table public.session_equipment add column company_id uuid not null default app.company_default();
    else
      update public.session_equipment set company_id = app.company_default() where company_id is null;
      alter table public.session_equipment alter column company_id set default app.company_default();
      alter table public.session_equipment alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'session_equipment_company_fk') then
      alter table public.session_equipment add constraint session_equipment_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists session_equipment_company_idx on public.session_equipment (company_id);
    drop trigger if exists session_equipment_societe on public.session_equipment;
    create trigger session_equipment_societe before insert or update of session_id on public.session_equipment
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- session_fundings (parent sessions.session_id)
do $$
begin
  if to_regclass('public.session_fundings') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_fundings' and column_name = 'company_id') then
      alter table public.session_fundings add column company_id uuid not null default app.company_default();
    else
      update public.session_fundings set company_id = app.company_default() where company_id is null;
      alter table public.session_fundings alter column company_id set default app.company_default();
      alter table public.session_fundings alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'session_fundings_company_fk') then
      alter table public.session_fundings add constraint session_fundings_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists session_fundings_company_idx on public.session_fundings (company_id);
    drop trigger if exists session_fundings_societe on public.session_fundings;
    create trigger session_fundings_societe before insert or update of session_id on public.session_fundings
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- session_groups (parent sessions.session_id)
do $$
begin
  if to_regclass('public.session_groups') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_groups' and column_name = 'company_id') then
      alter table public.session_groups add column company_id uuid not null default app.company_default();
    else
      update public.session_groups set company_id = app.company_default() where company_id is null;
      alter table public.session_groups alter column company_id set default app.company_default();
      alter table public.session_groups alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'session_groups_company_fk') then
      alter table public.session_groups add constraint session_groups_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists session_groups_company_idx on public.session_groups (company_id);
    drop trigger if exists session_groups_societe on public.session_groups;
    create trigger session_groups_societe before insert or update of session_id on public.session_groups
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- session_needs_analysis (parent sessions.session_id)
do $$
begin
  if to_regclass('public.session_needs_analysis') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_needs_analysis' and column_name = 'company_id') then
      alter table public.session_needs_analysis add column company_id uuid not null default app.company_default();
    else
      update public.session_needs_analysis set company_id = app.company_default() where company_id is null;
      alter table public.session_needs_analysis alter column company_id set default app.company_default();
      alter table public.session_needs_analysis alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'session_needs_analysis_company_fk') then
      alter table public.session_needs_analysis add constraint session_needs_analysis_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists session_needs_analysis_company_idx on public.session_needs_analysis (company_id);
    drop trigger if exists session_needs_analysis_societe on public.session_needs_analysis;
    create trigger session_needs_analysis_societe before insert or update of session_id on public.session_needs_analysis
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- session_qualiopi (parent sessions.session_id)
do $$
begin
  if to_regclass('public.session_qualiopi') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_qualiopi' and column_name = 'company_id') then
      alter table public.session_qualiopi add column company_id uuid not null default app.company_default();
    else
      update public.session_qualiopi set company_id = app.company_default() where company_id is null;
      alter table public.session_qualiopi alter column company_id set default app.company_default();
      alter table public.session_qualiopi alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'session_qualiopi_company_fk') then
      alter table public.session_qualiopi add constraint session_qualiopi_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists session_qualiopi_company_idx on public.session_qualiopi (company_id);
    drop trigger if exists session_qualiopi_societe on public.session_qualiopi;
    create trigger session_qualiopi_societe before insert or update of session_id on public.session_qualiopi
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- session_sequences (parent sessions.session_id)
do $$
begin
  if to_regclass('public.session_sequences') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_sequences' and column_name = 'company_id') then
      alter table public.session_sequences add column company_id uuid not null default app.company_default();
    else
      update public.session_sequences set company_id = app.company_default() where company_id is null;
      alter table public.session_sequences alter column company_id set default app.company_default();
      alter table public.session_sequences alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'session_sequences_company_fk') then
      alter table public.session_sequences add constraint session_sequences_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists session_sequences_company_idx on public.session_sequences (company_id);
    drop trigger if exists session_sequences_societe on public.session_sequences;
    create trigger session_sequences_societe before insert or update of session_id on public.session_sequences
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- attendance_halfdays (parent sessions.session_id)
do $$
begin
  if to_regclass('public.attendance_halfdays') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'attendance_halfdays' and column_name = 'company_id') then
      alter table public.attendance_halfdays add column company_id uuid not null default app.company_default();
    else
      update public.attendance_halfdays set company_id = app.company_default() where company_id is null;
      alter table public.attendance_halfdays alter column company_id set default app.company_default();
      alter table public.attendance_halfdays alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'attendance_halfdays_company_fk') then
      alter table public.attendance_halfdays add constraint attendance_halfdays_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists attendance_halfdays_company_idx on public.attendance_halfdays (company_id);
    drop trigger if exists attendance_halfdays_societe on public.attendance_halfdays;
    create trigger attendance_halfdays_societe before insert or update of session_id on public.attendance_halfdays
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- attendance_proxy_signatures (parent sessions.session_id)
do $$
begin
  if to_regclass('public.attendance_proxy_signatures') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'attendance_proxy_signatures' and column_name = 'company_id') then
      alter table public.attendance_proxy_signatures add column company_id uuid not null default app.company_default();
    else
      update public.attendance_proxy_signatures set company_id = app.company_default() where company_id is null;
      alter table public.attendance_proxy_signatures alter column company_id set default app.company_default();
      alter table public.attendance_proxy_signatures alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'attendance_proxy_signatures_company_fk') then
      alter table public.attendance_proxy_signatures add constraint attendance_proxy_signatures_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists attendance_proxy_signatures_company_idx on public.attendance_proxy_signatures (company_id);
    drop trigger if exists attendance_proxy_signatures_societe on public.attendance_proxy_signatures;
    create trigger attendance_proxy_signatures_societe before insert or update of session_id on public.attendance_proxy_signatures
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- attendances (parent sessions.session_id)
do $$
begin
  if to_regclass('public.attendances') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'attendances' and column_name = 'company_id') then
      alter table public.attendances add column company_id uuid not null default app.company_default();
    else
      update public.attendances set company_id = app.company_default() where company_id is null;
      alter table public.attendances alter column company_id set default app.company_default();
      alter table public.attendances alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'attendances_company_fk') then
      alter table public.attendances add constraint attendances_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists attendances_company_idx on public.attendances (company_id);
    drop trigger if exists attendances_societe on public.attendances;
    create trigger attendances_societe before insert or update of session_id on public.attendances
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- document_signatures (parent sessions.session_id)
do $$
begin
  if to_regclass('public.document_signatures') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'document_signatures' and column_name = 'company_id') then
      alter table public.document_signatures add column company_id uuid not null default app.company_default();
    else
      update public.document_signatures set company_id = app.company_default() where company_id is null;
      alter table public.document_signatures alter column company_id set default app.company_default();
      alter table public.document_signatures alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'document_signatures_company_fk') then
      alter table public.document_signatures add constraint document_signatures_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists document_signatures_company_idx on public.document_signatures (company_id);
    drop trigger if exists document_signatures_societe on public.document_signatures;
    create trigger document_signatures_societe before insert or update of session_id on public.document_signatures
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- trainee_evaluations (parent sessions.session_id)
do $$
begin
  if to_regclass('public.trainee_evaluations') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainee_evaluations' and column_name = 'company_id') then
      alter table public.trainee_evaluations add column company_id uuid not null default app.company_default();
    else
      update public.trainee_evaluations set company_id = app.company_default() where company_id is null;
      alter table public.trainee_evaluations alter column company_id set default app.company_default();
      alter table public.trainee_evaluations alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'trainee_evaluations_company_fk') then
      alter table public.trainee_evaluations add constraint trainee_evaluations_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists trainee_evaluations_company_idx on public.trainee_evaluations (company_id);
    drop trigger if exists trainee_evaluations_societe on public.trainee_evaluations;
    create trigger trainee_evaluations_societe before insert or update of session_id on public.trainee_evaluations
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- evaluations_cold (parent sessions.session_id)
do $$
begin
  if to_regclass('public.evaluations_cold') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'evaluations_cold' and column_name = 'company_id') then
      alter table public.evaluations_cold add column company_id uuid not null default app.company_default();
    else
      update public.evaluations_cold set company_id = app.company_default() where company_id is null;
      alter table public.evaluations_cold alter column company_id set default app.company_default();
      alter table public.evaluations_cold alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'evaluations_cold_company_fk') then
      alter table public.evaluations_cold add constraint evaluations_cold_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists evaluations_cold_company_idx on public.evaluations_cold (company_id);
    drop trigger if exists evaluations_cold_societe on public.evaluations_cold;
    create trigger evaluations_cold_societe before insert or update of session_id on public.evaluations_cold
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- trainer_evaluations (parent sessions.session_id)
do $$
begin
  if to_regclass('public.trainer_evaluations') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainer_evaluations' and column_name = 'company_id') then
      alter table public.trainer_evaluations add column company_id uuid not null default app.company_default();
    else
      update public.trainer_evaluations set company_id = app.company_default() where company_id is null;
      alter table public.trainer_evaluations alter column company_id set default app.company_default();
      alter table public.trainer_evaluations alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'trainer_evaluations_company_fk') then
      alter table public.trainer_evaluations add constraint trainer_evaluations_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists trainer_evaluations_company_idx on public.trainer_evaluations (company_id);
    drop trigger if exists trainer_evaluations_societe on public.trainer_evaluations;
    create trigger trainer_evaluations_societe before insert or update of session_id on public.trainer_evaluations
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- trainee_info_sheets (parent sessions.session_id)
do $$
begin
  if to_regclass('public.trainee_info_sheets') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainee_info_sheets' and column_name = 'company_id') then
      alter table public.trainee_info_sheets add column company_id uuid not null default app.company_default();
    else
      update public.trainee_info_sheets set company_id = app.company_default() where company_id is null;
      alter table public.trainee_info_sheets alter column company_id set default app.company_default();
      alter table public.trainee_info_sheets alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'trainee_info_sheets_company_fk') then
      alter table public.trainee_info_sheets add constraint trainee_info_sheets_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists trainee_info_sheets_company_idx on public.trainee_info_sheets (company_id);
    drop trigger if exists trainee_info_sheets_societe on public.trainee_info_sheets;
    create trigger trainee_info_sheets_societe before insert or update of session_id on public.trainee_info_sheets
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- trainee_objectives (parent sessions.session_id)
do $$
begin
  if to_regclass('public.trainee_objectives') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainee_objectives' and column_name = 'company_id') then
      alter table public.trainee_objectives add column company_id uuid not null default app.company_default();
    else
      update public.trainee_objectives set company_id = app.company_default() where company_id is null;
      alter table public.trainee_objectives alter column company_id set default app.company_default();
      alter table public.trainee_objectives alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'trainee_objectives_company_fk') then
      alter table public.trainee_objectives add constraint trainee_objectives_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists trainee_objectives_company_idx on public.trainee_objectives (company_id);
    drop trigger if exists trainee_objectives_societe on public.trainee_objectives;
    create trigger trainee_objectives_societe before insert or update of session_id on public.trainee_objectives
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- trainee_positioning_tests (parent sessions.session_id)
do $$
begin
  if to_regclass('public.trainee_positioning_tests') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainee_positioning_tests' and column_name = 'company_id') then
      alter table public.trainee_positioning_tests add column company_id uuid not null default app.company_default();
    else
      update public.trainee_positioning_tests set company_id = app.company_default() where company_id is null;
      alter table public.trainee_positioning_tests alter column company_id set default app.company_default();
      alter table public.trainee_positioning_tests alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'trainee_positioning_tests_company_fk') then
      alter table public.trainee_positioning_tests add constraint trainee_positioning_tests_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists trainee_positioning_tests_company_idx on public.trainee_positioning_tests (company_id);
    drop trigger if exists trainee_positioning_tests_societe on public.trainee_positioning_tests;
    create trigger trainee_positioning_tests_societe before insert or update of session_id on public.trainee_positioning_tests
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- positioning_results (parent sessions.session_id)
do $$
begin
  if to_regclass('public.positioning_results') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'positioning_results' and column_name = 'company_id') then
      alter table public.positioning_results add column company_id uuid not null default app.company_default();
    else
      update public.positioning_results set company_id = app.company_default() where company_id is null;
      alter table public.positioning_results alter column company_id set default app.company_default();
      alter table public.positioning_results alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'positioning_results_company_fk') then
      alter table public.positioning_results add constraint positioning_results_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists positioning_results_company_idx on public.positioning_results (company_id);
    drop trigger if exists positioning_results_societe on public.positioning_results;
    create trigger positioning_results_societe before insert or update of session_id on public.positioning_results
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- quiz_attempts (parent sessions.session_id)
do $$
begin
  if to_regclass('public.quiz_attempts') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quiz_attempts' and column_name = 'company_id') then
      alter table public.quiz_attempts add column company_id uuid not null default app.company_default();
    else
      update public.quiz_attempts set company_id = app.company_default() where company_id is null;
      alter table public.quiz_attempts alter column company_id set default app.company_default();
      alter table public.quiz_attempts alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'quiz_attempts_company_fk') then
      alter table public.quiz_attempts add constraint quiz_attempts_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists quiz_attempts_company_idx on public.quiz_attempts (company_id);
    drop trigger if exists quiz_attempts_societe on public.quiz_attempts;
    create trigger quiz_attempts_societe before insert or update of session_id on public.quiz_attempts
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- sst_certifications (parent sessions.session_id)
do $$
begin
  if to_regclass('public.sst_certifications') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sst_certifications' and column_name = 'company_id') then
      alter table public.sst_certifications add column company_id uuid not null default app.company_default();
    else
      update public.sst_certifications set company_id = app.company_default() where company_id is null;
      alter table public.sst_certifications alter column company_id set default app.company_default();
      alter table public.sst_certifications alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'sst_certifications_company_fk') then
      alter table public.sst_certifications add constraint sst_certifications_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists sst_certifications_company_idx on public.sst_certifications (company_id);
    drop trigger if exists sst_certifications_societe on public.sst_certifications;
    create trigger sst_certifications_societe before insert or update of session_id on public.sst_certifications
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- formative_evaluations (parent sessions.session_id)
do $$
begin
  if to_regclass('public.formative_evaluations') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'formative_evaluations' and column_name = 'company_id') then
      alter table public.formative_evaluations add column company_id uuid not null default app.company_default();
    else
      update public.formative_evaluations set company_id = app.company_default() where company_id is null;
      alter table public.formative_evaluations alter column company_id set default app.company_default();
      alter table public.formative_evaluations alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'formative_evaluations_company_fk') then
      alter table public.formative_evaluations add constraint formative_evaluations_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists formative_evaluations_company_idx on public.formative_evaluations (company_id);
    drop trigger if exists formative_evaluations_societe on public.formative_evaluations;
    create trigger formative_evaluations_societe before insert or update of session_id on public.formative_evaluations
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- formative_sheets (parent sessions.session_id)
do $$
begin
  if to_regclass('public.formative_sheets') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'formative_sheets' and column_name = 'company_id') then
      alter table public.formative_sheets add column company_id uuid not null default app.company_default();
    else
      update public.formative_sheets set company_id = app.company_default() where company_id is null;
      alter table public.formative_sheets alter column company_id set default app.company_default();
      alter table public.formative_sheets alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'formative_sheets_company_fk') then
      alter table public.formative_sheets add constraint formative_sheets_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists formative_sheets_company_idx on public.formative_sheets (company_id);
    drop trigger if exists formative_sheets_societe on public.formative_sheets;
    create trigger formative_sheets_societe before insert or update of session_id on public.formative_sheets
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- course_document_downloads (parent sessions.session_id)
do $$
begin
  if to_regclass('public.course_document_downloads') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'course_document_downloads' and column_name = 'company_id') then
      alter table public.course_document_downloads add column company_id uuid not null default app.company_default();
    else
      update public.course_document_downloads set company_id = app.company_default() where company_id is null;
      alter table public.course_document_downloads alter column company_id set default app.company_default();
      alter table public.course_document_downloads alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'course_document_downloads_company_fk') then
      alter table public.course_document_downloads add constraint course_document_downloads_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists course_document_downloads_company_idx on public.course_document_downloads (company_id);
    drop trigger if exists course_document_downloads_societe on public.course_document_downloads;
    create trigger course_document_downloads_societe before insert or update of session_id on public.course_document_downloads
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- pp_lignes (parent sessions.session_id)
do $$
begin
  if to_regclass('public.pp_lignes') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pp_lignes' and column_name = 'company_id') then
      alter table public.pp_lignes add column company_id uuid not null default app.company_default();
    else
      update public.pp_lignes set company_id = app.company_default() where company_id is null;
      alter table public.pp_lignes alter column company_id set default app.company_default();
      alter table public.pp_lignes alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'pp_lignes_company_fk') then
      alter table public.pp_lignes add constraint pp_lignes_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists pp_lignes_company_idx on public.pp_lignes (company_id);
    drop trigger if exists pp_lignes_societe on public.pp_lignes;
    create trigger pp_lignes_societe before insert or update of session_id on public.pp_lignes
      for each row execute function app.societe_du_parent('sessions', 'session_id');
  end if;
end
$$;

-- trainee_documents (parent trainees.trainee_id)
do $$
begin
  if to_regclass('public.trainee_documents') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainee_documents' and column_name = 'company_id') then
      alter table public.trainee_documents add column company_id uuid not null default app.company_default();
    else
      update public.trainee_documents set company_id = app.company_default() where company_id is null;
      alter table public.trainee_documents alter column company_id set default app.company_default();
      alter table public.trainee_documents alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'trainee_documents_company_fk') then
      alter table public.trainee_documents add constraint trainee_documents_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists trainee_documents_company_idx on public.trainee_documents (company_id);
    drop trigger if exists trainee_documents_societe on public.trainee_documents;
    create trigger trainee_documents_societe before insert or update of trainee_id on public.trainee_documents
      for each row execute function app.societe_du_parent('trainees', 'trainee_id');
  end if;
end
$$;

-- trainee_disability (parent trainees.trainee_id)
do $$
begin
  if to_regclass('public.trainee_disability') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainee_disability' and column_name = 'company_id') then
      alter table public.trainee_disability add column company_id uuid not null default app.company_default();
    else
      update public.trainee_disability set company_id = app.company_default() where company_id is null;
      alter table public.trainee_disability alter column company_id set default app.company_default();
      alter table public.trainee_disability alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'trainee_disability_company_fk') then
      alter table public.trainee_disability add constraint trainee_disability_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists trainee_disability_company_idx on public.trainee_disability (company_id);
    drop trigger if exists trainee_disability_societe on public.trainee_disability;
    create trigger trainee_disability_societe before insert or update of trainee_id on public.trainee_disability
      for each row execute function app.societe_du_parent('trainees', 'trainee_id');
  end if;
end
$$;

-- trainee_ssn (parent trainees.trainee_id)
do $$
begin
  if to_regclass('public.trainee_ssn') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainee_ssn' and column_name = 'company_id') then
      alter table public.trainee_ssn add column company_id uuid not null default app.company_default();
    else
      update public.trainee_ssn set company_id = app.company_default() where company_id is null;
      alter table public.trainee_ssn alter column company_id set default app.company_default();
      alter table public.trainee_ssn alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'trainee_ssn_company_fk') then
      alter table public.trainee_ssn add constraint trainee_ssn_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists trainee_ssn_company_idx on public.trainee_ssn (company_id);
    drop trigger if exists trainee_ssn_societe on public.trainee_ssn;
    create trigger trainee_ssn_societe before insert or update of trainee_id on public.trainee_ssn
      for each row execute function app.societe_du_parent('trainees', 'trainee_id');
  end if;
end
$$;

-- pp_nir (parent trainees.trainee_id)
do $$
begin
  if to_regclass('public.pp_nir') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pp_nir' and column_name = 'company_id') then
      alter table public.pp_nir add column company_id uuid not null default app.company_default();
    else
      update public.pp_nir set company_id = app.company_default() where company_id is null;
      alter table public.pp_nir alter column company_id set default app.company_default();
      alter table public.pp_nir alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'pp_nir_company_fk') then
      alter table public.pp_nir add constraint pp_nir_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists pp_nir_company_idx on public.pp_nir (company_id);
    drop trigger if exists pp_nir_societe on public.pp_nir;
    create trigger pp_nir_societe before insert or update of trainee_id on public.pp_nir
      for each row execute function app.societe_du_parent('trainees', 'trainee_id');
  end if;
end
$$;

-- itv_visit_items (parent itv_visits.visit_id)
do $$
begin
  if to_regclass('public.itv_visit_items') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'itv_visit_items' and column_name = 'company_id') then
      alter table public.itv_visit_items add column company_id uuid not null default app.company_default();
    else
      update public.itv_visit_items set company_id = app.company_default() where company_id is null;
      alter table public.itv_visit_items alter column company_id set default app.company_default();
      alter table public.itv_visit_items alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'itv_visit_items_company_fk') then
      alter table public.itv_visit_items add constraint itv_visit_items_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists itv_visit_items_company_idx on public.itv_visit_items (company_id);
    drop trigger if exists itv_visit_items_societe on public.itv_visit_items;
    create trigger itv_visit_items_societe before insert or update of visit_id on public.itv_visit_items
      for each row execute function app.societe_du_parent('itv_visits', 'visit_id');
  end if;
end
$$;

-- itv_visit_parts (parent itv_visits.visit_id)
do $$
begin
  if to_regclass('public.itv_visit_parts') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'itv_visit_parts' and column_name = 'company_id') then
      alter table public.itv_visit_parts add column company_id uuid not null default app.company_default();
    else
      update public.itv_visit_parts set company_id = app.company_default() where company_id is null;
      alter table public.itv_visit_parts alter column company_id set default app.company_default();
      alter table public.itv_visit_parts alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'itv_visit_parts_company_fk') then
      alter table public.itv_visit_parts add constraint itv_visit_parts_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists itv_visit_parts_company_idx on public.itv_visit_parts (company_id);
    drop trigger if exists itv_visit_parts_societe on public.itv_visit_parts;
    create trigger itv_visit_parts_societe before insert or update of visit_id on public.itv_visit_parts
      for each row execute function app.societe_du_parent('itv_visits', 'visit_id');
  end if;
end
$$;

-- duerp_actions (parent duerp_projects.project_id)
do $$
begin
  if to_regclass('public.duerp_actions') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'duerp_actions' and column_name = 'company_id') then
      alter table public.duerp_actions add column company_id uuid not null default app.company_default();
    else
      update public.duerp_actions set company_id = app.company_default() where company_id is null;
      alter table public.duerp_actions alter column company_id set default app.company_default();
      alter table public.duerp_actions alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'duerp_actions_company_fk') then
      alter table public.duerp_actions add constraint duerp_actions_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists duerp_actions_company_idx on public.duerp_actions (company_id);
    drop trigger if exists duerp_actions_societe on public.duerp_actions;
    create trigger duerp_actions_societe before insert or update of project_id on public.duerp_actions
      for each row execute function app.societe_du_parent('duerp_projects', 'project_id');
  end if;
end
$$;

-- duerp_risks (parent duerp_projects.project_id)
do $$
begin
  if to_regclass('public.duerp_risks') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'duerp_risks' and column_name = 'company_id') then
      alter table public.duerp_risks add column company_id uuid not null default app.company_default();
    else
      update public.duerp_risks set company_id = app.company_default() where company_id is null;
      alter table public.duerp_risks alter column company_id set default app.company_default();
      alter table public.duerp_risks alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'duerp_risks_company_fk') then
      alter table public.duerp_risks add constraint duerp_risks_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists duerp_risks_company_idx on public.duerp_risks (company_id);
    drop trigger if exists duerp_risks_societe on public.duerp_risks;
    create trigger duerp_risks_societe before insert or update of project_id on public.duerp_risks
      for each row execute function app.societe_du_parent('duerp_projects', 'project_id');
  end if;
end
$$;

-- duerp_units (parent duerp_projects.project_id)
do $$
begin
  if to_regclass('public.duerp_units') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'duerp_units' and column_name = 'company_id') then
      alter table public.duerp_units add column company_id uuid not null default app.company_default();
    else
      update public.duerp_units set company_id = app.company_default() where company_id is null;
      alter table public.duerp_units alter column company_id set default app.company_default();
      alter table public.duerp_units alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'duerp_units_company_fk') then
      alter table public.duerp_units add constraint duerp_units_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists duerp_units_company_idx on public.duerp_units (company_id);
    drop trigger if exists duerp_units_societe on public.duerp_units;
    create trigger duerp_units_societe before insert or update of project_id on public.duerp_units
      for each row execute function app.societe_du_parent('duerp_projects', 'project_id');
  end if;
end
$$;

-- duerp_equipements (parent duerp_projects.project_id)
do $$
begin
  if to_regclass('public.duerp_equipements') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'duerp_equipements' and column_name = 'company_id') then
      alter table public.duerp_equipements add column company_id uuid not null default app.company_default();
    else
      update public.duerp_equipements set company_id = app.company_default() where company_id is null;
      alter table public.duerp_equipements alter column company_id set default app.company_default();
      alter table public.duerp_equipements alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'duerp_equipements_company_fk') then
      alter table public.duerp_equipements add constraint duerp_equipements_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists duerp_equipements_company_idx on public.duerp_equipements (company_id);
    drop trigger if exists duerp_equipements_societe on public.duerp_equipements;
    create trigger duerp_equipements_societe before insert or update of project_id on public.duerp_equipements
      for each row execute function app.societe_du_parent('duerp_projects', 'project_id');
  end if;
end
$$;

-- duerp_habilitations (parent duerp_projects.project_id)
do $$
begin
  if to_regclass('public.duerp_habilitations') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'duerp_habilitations' and column_name = 'company_id') then
      alter table public.duerp_habilitations add column company_id uuid not null default app.company_default();
    else
      update public.duerp_habilitations set company_id = app.company_default() where company_id is null;
      alter table public.duerp_habilitations alter column company_id set default app.company_default();
      alter table public.duerp_habilitations alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'duerp_habilitations_company_fk') then
      alter table public.duerp_habilitations add constraint duerp_habilitations_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists duerp_habilitations_company_idx on public.duerp_habilitations (company_id);
    drop trigger if exists duerp_habilitations_societe on public.duerp_habilitations;
    create trigger duerp_habilitations_societe before insert or update of project_id on public.duerp_habilitations
      for each row execute function app.societe_du_parent('duerp_projects', 'project_id');
  end if;
end
$$;

-- duerp_verifications (parent duerp_projects.project_id)
do $$
begin
  if to_regclass('public.duerp_verifications') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'duerp_verifications' and column_name = 'company_id') then
      alter table public.duerp_verifications add column company_id uuid not null default app.company_default();
    else
      update public.duerp_verifications set company_id = app.company_default() where company_id is null;
      alter table public.duerp_verifications alter column company_id set default app.company_default();
      alter table public.duerp_verifications alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'duerp_verifications_company_fk') then
      alter table public.duerp_verifications add constraint duerp_verifications_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists duerp_verifications_company_idx on public.duerp_verifications (company_id);
    drop trigger if exists duerp_verifications_societe on public.duerp_verifications;
    create trigger duerp_verifications_societe before insert or update of project_id on public.duerp_verifications
      for each row execute function app.societe_du_parent('duerp_projects', 'project_id');
  end if;
end
$$;

-- budget_receipts (parent budget_transactions.transaction_id)
do $$
begin
  if to_regclass('public.budget_receipts') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'budget_receipts' and column_name = 'company_id') then
      alter table public.budget_receipts add column company_id uuid not null default app.company_default();
    else
      update public.budget_receipts set company_id = app.company_default() where company_id is null;
      alter table public.budget_receipts alter column company_id set default app.company_default();
      alter table public.budget_receipts alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'budget_receipts_company_fk') then
      alter table public.budget_receipts add constraint budget_receipts_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists budget_receipts_company_idx on public.budget_receipts (company_id);
    drop trigger if exists budget_receipts_societe on public.budget_receipts;
    create trigger budget_receipts_societe before insert or update of transaction_id on public.budget_receipts
      for each row execute function app.societe_du_parent('budget_transactions', 'transaction_id');
  end if;
end
$$;

-- budget_transaction_invoices (parent budget_transactions.transaction_id)
do $$
begin
  if to_regclass('public.budget_transaction_invoices') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'budget_transaction_invoices' and column_name = 'company_id') then
      alter table public.budget_transaction_invoices add column company_id uuid not null default app.company_default();
    else
      update public.budget_transaction_invoices set company_id = app.company_default() where company_id is null;
      alter table public.budget_transaction_invoices alter column company_id set default app.company_default();
      alter table public.budget_transaction_invoices alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'budget_transaction_invoices_company_fk') then
      alter table public.budget_transaction_invoices add constraint budget_transaction_invoices_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists budget_transaction_invoices_company_idx on public.budget_transaction_invoices (company_id);
    drop trigger if exists budget_transaction_invoices_societe on public.budget_transaction_invoices;
    create trigger budget_transaction_invoices_societe before insert or update of transaction_id on public.budget_transaction_invoices
      for each row execute function app.societe_du_parent('budget_transactions', 'transaction_id');
  end if;
end
$$;

-- mailing_sends (parent mailing_campaigns.campaign_id)
do $$
begin
  if to_regclass('public.mailing_sends') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mailing_sends' and column_name = 'company_id') then
      alter table public.mailing_sends add column company_id uuid not null default app.company_default();
    else
      update public.mailing_sends set company_id = app.company_default() where company_id is null;
      alter table public.mailing_sends alter column company_id set default app.company_default();
      alter table public.mailing_sends alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'mailing_sends_company_fk') then
      alter table public.mailing_sends add constraint mailing_sends_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists mailing_sends_company_idx on public.mailing_sends (company_id);
    drop trigger if exists mailing_sends_societe on public.mailing_sends;
    create trigger mailing_sends_societe before insert or update of campaign_id on public.mailing_sends
      for each row execute function app.societe_du_parent('mailing_campaigns', 'campaign_id');
  end if;
end
$$;

-- process_steps (parent processes.process_id)
do $$
begin
  if to_regclass('public.process_steps') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'process_steps' and column_name = 'company_id') then
      alter table public.process_steps add column company_id uuid not null default app.company_default();
    else
      update public.process_steps set company_id = app.company_default() where company_id is null;
      alter table public.process_steps alter column company_id set default app.company_default();
      alter table public.process_steps alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'process_steps_company_fk') then
      alter table public.process_steps add constraint process_steps_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists process_steps_company_idx on public.process_steps (company_id);
    drop trigger if exists process_steps_societe on public.process_steps;
    create trigger process_steps_societe before insert or update of process_id on public.process_steps
      for each row execute function app.societe_du_parent('processes', 'process_id');
  end if;
end
$$;

-- process_versions (parent processes.process_id)
do $$
begin
  if to_regclass('public.process_versions') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'process_versions' and column_name = 'company_id') then
      alter table public.process_versions add column company_id uuid not null default app.company_default();
    else
      update public.process_versions set company_id = app.company_default() where company_id is null;
      alter table public.process_versions alter column company_id set default app.company_default();
      alter table public.process_versions alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'process_versions_company_fk') then
      alter table public.process_versions add constraint process_versions_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists process_versions_company_idx on public.process_versions (company_id);
    drop trigger if exists process_versions_societe on public.process_versions;
    create trigger process_versions_societe before insert or update of process_id on public.process_versions
      for each row execute function app.societe_du_parent('processes', 'process_id');
  end if;
end
$$;

-- process_connections (parent processes.process_id)
do $$
begin
  if to_regclass('public.process_connections') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'process_connections' and column_name = 'company_id') then
      alter table public.process_connections add column company_id uuid not null default app.company_default();
    else
      update public.process_connections set company_id = app.company_default() where company_id is null;
      alter table public.process_connections alter column company_id set default app.company_default();
      alter table public.process_connections alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'process_connections_company_fk') then
      alter table public.process_connections add constraint process_connections_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists process_connections_company_idx on public.process_connections (company_id);
    drop trigger if exists process_connections_societe on public.process_connections;
    create trigger process_connections_societe before insert or update of process_id on public.process_connections
      for each row execute function app.societe_du_parent('processes', 'process_id');
  end if;
end
$$;

-- ===== Classe C : partageables =====

-- clients
do $$
begin
  if to_regclass('public.clients') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'company_id') then
      alter table public.clients add column company_id uuid not null default app.company_default();
    else
      update public.clients set company_id = app.company_default() where company_id is null;
      alter table public.clients alter column company_id set default app.company_default();
      alter table public.clients alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'clients_company_fk') then
      alter table public.clients add constraint clients_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists clients_company_idx on public.clients (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'company_ids') then
      alter table public.clients add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists clients_company_ids_idx on public.clients using gin (company_ids);
    drop trigger if exists clients_societes on public.clients;
    create trigger clients_societes before insert or update of company_id, company_ids on public.clients
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- client_contacts
do $$
begin
  if to_regclass('public.client_contacts') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_contacts' and column_name = 'company_id') then
      alter table public.client_contacts add column company_id uuid not null default app.company_default();
    else
      update public.client_contacts set company_id = app.company_default() where company_id is null;
      alter table public.client_contacts alter column company_id set default app.company_default();
      alter table public.client_contacts alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'client_contacts_company_fk') then
      alter table public.client_contacts add constraint client_contacts_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists client_contacts_company_idx on public.client_contacts (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_contacts' and column_name = 'company_ids') then
      alter table public.client_contacts add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists client_contacts_company_ids_idx on public.client_contacts using gin (company_ids);
    drop trigger if exists client_contacts_societes on public.client_contacts;
    create trigger client_contacts_societes before insert or update of company_id, company_ids on public.client_contacts
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- sites
do $$
begin
  if to_regclass('public.sites') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sites' and column_name = 'company_id') then
      alter table public.sites add column company_id uuid not null default app.company_default();
    else
      update public.sites set company_id = app.company_default() where company_id is null;
      alter table public.sites alter column company_id set default app.company_default();
      alter table public.sites alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'sites_company_fk') then
      alter table public.sites add constraint sites_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists sites_company_idx on public.sites (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sites' and column_name = 'company_ids') then
      alter table public.sites add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists sites_company_ids_idx on public.sites using gin (company_ids);
    drop trigger if exists sites_societes on public.sites;
    create trigger sites_societes before insert or update of company_id, company_ids on public.sites
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- trainers
do $$
begin
  if to_regclass('public.trainers') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainers' and column_name = 'company_id') then
      alter table public.trainers add column company_id uuid not null default app.company_default();
    else
      update public.trainers set company_id = app.company_default() where company_id is null;
      alter table public.trainers alter column company_id set default app.company_default();
      alter table public.trainers alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'trainers_company_fk') then
      alter table public.trainers add constraint trainers_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists trainers_company_idx on public.trainers (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainers' and column_name = 'company_ids') then
      alter table public.trainers add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists trainers_company_ids_idx on public.trainers using gin (company_ids);
    drop trigger if exists trainers_societes on public.trainers;
    create trigger trainers_societes before insert or update of company_id, company_ids on public.trainers
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- trainer_certificates
do $$
begin
  if to_regclass('public.trainer_certificates') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainer_certificates' and column_name = 'company_id') then
      alter table public.trainer_certificates add column company_id uuid not null default app.company_default();
    else
      update public.trainer_certificates set company_id = app.company_default() where company_id is null;
      alter table public.trainer_certificates alter column company_id set default app.company_default();
      alter table public.trainer_certificates alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'trainer_certificates_company_fk') then
      alter table public.trainer_certificates add constraint trainer_certificates_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists trainer_certificates_company_idx on public.trainer_certificates (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainer_certificates' and column_name = 'company_ids') then
      alter table public.trainer_certificates add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists trainer_certificates_company_ids_idx on public.trainer_certificates using gin (company_ids);
    drop trigger if exists trainer_certificates_societes on public.trainer_certificates;
    create trigger trainer_certificates_societes before insert or update of company_id, company_ids on public.trainer_certificates
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- trainer_interviews
do $$
begin
  if to_regclass('public.trainer_interviews') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainer_interviews' and column_name = 'company_id') then
      alter table public.trainer_interviews add column company_id uuid not null default app.company_default();
    else
      update public.trainer_interviews set company_id = app.company_default() where company_id is null;
      alter table public.trainer_interviews alter column company_id set default app.company_default();
      alter table public.trainer_interviews alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'trainer_interviews_company_fk') then
      alter table public.trainer_interviews add constraint trainer_interviews_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists trainer_interviews_company_idx on public.trainer_interviews (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainer_interviews' and column_name = 'company_ids') then
      alter table public.trainer_interviews add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists trainer_interviews_company_ids_idx on public.trainer_interviews using gin (company_ids);
    drop trigger if exists trainer_interviews_societes on public.trainer_interviews;
    create trigger trainer_interviews_societes before insert or update of company_id, company_ids on public.trainer_interviews
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- trainer_qualifications
do $$
begin
  if to_regclass('public.trainer_qualifications') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainer_qualifications' and column_name = 'company_id') then
      alter table public.trainer_qualifications add column company_id uuid not null default app.company_default();
    else
      update public.trainer_qualifications set company_id = app.company_default() where company_id is null;
      alter table public.trainer_qualifications alter column company_id set default app.company_default();
      alter table public.trainer_qualifications alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'trainer_qualifications_company_fk') then
      alter table public.trainer_qualifications add constraint trainer_qualifications_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists trainer_qualifications_company_idx on public.trainer_qualifications (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainer_qualifications' and column_name = 'company_ids') then
      alter table public.trainer_qualifications add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists trainer_qualifications_company_ids_idx on public.trainer_qualifications using gin (company_ids);
    drop trigger if exists trainer_qualifications_societes on public.trainer_qualifications;
    create trigger trainer_qualifications_societes before insert or update of company_id, company_ids on public.trainer_qualifications
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- trainer_trainings
do $$
begin
  if to_regclass('public.trainer_trainings') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainer_trainings' and column_name = 'company_id') then
      alter table public.trainer_trainings add column company_id uuid not null default app.company_default();
    else
      update public.trainer_trainings set company_id = app.company_default() where company_id is null;
      alter table public.trainer_trainings alter column company_id set default app.company_default();
      alter table public.trainer_trainings alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'trainer_trainings_company_fk') then
      alter table public.trainer_trainings add constraint trainer_trainings_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists trainer_trainings_company_idx on public.trainer_trainings (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trainer_trainings' and column_name = 'company_ids') then
      alter table public.trainer_trainings add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists trainer_trainings_company_ids_idx on public.trainer_trainings using gin (company_ids);
    drop trigger if exists trainer_trainings_societes on public.trainer_trainings;
    create trigger trainer_trainings_societes before insert or update of company_id, company_ids on public.trainer_trainings
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- courses
do $$
begin
  if to_regclass('public.courses') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'courses' and column_name = 'company_id') then
      alter table public.courses add column company_id uuid not null default app.company_default();
    else
      update public.courses set company_id = app.company_default() where company_id is null;
      alter table public.courses alter column company_id set default app.company_default();
      alter table public.courses alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'courses_company_fk') then
      alter table public.courses add constraint courses_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists courses_company_idx on public.courses (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'courses' and column_name = 'company_ids') then
      alter table public.courses add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists courses_company_ids_idx on public.courses using gin (company_ids);
    drop trigger if exists courses_societes on public.courses;
    create trigger courses_societes before insert or update of company_id, company_ids on public.courses
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- course_documents
do $$
begin
  if to_regclass('public.course_documents') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'course_documents' and column_name = 'company_id') then
      alter table public.course_documents add column company_id uuid not null default app.company_default();
    else
      update public.course_documents set company_id = app.company_default() where company_id is null;
      alter table public.course_documents alter column company_id set default app.company_default();
      alter table public.course_documents alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'course_documents_company_fk') then
      alter table public.course_documents add constraint course_documents_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists course_documents_company_idx on public.course_documents (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'course_documents' and column_name = 'company_ids') then
      alter table public.course_documents add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists course_documents_company_ids_idx on public.course_documents using gin (company_ids);
    drop trigger if exists course_documents_societes on public.course_documents;
    create trigger course_documents_societes before insert or update of company_id, company_ids on public.course_documents
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- course_equipment
do $$
begin
  if to_regclass('public.course_equipment') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'course_equipment' and column_name = 'company_id') then
      alter table public.course_equipment add column company_id uuid not null default app.company_default();
    else
      update public.course_equipment set company_id = app.company_default() where company_id is null;
      alter table public.course_equipment alter column company_id set default app.company_default();
      alter table public.course_equipment alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'course_equipment_company_fk') then
      alter table public.course_equipment add constraint course_equipment_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists course_equipment_company_idx on public.course_equipment (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'course_equipment' and column_name = 'company_ids') then
      alter table public.course_equipment add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists course_equipment_company_ids_idx on public.course_equipment using gin (company_ids);
    drop trigger if exists course_equipment_societes on public.course_equipment;
    create trigger course_equipment_societes before insert or update of company_id, company_ids on public.course_equipment
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- course_questions
do $$
begin
  if to_regclass('public.course_questions') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'course_questions' and column_name = 'company_id') then
      alter table public.course_questions add column company_id uuid not null default app.company_default();
    else
      update public.course_questions set company_id = app.company_default() where company_id is null;
      alter table public.course_questions alter column company_id set default app.company_default();
      alter table public.course_questions alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'course_questions_company_fk') then
      alter table public.course_questions add constraint course_questions_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists course_questions_company_idx on public.course_questions (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'course_questions' and column_name = 'company_ids') then
      alter table public.course_questions add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists course_questions_company_ids_idx on public.course_questions using gin (company_ids);
    drop trigger if exists course_questions_societes on public.course_questions;
    create trigger course_questions_societes before insert or update of company_id, company_ids on public.course_questions
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- course_sequences
do $$
begin
  if to_regclass('public.course_sequences') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'course_sequences' and column_name = 'company_id') then
      alter table public.course_sequences add column company_id uuid not null default app.company_default();
    else
      update public.course_sequences set company_id = app.company_default() where company_id is null;
      alter table public.course_sequences alter column company_id set default app.company_default();
      alter table public.course_sequences alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'course_sequences_company_fk') then
      alter table public.course_sequences add constraint course_sequences_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists course_sequences_company_idx on public.course_sequences (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'course_sequences' and column_name = 'company_ids') then
      alter table public.course_sequences add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists course_sequences_company_ids_idx on public.course_sequences using gin (company_ids);
    drop trigger if exists course_sequences_societes on public.course_sequences;
    create trigger course_sequences_societes before insert or update of company_id, company_ids on public.course_sequences
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- training_themes
do $$
begin
  if to_regclass('public.training_themes') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'training_themes' and column_name = 'company_id') then
      alter table public.training_themes add column company_id uuid not null default app.company_default();
    else
      update public.training_themes set company_id = app.company_default() where company_id is null;
      alter table public.training_themes alter column company_id set default app.company_default();
      alter table public.training_themes alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'training_themes_company_fk') then
      alter table public.training_themes add constraint training_themes_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists training_themes_company_idx on public.training_themes (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'training_themes' and column_name = 'company_ids') then
      alter table public.training_themes add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists training_themes_company_ids_idx on public.training_themes using gin (company_ids);
    drop trigger if exists training_themes_societes on public.training_themes;
    create trigger training_themes_societes before insert or update of company_id, company_ids on public.training_themes
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- theme_questions
do $$
begin
  if to_regclass('public.theme_questions') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'theme_questions' and column_name = 'company_id') then
      alter table public.theme_questions add column company_id uuid not null default app.company_default();
    else
      update public.theme_questions set company_id = app.company_default() where company_id is null;
      alter table public.theme_questions alter column company_id set default app.company_default();
      alter table public.theme_questions alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'theme_questions_company_fk') then
      alter table public.theme_questions add constraint theme_questions_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists theme_questions_company_idx on public.theme_questions (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'theme_questions' and column_name = 'company_ids') then
      alter table public.theme_questions add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists theme_questions_company_ids_idx on public.theme_questions using gin (company_ids);
    drop trigger if exists theme_questions_societes on public.theme_questions;
    create trigger theme_questions_societes before insert or update of company_id, company_ids on public.theme_questions
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- positioning_questions_ref
do $$
begin
  if to_regclass('public.positioning_questions_ref') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'positioning_questions_ref' and column_name = 'company_id') then
      alter table public.positioning_questions_ref add column company_id uuid not null default app.company_default();
    else
      update public.positioning_questions_ref set company_id = app.company_default() where company_id is null;
      alter table public.positioning_questions_ref alter column company_id set default app.company_default();
      alter table public.positioning_questions_ref alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'positioning_questions_ref_company_fk') then
      alter table public.positioning_questions_ref add constraint positioning_questions_ref_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists positioning_questions_ref_company_idx on public.positioning_questions_ref (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'positioning_questions_ref' and column_name = 'company_ids') then
      alter table public.positioning_questions_ref add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists positioning_questions_ref_company_ids_idx on public.positioning_questions_ref using gin (company_ids);
    drop trigger if exists positioning_questions_ref_societes on public.positioning_questions_ref;
    create trigger positioning_questions_ref_societes before insert or update of company_id, company_ids on public.positioning_questions_ref
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- positioning_themes
do $$
begin
  if to_regclass('public.positioning_themes') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'positioning_themes' and column_name = 'company_id') then
      alter table public.positioning_themes add column company_id uuid not null default app.company_default();
    else
      update public.positioning_themes set company_id = app.company_default() where company_id is null;
      alter table public.positioning_themes alter column company_id set default app.company_default();
      alter table public.positioning_themes alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'positioning_themes_company_fk') then
      alter table public.positioning_themes add constraint positioning_themes_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists positioning_themes_company_idx on public.positioning_themes (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'positioning_themes' and column_name = 'company_ids') then
      alter table public.positioning_themes add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists positioning_themes_company_ids_idx on public.positioning_themes using gin (company_ids);
    drop trigger if exists positioning_themes_societes on public.positioning_themes;
    create trigger positioning_themes_societes before insert or update of company_id, company_ids on public.positioning_themes
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- programme_versions
do $$
begin
  if to_regclass('public.programme_versions') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programme_versions' and column_name = 'company_id') then
      alter table public.programme_versions add column company_id uuid not null default app.company_default();
    else
      update public.programme_versions set company_id = app.company_default() where company_id is null;
      alter table public.programme_versions alter column company_id set default app.company_default();
      alter table public.programme_versions alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'programme_versions_company_fk') then
      alter table public.programme_versions add constraint programme_versions_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists programme_versions_company_idx on public.programme_versions (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programme_versions' and column_name = 'company_ids') then
      alter table public.programme_versions add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists programme_versions_company_ids_idx on public.programme_versions using gin (company_ids);
    drop trigger if exists programme_versions_societes on public.programme_versions;
    create trigger programme_versions_societes before insert or update of company_id, company_ids on public.programme_versions
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- equipment_catalog
do $$
begin
  if to_regclass('public.equipment_catalog') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'equipment_catalog' and column_name = 'company_id') then
      alter table public.equipment_catalog add column company_id uuid not null default app.company_default();
    else
      update public.equipment_catalog set company_id = app.company_default() where company_id is null;
      alter table public.equipment_catalog alter column company_id set default app.company_default();
      alter table public.equipment_catalog alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'equipment_catalog_company_fk') then
      alter table public.equipment_catalog add constraint equipment_catalog_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists equipment_catalog_company_idx on public.equipment_catalog (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'equipment_catalog' and column_name = 'company_ids') then
      alter table public.equipment_catalog add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists equipment_catalog_company_ids_idx on public.equipment_catalog using gin (company_ids);
    drop trigger if exists equipment_catalog_societes on public.equipment_catalog;
    create trigger equipment_catalog_societes before insert or update of company_id, company_ids on public.equipment_catalog
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- itv_equipment_types
do $$
begin
  if to_regclass('public.itv_equipment_types') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'itv_equipment_types' and column_name = 'company_id') then
      alter table public.itv_equipment_types add column company_id uuid not null default app.company_default();
    else
      update public.itv_equipment_types set company_id = app.company_default() where company_id is null;
      alter table public.itv_equipment_types alter column company_id set default app.company_default();
      alter table public.itv_equipment_types alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'itv_equipment_types_company_fk') then
      alter table public.itv_equipment_types add constraint itv_equipment_types_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists itv_equipment_types_company_idx on public.itv_equipment_types (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'itv_equipment_types' and column_name = 'company_ids') then
      alter table public.itv_equipment_types add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists itv_equipment_types_company_ids_idx on public.itv_equipment_types using gin (company_ids);
    drop trigger if exists itv_equipment_types_societes on public.itv_equipment_types;
    create trigger itv_equipment_types_societes before insert or update of company_id, company_ids on public.itv_equipment_types
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- itv_parts
do $$
begin
  if to_regclass('public.itv_parts') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'itv_parts' and column_name = 'company_id') then
      alter table public.itv_parts add column company_id uuid not null default app.company_default();
    else
      update public.itv_parts set company_id = app.company_default() where company_id is null;
      alter table public.itv_parts alter column company_id set default app.company_default();
      alter table public.itv_parts alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'itv_parts_company_fk') then
      alter table public.itv_parts add constraint itv_parts_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists itv_parts_company_idx on public.itv_parts (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'itv_parts' and column_name = 'company_ids') then
      alter table public.itv_parts add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists itv_parts_company_ids_idx on public.itv_parts using gin (company_ids);
    drop trigger if exists itv_parts_societes on public.itv_parts;
    create trigger itv_parts_societes before insert or update of company_id, company_ids on public.itv_parts
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- itv_technicians
do $$
begin
  if to_regclass('public.itv_technicians') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'itv_technicians' and column_name = 'company_id') then
      alter table public.itv_technicians add column company_id uuid not null default app.company_default();
    else
      update public.itv_technicians set company_id = app.company_default() where company_id is null;
      alter table public.itv_technicians alter column company_id set default app.company_default();
      alter table public.itv_technicians alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'itv_technicians_company_fk') then
      alter table public.itv_technicians add constraint itv_technicians_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists itv_technicians_company_idx on public.itv_technicians (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'itv_technicians' and column_name = 'company_ids') then
      alter table public.itv_technicians add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists itv_technicians_company_ids_idx on public.itv_technicians using gin (company_ids);
    drop trigger if exists itv_technicians_societes on public.itv_technicians;
    create trigger itv_technicians_societes before insert or update of company_id, company_ids on public.itv_technicians
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- mailing_templates
do $$
begin
  if to_regclass('public.mailing_templates') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mailing_templates' and column_name = 'company_id') then
      alter table public.mailing_templates add column company_id uuid not null default app.company_default();
    else
      update public.mailing_templates set company_id = app.company_default() where company_id is null;
      alter table public.mailing_templates alter column company_id set default app.company_default();
      alter table public.mailing_templates alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'mailing_templates_company_fk') then
      alter table public.mailing_templates add constraint mailing_templates_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists mailing_templates_company_idx on public.mailing_templates (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mailing_templates' and column_name = 'company_ids') then
      alter table public.mailing_templates add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists mailing_templates_company_ids_idx on public.mailing_templates using gin (company_ids);
    drop trigger if exists mailing_templates_societes on public.mailing_templates;
    create trigger mailing_templates_societes before insert or update of company_id, company_ids on public.mailing_templates
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- call_arguments
do $$
begin
  if to_regclass('public.call_arguments') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'call_arguments' and column_name = 'company_id') then
      alter table public.call_arguments add column company_id uuid not null default app.company_default();
    else
      update public.call_arguments set company_id = app.company_default() where company_id is null;
      alter table public.call_arguments alter column company_id set default app.company_default();
      alter table public.call_arguments alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'call_arguments_company_fk') then
      alter table public.call_arguments add constraint call_arguments_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists call_arguments_company_idx on public.call_arguments (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'call_arguments' and column_name = 'company_ids') then
      alter table public.call_arguments add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists call_arguments_company_ids_idx on public.call_arguments using gin (company_ids);
    drop trigger if exists call_arguments_societes on public.call_arguments;
    create trigger call_arguments_societes before insert or update of company_id, company_ids on public.call_arguments
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- call_objections
do $$
begin
  if to_regclass('public.call_objections') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'call_objections' and column_name = 'company_id') then
      alter table public.call_objections add column company_id uuid not null default app.company_default();
    else
      update public.call_objections set company_id = app.company_default() where company_id is null;
      alter table public.call_objections alter column company_id set default app.company_default();
      alter table public.call_objections alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'call_objections_company_fk') then
      alter table public.call_objections add constraint call_objections_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists call_objections_company_idx on public.call_objections (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'call_objections' and column_name = 'company_ids') then
      alter table public.call_objections add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists call_objections_company_ids_idx on public.call_objections using gin (company_ids);
    drop trigger if exists call_objections_societes on public.call_objections;
    create trigger call_objections_societes before insert or update of company_id, company_ids on public.call_objections
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- quality_documents
do $$
begin
  if to_regclass('public.quality_documents') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quality_documents' and column_name = 'company_id') then
      alter table public.quality_documents add column company_id uuid not null default app.company_default();
    else
      update public.quality_documents set company_id = app.company_default() where company_id is null;
      alter table public.quality_documents alter column company_id set default app.company_default();
      alter table public.quality_documents alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'quality_documents_company_fk') then
      alter table public.quality_documents add constraint quality_documents_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists quality_documents_company_idx on public.quality_documents (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quality_documents' and column_name = 'company_ids') then
      alter table public.quality_documents add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists quality_documents_company_ids_idx on public.quality_documents using gin (company_ids);
    drop trigger if exists quality_documents_societes on public.quality_documents;
    create trigger quality_documents_societes before insert or update of company_id, company_ids on public.quality_documents
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- quality_doc_versions
do $$
begin
  if to_regclass('public.quality_doc_versions') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quality_doc_versions' and column_name = 'company_id') then
      alter table public.quality_doc_versions add column company_id uuid not null default app.company_default();
    else
      update public.quality_doc_versions set company_id = app.company_default() where company_id is null;
      alter table public.quality_doc_versions alter column company_id set default app.company_default();
      alter table public.quality_doc_versions alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'quality_doc_versions_company_fk') then
      alter table public.quality_doc_versions add constraint quality_doc_versions_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists quality_doc_versions_company_idx on public.quality_doc_versions (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quality_doc_versions' and column_name = 'company_ids') then
      alter table public.quality_doc_versions add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists quality_doc_versions_company_ids_idx on public.quality_doc_versions using gin (company_ids);
    drop trigger if exists quality_doc_versions_societes on public.quality_doc_versions;
    create trigger quality_doc_versions_societes before insert or update of company_id, company_ids on public.quality_doc_versions
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- qualiopi_documents
do $$
begin
  if to_regclass('public.qualiopi_documents') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'qualiopi_documents' and column_name = 'company_id') then
      alter table public.qualiopi_documents add column company_id uuid not null default app.company_default();
    else
      update public.qualiopi_documents set company_id = app.company_default() where company_id is null;
      alter table public.qualiopi_documents alter column company_id set default app.company_default();
      alter table public.qualiopi_documents alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'qualiopi_documents_company_fk') then
      alter table public.qualiopi_documents add constraint qualiopi_documents_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists qualiopi_documents_company_idx on public.qualiopi_documents (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'qualiopi_documents' and column_name = 'company_ids') then
      alter table public.qualiopi_documents add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists qualiopi_documents_company_ids_idx on public.qualiopi_documents using gin (company_ids);
    drop trigger if exists qualiopi_documents_societes on public.qualiopi_documents;
    create trigger qualiopi_documents_societes before insert or update of company_id, company_ids on public.qualiopi_documents
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- pp_course_settings
do $$
begin
  if to_regclass('public.pp_course_settings') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pp_course_settings' and column_name = 'company_id') then
      alter table public.pp_course_settings add column company_id uuid not null default app.company_default();
    else
      update public.pp_course_settings set company_id = app.company_default() where company_id is null;
      alter table public.pp_course_settings alter column company_id set default app.company_default();
      alter table public.pp_course_settings alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'pp_course_settings_company_fk') then
      alter table public.pp_course_settings add constraint pp_course_settings_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists pp_course_settings_company_idx on public.pp_course_settings (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pp_course_settings' and column_name = 'company_ids') then
      alter table public.pp_course_settings add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists pp_course_settings_company_ids_idx on public.pp_course_settings using gin (company_ids);
    drop trigger if exists pp_course_settings_societes on public.pp_course_settings;
    create trigger pp_course_settings_societes before insert or update of company_id, company_ids on public.pp_course_settings
      for each row execute function app.societes_partage();
  end if;
end
$$;

-- pp_presets
do $$
begin
  if to_regclass('public.pp_presets') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pp_presets' and column_name = 'company_id') then
      alter table public.pp_presets add column company_id uuid not null default app.company_default();
    else
      update public.pp_presets set company_id = app.company_default() where company_id is null;
      alter table public.pp_presets alter column company_id set default app.company_default();
      alter table public.pp_presets alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'pp_presets_company_fk') then
      alter table public.pp_presets add constraint pp_presets_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists pp_presets_company_idx on public.pp_presets (company_id);
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pp_presets' and column_name = 'company_ids') then
      alter table public.pp_presets add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists pp_presets_company_ids_idx on public.pp_presets using gin (company_ids);
    drop trigger if exists pp_presets_societes on public.pp_presets;
    create trigger pp_presets_societes before insert or update of company_id, company_ids on public.pp_presets
      for each row execute function app.societes_partage();
  end if;
end
$$;

insert into public.schema_migrations (version) values ('0274_societes_colonnes') on conflict (version) do nothing;

-- ===== supabase/migrations/0275_societes_isolement.sql =====
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

  -- Isolement par société (C2, 0275) : le super administrateur ne lit les données d'une société que par l'accès de
  -- support. Les tests du super administrateur se jouent avec l'accès permanent sur la société de l'instance (réglage
  -- de GLD), quel que soit le réglage de la base d'essai ; annulé avec le reste.
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
        ('Client facturation essai', '12345678900011', '123456789', '1 rue de l''Essai', '29000', 'Quimper', 'FR00123456789') returning id into b_cli;
      -- Organisme complet pour l'essai (base locale) ; la production garde ses valeurs (coalesce)
      update public.organization_settings set legal_name = coalesce(legal_name, 'Organisme essai'), siren = coalesce(siren, '987654321'),
        address = coalesce(address, '2 rue de l''Essai'), postal_code = coalesce(postal_code, '29000'), city = coalesce(city, 'Quimper'),
        forme_juridique = coalesce(forme_juridique, 'SARL'), capital_social = coalesce(capital_social, '1000'),
        tva_intra = coalesce(tva_intra, 'FR00987654321'), rcs = coalesce(rcs, 'RCS Quimper 987 654 321');
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
        address = coalesce(address, '2 rue de l''Essai'), postal_code = coalesce(postal_code, '29000'), city = coalesce(city, 'Quimper'),
        forme_juridique = coalesce(forme_juridique, 'SARL'), capital_social = coalesce(capital_social, '1000'),
        tva_intra = coalesce(tva_intra, 'FR00987654321'), rcs = coalesce(rcs, 'RCS Quimper 987 654 321');
      insert into public.clients (name, address, postal_code, city) values ('Pro sans SIREN essai', '3 rue', '29000', 'Quimper') returning id into m_cli;
      insert into public.clients (name, address, postal_code, city, client_type, vat_exempt) values ('Particulier essai', '4 rue', '29000', 'Quimper', 'particulier', true) returning id into m_part;
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
        address = coalesce(address, '2 rue de l''Essai'), postal_code = coalesce(postal_code, '29000'), city = coalesce(city, 'Quimper'),
        forme_juridique = coalesce(forme_juridique, 'SARL'), capital_social = coalesce(capital_social, '1000'),
        tva_intra = coalesce(tva_intra, 'FR00987654321'), rcs = coalesce(rcs, 'RCS Quimper 987 654 321');
      insert into public.clients (name, siret, siren, address, postal_code, city, tva) values
        ('Client avoir essai', '12345678900011', '123456789', '1 rue', '29000', 'Quimper', 'FR00123456789') returning id into a_cli;
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
        address = coalesce(address, '2 rue de l''Essai'), postal_code = coalesce(postal_code, '29000'), city = coalesce(city, 'Quimper'),
        forme_juridique = coalesce(forme_juridique, 'SARL'), capital_social = coalesce(capital_social, '1000'),
        tva_intra = coalesce(tva_intra, 'FR00987654321'), rcs = coalesce(rcs, 'RCS Quimper 987 654 321');
      insert into public.clients (name, siret, siren, address, postal_code, city, tva) values
        ('Client annuaire essai', '12345678900011', '123456789', '1 rue', '29000', 'Quimper', 'FR00123456789') returning id into s_cli;
      insert into public.clients (name, address, postal_code, city, client_type) values
        ('Particulier essai', '3 rue', '29000', 'Quimper', 'particulier') returning id into s_par;
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
        address = coalesce(address, '2 rue de l''Essai'), postal_code = coalesce(postal_code, '29000'), city = coalesce(city, 'Quimper'),
        forme_juridique = coalesce(forme_juridique, 'SARL'), capital_social = coalesce(capital_social, '1000'),
        tva_intra = coalesce(tva_intra, 'FR00987654321'), rcs = coalesce(rcs, 'RCS Quimper 987 654 321');
      delete from public.approval_rules where company_id = app.billing_company() and scope = 'invoice';
      insert into public.clients (name, address, postal_code, city, client_type) values ('Circuit essai', '1 rue', '29000', 'Quimper', 'particulier') returning id into k_cli;
      insert into public.clients (name, address, postal_code, city, client_type) values ('Circuit libre essai', '2 rue', '29000', 'Quimper', 'particulier') returning id into k_cli2;
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
        address = coalesce(address, '2 rue de l''Essai'), postal_code = coalesce(postal_code, '29000'), city = coalesce(city, 'Quimper'),
        forme_juridique = coalesce(forme_juridique, 'SARL'), capital_social = coalesce(capital_social, '1000'),
        tva_intra = coalesce(tva_intra, 'FR00987654321'), rcs = coalesce(rcs, 'RCS Quimper 987 654 321');
      delete from public.approval_rules where company_id = app.billing_company() and scope = 'invoice';
      insert into public.clients (name, address, postal_code, city, client_type) values ('Acompte essai', '1 rue', '29000', 'Quimper', 'particulier') returning id into x_cli;
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

      perform set_config('request.jwt.claims', '', true);
      delete from public.quote_items where company_id = y_x;
      delete from public.quotes where company_id = y_x;
      delete from public.clients where company_id = y_x;
      update public.clients set company_ids = array[y_own] where name = 'Client C2 société 1';
      delete from public.audit_logs where company_id = y_x;
      delete from public.company_members where company_id = y_x;
      delete from public.companies where id = y_x;
    end;
  end if;

  raise exception E'RÉSULTAT DES TESTS DE DROITS (tout est annulé)\n%\n\n% test(s), % échec(s)',
    array_to_string(v_lines, E'\n'), v_total, v_fail;
end
$test$;
