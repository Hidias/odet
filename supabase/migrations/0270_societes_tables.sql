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
