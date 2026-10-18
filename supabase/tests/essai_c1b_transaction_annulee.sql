-- FICHIER GÉNÉRÉ par scripts/securite/essai_droits.py : ne pas modifier à la main.
-- Essai des droits composés (C1b) en transaction annulée : photographie des lectures par rôle, 0370 à 0375,
-- nouvelle photographie, puis tous les tests de droits. Se termine TOUJOURS par l'erreur volontaire
-- « RÉSULTAT DES TESTS DE DROITS » : tout est annulé, rien n'est enregistré. Aucune validation de transaction.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== Photographie des lectures avant C1b (comptes d'essai créés dans la transaction annulée) =====
create temp table essai_lectures_comptes (who text primary key, uid uuid);
create temp table essai_lectures_avant (who text, tbl text, n bigint);
create temp table essai_lectures_apres (who text, tbl text, n bigint);

do $cmp$
declare
  v_trainer uuid; v_client uuid; v_site uuid; v_tech uuid;
begin
  insert into essai_lectures_comptes (who, uid)
  select x.who, gen_random_uuid() from unnest(array['sa', 'ad', 'dir', 'ges', 'for', 'com', 'cpt', 'lec', 'tech', 'off', 'ent']) x(who);
  insert into auth.users (id, email, aud, role)
  select uid, 'cmp.' || who || '@test.invalid', 'authenticated', 'authenticated' from essai_lectures_comptes;
  insert into public.trainers (first_name, last_name) values ('Comparaison', 'FORMATEUR') returning id into v_trainer;
  alter table public.profiles disable trigger profiles_protect_role;
  insert into public.profiles (id, email, role, is_active, trainer_id)
  select c.uid, 'cmp.' || c.who || '@test.invalid',
         case c.who when 'sa' then 'superadmin' when 'ad' then 'admin' when 'dir' then 'direction' when 'ges' then 'gestionnaire'
                    when 'for' then 'formateur' when 'com' then 'commercial' when 'cpt' then 'comptable' when 'off' then 'direction'
                    when 'ent' then 'entreprise' else 'lecture' end,
         c.who <> 'off', case when c.who = 'for' then v_trainer end
  from essai_lectures_comptes c
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active, trainer_id = excluded.trainer_id;
  alter table public.profiles enable trigger profiles_protect_role;
  select uid into v_tech from essai_lectures_comptes where who = 'tech';
  insert into public.itv_technicians (profile_id, is_active) values (v_tech, true)
  on conflict (profile_id) do update set is_active = true;
  insert into public.clients (name) values ('Comparaison client') returning id into v_client;
  insert into public.sites (name, client_id) values ('Comparaison site', v_client) returning id into v_site;
  insert into public.sessions (start_date, end_date, trainer_id, client_id, attendance_token)
  values (current_date, current_date, v_trainer, v_client, 'cmp-' || replace(gen_random_uuid()::text, '-', ''));
  insert into public.itv_visits (client_id, site_id, technician_id, status) values (v_client, v_site, v_tech, 'planifiee');
end
$cmp$;

create function pg_temp.essai_compter(p_apres boolean)
returns void
language plpgsql
as $f$
declare
  c record; t text; v bigint;
begin
  for c in select * from essai_lectures_comptes order by who loop
    foreach t in array array['accounting_periods', 'app_versions', 'attendance_halfdays', 'attendance_proxy_signatures', 'attendances', 'audit_logs', 'audits_internes', 'bank_statements', 'bpf_declarations', 'budget_actions', 'budget_categories', 'budget_emails_sent', 'budget_meal_guests', 'budget_pipeline', 'budget_receipts', 'budget_rules', 'budget_settings', 'budget_transaction_invoices', 'budget_transactions', 'call_arguments', 'call_objections', 'cert_audit_findings', 'cert_criteria', 'cert_documents', 'cert_indicator_status', 'cert_indicators', 'cert_proofs', 'cert_referentials', 'cert_settings', 'client_contacts', 'client_interactions', 'client_portal_access', 'client_providers', 'clients', 'completude_alerts', 'completude_tracking', 'course_document_downloads', 'course_documents', 'course_equipment', 'course_questions', 'courses', 'dashboard_widget_configs', 'demo_records', 'document_signatures', 'documents', 'duerp_actions', 'duerp_equipements', 'duerp_formations_reglementaires', 'duerp_habilitations', 'duerp_projects', 'duerp_risk_categories', 'duerp_risk_templates', 'duerp_risks', 'duerp_sector_templates', 'duerp_units', 'duerp_verifications', 'equipment_catalog', 'evaluations_cold', 'import_logs', 'invoice_emails_sent', 'invoice_items', 'invoice_payments', 'invoice_relances', 'invoice_sessions', 'invoices', 'itv_contracts', 'itv_equipment', 'itv_equipment_types', 'itv_parts', 'itv_settings', 'itv_technicians', 'itv_visit_items', 'itv_visit_parts', 'itv_visits', 'mailing_blocklist', 'mailing_campaigns', 'mailing_email_status', 'mailing_segments', 'mailing_sends', 'mailing_templates', 'non_conformites', 'non_conformities', 'notifications', 'org_modules', 'org_settings', 'organization_settings', 'phoning_sessions', 'positioning_questions_ref', 'positioning_results', 'positioning_themes', 'process_categories', 'process_connections', 'process_responsibles', 'process_steps', 'process_versions', 'processes', 'profiles', 'programme_versions', 'prospect_calls', 'prospect_email_logs', 'prospect_needs_analysis', 'prospect_rdv', 'prospection_massive', 'psh_requests', 'qualiopi_documents', 'qualiopi_indicators', 'quality_alerts', 'quality_doc_versions', 'quality_documents', 'quality_roles', 'quiz_attempts', 'quote_items', 'quotes', 'rdv_emails_sent', 'rdv_kit_documents', 'reclamations', 'rgpd_traitements', 'schema_migrations', 'session_checklists', 'session_costs', 'session_document_access', 'session_documents', 'session_emails_sent', 'session_equipment', 'session_fundings', 'session_groups', 'session_needs_analysis', 'session_qualiopi', 'session_trainees', 'session_trainers', 'sessions', 'signature_alerts_sent', 'sites', 'social_media_library', 'social_posts', 'social_tokens', 'sst_certifications', 'theme_questions', 'trainee_documents', 'trainee_evaluations', 'trainee_info_sheets', 'trainee_objectives', 'trainee_positioning_tests', 'trainees', 'trainees_archive', 'trainer_certificates', 'trainer_evaluations', 'trainer_interviews', 'trainer_qualifications', 'trainer_trainings', 'trainers', 'training_themes', 'uploaded_documents', 'uploaded_files', 'user_email_configs', 'user_planning_events', 'veille_qualiopi', 'veille_sources'] loop
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', c.uid, 'role', 'authenticated',
                                                                   'email', 'cmp.' || c.who || '@test.invalid')::text, true);
        perform set_config('request.jwt.claim.sub', c.uid::text, true);
        execute 'set local role authenticated';
        execute format('select count(*) from public.%I', t) into v;
        execute 'reset role';
      exception when others then
        v := -1;
      end;
      if p_apres then
        insert into essai_lectures_apres values (c.who, t, v);
      else
        insert into essai_lectures_avant values (c.who, t, v);
      end if;
    end loop;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$f$;

select pg_temp.essai_compter(false);

-- ===== supabase/migrations/0370_droits_tables.sql =====
-- 0370_droits_tables.sql : droits composés par société (chantier C1b), tables.
--
-- Modèle (spec claude/odet-droits-composes.md, § 3) :
--   * permissions : catalogue des droits élémentaires (plateforme ; rempli par 0372, généré) ;
--   * permission_profiles : profils de droits ; company_id vide = modèle de plateforme (superadmin, admin, direction,
--     gestionnaire, formateur, commercial, technicien, comptable, comptable externe, RH, salarié, lecture, écran,
--     membre) ; company_id rempli = profil propre à une société (copie modifiable d'un modèle, ou profil créé) ;
--   * permission_profile_rights : droits de chaque profil ;
--   * company_member_roles (C1a, déjà créée) : profils EN PLUS attribués à une personne dans une société ;
--   * company_member_rights : droits accordés ou retirés à une personne dans une société (ajustements) ;
--   * offers, offer_items, offer_restrictions : offres ou licences ; un droit ou un module listé dans
--     offer_restrictions n'existe que pour les sociétés dont l'offre (companies.offer_id) le contient ;
--   * approval_rules, approval_requests, approval_delegations : circuit de validation commun (factures par client,
--     commandes avec seuil, absences, heures, frais) et délégations.
-- Le profil de base d'une personne dans une société est son rôle d'appartenance (company_members.role, recopié du
-- rôle du compte par C1a) ; « membre » est un rôle de base vide : ses droits viennent seulement des profils attribués.
--
-- Toutes les nouvelles tables naissent avec company_id (règle de C1a ; vide et contrôlé pour les tables de plateforme).
-- RLS active dès la création ; règles d'accès : 0373 (générée par scripts/securite/regles.py).
-- Migration additive et idempotente. Retour arrière : supabase/rollback/0370-0375_droits_retour.sql

-- Rôle de base « membre » (droits seulement par profils attribués) : admis par les deux contraintes de rôle
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role = any (array[
  'superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture',
  'entreprise', 'formateur_externe', 'stagiaire', 'membre'
]::text[]));
alter table public.company_members drop constraint if exists company_members_role_check;
alter table public.company_members add constraint company_members_role_check check (role = any (array[
  'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture', 'membre'
]::text[]));

-- Catalogue des droits élémentaires (plateforme)
create table if not exists public.permissions (
  code text primary key check (code ~ '^[a-z_]+(\.[a-z_]+)+$'),
  company_id uuid references public.companies (id) on delete cascade check (company_id is null),
  module text,
  label text not null check (char_length(btrim(label)) > 0),
  description text not null default '',
  data_scope text not null default '',
  own_scope boolean not null default false,
  shows_prices boolean not null default false,
  full_license_only boolean not null default false,
  platform_only boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.permissions is 'Catalogue des droits élémentaires (plateforme) : nom clair, ce que le droit permet, données concernées';
comment on column public.permissions.own_scope is 'Droit limité au périmètre de la personne (ses sessions, ses visites, sa fiche)';
comment on column public.permissions.shows_prices is 'Le droit montre des prix, montants ou coûts (jamais au technicien)';
comment on column public.permissions.full_license_only is 'Réservé aux sociétés qui ont la licence totale (sauf super administrateur)';
comment on column public.permissions.platform_only is 'Réservé au super administrateur (éditeur)';

-- Profils de droits : modèles de plateforme (company_id vide) et profils des sociétés
create table if not exists public.permission_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z_]*$'),
  label text not null check (char_length(btrim(label)) > 0),
  description text not null default '',
  base_role text,
  is_system boolean not null default false,
  position integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.permission_profiles is 'Profils de droits : modèles de plateforme (sans société) et profils propres à une société (même clé = remplace le modèle dans cette société)';
create unique index if not exists permission_profiles_modele_uniq on public.permission_profiles (key) where company_id is null;
create unique index if not exists permission_profiles_societe_uniq on public.permission_profiles (company_id, key) where company_id is not null;

create table if not exists public.permission_profile_rights (
  profile_id uuid not null references public.permission_profiles (id) on delete cascade,
  right_code text not null references public.permissions (code) on update cascade on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, right_code)
);
comment on table public.permission_profile_rights is 'Droits de chaque profil (company_id recopié du profil)';
create index if not exists permission_profile_rights_company_idx on public.permission_profile_rights (company_id);

-- Ajustements individuels : droit accordé ou retiré à une personne dans une société
create table if not exists public.company_member_rights (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  member_id uuid not null references public.company_members (id) on delete cascade,
  right_code text not null references public.permissions (code) on update cascade on delete cascade,
  effect text not null default 'grant' check (effect in ('grant', 'revoke')),
  reason text,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  unique (member_id, right_code)
);
comment on table public.company_member_rights is 'Droits accordés (grant) ou retirés (revoke) à une personne dans une société, en plus de ses profils';
create index if not exists company_member_rights_company_idx on public.company_member_rights (company_id);

create index if not exists company_member_roles_member_idx on public.company_member_roles (member_id);

-- Offres ou licences (non tranché commercialement : le mécanisme existe, aucune restriction n'est posée)
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade check (company_id is null),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),
  label text not null check (char_length(btrim(label)) > 0),
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.offers is 'Offres ou licences proposées aux sociétés (plateforme)';

create table if not exists public.offer_items (
  offer_id uuid not null references public.offers (id) on delete cascade,
  kind text not null check (kind in ('right', 'module')),
  item_key text not null check (char_length(btrim(item_key)) > 0),
  company_id uuid references public.companies (id) on delete cascade check (company_id is null),
  primary key (offer_id, kind, item_key)
);
comment on table public.offer_items is 'Droits et modules compris dans une offre';

