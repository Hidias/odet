-- FICHIER GÉNÉRÉ par scripts/securite/essai_societes.py : ne pas modifier à la main.
-- Essai du socle multi-sociétés (C1a) en transaction annulée : 0270 à 0273, réglage de l'instance odet-gld,
-- puis tous les tests de droits. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DES TESTS DE DROITS » :
-- tout est annulé, rien n'est enregistré. Aucune validation de transaction.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '180s', true);

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
          ('sa', null, 'aucune appartenance pour le super administrateur', 'select count(*) from public.company_members where profile_id = auth.uid()', '=0'),
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

  raise exception E'RÉSULTAT DES TESTS DE DROITS (tout est annulé)\n%\n\n% test(s), % échec(s)',
    array_to_string(v_lines, E'\n'), v_total, v_fail;
end
$test$;
