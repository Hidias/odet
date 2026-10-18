-- FICHIER GÉNÉRÉ par scripts/securite/essai_societes.py : ne pas modifier à la main.
-- Essai du retour arrière du socle multi-sociétés (C1a) en transaction annulée : photographie de l'état
-- (structure des schémas public et app, registre des migrations, réglages, profils, modules), 0270 à 0273,
-- réglage de l'instance, retour arrière, comparaison. Se termine TOUJOURS par l'erreur volontaire
-- « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE C1a » : tout est annulé. Aucune validation de transaction.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '180s', true);

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
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t;
create temp table etat_essai_avant as select * from etat_essai;

-- ===== supabase/migrations/0270_societes_tables.sql =====
-- 0270_societes_tables.sql : socle multi-sociétés (chantier C1a), tables.
--
-- Quatre niveaux facultatifs (spec odet-multi-entreprise-spec.md v2) : groupe (organization_settings, existant),
-- société (companies), établissement (company_establishments), enseigne (C3, plus tard).
-- Ici : sociétés, établissements, appartenances et rôle par société, profils de droits par appartenance
-- (vide, préparé pour C1b), modules par société, fenêtres d'accès de support.
--
-- Aucune table métier n'est touchée : le rattachement des données existantes (company_id) est le chantier C2.
-- Règles d'accès de ces tables : 0273 (générée par scripts/securite/regles.py).
-- Migration additive et idempotente. Retour arrière : supabase/rollback/0270-0273_societes_retour.sql

-- Sociétés (personnes morales)
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (char_length(btrim(legal_name)) > 0),
  short_name text,
  legal_form text,
  capital text,
  siren varchar(9),
  vat_number text,
  vat_applicable boolean not null default true,
  rcs text,
  naf text,
  idcc text,
  fiscal_year_start_month integer not null default 1 check (fiscal_year_start_month between 1 and 12),
  is_training_org boolean not null default false,
  nda text,
  address text,
  postal_code text,
  city text,
  phone text,
  email text,
  website text,
  bank_name text,
  iban text,
  bic text,
  logo_url text,
  doc_prefix text,
  -- Société qui porte l'instance (n° 1) : une seule
  is_instance_owner boolean not null default false,
  -- Licence totale : l'administrateur de la société a accès aux réglages (décision du 17/10, réglée par l'éditeur)
  full_license boolean not null default false,
  -- Accès de support de l'éditeur aux données métier de la société :
  --   permanent : toujours, chaque lecture tracée ; on_demand : seulement pendant une fenêtre ouverte par
  --   l'administrateur de la société ; none : jamais. Défaut du produit : à la demande.
  support_access_mode text not null default 'on_demand' check (support_access_mode in ('permanent', 'on_demand', 'none')),
  support_access_hours integer not null default 24 check (support_access_hours between 1 and 168),
  status text not null default 'active' check (status in ('active', 'archived')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.companies is 'Sociétés (personnes morales) de l''instance : identité juridique, banque, préfixe, modules, accès de support';
create unique index if not exists companies_instance_owner_uniq on public.companies (is_instance_owner) where is_instance_owner;

-- Établissements (SIRET)
create table if not exists public.company_establishments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  siret varchar(14),
  name text,
  brand_name text,
  address text,
  postal_code text,
  city text,
  is_head_office boolean not null default false,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.company_establishments is 'Établissements des sociétés (SIRET, adresse, enseigne officielle)';
create index if not exists company_establishments_company_idx on public.company_establishments (company_id);
create unique index if not exists company_establishments_siret_uniq on public.company_establishments (company_id, siret)
  where siret is not null;

-- Appartenances : un compte, plusieurs sociétés, un rôle par société.
-- Le super administrateur (rôle de plateforme) n'a pas d'appartenance : son accès passe par l'accès de support.
create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture')),
  can_consolidate boolean not null default false,
  is_default boolean not null default false,
  is_active boolean not null default true,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, profile_id)
);
comment on table public.company_members is 'Appartenances des comptes aux sociétés : rôle par société, vue groupe, société par défaut';
create index if not exists company_members_profile_idx on public.company_members (profile_id);
create unique index if not exists company_members_default_uniq on public.company_members (profile_id) where is_default;