create table if not exists public.offer_restrictions (
  kind text not null check (kind in ('right', 'module')),
  item_key text not null check (char_length(btrim(item_key)) > 0),
  company_id uuid references public.companies (id) on delete cascade check (company_id is null),
  note text,
  primary key (kind, item_key)
);
comment on table public.offer_restrictions is 'Droits et modules qui n''existent que dans une offre (vide : tout est disponible pour toutes les sociétés)';

alter table public.companies add column if not exists offer_id uuid references public.offers (id) on delete set null;
comment on column public.companies.offer_id is 'Offre de la société (réglée par le super administrateur) ; vide = aucune offre, seuls les droits et modules sans restriction';

-- Circuit de validation commun
create table if not exists public.approval_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  scope text not null check (scope in ('invoice', 'purchase_order', 'absence', 'timesheet', 'expense', 'quote')),
  client_id uuid references public.clients (id) on delete cascade,
  mode text not null check (mode in ('none', 'always', 'threshold')),
  threshold numeric check (threshold is null or threshold >= 0),
  validator_right text not null references public.permissions (code) on update cascade,
  extra_steps jsonb not null default '[]'::jsonb check (jsonb_typeof(extra_steps) = 'array'),
  is_active boolean not null default true,
  note text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (mode <> 'threshold' or threshold is not null),
  check (client_id is null or scope = 'invoice')
);
comment on table public.approval_rules is 'Circuits de validation par société et par périmètre (factures : par client ; commandes : seuil ; absences, heures, frais)';
create unique index if not exists approval_rules_uniq on public.approval_rules (company_id, scope, coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  scope text not null check (scope in ('invoice', 'purchase_order', 'absence', 'timesheet', 'expense', 'quote')),
  object_table text not null check (object_table ~ '^[a-z_][a-z0-9_]{0,62}$'),
  object_id uuid not null,
  client_id uuid,
  amount numeric,
  label text,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) > 0),
  current_step integer not null default 0,
  history jsonb not null default '[]'::jsonb,
  decided_by uuid,
  decided_at timestamptz,
  decision_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.approval_requests is 'Demandes de validation (circuit commun) : écrites seulement par les fonctions approval_*';
create index if not exists approval_requests_company_status_idx on public.approval_requests (company_id, status);
create index if not exists approval_requests_object_idx on public.approval_requests (object_table, object_id);
create unique index if not exists approval_requests_pending_uniq on public.approval_requests (object_table, object_id) where status = 'pending';

create table if not exists public.approval_delegations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  from_profile uuid not null references public.profiles (id) on delete cascade,
  to_profile uuid not null references public.profiles (id) on delete cascade,
  scope text check (scope is null or scope in ('invoice', 'purchase_order', 'absence', 'timesheet', 'expense', 'quote')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  check (from_profile <> to_profile),
  check (ends_at > starts_at)
);
comment on table public.approval_delegations is 'Délégations de validation : une personne valide pour une autre pendant une période';
create index if not exists approval_delegations_to_idx on public.approval_delegations (to_profile, company_id);

-- Aucune table ouverte avant ses règles (0373) ; droits des comptes posés ici
do $$
declare t text;
begin
  foreach t in array array['permissions', 'permission_profiles', 'permission_profile_rights', 'company_member_rights',
                           'offers', 'offer_items', 'offer_restrictions', 'approval_rules', 'approval_requests',
                           'approval_delegations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke truncate, trigger, references on table public.%I from authenticated', t);
    if t in ('approval_requests', 'approval_delegations') then
      -- Écrites seulement par les fonctions approval_* (0375)
      execute format('revoke insert, update, delete on table public.%I from authenticated', t);
      execute format('grant select on table public.%I to authenticated', t);
    else
      execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    end if;
  end loop;
end $$;

insert into public.schema_migrations (version) values ('0370_droits_tables') on conflict (version) do nothing;

-- ===== supabase/migrations/0371_droits_fonctions.sql =====
-- 0371_droits_fonctions.sql : droits composés par société (chantier C1b), fonctions.
--
-- UNE SEULE FONCTION fait foi : app.a_le_droit(code) = « le compte connecté a le droit X dans la société courante ».
-- Toutes les règles d'accès générées par scripts/securite/regles.py (0373) l'appellent sous la forme
-- (select app.a_le_droit('...')) (évaluée une fois par requête) ; l'écran lit les mêmes droits par public.my_rights().
--
-- Calcul des droits d'une personne dans une société (app.rights_for) :
--   1. compte désactivé ou sans rôle : aucun droit ;
--   2. super administrateur (rôle de plateforme) : les droits du modèle « superadmin » (tous) ; son accès aux données
--      d'une société reste celui de l'accès de support de C1a (condition de société posée par C2) ;
--   3. sinon, profils de la personne dans la société (app.profiles_for) :
--      * profil de base = son rôle d'appartenance (company_members.role) ; « lecture » coché technicien actif avec le
--        module Interventions actif = « technicien » (même règle que app.role()) ;
--      * profils en plus attribués dans la société (company_member_roles) ;
--      chaque clé de profil prend le profil propre à la société s'il existe, sinon le modèle de plateforme ;
--   4. droits des profils + droits accordés à la personne − droits retirés à la personne ;
--   5. moins les droits réservés à la licence totale si la société ne l'a pas, moins les droits réservés à une offre
--      que la société n'a pas, moins les droits de plateforme.
-- Société courante : app.current_company() (C1a : en-tête contrôlé, sinon société par défaut). Sans société (aucune
-- appartenance), le profil de base est le rôle du compte, comme avant C1b.
--
-- Équivalence avec le chantier 2 : pour une société unique, le rôle d'appartenance est le rôle du compte (recopie de
-- C1a) ; les modèles qui reprennent un rôle contiennent exactement les droits que la matrice donnait à ce rôle (0372,
-- générée depuis la même matrice que 0082). Contrôlé par supabase/tests/droits_chantier2.sql (bloc C1b).
-- Migration idempotente. Retour arrière : supabase/rollback/0370-0375_droits_retour.sql

-- Rôle effectif d'un compte (même règle que app.role(), pour un compte donné)
create or replace function app.role_of(p_profile uuid)
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
  where p.id = p_profile and p.is_active
$$;

