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