-- Profils de droits par appartenance (plusieurs par personne et par société) : vide, défini par C1b
create table if not exists public.company_member_roles (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.company_members (id) on delete cascade,
  role_key text not null check (char_length(btrim(role_key)) > 0),
  granted_by uuid,
  granted_at timestamptz not null default now(),
  unique (member_id, role_key)
);
comment on table public.company_member_roles is 'Profils de droits d''une appartenance (plusieurs par personne et par société) : défini par C1b';

-- Modules actifs par société (org_modules = modules installés sur l'instance)
create table if not exists public.company_modules (
  company_id uuid not null references public.companies (id) on delete restrict,
  key text not null references public.org_modules (key) on update cascade on delete cascade,
  enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (company_id, key)
);
comment on table public.company_modules is 'Modules actifs dans chaque société (parmi les modules installés, org_modules)';

-- Fenêtres d'accès de support (mode « à la demande ») : ouvertes par l'administrateur de la société
create table if not exists public.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  opened_by uuid,
  opened_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  closed_at timestamptz,
  closed_by uuid,
  check (expires_at > opened_at)
);
comment on table public.support_access_grants is 'Fenêtres d''accès de support de l''éditeur aux données métier d''une société (mode à la demande)';
create index if not exists support_access_grants_company_idx on public.support_access_grants (company_id, expires_at desc);

-- Aucune table ouverte avant ses règles (0273)
alter table public.companies enable row level security;
alter table public.company_establishments enable row level security;
alter table public.company_members enable row level security;
alter table public.company_member_roles enable row level security;
alter table public.company_modules enable row level security;
alter table public.support_access_grants enable row level security;

insert into public.schema_migrations (version) values ('0270_societes_tables') on conflict (version) do nothing;

-- ===== supabase/migrations/0271_societes_fonctions.sql =====
-- 0271_societes_fonctions.sql : socle multi-sociétés (chantier C1a), fonctions.
--
-- Société courante : envoyée par l'application dans l'en-tête x-company-id de chaque requête, lue en base par
-- app.current_company() et CONTRÔLÉE contre les sociétés visibles du compte ; une valeur absente, mal formée,
-- inconnue ou non autorisée retombe sur la société par défaut du compte, jamais sur une autre.
--
-- Sociétés visibles : appartenances actives d'un compte actif ; pour le super administrateur (rôle de plateforme,
-- sans appartenance), les sociétés dont l'accès de support est ouvert (mode permanent, ou fenêtre ouverte par
-- l'administrateur de la société en mode à la demande).
--
-- app.role() n'est PAS modifiée : le rôle utilisé par les règles reste celui du profil (une seule société).
-- app.company_role() donne déjà le rôle dans une société ; C1b et C2 s'en serviront.
--
-- Trace de l'accès de support : PostgREST exécute les lectures (GET) dans des transactions en lecture seule,
-- la base ne peut donc pas écrire au journal pendant une lecture. L'application envoie par lots les tables lues
-- par le super administrateur à public.support_trace(), qui contrôle l'appelant et écrit au journal d'audit
-- (société, mode, fenêtre, tables, page ; jamais de valeur lue).
-- Migration idempotente. Retour arrière : supabase/rollback/0270-0273_societes_retour.sql

-- En-tête x-company-id de la requête (uuid bien formé, sinon null)
create or replace function app.header_company()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_h text;
  v text;
begin
  v_h := current_setting('request.headers', true);
  if v_h is null or v_h = '' then
    return null;
  end if;
  v := v_h::json ->> 'x-company-id';
  if v is null or v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return v::uuid;
exception when others then
  return null;
end
$$;

-- Accès de support ouvert pour une société (mode permanent, ou fenêtre en cours en mode à la demande)
create or replace function app.support_open(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.companies c
    where c.id = p_company
      and (c.support_access_mode = 'permanent'
           or (c.support_access_mode = 'on_demand'
               and exists (select 1 from public.support_access_grants g
                           where g.company_id = c.id and g.closed_at is null and g.expires_at > now()))))
