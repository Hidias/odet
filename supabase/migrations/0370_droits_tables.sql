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
