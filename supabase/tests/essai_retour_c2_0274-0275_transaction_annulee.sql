-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c2_0274-0275) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0274_societes_colonnes.sql, 0275_societes_isolement.sql, retour arrière,
-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_schema || '.' || table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace)
  union all
  select 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal
    and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'migrations', 'public.schema_migrations', md5(coalesce(string_agg(version, ',' order by version), ''))
  from public.schema_migrations
  union all
  select 'données', 'organization_settings', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.organization_settings t
  union all
  select 'données', 'profiles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t
  union all
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t
  union all
  select 'données', 'company_members', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_members t
  union all
  select 'données', 'company_member_roles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_member_roles t;
create temp table etat_essai_avant as select * from etat_essai;

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


-- Verrous de toutes les tables touchées, pris en une instruction avant tout changement
do $$
declare v_liste text;
begin
  select string_agg(format('public.%I', t), ', ') into v_liste
  from unnest(array['sessions', 'trainees', 'invoices', 'quotes', 'invoice_emails_sent', 'itv_visits', 'itv_contracts', 'itv_equipment', 'budget_actions', 'budget_categories', 'budget_emails_sent', 'budget_meal_guests', 'budget_pipeline', 'budget_rules', 'budget_settings', 'budget_transactions', 'bank_statements', 'accounting_periods', 'bpf_declarations', 'cert_audit_findings', 'cert_documents', 'cert_indicator_status', 'cert_proofs', 'cert_settings', 'duerp_projects', 'pp_envois', 'pp_accuses', 'pp_fichiers', 'prospection_massive', 'prospect_calls', 'prospect_rdv', 'prospect_email_logs', 'prospect_needs_analysis', 'phoning_sessions', 'rdv_emails_sent', 'rdv_kit_documents', 'mailing_campaigns', 'mailing_segments', 'mailing_email_status', 'mailing_blocklist', 'social_posts', 'social_media_library', 'social_tokens', 'non_conformites', 'non_conformities', 'reclamations', 'quality_alerts', 'completude_alerts', 'completude_tracking', 'notifications', 'audit_logs', 'error_logs', 'rgpd_traitements', 'veille_qualiopi', 'veille_sources', 'processes', 'process_categories', 'process_responsibles', 'qualiopi_indicators', 'audits_internes', 'documents', 'uploaded_documents', 'uploaded_files', 'import_logs', 'signature_alerts_sent', 'trainees_archive', 'psh_requests', 'client_interactions', 'client_portal_access', 'client_providers', 'user_feedback', 'quote_items', 'invoice_items', 'invoice_sessions', 'invoice_payments', 'invoice_relances', 'session_trainees', 'session_trainers', 'session_checklists', 'session_costs', 'session_document_access', 'session_documents', 'session_emails_sent', 'session_equipment', 'session_fundings', 'session_groups', 'session_needs_analysis', 'session_qualiopi', 'session_sequences', 'attendance_halfdays', 'attendance_proxy_signatures', 'attendances', 'document_signatures', 'trainee_evaluations', 'evaluations_cold', 'trainer_evaluations', 'trainee_info_sheets', 'trainee_objectives', 'trainee_positioning_tests', 'positioning_results', 'quiz_attempts', 'sst_certifications', 'formative_evaluations', 'formative_sheets', 'course_document_downloads', 'pp_lignes', 'trainee_documents', 'trainee_disability', 'trainee_ssn', 'pp_nir', 'itv_visit_items', 'itv_visit_parts', 'duerp_actions', 'duerp_risks', 'duerp_units', 'duerp_equipements', 'duerp_habilitations', 'duerp_verifications', 'budget_receipts', 'budget_transaction_invoices', 'mailing_sends', 'process_steps', 'process_versions', 'process_connections', 'clients', 'client_contacts', 'sites', 'trainers', 'trainer_certificates', 'trainer_interviews', 'trainer_qualifications', 'trainer_trainings', 'courses', 'course_documents', 'course_equipment', 'course_questions', 'course_sequences', 'training_themes', 'theme_questions', 'positioning_questions_ref', 'positioning_themes', 'programme_versions', 'equipment_catalog', 'itv_equipment_types', 'itv_parts', 'itv_technicians', 'mailing_templates', 'call_arguments', 'call_objections', 'quality_documents', 'quality_doc_versions', 'qualiopi_documents', 'pp_course_settings', 'pp_presets']) t where to_regclass('public.' || t) is not null;
  execute 'lock table ' || v_liste || ' in access exclusive mode';
end
$$;


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

-- ===== supabase/rollback/0274-0275_societes_retour.sql =====
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

do $verif$
declare
  v_diff text[];
  v_n int;
  v_par text;
begin
  select count(*), (array_agg(coalesce(a.kind, b.kind) || ' ' || coalesce(a.name, b.name) || case
           when a.name is null then ' (en trop après retour)' when b.name is null then ' (manquant après retour)'
           else ' (différent)' end order by coalesce(a.kind, b.kind) desc, coalesce(a.name, b.name)))[1:40]
    into v_n, v_diff
  from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
  where a.v is distinct from b.v;
  select string_agg(k || ' ' || n, ', ') into v_par from (
    select coalesce(a.kind, b.kind) k, count(*) n
    from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
    where a.v is distinct from b.v group by 1) z;
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE c2_0274-0275 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