$$;

-- Sociétés visibles par le compte connecté
create or replace function app.visible_companies()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.company_id
  from public.company_members m
  join public.profiles p on p.id = m.profile_id
  where m.profile_id = (select auth.uid()) and m.is_active and p.is_active and p.role <> 'superadmin'
  union
  select c.id from public.companies c
  where (select app.is_superadmin()) and app.support_open(c.id)
$$;

-- Société courante : en-tête contrôlé, sinon société par défaut, sinon première société visible ; null si aucune
create or replace function app.current_company()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select h.v from (select app.header_company() as v) h
      where h.v in (select app.visible_companies())),
    (select m.company_id from public.company_members m
      where m.profile_id = (select auth.uid()) and m.is_active and m.is_default
        and m.company_id in (select app.visible_companies())
      limit 1),
    (select c.id from public.companies c
      where c.id in (select app.visible_companies())
      order by c.is_instance_owner desc, c.position, c.created_at
      limit 1))
$$;

-- Rôle du compte connecté dans une société (par défaut la société courante) ; null si aucun accès
create or replace function app.company_role(p_company uuid default null)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.role() is null then null
    when app.is_superadmin() then
      case when app.support_open(coalesce(p_company, app.current_company())) then 'superadmin' end
    else (select m.role from public.company_members m
          where m.profile_id = (select auth.uid()) and m.is_active
            and m.company_id = coalesce(p_company, app.current_company()))
  end
$$;

-- Administrateur d'une société (administrateur membre, ou super administrateur avec accès de support ouvert)
create or replace function app.is_company_admin(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.company_role(p_company) = any (array['superadmin', 'admin']), false)
$$;

-- Tables de plateforme (réglages, comptes, journal) : leur lecture n'est pas une lecture de données métier
create or replace function app.support_platform_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'profiles', 'org_modules', 'organization_settings', 'org_settings', 'app_versions', 'schema_migrations',
    'dashboard_widget_configs', 'user_email_configs', 'audit_logs', 'error_logs', 'user_feedback', 'demo_records',
    'companies', 'company_establishments', 'company_members', 'company_member_roles', 'company_modules',
    'support_access_grants'
  ]::text[]
$$;

-- Garde des champs sensibles d'une société : le mode d'accès de support ne change que par
-- public.company_set_support_mode (administrateur de la société) ; licence totale et société n° 1 : super administrateur.
-- Les migrations et le serveur (sans compte connecté) ne sont pas concernés.
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

drop trigger if exists companies_guard on public.companies;
create trigger companies_guard before update on public.companies
  for each row execute function app.companies_guard();