-- Clés des profils d'un compte dans une société : profil de base d'abord, puis profils attribués
create or replace function app.profiles_for(p_profile uuid, p_company uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := app.role_of(p_profile);
  v_member uuid;
  v_mrole text;
  v_base text;
  v_out text[];
begin
  if v_role is null then
    return '{}'::text[];
  end if;
  if v_role = 'superadmin' then
    return array['superadmin'];
  end if;
  if p_company is null then
    return array[v_role];
  end if;
  select m.id, m.role into v_member, v_mrole
  from public.company_members m
  where m.company_id = p_company and m.profile_id = p_profile and m.is_active;
  if v_member is null then
    return '{}'::text[];
  end if;
  v_base := case when v_role = 'technicien' and v_mrole = 'lecture' then 'technicien' else v_mrole end;
  select array[v_base] || coalesce(array_agg(r.role_key order by r.role_key) filter (where r.role_key <> v_base), '{}'::text[])
    into v_out
  from public.company_member_roles r
  where r.member_id = v_member;
  return coalesce(v_out, array[v_base]);
end
$$;

-- Droits d'un compte dans une société (tableau trié de codes)
create or replace function app.rights_for(p_profile uuid, p_company uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := app.role_of(p_profile);
  v_keys text[];
  v_member uuid;
  v_full boolean := false;
  v_offer uuid;
  v_out text[];
begin
  if v_role is null then
    return '{}'::text[];
  end if;
  -- Super administrateur : modèle de plateforme « superadmin », sans filtre de société
  if v_role = 'superadmin' then
    select coalesce(array_agg(r.right_code order by r.right_code), '{}'::text[]) into v_out
    from public.permission_profile_rights r
    join public.permission_profiles p on p.id = r.profile_id
    where p.company_id is null and p.key = 'superadmin';
    return v_out;
  end if;
  v_keys := app.profiles_for(p_profile, p_company);
  if coalesce(array_length(v_keys, 1), 0) = 0 then
    return '{}'::text[];
  end if;
  if p_company is not null then
    select m.id into v_member from public.company_members m
    where m.company_id = p_company and m.profile_id = p_profile and m.is_active;
    select c.full_license, c.offer_id into v_full, v_offer from public.companies c where c.id = p_company;
  end if;
  with profils as (
    select distinct on (p.key) p.id
    from public.permission_profiles p
    where p.key = any (v_keys) and (p.company_id = p_company or p.company_id is null)
    order by p.key, (p.company_id is null)
  ), bruts as (
    select pr.right_code as code from public.permission_profile_rights pr where pr.profile_id in (select id from profils)
    union
    select g.right_code from public.company_member_rights g where g.member_id = v_member and g.effect = 'grant'
    except
    select g.right_code from public.company_member_rights g where g.member_id = v_member and g.effect = 'revoke'
  )
  select coalesce(array_agg(b.code order by b.code), '{}'::text[]) into v_out
  from bruts b
  join public.permissions d on d.code = b.code
  where not d.platform_only
    and (not d.full_license_only or coalesce(v_full, false))
    and (not exists (select 1 from public.offer_restrictions o where o.kind = 'right' and o.item_key = b.code)
         or exists (select 1 from public.offer_items i where i.offer_id = v_offer and i.kind = 'right' and i.item_key = b.code));
  return v_out;
end
$$;

-- Droits du compte connecté dans la société courante
create or replace function app.rights()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select app.rights_for((select auth.uid()), app.current_company())
$$;

-- LA fonction des règles d'accès : le compte connecté a-t-il le droit X dans la société courante ?
create or replace function app.a_le_droit(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_code = any (app.rights()), false)
$$;

-- Le compte connecté a-t-il le droit X dans une société donnée (lignes rattachées à une société) ?
create or replace function app.a_le_droit_dans(p_company uuid, p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_company in (select app.visible_companies())
                  and p_code = any (app.rights_for((select auth.uid()), p_company)), false)
$$;

-- Sociétés où le compte connecté a le droit X (pour les règles des tables rattachées à une société)
create or replace function app.societes_avec_droit(p_code text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v from app.visible_companies() v
  where p_code = any (app.rights_for((select auth.uid()), v))
$$;

-- Module ou droit disponible dans l'offre d'une société (aucune restriction posée = disponible partout)
create or replace function app.offer_allows(p_company uuid, p_kind text, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.offer_restrictions o where o.kind = p_kind and o.item_key = p_key)
      or exists (select 1 from public.offer_items i
                 join public.companies c on c.offer_id = i.offer_id
                 where c.id = p_company and i.kind = p_kind and i.item_key = p_key)
$$;

-- Le compte connecté peut-il décider d'une demande de validation (droit de l'étape en cours dans la société, ou
-- délégation en cours d'une personne qui a ce droit) ? Jamais sur sa propre demande.
create or replace function app.approval_can_decide(p_company uuid, p_scope text, p_right text, p_requested_by uuid,
                                                   p_status text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_status = 'pending'
    and p_requested_by is distinct from (select auth.uid())
    and (app.a_le_droit_dans(p_company, p_right)
         or exists (select 1 from public.approval_delegations d
                    where d.company_id = p_company and d.to_profile = (select auth.uid()) and d.revoked_at is null
                      and now() >= d.starts_at and now() < d.ends_at and (d.scope is null or d.scope = p_scope)
                      and d.from_profile is distinct from p_requested_by
                      and p_right = any (app.rights_for(d.from_profile, p_company)))),
    false)
$$;

-- Droits du compte connecté, lus par l'application (une seule source avec les règles d'accès)
create or replace function public.my_rights()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'company_id', app.current_company(),
    'role', app.role(),
    'profiles', to_jsonb(app.profiles_for((select auth.uid()), app.current_company())),
    'rights', to_jsonb(app.rights()),
    'full_license', coalesce((select c.full_license from public.companies c where c.id = app.current_company()), false)
  )
  where app.role() is not null
$$;

-- Choix de la direction (décision du 17/10) : devis visibles ou non du comptable externe de la société courante.
-- Crée au besoin le profil propre à la société (copie du modèle « comptable_externe »), puis ajoute ou retire
-- « Voir les devis ». Aucun accès aux Paramètres n'est nécessaire.
create or replace function public.external_accountant_set_quotes(p_visible boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.current_company();
  v_prof uuid;
begin
  if v_company is null or not app.a_le_droit('facturation.comptable_externe.regler') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select p.id into v_prof from public.permission_profiles p where p.company_id = v_company and p.key = 'comptable_externe';
  if v_prof is null then
    insert into public.permission_profiles (company_id, key, label, description, base_role, position, created_by)
    select v_company, p.key, p.label, p.description, p.base_role, p.position, (select auth.uid())
    from public.permission_profiles p where p.company_id is null and p.key = 'comptable_externe'
    returning id into v_prof;
    if v_prof is null then
      raise exception 'Modèle « comptable externe » absent' using errcode = '22023';
    end if;
    insert into public.permission_profile_rights (profile_id, right_code)
    select v_prof, r.right_code from public.permission_profile_rights r
    join public.permission_profiles p on p.id = r.profile_id
    where p.company_id is null and p.key = 'comptable_externe';
  end if;
  if p_visible then
    insert into public.permission_profile_rights (profile_id, right_code) values (v_prof, 'commercial.devis.voir')
    on conflict do nothing;
  else
    delete from public.permission_profile_rights where profile_id = v_prof and right_code = 'commercial.devis.voir';
  end if;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'system', 'Devis du comptable externe',
          jsonb_build_object('company_id', v_company, 'visible', p_visible));
  return p_visible;
end
$$;

-- Rôle de base « membre » : reçoit une appartenance comme les autres rôles internes (recopie de C1a)
create or replace function app.member_role(p_role text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_role in ('admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture', 'membre')
              then p_role end
$$;

-- Garde des champs sensibles d'une société (C1a) : l'offre rejoint la licence totale et la société n° 1,
-- réservées au super administrateur.
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
    if (new.full_license, new.is_instance_owner, new.offer_id) is distinct from (old.full_license, old.is_instance_owner, old.offer_id)
       and not app.is_superadmin() then
      raise exception 'Licence, offre et société n° 1 : réservées au super administrateur' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;

-- Recopies et contrôles des tables de droits
create or replace function app.profile_rights_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.company_id into new.company_id from public.permission_profiles p where p.id = new.profile_id;
  return new;
end
$$;

drop trigger if exists permission_profile_rights_company on public.permission_profile_rights;
create trigger permission_profile_rights_company before insert or update on public.permission_profile_rights
  for each row execute function app.profile_rights_company();

-- Profils de plateforme : la clé et le rôle repris d'un modèle fourni ne changent pas ; le profil « superadmin »
-- n'existe qu'en modèle de plateforme ; un droit de plateforme ne va que dans le modèle « superadmin ».
create or replace function app.permission_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.is_system and (new.key, new.base_role, new.company_id, new.is_system)
     is distinct from (old.key, old.base_role, old.company_id, old.is_system) then
    raise exception 'Modèle fourni : sa clé et son rôle repris ne changent pas' using errcode = '42501';
  end if;
  if new.company_id is not null and new.key = 'superadmin' then
    raise exception 'Le profil super administrateur n''existe qu''au niveau de la plateforme' using errcode = '22023';
  end if;
  if new.company_id is not null then
    new.is_system := false;
  end if;
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists permission_profiles_guard on public.permission_profiles;
create trigger permission_profiles_guard before insert or update on public.permission_profiles
  for each row execute function app.permission_profiles_guard();

create or replace function app.profile_rights_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.permissions d where d.code = new.right_code and d.platform_only)
     and not exists (select 1 from public.permission_profiles p where p.id = new.profile_id
                     and p.company_id is null and p.key = 'superadmin') then
    raise exception 'Droit réservé à la plateforme : %', new.right_code using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists permission_profile_rights_guard on public.permission_profile_rights;
create trigger permission_profile_rights_guard before insert or update on public.permission_profile_rights
  for each row execute function app.profile_rights_guard();

-- Ajustements individuels : société de l'appartenance ; jamais un droit de plateforme
create or replace function app.member_rights_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select m.company_id into new.company_id from public.company_members m where m.id = new.member_id;
  if exists (select 1 from public.permissions d where d.code = new.right_code and d.platform_only) then
    raise exception 'Droit réservé à la plateforme : %', new.right_code using errcode = '42501';
  end if;
  new.granted_by := coalesce(new.granted_by, (select auth.uid()));
  return new;
end
$$;

drop trigger if exists company_member_rights_guard on public.company_member_rights;
create trigger company_member_rights_guard before insert or update on public.company_member_rights
  for each row execute function app.member_rights_guard();

-- Profils attribués (company_member_roles, C1a) : clé d'un profil existant (de la société ou modèle), jamais
-- « superadmin » ni « membre »
create or replace function app.member_roles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select m.company_id into v_company from public.company_members m where m.id = new.member_id;
  if new.role_key in ('superadmin', 'membre')
     or not exists (select 1 from public.permission_profiles p
                    where p.key = new.role_key and (p.company_id is null or p.company_id = v_company)) then
    raise exception 'Profil inconnu ou non attribuable : %', new.role_key using errcode = '22023';
  end if;
  new.granted_by := coalesce(new.granted_by, (select auth.uid()));
  return new;
end
$$;

drop trigger if exists company_member_roles_guard on public.company_member_roles;
create trigger company_member_roles_guard before insert or update on public.company_member_roles
  for each row execute function app.member_roles_guard();

revoke all on function app.role_of(uuid), app.profiles_for(uuid, uuid), app.rights_for(uuid, uuid), app.rights(),
  app.a_le_droit(text), app.a_le_droit_dans(uuid, text), app.societes_avec_droit(text), app.offer_allows(uuid, text, text),
  app.approval_can_decide(uuid, text, text, uuid, text)
  from public, anon;
grant execute on function app.role_of(uuid), app.profiles_for(uuid, uuid), app.rights_for(uuid, uuid), app.rights(),
  app.a_le_droit(text), app.a_le_droit_dans(uuid, text), app.societes_avec_droit(text), app.offer_allows(uuid, text, text),
  app.approval_can_decide(uuid, text, text, uuid, text)
  to authenticated, service_role;
revoke all on function app.profile_rights_company(), app.permission_profiles_guard(), app.profile_rights_guard(),
  app.member_rights_guard(), app.member_roles_guard() from public, anon, authenticated;
revoke all on function public.my_rights(), public.external_accountant_set_quotes(boolean) from public, anon;
grant execute on function public.my_rights(), public.external_accountant_set_quotes(boolean) to authenticated, service_role;

insert into public.schema_migrations (version) values ('0371_droits_fonctions') on conflict (version) do nothing;

-- ===== supabase/migrations/0372_droits_catalogue.sql =====
-- 0372_droits_catalogue.sql : catalogue des droits et modèles de profils (chantier C1b).
-- FICHIER GÉNÉRÉ par scripts/securite/regles.py (catalogue : scripts/securite/droits.py ; droits des modèles qui
-- reprennent un rôle : calculés depuis la matrice du chantier 2). Ne pas modifier à la main.
--
-- Reprise de l'existant sans perte : chaque rôle actuel (profiles.role, et « lecture » coché technicien) devient un
-- modèle de profil qui contient exactement ses droits d'aujourd'hui. Les comptes ne sont pas modifiés : leur profil
-- de base reste leur rôle d'appartenance (company_members.role, recopié par C1a).
-- Migration idempotente (les droits retirés d'un modèle par le super administrateur ne sont pas remis, sauf en
-- rejouant la migration). Retour arrière : supabase/rollback/0370-0375_droits_retour.sql

insert into public.permissions (code, module, label, description, data_scope, own_scope, shows_prices,
  full_license_only, platform_only, position) values
  ('plateforme.administrer', null, 'Administrer la plateforme', 'Opérations réservées à l''éditeur : versions, migrations, données de démonstration, corrections exceptionnelles', 'app_versions, schema_migrations, demo_records, catalogue des droits, modèles de profils', false, false, false, true, 10),
  ('organisation.reglages.voir', null, 'Voir les réglages de l''organisme', 'Lire l''identité, les modules actifs, les référents qualité et les versions (nécessaire à tous les écrans)', 'organization_settings, org_settings, org_modules, quality_roles, app_versions', false, false, false, false, 20),
  ('organisation.comptes.voir', null, 'Voir les comptes', 'Lire la liste des comptes (noms, fonctions, rôles) pour afficher les auteurs et choisir un collègue', 'profiles', false, false, false, false, 30),
  ('organisation.preferences.gerer', null, 'Gérer ses préférences', 'Régler son tableau de bord et sa boîte d''envoi (seulement les siens)', 'dashboard_widget_configs, user_email_configs', true, false, false, false, 40),
  ('organisation.journal.ecrire', null, 'Écrire au journal d''audit', 'Ajouter une ligne au journal lors d''une action (en attendant l''écriture par la base, chantier F)', 'audit_logs (ajout seulement)', false, false, false, false, 50),
  ('organisation.notifications.gerer', null, 'Voir et traiter les notifications', 'Lire, créer et marquer comme lues les notifications', 'notifications', false, false, false, false, 60),
  ('organisation.notifications.supprimer', null, 'Supprimer des notifications', 'Supprimer des notifications', 'notifications', false, false, false, false, 70),
  ('planning.agenda.voir', null, 'Voir les agendas', 'Lire les évènements d''agenda de l''équipe', 'user_planning_events', false, false, false, false, 80),
  ('planning.agenda.gerer_siens', null, 'Gérer son agenda', 'Créer, modifier, supprimer ses propres évènements', 'user_planning_events', true, false, false, false, 90),
  ('planning.agenda.gerer_equipe', null, 'Gérer les agendas de l''équipe', 'Créer, modifier, supprimer les évènements de toute l''équipe', 'user_planning_events', false, false, false, false, 100),
  ('parametres.ouvrir', null, 'Ouvrir les Paramètres', 'Accéder aux pages Paramètres et à l''assistant de configuration (garde des écrans, branche ecrans/gardes)', 'pages Paramètres, Console exclue', false, false, true, false, 110),
  ('parametres.organisme.modifier', null, 'Configurer l''organisme', 'Modifier l''identité, les textes et les réglages de l''organisme', 'organization_settings, org_settings', false, false, false, false, 120),
  ('parametres.modules.gerer', null, 'Configurer les modules', 'Activer ou couper un module', 'org_modules', false, false, false, false, 130),
  ('parametres.referents.gerer', null, 'Désigner les référents', 'Désigner les référents qualité (dont le référent handicap)', 'quality_roles', false, false, false, false, 140),
  ('parametres.utilisateurs.gerer', null, 'Gérer les comptes', 'Créer, modifier, désactiver un compte (jamais un super administrateur)', 'profiles', false, false, false, false, 150),
  ('parametres.profils.gerer', null, 'Gérer les profils de droits', 'Créer et modifier les profils de droits de la société (Paramètres › Profils)', 'permission_profiles, permission_profile_rights', false, false, true, false, 160),
  ('parametres.droits.attribuer', null, 'Attribuer des droits', 'Donner ou retirer des profils et des droits à une personne dans la société (Paramètres › Utilisateurs)', 'company_member_roles, company_member_rights', false, false, true, false, 170),
  ('parametres.reseaux_sociaux.voir', 'social', 'Voir les connexions aux réseaux sociaux', 'Lire l''état des connexions (jetons) des réseaux sociaux', 'social_tokens', false, false, false, false, 180),
  ('validations.circuits.configurer', null, 'Configurer les circuits de validation', 'Régler par périmètre (factures par client, commandes avec seuil, absences, heures, frais) qui valide', 'approval_rules', false, false, false, false, 190),
  ('formation.catalogue.voir', 'formation', 'Voir le catalogue', 'Lire les formations, thèmes, matériel, programmes, documents de formation et banques de questions', 'courses, training_themes, course_equipment, equipment_catalog, programme_versions, trainer_qualifications, course_documents, course_questions, theme_questions, positioning_questions_ref, positioning_themes', false, false, false, false, 200),
  ('formation.catalogue.gerer', 'formation', 'Gérer le catalogue', 'Créer, modifier, supprimer formations, thèmes, matériel et programmes ; supprimer des questions', 'mêmes tables que « Voir le catalogue »', false, false, false, false, 210),
  ('formation.questions.modifier', 'formation', 'Rédiger les questions', 'Créer et modifier les questions des tests et quiz', 'course_questions, theme_questions, positioning_*', false, false, false, false, 220),
  ('formation.formateurs.voir', 'formation', 'Voir les formateurs', 'Lire les fiches formateurs', 'trainers', false, false, false, false, 230),
  ('formation.formateurs.gerer', 'formation', 'Gérer les formateurs', 'Créer, modifier, supprimer les fiches formateurs', 'trainers', false, false, false, false, 240),
  ('formation.formateurs.modifier_sa_fiche', 'formation', 'Modifier sa fiche de formateur', 'Le formateur met à jour sa propre fiche (signature, coordonnées)', 'trainers (la sienne)', true, false, false, false, 250),
  ('formation.formateurs.dossier', 'formation', 'Tenir le dossier des formateurs', 'Entretiens, formations suivies et certificats des formateurs', 'trainer_interviews, trainer_trainings, trainer_certificates', false, false, false, false, 260),
  ('formation.sessions.voir', 'formation', 'Voir toutes les sessions', 'Lire toutes les sessions, leurs financements, groupes et formateurs', 'sessions, session_fundings, session_groups, session_trainers', false, false, false, false, 270),
  ('formation.sessions.voir_siennes', 'formation', 'Voir ses sessions', 'Le formateur lit ses sessions et tout leur suivi (émargement, évaluations, fiches)', 'sessions et tables filles, limitées à ses sessions', true, false, false, false, 280),
  ('formation.sessions.creer', 'formation', 'Créer des sessions', 'Créer une session', 'sessions', false, false, false, false, 290),
  ('formation.sessions.modifier', 'formation', 'Modifier les sessions', 'Modifier toutes les sessions, financements, groupes et formateurs', 'sessions, session_fundings, session_groups, session_trainers', false, false, false, false, 300),
  ('formation.sessions.modifier_siennes', 'formation', 'Faire vivre ses sessions', 'Le formateur modifie ses sessions : émargement, évaluations, fiches, documents, check-list', 'sessions et tables filles, limitées à ses sessions', true, false, false, false, 310),
  ('formation.sessions.supprimer', 'formation', 'Supprimer des sessions', 'Supprimer une session', 'sessions', false, false, false, false, 320),
  ('formation.sessions.preparer', 'formation', 'Préparer les sessions', 'Check-list, documents, envois enregistrés, matériel, analyses des besoins des sessions', 'session_checklists, session_documents, session_document_access, session_emails_sent, session_equipment, session_needs_analysis, session_qualiopi, course_document_downloads', false, false, false, false, 330),
  ('formation.suivi.voir', 'formation', 'Voir le suivi des sessions', 'Lire émargement, évaluations, fiches de renseignements, objectifs, tests et certificats SST', 'attendance_*, trainee_info_sheets, trainee_objectives, trainee_positioning_tests, positioning_results, sst_certifications, quiz_attempts, trainee_evaluations, evaluations_cold, trainer_evaluations, trainee_documents, session_checklists et documents des sessions', false, false, false, false, 340),
  ('formation.suivi.gerer', 'formation', 'Corriger le suivi des sessions', 'Saisir et corriger émargement, évaluations, fiches et certificats ; supprimer des pièces de suivi', 'mêmes tables que « Voir le suivi des sessions »', false, false, false, false, 350),
  ('formation.couts.gerer', 'formation', 'Voir et saisir les coûts des sessions', 'Coûts engagés par session (marge)', 'session_costs', false, true, false, false, 360),
  ('formation.signatures.suivre', 'formation', 'Suivre les relances de signature', 'Lire les alertes de signature envoyées', 'signature_alerts_sent', false, false, false, false, 370),
  ('formation.documents.voir', 'formation', 'Voir les documents', 'Lire les documents déposés', 'documents, uploaded_documents, uploaded_files', false, false, false, false, 380),
  ('formation.documents.modifier', 'formation', 'Déposer des documents', 'Déposer et modifier des documents', 'documents, uploaded_documents, uploaded_files', false, false, false, false, 390),
  ('formation.documents.supprimer', 'formation', 'Supprimer des documents', 'Supprimer des documents', 'documents, uploaded_documents, uploaded_files', false, false, false, false, 400),
  ('formation.stagiaires.voir', 'formation', 'Voir tous les stagiaires', 'Lire les fiches et inscriptions de tous les stagiaires (jamais le numéro de sécurité sociale ni le handicap)', 'trainees, session_trainees', false, false, false, false, 410),
  ('formation.stagiaires.voir_siens', 'formation', 'Voir les stagiaires de ses sessions', 'Le formateur lit les stagiaires inscrits à ses sessions', 'trainees, trainee_documents (ses sessions)', true, false, false, false, 420),
  ('formation.stagiaires.creer', 'formation', 'Créer des stagiaires', 'Créer une fiche stagiaire', 'trainees', false, false, false, false, 430),
  ('formation.stagiaires.modifier', 'formation', 'Modifier les stagiaires', 'Modifier toutes les fiches stagiaires', 'trainees', false, false, false, false, 440),
  ('formation.stagiaires.modifier_siens', 'formation', 'Compléter les stagiaires de ses sessions', 'Le formateur complète les fiches et documents des stagiaires de ses sessions', 'trainees, trainee_documents (ses sessions)', true, false, false, false, 450),
  ('formation.stagiaires.supprimer', 'formation', 'Supprimer des stagiaires', 'Supprimer une fiche stagiaire', 'trainees', false, false, false, false, 460),
  ('formation.stagiaires.archives', 'formation', 'Gérer les archives des stagiaires', 'Lire et tenir les archives des stagiaires', 'trainees_archive', false, false, false, false, 470),
  ('formation.inscriptions.gerer', 'formation', 'Inscrire des stagiaires', 'Inscrire, modifier et retirer des stagiaires d''une session', 'session_trainees', false, false, false, false, 480),
  ('formation.convocations.envoyer', 'formation', 'Envoyer aux stagiaires et aux clients', 'Envoyer convocations, documents de fin de stage et liens d''évaluation (route /api, branche ecrans/gardes)', 'emails des sessions', false, false, false, false, 490),
  ('clients.fiches.voir', 'commercial', 'Voir les clients', 'Lire clients, contacts, sites et historique des échanges', 'clients, client_contacts, sites, client_interactions', false, false, false, false, 500),
  ('clients.fiches.modifier', 'commercial', 'Modifier les clients', 'Créer et modifier clients, contacts, sites ; supprimer contacts et sites', 'clients, client_contacts, sites, client_interactions', false, false, false, false, 510),
  ('clients.fiches.supprimer', 'commercial', 'Supprimer des clients', 'Supprimer un client et des lignes d''historique', 'clients, client_interactions', false, false, false, false, 520),
  ('clients.historique.ecrire', 'commercial', 'Noter un échange avec un client', 'Ajouter une ligne à l''historique d''un client', 'client_interactions', false, false, false, false, 530),
  ('clients.espace.gerer', 'commercial', 'Gérer l''espace entreprise et les prestataires', 'Accès des clients à leur espace, prestataires concurrents', 'client_portal_access, client_providers', false, false, false, false, 540),
  ('commercial.devis.voir', 'commercial', 'Voir les devis', 'Lire les devis et leurs lignes, avec les prix', 'quotes, quote_items', false, true, false, false, 550),
  ('commercial.devis.modifier', 'commercial', 'Préparer les devis', 'Créer et modifier des devis', 'quotes, quote_items', false, true, false, false, 560),
  ('commercial.devis.supprimer', 'commercial', 'Supprimer des devis', 'Supprimer un devis', 'quotes', false, false, false, false, 570),
  ('commercial.devis.envoyer', 'commercial', 'Envoyer les devis', 'Envoyer un devis au client (route /api)', 'emails des devis', false, true, false, false, 580),
  ('commercial.prospection.voir', 'prospection', 'Voir la prospection', 'Lire la base prospects, appels, rendez-vous, analyses de besoin, imports', 'prospection_massive, prospect_*, phoning_sessions, call_*, rdv_*, import_logs', false, false, false, false, 590),
  ('commercial.prospection.gerer', 'prospection', 'Prospecter', 'Appeler, noter, prendre rendez-vous, importer', 'mêmes tables que « Voir la prospection »', false, false, false, false, 600),
  ('commercial.prospection.supprimer', 'prospection', 'Supprimer des prospects', 'Supprimer de la base prospects', 'prospection_massive', false, false, false, false, 610),
  ('communication.campagnes.gerer', 'mailing', 'Gérer les campagnes email', 'Segments, modèles, envois, liste d''exclusion', 'mailing_*', false, false, false, false, 620),
  ('communication.reseaux.gerer', 'social', 'Publier sur les réseaux sociaux', 'Préparer et planifier les publications, bibliothèque de médias', 'social_posts, social_media_library', false, false, false, false, 630),
  ('facturation.factures.voir', 'commercial', 'Voir les factures', 'Lire factures, avoirs, lignes, paiements, relances et envois, avec les montants', 'invoices, invoice_items, invoice_sessions, invoice_payments, invoice_relances, invoice_emails_sent', false, true, false, false, 640),
  ('facturation.factures.modifier', 'commercial', 'Préparer les factures', 'Créer et modifier factures et lignes, saisir les paiements et les relances', 'mêmes tables que « Voir les factures »', false, true, false, false, 650),
  ('facturation.factures.supprimer', 'commercial', 'Supprimer des factures', 'Supprimer une facture (refusé par la base pour une facture émise, chantier Facturation fiable)', 'invoices, invoice_relances, invoice_emails_sent', false, false, false, false, 660),
  ('facturation.brouillons.supprimer', 'commercial', 'Supprimer ses brouillons de facture', 'Supprimer une facture encore en brouillon', 'invoices (brouillons)', false, false, false, false, 670),
  ('facturation.factures.valider', 'commercial', 'Valider les factures', 'Émettre une facture : numéro définitif donné par la base, contenu figé (chantier Facturation fiable)', 'invoices', false, true, false, false, 680),
  ('facturation.factures.envoyer', 'commercial', 'Envoyer les factures', 'Envoyer ou mettre à disposition une facture émise', 'emails des factures', false, true, false, false, 690),
  ('facturation.avoirs.emettre', 'commercial', 'Émettre des avoirs', 'Annuler tout ou partie d''une facture émise par un avoir', 'invoices (avoirs)', false, true, false, false, 700),
  ('facturation.brouillons.demander_confirmation', 'commercial', 'Demander la confirmation d''un brouillon', 'Comptable externe : signaler un brouillon à son auteur et demander sa confirmation, sans le modifier', 'notifications', false, false, false, false, 710),
  ('facturation.comptable_externe.regler', 'commercial', 'Choisir ce que voit le comptable externe', 'Direction : rendre les devis visibles ou non au comptable externe de la société (sans ouvrir les Paramètres)', 'profil « comptable externe » de la société', false, false, false, false, 720),
  ('facturation.export.comptable', 'comptabilite', 'Exporter pour la comptabilité', 'Exports comptables, FEC, transmission au comptable', 'factures émises, avoirs, paiements', false, true, false, false, 730),
  ('finance.budget.gerer', 'finance', 'Tenir le budget et la comptabilité', 'Budget, relevés bancaires, rapprochement, catégories, périodes comptables', 'budget_*, bank_statements, accounting_periods', false, true, false, false, 740),
  ('qualite.registres.voir', 'qualite', 'Voir les registres qualité', 'Non-conformités, réclamations, alertes, veille, processus, audits internes, RGPD, BPF, indicateurs', 'non_conformites, reclamations, quality_alerts, veille_*, process_*, audits_internes, rgpd_traitements, bpf_declarations, qualiopi_indicators', false, false, false, false, 750),
  ('qualite.registres.signaler', 'qualite', 'Signaler dans les registres qualité', 'Créer une non-conformité, une réclamation, une alerte, une veille', 'mêmes tables', false, false, false, false, 760),
  ('qualite.registres.gerer', 'qualite', 'Traiter les registres qualité', 'Modifier et clore les lignes des registres qualité', 'mêmes tables', false, false, false, false, 770),
  ('qualite.documents.voir', null, 'Voir les documents qualité', 'Lire les documents qualité et leurs versions', 'quality_documents, qualiopi_documents, quality_doc_versions', false, false, false, false, 780),
  ('qualite.documents.gerer', null, 'Gérer les documents qualité', 'Créer et modifier les documents qualité', 'quality_documents, qualiopi_documents', false, false, false, false, 790),
  ('qualite.documents.valider', null, 'Valider une version de document qualité', 'Enregistrer une nouvelle version validée', 'quality_doc_versions', false, false, false, false, 800),
  ('qualite.completude.suivre', null, 'Suivre la complétude', 'Lire et traiter les alertes de complétude des sessions', 'completude_alerts, completude_tracking', false, false, false, false, 810),
  ('qualite.completude.supprimer', null, 'Supprimer des alertes de complétude', 'Supprimer des alertes', 'completude_alerts, completude_tracking', false, false, false, false, 820),
  ('qualite.certification.gerer', 'certification', 'Préparer les certifications', 'Référentiels, preuves, constats d''audit, réglages (face auditeur)', 'cert_*', false, false, false, false, 830),
  ('qualite.handicap.voir', 'qualite', 'Voir les données de handicap', 'Direction et référent handicap : besoins, adaptations, registre PSH (règle app.can_see_disability, inchangée)', 'trainee_disability, psh_requests', false, false, false, false, 840),
  ('prestations.duerp.gerer', 'duerp', 'Réaliser les DUERP', 'Projets DUERP, unités, risques, actions', 'duerp_*', false, false, false, false, 850),
  ('passeport.declarations.gerer', 'passeport', 'Déclarer au Passeport de prévention', 'Préparer et suivre les déclarations (règles propres du Passeport, pp_can, inchangées)', 'pp_*', false, false, false, false, 860),
  ('conformite.journal.voir', null, 'Voir le journal d''audit', 'Lire le journal d''audit de la société', 'audit_logs', false, false, false, false, 870),
  ('conformite.rgpd.gerer', null, 'Tenir le registre RGPD', 'Registre, sous-traitants, AIPD, informations (chantier F)', 'rgpd_* (prévu)', false, false, false, false, 880),
  ('conformite.demandes.gerer', null, 'Traiter les demandes des personnes', 'Droits d''accès, rectification, effacement', 'rgpd_requests (prévu)', false, false, false, false, 890),
  ('conformite.violations.gerer', null, 'Gérer les violations de données', 'Registre des violations (72 h)', 'rgpd_breaches (prévu)', false, false, false, false, 900),
  ('conformite.purges.valider', null, 'Valider les purges', 'Valider les passages de purge proposés', 'rgpd_purges (prévu)', false, false, false, false, 910),
  ('interventions.referentiel.voir', 'interventions', 'Voir les types d''appareils et les techniciens', 'Lire les types de matériel et la liste des techniciens', 'itv_equipment_types, itv_technicians', false, false, false, false, 920),
  ('interventions.tarifs.voir', 'interventions', 'Voir les prix des interventions', 'Lire les prix des pièces, le forfait de visite et les prix des pièces fournies', 'itv_parts, itv_settings, itv_visit_parts', false, true, false, false, 930),
  ('interventions.reglages.gerer', 'interventions', 'Configurer les interventions', 'Réglages, types de matériel, pièces et prix, techniciens', 'itv_settings, itv_equipment_types, itv_parts, itv_technicians', false, true, false, false, 940),
  ('interventions.contrats.voir', 'interventions', 'Voir les contrats de maintenance', 'Lire les contrats avec leur prix annuel', 'itv_contracts', false, true, false, false, 950),
  ('interventions.contrats.gerer', 'interventions', 'Gérer les contrats de maintenance', 'Créer et modifier les contrats', 'itv_contracts', false, true, false, false, 960),
  ('interventions.visites.voir', 'interventions', 'Voir toutes les visites', 'Lire toutes les visites et leurs lignes de contrôle', 'itv_visits, itv_visit_items', false, false, false, false, 970),
  ('interventions.visites.gerer', 'interventions', 'Planifier et gérer les visites', 'Créer, planifier, modifier, supprimer toutes les visites et leurs lignes', 'itv_visits, itv_visit_items, itv_visit_parts', false, false, false, false, 980),
  ('interventions.parc.voir', 'interventions', 'Voir le parc des clients', 'Lire les appareils de tous les clients', 'itv_equipment', false, false, false, false, 990),
  ('interventions.parc.gerer', 'interventions', 'Gérer le parc des clients', 'Créer, modifier, supprimer des appareils', 'itv_equipment', false, false, false, false, 1000),
  ('interventions.missions.voir', 'interventions', 'Voir ses missions', 'Le technicien lit ses visites, les clients, sites et contacts de ses visites, leur parc et leur historique, sans aucun prix', 'itv_visits, clients, client_contacts, sites, itv_equipment, itv_visit_items, vues terrain', true, false, false, false, 1010),
  ('interventions.missions.realiser', 'interventions', 'Intervenir', 'Le technicien réalise ses visites : démarrage, contrôles, pièces fournies, photos, signature du client', 'itv_visits, itv_visit_items, itv_visit_parts (ses visites)', true, false, false, false, 1020),
  ('interventions.parc.annoter', 'interventions', 'Annoter le parc de ses clients', 'Le technicien ajoute ou corrige un appareil chez les clients de ses visites', 'itv_equipment (ses clients)', true, false, false, false, 1030),
  ('interventions.rapports.envoyer', 'interventions', 'Envoyer les rapports d''intervention', 'Envoyer le rapport de visite au client', 'emails des visites', false, false, false, false, 1040),
  ('rh.personnel.voir', 'rh', 'Voir le personnel', 'Annuaire : nom, emploi, équipe, téléphone et email professionnels', 'hr_people (partie annuaire)', false, false, false, false, 1050),
  ('rh.dossiers.voir', 'rh', 'Voir les dossiers du personnel', 'Fiche complète : identité, coordonnées personnelles, contrat', 'hr_people, hr_employments', false, false, false, false, 1060),
  ('rh.dossiers.gerer', 'rh', 'Tenir les dossiers du personnel', 'Créer et modifier personnes, contrats, équipes, horaires, habilitations, suivi de santé administratif', 'hr_*', false, false, false, false, 1070),
  ('rh.salaires.voir', 'rh', 'Voir les salaires', 'Lire les rémunérations (consultation journalisée)', 'hr_compensation', false, true, false, false, 1080),
  ('rh.absences.demander', 'rh', 'Demander une absence', 'Demander ses congés et absences, voir son solde', 'hr_absence_requests (les siennes)', true, false, false, false, 1090),
  ('rh.absences.valider', 'rh', 'Valider les absences', 'Valider ou refuser les demandes d''absence', 'hr_absence_requests, approval_requests', false, false, false, false, 1100),
  ('rh.heures.saisir', 'rh', 'Saisir ses heures', 'Remplir sa semaine d''heures', 'hr_time_entries (les siennes)', true, false, false, false, 1110),
  ('rh.heures.valider', 'rh', 'Valider les heures', 'Valider les semaines d''heures et les heures supplémentaires', 'hr_timesheets, approval_requests', false, false, false, false, 1120),
  ('rh.documents.restreints', 'rh', 'Voir les documents restreints du personnel', 'Justificatifs d''absence, santé au travail administrative, bulletins', 'hr_documents (restreint, privé)', false, false, false, false, 1130),
  ('rh.parametres.gerer', 'rh', 'Configurer les RH', 'Types d''absence, horaires de référence, règles de temps', 'hr_absence_types, hr_schedules', false, false, false, false, 1140),
  ('frais.notes.saisir', 'frais', 'Saisir ses notes de frais', 'Déclarer ses frais avec justificatif', 'notes de frais (les siennes)', true, false, false, false, 1150),
  ('frais.notes.valider', 'frais', 'Valider les notes de frais', 'Valider ou refuser les notes de frais', 'notes de frais, approval_requests', false, true, false, false, 1160),
  ('vehicules.siens.utiliser', 'vehicules', 'Utiliser son véhicule', 'Voir son véhicule, saisir un plein, un état des lieux, un incident', 'vehicles (le sien), pleins, incidents', true, false, false, false, 1170),
  ('vehicules.parc.voir', 'vehicules', 'Voir le parc de véhicules', 'Lire les véhicules, échéances et historiques', 'vehicles, entretiens, échéances', false, false, false, false, 1180),
  ('vehicules.couts.voir', 'vehicules', 'Voir les coûts des véhicules', 'Coûts, pleins, factures d''entretien', 'pleins, entretiens', false, true, false, false, 1190),
  ('vehicules.parc.gerer', 'vehicules', 'Gérer le parc de véhicules', 'Créer, modifier, attribuer les véhicules', 'vehicles, attributions', false, false, false, false, 1200),
  ('vehicules.carte.voir', 'vehicules', 'Voir la carte en direct', 'Positions des véhicules pendant les heures de service (direction seulement)', 'vehicle_live, positions', false, false, false, false, 1210),
  ('vehicules.ecran_mural.voir', 'vehicules', 'Afficher l''écran mural', 'Page plein écran du suivi des véhicules, en lecture seule (compte « écran »)', 'vehicle_live (affichage)', false, false, false, false, 1220),
  ('vehicules.geolocalisation.configurer', 'vehicules', 'Configurer la géolocalisation', 'Fournisseur de boîtiers, heures de service', 'réglages du module', false, false, false, false, 1230),
  ('stock.sien.mouvementer', 'stock', 'Mouvementer son stock', 'Voir et mouvementer le stock de son véhicule ou le sien (prise au dépôt, retour)', 'stock_movements (le sien)', true, false, false, false, 1240),
  ('stock.voir', 'stock', 'Voir tout le stock', 'Quantités de tous les emplacements, transferts entre dépôts', 'stock_*', false, false, false, false, 1250),
  ('stock.articles.gerer', 'stock', 'Gérer les articles et les seuils', 'Articles, fournisseurs, seuils', 'stock_items, suppliers, stock_thresholds', false, false, false, false, 1260),
  ('stock.commandes.preparer', 'stock', 'Préparer une commande', 'Préparer une demande ou une commande d''achat', 'purchase_orders', false, false, false, false, 1270),
  ('stock.commandes.valider', 'stock', 'Valider les commandes', 'Valider les commandes selon le seuil de la société', 'purchase_orders, approval_requests', false, true, false, false, 1280),
  ('stock.inventaires.valider', 'stock', 'Valider un inventaire', 'Valider les écarts d''inventaire', 'stock_counts', false, false, false, false, 1290),
  ('stock.valeur.voir', 'stock', 'Voir les prix d''achat et la valeur du stock', 'Prix d''achat, valorisation', 'stock_items (prix), v_stock_value', false, true, false, false, 1300),
  ('manager.cockpit.voir', 'manager', 'Voir le cockpit de direction', 'Indicateurs de la société et du groupe, rapport du lundi', 'vues du Manager', false, true, false, false, 1310),
  ('manager.validations.voir', null, 'Voir le centre de validations', 'Toutes les demandes de validation de la société', 'approval_requests, approval_delegations', false, false, false, false, 1320),
  ('manager.emprunts.gerer', 'manager', 'Gérer les emprunts', 'Emprunts, échéanciers, capital restant', 'emprunts (prévu)', false, true, false, false, 1330),
  ('manager.objectifs.gerer', 'manager', 'Gérer les objectifs', 'Objectifs suivis dans le cockpit', 'objectifs (prévu)', false, false, false, false, 1340),
  ('validations.deleguer', null, 'Déléguer ses validations', 'Confier ses validations à une autre personne pendant une période', 'approval_delegations', false, false, false, false, 1350)
on conflict (code) do update set module = excluded.module, label = excluded.label,
  description = excluded.description, data_scope = excluded.data_scope, own_scope = excluded.own_scope,
  shows_prices = excluded.shows_prices, full_license_only = excluded.full_license_only,
  platform_only = excluded.platform_only, position = excluded.position, updated_at = now();

-- Modèles de profils (plateforme)
insert into public.permission_profiles (key, label, description, base_role, is_system, position) values
  ('superadmin', 'Super administrateur', 'Éditeur de la plateforme : tous les droits ; voit une société par l''accès de support (C1a)', 'superadmin', true, 10),
  ('admin', 'Administrateur', 'Associés : tout sauf la plateforme ; les Paramètres seulement avec la licence totale de la société', 'admin', true, 20),
  ('direction', 'Direction', 'Direction de la société : toutes les données de gestion, jamais les Paramètres', 'direction', true, 30),
  ('gestionnaire', 'Gestionnaire', 'Organisation des sessions, des clients et des interventions', 'gestionnaire', true, 40),
  ('formateur', 'Formateur', 'Ses sessions et leurs stagiaires seulement ; ni devis ni factures', 'formateur', true, 50),
  ('commercial', 'Commercial', 'Clients, prospection, devis et factures', 'commercial', true, 60),
  ('technicien', 'Technicien', 'Ses missions sur le terrain ; peut annoter ; jamais aucun prix', 'technicien', true, 70),
  ('comptable', 'Comptable interne', 'Factures, paiements, espace comptable ; aucune donnée de formation sensible', 'comptable', true, 80),
  ('comptable_externe', 'Comptable externe', 'Cabinet comptable : lit les factures et avoirs (brouillons signalés « sans valeur comptable ») ; ne modifie rien ; demande une confirmation à l''auteur. Devis : la direction ajoute « Voir les devis » au profil de sa société si elle le veut', null, true, 90),
  ('rh', 'Ressources humaines', 'Dossiers du personnel, absences, heures, documents RH', null, true, 100),
  ('salarie', 'Salarié', 'Son espace : congés, heures, frais, son véhicule, son stock', null, true, 110),
  ('lecture', 'Lecture', 'Consultation sans modification ; ni devis ni factures', 'lecture', true, 120),
  ('ecran', 'Compte « écran »', 'Écran mural des véhicules : une seule page, lecture seule, révocable d''un clic', null, true, 130),
  ('membre', 'Sans profil de base', 'Rôle de base vide : les droits viennent seulement des profils attribués dans la société (comptable externe, RH, salarié, écran)', null, true, 140)
on conflict (key) where company_id is null do update set label = excluded.label,
  description = excluded.description, position = excluded.position;

-- Droits des modèles
insert into public.permission_profile_rights (profile_id, right_code)
select p.id, x.code from public.permission_profiles p, (values ('clients.espace.gerer'), ('clients.fiches.modifier'), ('clients.fiches.supprimer'), ('clients.fiches.voir'), ('clients.historique.ecrire'), ('commercial.devis.envoyer'), ('commercial.devis.modifier'), ('commercial.devis.supprimer'), ('commercial.devis.voir'), ('commercial.prospection.gerer'), ('commercial.prospection.supprimer'), ('commercial.prospection.voir'), ('communication.campagnes.gerer'), ('communication.reseaux.gerer'), ('conformite.demandes.gerer'), ('conformite.journal.voir'), ('conformite.purges.valider'), ('conformite.rgpd.gerer'), ('conformite.violations.gerer'), ('facturation.avoirs.emettre'), ('facturation.brouillons.demander_confirmation'), ('facturation.comptable_externe.regler'), ('facturation.export.comptable'), ('facturation.factures.envoyer'), ('facturation.factures.modifier'), ('facturation.factures.supprimer'), ('facturation.factures.valider'), ('facturation.factures.voir'), ('finance.budget.gerer'), ('formation.catalogue.gerer'), ('formation.catalogue.voir'), ('formation.convocations.envoyer'), ('formation.couts.gerer'), ('formation.documents.modifier'), ('formation.documents.supprimer'), ('formation.documents.voir'), ('formation.formateurs.dossier'), ('formation.formateurs.gerer'), ('formation.formateurs.voir'), ('formation.inscriptions.gerer'), ('formation.questions.modifier'), ('formation.sessions.creer'), ('formation.sessions.modifier'), ('formation.sessions.preparer'), ('formation.sessions.supprimer'), ('formation.sessions.voir'), ('formation.signatures.suivre'), ('formation.stagiaires.archives'), ('formation.stagiaires.creer'), ('formation.stagiaires.modifier'), ('formation.stagiaires.supprimer'), ('formation.stagiaires.voir'), ('formation.suivi.gerer'), ('formation.suivi.voir'), ('frais.notes.valider'), ('interventions.contrats.gerer'), ('interventions.contrats.voir'), ('interventions.parc.gerer'), ('interventions.parc.voir'), ('interventions.rapports.envoyer'), ('interventions.referentiel.voir'), ('interventions.reglages.gerer'), ('interventions.tarifs.voir'), ('interventions.visites.gerer'), ('interventions.visites.voir'), ('manager.cockpit.voir'), ('manager.emprunts.gerer'), ('manager.objectifs.gerer'), ('manager.validations.voir'), ('organisation.comptes.voir'), ('organisation.journal.ecrire'), ('organisation.notifications.gerer'), ('organisation.notifications.supprimer'), ('organisation.preferences.gerer'), ('organisation.reglages.voir'), ('parametres.droits.attribuer'), ('parametres.modules.gerer'), ('parametres.organisme.modifier'), ('parametres.ouvrir'), ('parametres.profils.gerer'), ('parametres.referents.gerer'), ('parametres.reseaux_sociaux.voir'), ('parametres.utilisateurs.gerer'), ('passeport.declarations.gerer'), ('planning.agenda.gerer_equipe'), ('planning.agenda.gerer_siens'), ('planning.agenda.voir'), ('plateforme.administrer'), ('prestations.duerp.gerer'), ('qualite.certification.gerer'), ('qualite.completude.suivre'), ('qualite.completude.supprimer'), ('qualite.documents.gerer'), ('qualite.documents.valider'), ('qualite.documents.voir'), ('qualite.handicap.voir'), ('qualite.registres.gerer'), ('qualite.registres.signaler'), ('qualite.registres.voir'), ('rh.absences.valider'), ('rh.documents.restreints'), ('rh.dossiers.gerer'), ('rh.dossiers.voir'), ('rh.heures.valider'), ('rh.parametres.gerer'), ('rh.personnel.voir'), ('rh.salaires.voir'), ('stock.articles.gerer'), ('stock.commandes.preparer'), ('stock.commandes.valider'), ('stock.inventaires.valider'), ('stock.valeur.voir'), ('stock.voir'), ('validations.circuits.configurer'), ('validations.deleguer'), ('vehicules.carte.voir'), ('vehicules.couts.voir'), ('vehicules.ecran_mural.voir'), ('vehicules.geolocalisation.configurer'), ('vehicules.parc.gerer'), ('vehicules.parc.voir')) x(code)
where p.company_id is null and p.key = 'superadmin'
on conflict do nothing;
insert into public.permission_profile_rights (profile_id, right_code)
select p.id, x.code from public.permission_profiles p, (values ('clients.espace.gerer'), ('clients.fiches.modifier'), ('clients.fiches.supprimer'), ('clients.fiches.voir'), ('clients.historique.ecrire'), ('commercial.devis.envoyer'), ('commercial.devis.modifier'), ('commercial.devis.supprimer'), ('commercial.devis.voir'), ('commercial.prospection.gerer'), ('commercial.prospection.supprimer'), ('commercial.prospection.voir'), ('communication.campagnes.gerer'), ('communication.reseaux.gerer'), ('conformite.demandes.gerer'), ('conformite.journal.voir'), ('conformite.purges.valider'), ('conformite.rgpd.gerer'), ('conformite.violations.gerer'), ('facturation.avoirs.emettre'), ('facturation.comptable_externe.regler'), ('facturation.export.comptable'), ('facturation.factures.envoyer'), ('facturation.factures.modifier'), ('facturation.factures.supprimer'), ('facturation.factures.valider'), ('facturation.factures.voir'), ('finance.budget.gerer'), ('formation.catalogue.gerer'), ('formation.catalogue.voir'), ('formation.convocations.envoyer'), ('formation.couts.gerer'), ('formation.documents.modifier'), ('formation.documents.supprimer'), ('formation.documents.voir'), ('formation.formateurs.dossier'), ('formation.formateurs.gerer'), ('formation.formateurs.voir'), ('formation.inscriptions.gerer'), ('formation.questions.modifier'), ('formation.sessions.creer'), ('formation.sessions.modifier'), ('formation.sessions.preparer'), ('formation.sessions.supprimer'), ('formation.sessions.voir'), ('formation.signatures.suivre'), ('formation.stagiaires.archives'), ('formation.stagiaires.creer'), ('formation.stagiaires.modifier'), ('formation.stagiaires.supprimer'), ('formation.stagiaires.voir'), ('formation.suivi.gerer'), ('formation.suivi.voir'), ('frais.notes.valider'), ('interventions.contrats.gerer'), ('interventions.contrats.voir'), ('interventions.parc.gerer'), ('interventions.parc.voir'), ('interventions.rapports.envoyer'), ('interventions.referentiel.voir'), ('interventions.reglages.gerer'), ('interventions.tarifs.voir'), ('interventions.visites.gerer'), ('interventions.visites.voir'), ('manager.cockpit.voir'), ('manager.emprunts.gerer'), ('manager.objectifs.gerer'), ('manager.validations.voir'), ('organisation.comptes.voir'), ('organisation.journal.ecrire'), ('organisation.notifications.gerer'), ('organisation.notifications.supprimer'), ('organisation.preferences.gerer'), ('organisation.reglages.voir'), ('parametres.droits.attribuer'), ('parametres.modules.gerer'), ('parametres.organisme.modifier'), ('parametres.ouvrir'), ('parametres.profils.gerer'), ('parametres.referents.gerer'), ('parametres.reseaux_sociaux.voir'), ('parametres.utilisateurs.gerer'), ('passeport.declarations.gerer'), ('planning.agenda.gerer_equipe'), ('planning.agenda.gerer_siens'), ('planning.agenda.voir'), ('prestations.duerp.gerer'), ('qualite.certification.gerer'), ('qualite.completude.suivre'), ('qualite.completude.supprimer'), ('qualite.documents.gerer'), ('qualite.documents.valider'), ('qualite.documents.voir'), ('qualite.handicap.voir'), ('qualite.registres.gerer'), ('qualite.registres.signaler'), ('qualite.registres.voir'), ('rh.absences.valider'), ('rh.dossiers.gerer'), ('rh.dossiers.voir'), ('rh.heures.valider'), ('rh.parametres.gerer'), ('rh.personnel.voir'), ('rh.salaires.voir'), ('stock.articles.gerer'), ('stock.commandes.preparer'), ('stock.commandes.valider'), ('stock.inventaires.valider'), ('stock.valeur.voir'), ('stock.voir'), ('validations.circuits.configurer'), ('validations.deleguer'), ('vehicules.carte.voir'), ('vehicules.couts.voir'), ('vehicules.geolocalisation.configurer'), ('vehicules.parc.gerer'), ('vehicules.parc.voir')) x(code)
where p.company_id is null and p.key = 'admin'
on conflict do nothing;
insert into public.permission_profile_rights (profile_id, right_code)
select p.id, x.code from public.permission_profiles p, (values ('clients.espace.gerer'), ('clients.fiches.modifier'), ('clients.fiches.supprimer'), ('clients.fiches.voir'), ('clients.historique.ecrire'), ('commercial.devis.envoyer'), ('commercial.devis.modifier'), ('commercial.devis.supprimer'), ('commercial.devis.voir'), ('commercial.prospection.gerer'), ('commercial.prospection.supprimer'), ('commercial.prospection.voir'), ('communication.campagnes.gerer'), ('communication.reseaux.gerer'), ('conformite.demandes.gerer'), ('conformite.purges.valider'), ('conformite.rgpd.gerer'), ('conformite.violations.gerer'), ('facturation.avoirs.emettre'), ('facturation.comptable_externe.regler'), ('facturation.export.comptable'), ('facturation.factures.envoyer'), ('facturation.factures.modifier'), ('facturation.factures.supprimer'), ('facturation.factures.valider'), ('facturation.factures.voir'), ('finance.budget.gerer'), ('formation.catalogue.gerer'), ('formation.catalogue.voir'), ('formation.convocations.envoyer'), ('formation.couts.gerer'), ('formation.documents.modifier'), ('formation.documents.supprimer'), ('formation.documents.voir'), ('formation.formateurs.dossier'), ('formation.formateurs.gerer'), ('formation.formateurs.voir'), ('formation.inscriptions.gerer'), ('formation.questions.modifier'), ('formation.sessions.creer'), ('formation.sessions.modifier'), ('formation.sessions.preparer'), ('formation.sessions.supprimer'), ('formation.sessions.voir'), ('formation.signatures.suivre'), ('formation.stagiaires.archives'), ('formation.stagiaires.creer'), ('formation.stagiaires.modifier'), ('formation.stagiaires.supprimer'), ('formation.stagiaires.voir'), ('formation.suivi.gerer'), ('formation.suivi.voir'), ('frais.notes.valider'), ('interventions.contrats.gerer'), ('interventions.contrats.voir'), ('interventions.parc.gerer'), ('interventions.parc.voir'), ('interventions.rapports.envoyer'), ('interventions.referentiel.voir'), ('interventions.reglages.gerer'), ('interventions.tarifs.voir'), ('interventions.visites.gerer'), ('interventions.visites.voir'), ('manager.cockpit.voir'), ('manager.emprunts.gerer'), ('manager.objectifs.gerer'), ('manager.validations.voir'), ('organisation.comptes.voir'), ('organisation.journal.ecrire'), ('organisation.notifications.gerer'), ('organisation.preferences.gerer'), ('organisation.reglages.voir'), ('passeport.declarations.gerer'), ('planning.agenda.gerer_equipe'), ('planning.agenda.gerer_siens'), ('planning.agenda.voir'), ('prestations.duerp.gerer'), ('qualite.certification.gerer'), ('qualite.completude.suivre'), ('qualite.completude.supprimer'), ('qualite.documents.gerer'), ('qualite.documents.valider'), ('qualite.documents.voir'), ('qualite.handicap.voir'), ('qualite.registres.gerer'), ('qualite.registres.signaler'), ('qualite.registres.voir'), ('rh.absences.valider'), ('rh.dossiers.gerer'), ('rh.dossiers.voir'), ('rh.heures.valider'), ('rh.parametres.gerer'), ('rh.personnel.voir'), ('rh.salaires.voir'), ('stock.articles.gerer'), ('stock.commandes.preparer'), ('stock.commandes.valider'), ('stock.inventaires.valider'), ('stock.valeur.voir'), ('stock.voir'), ('validations.circuits.configurer'), ('validations.deleguer'), ('vehicules.carte.voir'), ('vehicules.couts.voir'), ('vehicules.parc.gerer'), ('vehicules.parc.voir')) x(code)
where p.company_id is null and p.key = 'direction'
on conflict do nothing;
insert into public.permission_profile_rights (profile_id, right_code)
select p.id, x.code from public.permission_profiles p, (values ('clients.espace.gerer'), ('clients.fiches.modifier'), ('clients.fiches.supprimer'), ('clients.fiches.voir'), ('clients.historique.ecrire'), ('commercial.devis.envoyer'), ('commercial.devis.modifier'), ('commercial.devis.supprimer'), ('commercial.devis.voir'), ('commercial.prospection.gerer'), ('commercial.prospection.supprimer'), ('commercial.prospection.voir'), ('communication.campagnes.gerer'), ('communication.reseaux.gerer'), ('facturation.factures.modifier'), ('facturation.factures.supprimer'), ('facturation.factures.voir'), ('formation.catalogue.gerer'), ('formation.catalogue.voir'), ('formation.convocations.envoyer'), ('formation.couts.gerer'), ('formation.documents.modifier'), ('formation.documents.supprimer'), ('formation.documents.voir'), ('formation.formateurs.dossier'), ('formation.formateurs.gerer'), ('formation.formateurs.voir'), ('formation.inscriptions.gerer'), ('formation.questions.modifier'), ('formation.sessions.creer'), ('formation.sessions.modifier'), ('formation.sessions.preparer'), ('formation.sessions.supprimer'), ('formation.sessions.voir'), ('formation.signatures.suivre'), ('formation.stagiaires.archives'), ('formation.stagiaires.creer'), ('formation.stagiaires.modifier'), ('formation.stagiaires.supprimer'), ('formation.stagiaires.voir'), ('formation.suivi.gerer'), ('formation.suivi.voir'), ('interventions.contrats.gerer'), ('interventions.contrats.voir'), ('interventions.parc.gerer'), ('interventions.parc.voir'), ('interventions.rapports.envoyer'), ('interventions.referentiel.voir'), ('interventions.reglages.gerer'), ('interventions.tarifs.voir'), ('interventions.visites.gerer'), ('interventions.visites.voir'), ('organisation.comptes.voir'), ('organisation.journal.ecrire'), ('organisation.notifications.gerer'), ('organisation.preferences.gerer'), ('organisation.reglages.voir'), ('passeport.declarations.gerer'), ('planning.agenda.gerer_equipe'), ('planning.agenda.gerer_siens'), ('planning.agenda.voir'), ('prestations.duerp.gerer'), ('qualite.certification.gerer'), ('qualite.completude.suivre'), ('qualite.completude.supprimer'), ('qualite.documents.gerer'), ('qualite.documents.voir'), ('qualite.registres.gerer'), ('qualite.registres.signaler'), ('qualite.registres.voir'), ('rh.personnel.voir'), ('stock.articles.gerer'), ('stock.commandes.preparer'), ('stock.inventaires.valider'), ('stock.voir'), ('vehicules.parc.voir')) x(code)
where p.company_id is null and p.key = 'gestionnaire'
on conflict do nothing;
insert into public.permission_profile_rights (profile_id, right_code)
select p.id, x.code from public.permission_profiles p, (values ('clients.fiches.voir'), ('clients.historique.ecrire'), ('formation.catalogue.voir'), ('formation.documents.modifier'), ('formation.documents.voir'), ('formation.formateurs.modifier_sa_fiche'), ('formation.formateurs.voir'), ('formation.questions.modifier'), ('formation.sessions.modifier_siennes'), ('formation.sessions.voir_siennes'), ('formation.stagiaires.creer'), ('formation.stagiaires.modifier_siens'), ('formation.stagiaires.voir_siens'), ('interventions.contrats.voir'), ('interventions.parc.voir'), ('interventions.referentiel.voir'), ('interventions.tarifs.voir'), ('interventions.visites.voir'), ('organisation.comptes.voir'), ('organisation.journal.ecrire'), ('organisation.notifications.gerer'), ('organisation.preferences.gerer'), ('organisation.reglages.voir'), ('planning.agenda.gerer_siens'), ('planning.agenda.voir'), ('qualite.completude.suivre'), ('qualite.documents.voir'), ('qualite.registres.signaler'), ('qualite.registres.voir')) x(code)
where p.company_id is null and p.key = 'formateur'
on conflict do nothing;
insert into public.permission_profile_rights (profile_id, right_code)
select p.id, x.code from public.permission_profiles p, (values ('clients.espace.gerer'), ('clients.fiches.modifier'), ('clients.fiches.voir'), ('clients.historique.ecrire'), ('commercial.devis.envoyer'), ('commercial.devis.modifier'), ('commercial.devis.voir'), ('commercial.prospection.gerer'), ('commercial.prospection.voir'), ('communication.campagnes.gerer'), ('communication.reseaux.gerer'), ('facturation.brouillons.supprimer'), ('facturation.factures.envoyer'), ('facturation.factures.modifier'), ('facturation.factures.voir'), ('formation.catalogue.voir'), ('formation.convocations.envoyer'), ('formation.documents.modifier'), ('formation.documents.voir'), ('formation.formateurs.voir'), ('formation.inscriptions.gerer'), ('formation.questions.modifier'), ('formation.sessions.creer'), ('formation.sessions.modifier'), ('formation.sessions.preparer'), ('formation.sessions.voir'), ('formation.stagiaires.creer'), ('formation.stagiaires.modifier'), ('formation.stagiaires.voir'), ('formation.suivi.voir'), ('interventions.contrats.voir'), ('interventions.parc.voir'), ('interventions.referentiel.voir'), ('interventions.tarifs.voir'), ('interventions.visites.voir'), ('organisation.comptes.voir'), ('organisation.journal.ecrire'), ('organisation.notifications.gerer'), ('organisation.preferences.gerer'), ('organisation.reglages.voir'), ('planning.agenda.gerer_siens'), ('planning.agenda.voir'), ('qualite.completude.suivre'), ('qualite.documents.voir'), ('qualite.registres.signaler'), ('qualite.registres.voir')) x(code)
where p.company_id is null and p.key = 'commercial'
on conflict do nothing;
insert into public.permission_profile_rights (profile_id, right_code)
select p.id, x.code from public.permission_profiles p, (values ('interventions.missions.realiser'), ('interventions.missions.voir'), ('interventions.parc.annoter'), ('interventions.rapports.envoyer'), ('interventions.referentiel.voir'), ('organisation.comptes.voir'), ('organisation.journal.ecrire'), ('organisation.preferences.gerer'), ('organisation.reglages.voir'), ('stock.commandes.preparer'), ('stock.sien.mouvementer'), ('vehicules.siens.utiliser')) x(code)
where p.company_id is null and p.key = 'technicien'
on conflict do nothing;
insert into public.permission_profile_rights (profile_id, right_code)
select p.id, x.code from public.permission_profiles p, (values ('clients.fiches.voir'), ('clients.historique.ecrire'), ('commercial.devis.voir'), ('facturation.brouillons.supprimer'), ('facturation.export.comptable'), ('facturation.factures.envoyer'), ('facturation.factures.modifier'), ('facturation.factures.voir'), ('finance.budget.gerer'), ('formation.catalogue.voir'), ('formation.formateurs.voir'), ('formation.sessions.voir'), ('formation.stagiaires.voir'), ('organisation.comptes.voir'), ('organisation.journal.ecrire'), ('organisation.notifications.gerer'), ('organisation.preferences.gerer'), ('organisation.reglages.voir'), ('planning.agenda.gerer_siens'), ('planning.agenda.voir'), ('qualite.completude.suivre'), ('qualite.documents.voir'), ('stock.valeur.voir'), ('vehicules.couts.voir')) x(code)
where p.company_id is null and p.key = 'comptable'
on conflict do nothing;
insert into public.permission_profile_rights (profile_id, right_code)
select p.id, x.code from public.permission_profiles p, (values ('clients.fiches.voir'), ('facturation.brouillons.demander_confirmation'), ('facturation.export.comptable'), ('facturation.factures.voir'), ('organisation.preferences.gerer'), ('organisation.reglages.voir')) x(code)
where p.company_id is null and p.key = 'comptable_externe'
on conflict do nothing;
insert into public.permission_profile_rights (profile_id, right_code)
select p.id, x.code from public.permission_profiles p, (values ('manager.validations.voir'), ('organisation.comptes.voir'), ('organisation.notifications.gerer'), ('organisation.preferences.gerer'), ('organisation.reglages.voir'), ('planning.agenda.gerer_siens'), ('planning.agenda.voir'), ('rh.absences.valider'), ('rh.documents.restreints'), ('rh.dossiers.gerer'), ('rh.dossiers.voir'), ('rh.heures.valider'), ('rh.parametres.gerer'), ('rh.personnel.voir'), ('rh.salaires.voir')) x(code)
where p.company_id is null and p.key = 'rh'
on conflict do nothing;
insert into public.permission_profile_rights (profile_id, right_code)
select p.id, x.code from public.permission_profiles p, (values ('frais.notes.saisir'), ('organisation.preferences.gerer'), ('organisation.reglages.voir'), ('rh.absences.demander'), ('rh.heures.saisir'), ('rh.personnel.voir'), ('stock.sien.mouvementer'), ('vehicules.siens.utiliser')) x(code)
where p.company_id is null and p.key = 'salarie'
on conflict do nothing;
insert into public.permission_profile_rights (profile_id, right_code)
select p.id, x.code from public.permission_profiles p, (values ('clients.fiches.voir'), ('formation.catalogue.voir'), ('formation.documents.voir'), ('formation.formateurs.voir'), ('formation.sessions.voir'), ('formation.stagiaires.voir'), ('formation.suivi.voir'), ('interventions.contrats.voir'), ('interventions.parc.voir'), ('interventions.referentiel.voir'), ('interventions.tarifs.voir'), ('interventions.visites.voir'), ('organisation.comptes.voir'), ('organisation.journal.ecrire'), ('organisation.notifications.gerer'), ('organisation.preferences.gerer'), ('organisation.reglages.voir'), ('planning.agenda.gerer_siens'), ('planning.agenda.voir'), ('qualite.completude.suivre'), ('qualite.documents.voir'), ('qualite.registres.voir')) x(code)
where p.company_id is null and p.key = 'lecture'
on conflict do nothing;
insert into public.permission_profile_rights (profile_id, right_code)
select p.id, x.code from public.permission_profiles p, (values ('organisation.reglages.voir'), ('vehicules.ecran_mural.voir')) x(code)
where p.company_id is null and p.key = 'ecran'
on conflict do nothing;
-- membre : aucun droit (rôle de base vide)

insert into public.schema_migrations (version) values ('0372_droits_catalogue') on conflict (version) do nothing;

-- ===== supabase/migrations/0373_droits_regles.sql =====
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
  $r$(select app.a_le_droit('organisation.comptes.voir'))$r$,
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

-- ===== supabase/migrations/0374_droits_prix_terrain.sql =====
-- 0374_droits_prix_terrain.sql : prix cachés au technicien EN BASE (chantier C1b, décision du 17/10).
--
-- Depuis 0373, la lecture de itv_parts, itv_settings et itv_visit_parts (qui portent des prix) demande le droit
-- « Voir les prix des interventions » (interventions.tarifs.voir), que le modèle « technicien » n'a pas.
-- Le technicien lit à la place trois vues SANS AUCUNE colonne de prix, limitées à ses missions :
--   itv_parts_terrain         : catalogue des pièces (nom, unité, type), sans price_ht ;
--   itv_settings_terrain      : réglages du module, sans visit_fee_ht (forfait de visite) ;
--   itv_visit_parts_terrain   : pièces fournies des visites de ses clients, sans unit_price_ht.
-- Il ajoute, change la quantité et retire les pièces fournies de SES visites par trois fonctions contrôlées
-- (itv_visit_part_add, itv_visit_part_set_quantity, itv_visit_part_remove) : le prix unitaire est pris dans le
-- catalogue par la base, jamais envoyé ni renvoyé au technicien. Les comptes qui ont le droit des prix gardent la
-- lecture et l'écriture directes, inchangées.
--
-- Les vues sont exécutées avec les droits de leur propriétaire (vues « security definer ») : elles filtrent
-- elles-mêmes par les droits (fonction unique app.a_le_droit) et par le module Interventions. Le conseiller de
-- sécurité de Supabase les signale à ce titre : c'est voulu (colonnes choisies, lignes filtrées).
-- Migration idempotente. Retour arrière : supabase/rollback/0370-0375_droits_retour.sql

create or replace view public.itv_parts_terrain with (security_barrier = true) as
select p.id, p.name, p.unit, p.type_id, p.is_active, p.created_at
from public.itv_parts p
where (select app.module_on('interventions'))
  and ((select app.a_le_droit('interventions.missions.voir'))
       or (select app.a_le_droit('interventions.referentiel.voir')));
comment on view public.itv_parts_terrain is 'Catalogue des pièces sans prix (technicien) : jamais de colonne de prix';

create or replace view public.itv_settings_terrain with (security_barrier = true) as
select s.id, s.label_prefix, s.label_next, s.tva_rate, s.report_title, s.report_intro, s.report_mentions,
       s.site_observations, s.operation_labels, s.planning_start, s.updated_at
from public.itv_settings s
where (select app.module_on('interventions'))
  and ((select app.a_le_droit('interventions.missions.voir'))
       or (select app.a_le_droit('interventions.referentiel.voir')));
comment on view public.itv_settings_terrain is 'Réglages du module Interventions sans le forfait de visite (technicien)';

create or replace view public.itv_visit_parts_terrain with (security_barrier = true) as
select vp.id, vp.visit_id, vp.part_id, vp.label, vp.quantity, vp.created_at
from public.itv_visit_parts vp
where (select app.module_on('interventions'))
  and ((select app.a_le_droit('interventions.visites.voir'))
       or ((select app.a_le_droit('interventions.missions.voir'))
           and vp.visit_id in (select app.tech_scope_visit_ids())));
comment on view public.itv_visit_parts_terrain is 'Pièces fournies des visites sans prix unitaire (technicien : visites de ses clients)';

revoke all on public.itv_parts_terrain, public.itv_settings_terrain, public.itv_visit_parts_terrain from public, anon;
grant select on public.itv_parts_terrain, public.itv_settings_terrain, public.itv_visit_parts_terrain to authenticated, service_role;

-- Le compte connecté peut-il écrire les pièces fournies de cette visite ?
create or replace function app.itv_can_edit_visit_parts(p_visit uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select app.module_on('interventions'))
    and ((select app.a_le_droit('interventions.visites.gerer'))
         or ((select app.a_le_droit('interventions.missions.realiser'))
             and p_visit in (select app.tech_visit_ids()))), false)
$$;

-- Ligne renvoyée au navigateur : jamais de prix
create or replace function app.itv_visit_part_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', vp.id, 'visit_id', vp.visit_id, 'part_id', vp.part_id, 'label', vp.label,
                            'quantity', vp.quantity, 'created_at', vp.created_at)
  from public.itv_visit_parts vp where vp.id = p_id
$$;

-- Ajout d'une pièce fournie (prix unitaire pris dans le catalogue par la base ; saisie libre : 0)
create or replace function public.itv_visit_part_add(p_visit uuid, p_part uuid default null, p_label text default null,
                                                     p_quantity numeric default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_price numeric := 0;
  v_id uuid;
begin
  if not app.itv_can_edit_visit_parts(p_visit) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'Quantité invalide' using errcode = '22023';
  end if;
  if p_part is not null then
    select p.name, p.price_ht into v_name, v_price from public.itv_parts p where p.id = p_part;
    if v_name is null then
      raise exception 'Pièce inconnue' using errcode = '22023';
    end if;
  end if;
  v_name := coalesce(nullif(btrim(p_label), ''), v_name);
  if v_name is null then
    raise exception 'Libellé de la pièce manquant' using errcode = '22023';
  end if;
  insert into public.itv_visit_parts (visit_id, part_id, label, quantity, unit_price_ht)
  values (p_visit, p_part, left(v_name, 300), p_quantity, coalesce(v_price, 0))
  returning id into v_id;
  return app.itv_visit_part_json(v_id);
end
$$;

-- Nouvelle quantité d'une pièce fournie
create or replace function public.itv_visit_part_set_quantity(p_id uuid, p_quantity numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit uuid;
begin
  select vp.visit_id into v_visit from public.itv_visit_parts vp where vp.id = p_id;
  if v_visit is null or not app.itv_can_edit_visit_parts(v_visit) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'Quantité invalide' using errcode = '22023';
  end if;
  update public.itv_visit_parts set quantity = p_quantity where id = p_id;
  return app.itv_visit_part_json(p_id);
end
$$;

-- Retrait d'une pièce fournie
create or replace function public.itv_visit_part_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit uuid;
begin
  select vp.visit_id into v_visit from public.itv_visit_parts vp where vp.id = p_id;
  if v_visit is null or not app.itv_can_edit_visit_parts(v_visit) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  delete from public.itv_visit_parts where id = p_id;
end
$$;

revoke all on function app.itv_can_edit_visit_parts(uuid), app.itv_visit_part_json(uuid) from public, anon, authenticated;
revoke all on function public.itv_visit_part_add(uuid, uuid, text, numeric), public.itv_visit_part_set_quantity(uuid, numeric),
  public.itv_visit_part_remove(uuid) from public, anon;
grant execute on function public.itv_visit_part_add(uuid, uuid, text, numeric), public.itv_visit_part_set_quantity(uuid, numeric),
  public.itv_visit_part_remove(uuid) to authenticated, service_role;

insert into public.schema_migrations (version) values ('0374_droits_prix_terrain') on conflict (version) do nothing;

-- ===== supabase/migrations/0375_droits_validations.sql =====
-- 0375_droits_validations.sql : circuit de validation commun (chantier C1b, décisions du 17/10).
--
-- Un seul circuit pour factures, commandes d'achat, absences, heures, frais et devis (tables de 0370) :
--   * approval_rules : réglage par société et par périmètre (validations.circuits.configurer) :
--       mode none (aucune validation), always (tout est validé, même 1 centime), threshold (au-delà d'un montant) ;
--       droit du valideur (ex. stock.commandes.valider) et étapes en plus (cumul de fonctions : liste de droits) ;
--       factures : une règle par client possible (circuit choisi par client) ; sinon la règle de la société ;
--     sans règle : réglage par défaut ci-dessous (le plus prudent : tout est validé), sauf les devis (aucune) ;
--   * approval_requests : une demande par objet en attente ; écrite seulement par ces fonctions ;
--   * approval_delegations : une personne valide pour une autre pendant une période (validations.deleguer).
-- Personne ne valide sa propre demande ; un refus demande un motif ; chaque décision est écrite au journal d'audit
-- (sans montant ni contenu de l'objet). Les modules (Facturation fiable, RH, Stock, frais, Manager) appellent
-- approval_submit à leur étape « à valider » : aucun module n'y est branché par C1b.
-- Migration idempotente. Retour arrière : supabase/rollback/0370-0375_droits_retour.sql

-- Réglage qui s'applique (règle du client, sinon de la société, sinon défaut du produit)
create or replace function app.approval_rule_for(p_company uuid, p_scope text, p_client uuid)
returns table (mode text, threshold numeric, validator_right text, extra_steps jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select r.mode, r.threshold, r.validator_right, r.extra_steps
  from (
    select r.mode, r.threshold, r.validator_right, r.extra_steps, 1 as rang
    from public.approval_rules r
    where r.company_id = p_company and r.scope = p_scope and r.is_active and p_client is not null and r.client_id = p_client
    union all
    select r.mode, r.threshold, r.validator_right, r.extra_steps, 2
    from public.approval_rules r
    where r.company_id = p_company and r.scope = p_scope and r.is_active and r.client_id is null
    union all
    select d.mode, null::numeric, d.validator_right, '[]'::jsonb, 3
    from (values ('invoice', 'always', 'facturation.factures.valider'),
                 ('purchase_order', 'always', 'stock.commandes.valider'),
                 ('absence', 'always', 'rh.absences.valider'),
                 ('timesheet', 'always', 'rh.heures.valider'),
                 ('expense', 'always', 'frais.notes.valider'),
                 ('quote', 'none', 'commercial.devis.modifier')) d(scope, mode, validator_right)
    where d.scope = p_scope
  ) r
  order by r.rang
  limit 1
$$;

-- Faut-il une validation ? (pour l'écran : avant d'envoyer, afficher « sera validé par… »)
create or replace function public.approval_required(p_scope text, p_amount numeric default null, p_client uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.current_company();
  r record;
begin
  if app.role() is null or v_company is null then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select * into r from app.approval_rule_for(v_company, p_scope, p_client);
  if r.mode is null then
    raise exception 'Périmètre inconnu : %', p_scope using errcode = '22023';
  end if;
  return jsonb_build_object(
    'required', r.mode = 'always' or (r.mode = 'threshold' and coalesce(p_amount, 0) > r.threshold),
    'mode', r.mode, 'threshold', r.threshold,
    'steps', jsonb_build_array(r.validator_right) || coalesce(r.extra_steps, '[]'::jsonb));
end
$$;

-- Dépôt d'une demande ; renvoie l'identifiant, ou null si aucune validation n'est requise
create or replace function public.approval_submit(p_scope text, p_object_table text, p_object_id uuid,
                                                  p_amount numeric default null, p_client uuid default null,
                                                  p_label text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.current_company();
  v_need jsonb;
  v_id uuid;
begin
  if app.role() is null or v_company is null then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if p_object_table !~ '^[a-z_][a-z0-9_]{0,62}$' or to_regclass('public.' || p_object_table) is null then
    raise exception 'Objet inconnu' using errcode = '22023';
  end if;
  v_need := public.approval_required(p_scope, p_amount, p_client);
  if not (v_need ->> 'required')::boolean then
    return null;
  end if;
  insert into public.approval_requests (company_id, scope, object_table, object_id, client_id, amount, label,
                                        requested_by, steps, history)
  values (v_company, p_scope, p_object_table, p_object_id, p_client, p_amount, left(p_label, 200),
          (select auth.uid()), v_need -> 'steps',
          jsonb_build_array(jsonb_build_object('at', now(), 'by', (select auth.uid()), 'action', 'submitted')))
  returning id into v_id;
  return v_id;
end
$$;

-- Décision : approved (étape suivante, ou demande validée à la dernière étape) ou rejected (motif obligatoire)
create or replace function public.approval_decide(p_request uuid, p_decision text, p_comment text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.approval_requests;
  v_right text;
  v_as uuid;
  v_status text;
begin
  select * into r from public.approval_requests where id = p_request for update;
  if r.id is null then
    raise exception 'Demande introuvable' using errcode = '22023';
  end if;
  v_right := r.steps ->> r.current_step;
  if not app.approval_can_decide(r.company_id, r.scope, v_right, r.requested_by, r.status) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Décision inconnue : %', p_decision using errcode = '22023';
  end if;
  if p_decision = 'rejected' and char_length(btrim(coalesce(p_comment, ''))) < 3 then
    raise exception 'Un refus demande un motif' using errcode = '22023';
  end if;
  -- Décision au nom d'une autre personne (délégation) : notée
  if not app.a_le_droit_dans(r.company_id, v_right) then
    select d.from_profile into v_as from public.approval_delegations d
    where d.company_id = r.company_id and d.to_profile = (select auth.uid()) and d.revoked_at is null
      and now() >= d.starts_at and now() < d.ends_at and (d.scope is null or d.scope = r.scope)
      and v_right = any (app.rights_for(d.from_profile, r.company_id))
    order by d.created_at limit 1;
  end if;
  v_status := case when p_decision = 'rejected' then 'rejected'
                   when r.current_step + 1 >= jsonb_array_length(r.steps) then 'approved'
                   else 'pending' end;
  update public.approval_requests set
    status = v_status,
    current_step = case when v_status = 'pending' then r.current_step + 1 else r.current_step end,
    history = r.history || jsonb_build_array(jsonb_build_object('at', now(), 'by', (select auth.uid()), 'as', v_as,
                                                                'action', p_decision, 'step', r.current_step,
                                                                'comment', left(p_comment, 500))),
    decided_by = case when v_status <> 'pending' then (select auth.uid()) end,
    decided_at = case when v_status <> 'pending' then now() end,
    decision_comment = case when v_status <> 'pending' then left(p_comment, 500) end,
    updated_at = now()
  where id = r.id;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'system', r.id, 'Validation : ' || p_decision,
          jsonb_build_object('company_id', r.company_id, 'scope', r.scope, 'object_table', r.object_table,
                             'step', r.current_step, 'on_behalf_of', v_as, 'status', v_status));
  return v_status;
end
$$;

-- Retrait d'une demande par son auteur, tant qu'elle est en attente
create or replace function public.approval_cancel(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.approval_requests set status = 'cancelled', updated_at = now(),
         history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', (select auth.uid()), 'action', 'cancelled'))
  where id = p_request and status = 'pending' and requested_by = (select auth.uid());
  if not found then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
end
$$;

-- Délégation de ses validations à une autre personne de la société courante
create or replace function public.approval_delegate(p_to uuid, p_ends_at timestamptz, p_reason text,
                                                    p_scope text default null, p_starts_at timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.current_company();
  v_id uuid;
begin
  if v_company is null or not app.a_le_droit('validations.deleguer') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if not exists (select 1 from public.company_members m join public.profiles p on p.id = m.profile_id
                 where m.company_id = v_company and m.profile_id = p_to and m.is_active and p.is_active) then
    raise exception 'La personne choisie n''appartient pas à la société' using errcode = '22023';
  end if;
  insert into public.approval_delegations (company_id, from_profile, to_profile, scope, starts_at, ends_at, reason, created_by)
  values (v_company, (select auth.uid()), p_to, p_scope, coalesce(p_starts_at, now()), p_ends_at, btrim(p_reason),
          (select auth.uid()))
  returning id into v_id;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'create', 'system', v_id, 'Délégation de validation',
          jsonb_build_object('company_id', v_company, 'to', p_to, 'scope', p_scope, 'until', p_ends_at));
  return v_id;
end
$$;

-- Fin d'une délégation (par celui qui l'a donnée, ou par le centre de validations)
create or replace function public.approval_delegation_revoke(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.approval_delegations d set revoked_at = now(), revoked_by = (select auth.uid())
  where d.id = p_id and d.revoked_at is null
    and (d.from_profile = (select auth.uid()) or app.a_le_droit_dans(d.company_id, 'manager.validations.voir'));
  if not found then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
end
$$;

revoke all on function app.approval_rule_for(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.approval_required(text, numeric, uuid), public.approval_submit(text, text, uuid, numeric, uuid, text),
  public.approval_decide(uuid, text, text), public.approval_cancel(uuid),
  public.approval_delegate(uuid, timestamptz, text, text, timestamptz), public.approval_delegation_revoke(uuid)
  from public, anon;
grant execute on function public.approval_required(text, numeric, uuid), public.approval_submit(text, text, uuid, numeric, uuid, text),
  public.approval_decide(uuid, text, text), public.approval_cancel(uuid),
  public.approval_delegate(uuid, timestamptz, text, text, timestamptz), public.approval_delegation_revoke(uuid)
  to authenticated, service_role;

insert into public.schema_migrations (version) values ('0375_droits_validations') on conflict (version) do nothing;

-- ===== Photographie des lectures après C1b (comparée par droits_chantier2.sql) =====
select pg_temp.essai_compter(true);

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
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'pp\_%'
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
      delete from public.company_members where company_id in (c_x, c_y);
      delete from public.companies where id in (c_x, c_y);
    end;
  end if;

  raise exception E'RÉSULTAT DES TESTS DE DROITS (tout est annulé)\n%\n\n% test(s), % échec(s)',
    array_to_string(v_lines, E'\n'), v_total, v_fail;
end
$test$;