-- Sociétés du compte connecté (pour l'écran de choix et le sélecteur, C3)
create or replace function public.my_companies()
returns table (id uuid, legal_name text, short_name text, logo_url text, status text, role text,
               is_default boolean, is_current boolean, support_access_mode text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.legal_name, c.short_name, c.logo_url, c.status, app.company_role(c.id),
         coalesce((select m.is_default from public.company_members m
                   where m.company_id = c.id and m.profile_id = (select auth.uid())), false),
         c.id = app.current_company(),
         c.support_access_mode
  from public.companies c
  where c.id in (select app.visible_companies())
  order by c.is_instance_owner desc, c.position, c.legal_name
$$;

-- Trace des lectures de données métier par le super administrateur (envoyée par lots par l'application)
create or replace function public.support_trace(p_tables text[], p_path text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tables text[];
  v_company uuid;
  v_name text;
  v_mode text;
begin
  if not app.is_superadmin() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select array_agg(distinct t order by t) into v_tables
  from unnest((coalesce(p_tables, '{}'::text[]))[1:100]) t
  where t ~ '^[a-z_][a-z0-9_]{0,62}$'
    and to_regclass('public.' || t) is not null
    and t <> all (app.support_platform_tables());
  if v_tables is null then
    return 0;
  end if;
  -- Société demandée par l'application (même hors accès ouvert : la trace le dit), sinon société courante
  v_company := coalesce((select c.id from public.companies c where c.id = app.header_company()),
                        app.current_company(),
                        (select c.id from public.companies c where c.is_instance_owner));
  select c.legal_name, c.support_access_mode into v_name, v_mode from public.companies c where c.id = v_company;
  if v_name is null then
    return 0;
  end if;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'view', 'system',
          'Accès de support aux données de ' || v_name,
          jsonb_build_object('support', true, 'company_id', v_company, 'mode', v_mode,
                             'fenetre_ouverte', app.support_open(v_company), 'tables', to_jsonb(v_tables),
                             'page', left(split_part(coalesce(p_path, ''), '?', 1), 200)));
  return 1;
end
$$;

-- Ouverture d'une fenêtre d'accès de support (mode à la demande) par l'administrateur de la société
create or replace function public.support_access_open(p_company uuid, p_reason text, p_hours integer default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_hours integer;
  v_until timestamptz;
begin
  if coalesce(app.company_role(p_company), '') <> 'admin' then
    raise exception 'Accès refusé : réservé à l''administrateur de la société' using errcode = '42501';
  end if;
  select c.support_access_mode, c.support_access_hours into v_mode, v_hours from public.companies c where c.id = p_company;
  if v_mode <> 'on_demand' then
    raise exception 'Le mode d''accès de support de cette société n''est pas « à la demande »' using errcode = '22023';
  end if;
  v_hours := least(greatest(coalesce(p_hours, v_hours), 1), 168);
  v_until := now() + make_interval(hours => v_hours);
  insert into public.support_access_grants (company_id, opened_by, expires_at, reason)
  values (p_company, (select auth.uid()), v_until, btrim(p_reason));
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'system', 'Accès de support ouvert',
          jsonb_build_object('support', true, 'company_id', p_company, 'jusqu_au', v_until, 'heures', v_hours));
  return v_until;
end
$$;

-- Fermeture des fenêtres ouvertes par l'administrateur de la société
create or replace function public.support_access_close(p_company uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if coalesce(app.company_role(p_company), '') <> 'admin' then
    raise exception 'Accès refusé : réservé à l''administrateur de la société' using errcode = '42501';
  end if;
  update public.support_access_grants
     set closed_at = now(), closed_by = (select auth.uid())
   where company_id = p_company and closed_at is null and expires_at > now();
  get diagnostics v_n = row_count;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'system', 'Accès de support fermé',
          jsonb_build_object('support', true, 'company_id', p_company, 'fenetres_fermees', v_n));
  return v_n;
end
$$;

-- Mode d'accès de support d'une société : décidé par l'administrateur de la société (propriétaire des données)
create or replace function public.company_set_support_mode(p_company uuid, p_mode text, p_hours integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if coalesce(app.company_role(p_company), '') <> 'admin' then
    raise exception 'Accès refusé : réservé à l''administrateur de la société' using errcode = '42501';
  end if;
  if p_mode not in ('permanent', 'on_demand', 'none') then
    raise exception 'Mode inconnu : %', p_mode using errcode = '22023';
  end if;
  select c.support_access_mode into v_old from public.companies c where c.id = p_company;
  perform set_config('odet.changement_acces_support', 'oui', true);
  update public.companies
     set support_access_mode = p_mode,
         support_access_hours = coalesce(least(greatest(p_hours, 1), 168), support_access_hours)
   where id = p_company;
  perform set_config('odet.changement_acces_support', '', true);
  if p_mode <> 'on_demand' then
    update public.support_access_grants set closed_at = now(), closed_by = (select auth.uid())
     where company_id = p_company and closed_at is null and expires_at > now();
  end if;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'system', 'Mode d''accès de support modifié',
          jsonb_build_object('support', true, 'company_id', p_company, 'avant', v_old, 'apres', p_mode));
end
$$;

revoke all on function app.header_company(), app.support_open(uuid), app.visible_companies(), app.current_company(),
  app.company_role(uuid), app.is_company_admin(uuid), app.support_platform_tables(), app.companies_guard() from public, anon;
grant execute on function app.header_company(), app.support_open(uuid), app.visible_companies(), app.current_company(),
  app.company_role(uuid), app.is_company_admin(uuid), app.support_platform_tables() to authenticated, service_role;
revoke all on function public.my_companies(), public.support_trace(text[], text), public.support_access_open(uuid, text, integer),
  public.support_access_close(uuid), public.company_set_support_mode(uuid, text, integer) from public, anon;
grant execute on function public.my_companies(), public.support_trace(text[], text), public.support_access_open(uuid, text, integer),
  public.support_access_close(uuid), public.company_set_support_mode(uuid, text, integer) to authenticated, service_role;

insert into public.schema_migrations (version) values ('0271_societes_fonctions') on conflict (version) do nothing;

-- ===== supabase/migrations/0272_societes_reprise.sql =====
-- 0272_societes_reprise.sql : socle multi-sociétés (chantier C1a), reprise de l'existant et recopies.
--
-- 1. Société n° 1 créée à partir des réglages de l'organisme (organization_settings), sans ressaisie ni valeur en dur.
-- 2. Établissement siège depuis le SIRET de l'organisme.
-- 3. Chaque compte interne actif ou non (hors super administrateur, rôle de plateforme, et hors comptes externes)
--    reçoit une appartenance à la société n° 1 avec son rôle actuel ; vue groupe pour les administrateurs.
-- 4. Modules de la société n° 1 = modules actifs aujourd'hui.
-- 5. Recopies à sens unique, tant que les écrans de C3 n'existent pas (une seule source de saisie) :
--    organization_settings → société n° 1 (identité juridique, banque, préfixe) ;
--    profiles (rôle, actif) → appartenance à la société n° 1 ;
--    org_modules (actif) → modules de la société n° 1.
--    C2 et C3 retireront ces recopies quand les écrans liront et écriront la société directement.
--
-- Le mode d'accès de support reste celui du produit (à la demande) : le choix propre à une instance est posé à part
-- (pour GLD : supabase/instances/odet-gld/c1a_acces_support_permanent.sql, décision du 17/10).
-- Migration idempotente. Retour arrière : supabase/rollback/0270-0273_societes_retour.sql

-- Rôles internes qui reçoivent une appartenance
create or replace function app.member_role(p_role text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_role in ('admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture')
              then p_role end
$$;

-- organization_settings → société n° 1 (créée si elle n'existe pas encore)
create or replace function app.copy_settings_to_owner(p_s public.organization_settings)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select c.id into v_id from public.companies c where c.is_instance_owner;
  if v_id is null then
    insert into public.companies (legal_name, is_instance_owner)
    values (coalesce(nullif(btrim(p_s.legal_name), ''), nullif(btrim(p_s.name), ''), 'Société'), true)
    returning id into v_id;
  end if;
  update public.companies c set
    legal_name = coalesce(nullif(btrim(p_s.legal_name), ''), nullif(btrim(p_s.name), ''), c.legal_name),
    short_name = nullif(btrim(p_s.name), ''),
    legal_form = nullif(btrim(p_s.forme_juridique), ''),
    capital = nullif(btrim(p_s.capital_social), ''),
    siren = coalesce(nullif(left(regexp_replace(coalesce(p_s.siren, ''), '\D', '', 'g'), 9), ''),
                     nullif(left(regexp_replace(coalesce(p_s.siret, ''), '\D', '', 'g'), 9), '')),
    vat_number = nullif(btrim(p_s.tva_intra), ''),
    vat_applicable = coalesce(p_s.tva_applicable, true),
    rcs = nullif(btrim(p_s.rcs), ''),
    naf = nullif(btrim(p_s.naf), ''),
    fiscal_year_start_month = coalesce(p_s.exercice_start_month, c.fiscal_year_start_month),
    is_training_org = coalesce(p_s.activity_kind in ('formation', 'mixte'), false) or coalesce(nullif(btrim(p_s.nda), ''), '') <> '',
    nda = nullif(btrim(p_s.nda), ''),
    address = p_s.address,
    postal_code = p_s.postal_code,
    city = p_s.city,
    phone = p_s.phone,
    email = p_s.email,
    website = p_s.website,
    bank_name = p_s.bank_name,
    iban = p_s.iban,
    bic = p_s.bic,
    logo_url = p_s.logo_url,
    doc_prefix = p_s.doc_prefix,
    updated_at = now()
  where c.id = v_id;
  -- Établissement siège (SIRET de l'organisme)
  if length(regexp_replace(coalesce(p_s.siret, ''), '\D', '', 'g')) = 14 then
    if exists (select 1 from public.company_establishments e where e.company_id = v_id and e.is_head_office) then
      update public.company_establishments e set
        siret = regexp_replace(p_s.siret, '\D', '', 'g'), name = nullif(btrim(p_s.name), ''),
        address = p_s.address, postal_code = p_s.postal_code, city = p_s.city, updated_at = now()
      where e.company_id = v_id and e.is_head_office;
    else
      insert into public.company_establishments (company_id, siret, name, address, postal_code, city, is_head_office)
      values (v_id, regexp_replace(p_s.siret, '\D', '', 'g'), nullif(btrim(p_s.name), ''), p_s.address, p_s.postal_code,
              p_s.city, true)
      on conflict do nothing;
    end if;
  end if;
end
$$;

create or replace function app.sync_owner_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.copy_settings_to_owner(new);
  return new;
end
$$;

-- profiles → appartenance à la société n° 1 (rôle et activité) ; super administrateur et comptes externes : aucune
create or replace function app.sync_profile_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_role text := app.member_role(new.role);
begin
  select c.id into v_company from public.companies c where c.is_instance_owner;
  if v_company is null then
    return new;
  end if;
  if v_role is null then
    update public.company_members m set is_active = false, updated_at = now()
     where m.company_id = v_company and m.profile_id = new.id and m.is_active;
    return new;
  end if;
  insert into public.company_members (company_id, profile_id, role, can_consolidate, is_default, is_active)
  values (v_company, new.id, v_role, v_role = 'admin',
          not exists (select 1 from public.company_members d where d.profile_id = new.id and d.is_default),
          coalesce(new.is_active, true))
  on conflict (company_id, profile_id) do update
    set role = excluded.role, is_active = excluded.is_active, updated_at = now();
  return new;
end
$$;

-- org_modules → modules de la société n° 1
create or replace function app.sync_owner_modules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select c.id into v_company from public.companies c where c.is_instance_owner;
  if v_company is null then
    return new;
  end if;
  insert into public.company_modules (company_id, key, enabled)
  values (v_company, new.key, coalesce(new.enabled, false))
  on conflict (company_id, key) do update set enabled = excluded.enabled, updated_at = now();
  return new;
end
$$;

revoke all on function app.member_role(text), app.copy_settings_to_owner(public.organization_settings), app.sync_owner_company(), app.sync_profile_member(), app.sync_owner_modules()
  from public, anon, authenticated;

-- Reprise : société n° 1 depuis la fiche de l'organisme (la plus ancienne s'il y en avait plusieurs),
-- sans toucher à la fiche elle-même
select app.copy_settings_to_owner(o)
from public.organization_settings o
where not exists (select 1 from public.companies where is_instance_owner)
order by o.created_at nulls last, o.id
limit 1;

drop trigger if exists organization_settings_sync_company on public.organization_settings;
create trigger organization_settings_sync_company after insert or update on public.organization_settings
  for each row execute function app.sync_owner_company();

-- Appartenances des comptes existants
insert into public.company_members (company_id, profile_id, role, can_consolidate, is_default, is_active)
select c.id, p.id, app.member_role(p.role), p.role = 'admin', true, coalesce(p.is_active, true)
from public.profiles p
cross join public.companies c
where c.is_instance_owner and app.member_role(p.role) is not null
on conflict (company_id, profile_id) do nothing;

drop trigger if exists profiles_sync_company_member on public.profiles;
create trigger profiles_sync_company_member after insert or update of role, is_active on public.profiles
  for each row execute function app.sync_profile_member();

-- Modules de la société n° 1
insert into public.company_modules (company_id, key, enabled)
select c.id, m.key, coalesce(m.enabled, false)
from public.org_modules m cross join public.companies c
where c.is_instance_owner
on conflict (company_id, key) do nothing;

drop trigger if exists org_modules_sync_company on public.org_modules;
create trigger org_modules_sync_company after insert or update of enabled on public.org_modules
  for each row execute function app.sync_owner_modules();

insert into public.schema_migrations (version) values ('0272_societes_reprise') on conflict (version) do nothing;

-- ===== supabase/migrations/0273_societes_regles.sql =====
-- 0273_societes_regles.sql : règles d'accès des tables du socle multi-sociétés (chantier C1a).
-- FICHIER GÉNÉRÉ par scripts/securite/regles.py (matrice MS). Ne pas modifier à la main.
--
-- Même principe que 0082 : une règle par action et par table pour authenticated ; aucune pour anon.
-- Termine par la photographie des tables existantes (app.tables_avant_societes) : toute table créée après
-- cette migration doit naître avec une colonne company_id (contrôlé par supabase/tests/droits_chantier2.sql).
-- Migration idempotente. Retour arrière : supabase/rollback/0270-0273_societes_retour.sql

-- Droits des tables : rien pour anon ; ni TRUNCATE, ni TRIGGER, ni REFERENCES pour les comptes connectés
do $$
declare t text;
begin
  foreach t in array array['companies', 'company_establishments', 'company_member_roles', 'company_members', 'company_modules', 'support_access_grants'] loop
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke truncate, trigger, references on table public.%I from authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end $$;

-- Suppression des règles existantes de ces tables
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['companies', 'company_establishments', 'company_member_roles', 'company_members', 'company_modules', 'support_access_grants']) loop
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


-- companies
select pg_temp.regles(array['companies'], null,
  $r$(id in (select app.visible_companies()) or (select app.is_superadmin()))$r$,
  $r$(select app.is_superadmin())$r$,
  $r$((select app.is_superadmin()) or (app.is_company_admin(id) and full_license))$r$,
  null);

-- company_establishments
select pg_temp.regles(array['company_establishments'], null,
  $r$(company_id in (select app.visible_companies()) or (select app.is_superadmin()))$r$,
  $r$((select app.is_superadmin()) or (app.is_company_admin(company_id) and exists (select 1 from public.companies c where c.id = company_id and c.full_license)))$r$,
  $r$((select app.is_superadmin()) or (app.is_company_admin(company_id) and exists (select 1 from public.companies c where c.id = company_id and c.full_license)))$r$,
  $r$(select app.is_superadmin())$r$);

-- company_member_roles
select pg_temp.regles(array['company_member_roles'], null,
  $r$member_id in (select m.id from public.company_members m)$r$,
  $r$member_id in (select m.id from public.company_members m where app.is_company_admin(m.company_id))$r$,
  $r$member_id in (select m.id from public.company_members m where app.is_company_admin(m.company_id))$r$,
  $r$member_id in (select m.id from public.company_members m where app.is_company_admin(m.company_id))$r$);

-- company_members
select pg_temp.regles(array['company_members'], null,
  $r$(profile_id = (select auth.uid()) or app.is_company_admin(company_id))$r$,
  $r$app.is_company_admin(company_id)$r$,
  $r$app.is_company_admin(company_id)$r$,
  $r$app.is_company_admin(company_id)$r$);

-- company_modules
select pg_temp.regles(array['company_modules'], null,
  $r$(company_id in (select app.visible_companies()) or (select app.is_superadmin()))$r$,
  $r$app.is_company_admin(company_id)$r$,
  $r$app.is_company_admin(company_id)$r$,
  $r$(select app.is_superadmin())$r$);

-- support_access_grants
select pg_temp.regles(array['support_access_grants'], null,
  $r$((select app.is_superadmin()) or coalesce(app.company_role(company_id) = any (array['admin', 'direction']), false))$r$,
  null,
  null,
  null);

-- Photographie des tables existantes : elles seront rattachées aux sociétés par C2.
-- Toute table créée après 0273 doit naître avec une colonne company_id.
create table if not exists app.tables_avant_societes (table_name text primary key);
revoke all on table app.tables_avant_societes from public, anon, authenticated;
insert into app.tables_avant_societes (table_name)
select c.relname from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
on conflict (table_name) do nothing;

insert into public.schema_migrations (version) values ('0273_societes_regles') on conflict (version) do nothing;

-- ===== supabase/instances/odet-gld/c1a_acces_support_permanent.sql =====
-- Instance odet-gld (GLD Solutions) : réglage propre à cette instance, appliqué après 0270 à 0273.
-- Décision du 17/10/2026 (Hicham, acceptée par les associés, mention prévue au pacte d'associé) :
-- l'accès de support de l'éditeur aux données métier de la société n° 1 est PERMANENT ET TRACÉ.
-- Le produit reste « à la demande » par défaut pour les autres instances.
-- Sans compte connecté (éditeur SQL) : la garde de la table companies laisse passer ce changement ;
-- il est écrit au journal d'audit comme tout changement de mode.
-- Retour arrière : supabase/instances/odet-gld/c1a_acces_support_permanent_retour.sql

update public.companies set support_access_mode = 'permanent'
 where is_instance_owner and support_access_mode <> 'permanent';

insert into public.audit_logs (action, entity_type, entity_name, details)
select 'update', 'system', 'Mode d''accès de support modifié',
       jsonb_build_object('support', true, 'company_id', c.id, 'avant', 'on_demand', 'apres', 'permanent',
                          'motif', 'Décision du 17/10/2026, réglage de l''instance')
from public.companies c
where c.is_instance_owner
  and not exists (select 1 from public.audit_logs a
                  where a.details ->> 'company_id' = c.id::text and a.details ->> 'apres' = 'permanent');

-- Contrôle pendant l'essai (avant le retour arrière) : sociétés, appartenances, modules
select set_config('essai.societes',
  (select count(*) from public.companies)::text || ' société(s), '
  || (select count(*) from public.company_members)::text || ' appartenance(s), '
  || (select count(*) from public.company_modules)::text || ' module(s), mode '
  || coalesce((select support_access_mode from public.companies where is_instance_owner), 'aucun'), true);

-- ===== supabase/rollback/0270-0273_societes_retour.sql =====
-- Retour arrière des migrations 0270 à 0273 (socle multi-sociétés, chantier C1a), en une fois.
-- Retire les recopies, les fonctions, les règles et les tables des sociétés. Aucune table métier n'avait été modifiée.
-- Les lignes écrites au journal d'audit par l'accès de support sont gardées (historique).
-- Essayé en transaction annulée : supabase/tests/essai_retour_c1a_transaction_annulee.sql (écart attendu : 0).

drop trigger if exists org_modules_sync_company on public.org_modules;
drop trigger if exists profiles_sync_company_member on public.profiles;
drop trigger if exists organization_settings_sync_company on public.organization_settings;

drop table if exists app.tables_avant_societes;

drop function if exists public.my_companies();
drop function if exists public.support_trace(text[], text);
drop function if exists public.support_access_open(uuid, text, integer);
drop function if exists public.support_access_close(uuid);
drop function if exists public.company_set_support_mode(uuid, text, integer);

drop table if exists public.support_access_grants;
drop table if exists public.company_modules;
drop table if exists public.company_member_roles;
drop table if exists public.company_members;
drop table if exists public.company_establishments;
drop table if exists public.companies;

drop function if exists app.sync_owner_modules();
drop function if exists app.sync_profile_member();
drop function if exists app.sync_owner_company();
drop function if exists app.copy_settings_to_owner(public.organization_settings);
drop function if exists app.member_role(text);
drop function if exists app.companies_guard();
drop function if exists app.support_platform_tables();
drop function if exists app.is_company_admin(uuid);
drop function if exists app.company_role(uuid);
drop function if exists app.current_company();
drop function if exists app.visible_companies();
drop function if exists app.support_open(uuid);
drop function if exists app.header_company();

delete from public.schema_migrations
 where version in ('0270_societes_tables', '0271_societes_fonctions', '0272_societes_reprise', '0273_societes_regles');

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE C1a (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%\nsociétés pendant l''essai : %',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), ''),
    current_setting('essai.societes', true);
end
$verif$;
