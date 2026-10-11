-- 0004_core_product.sql : socle produit
-- Profils et rôles, modules activables, sites, identité et marque de l'organisme,
-- verrouillage des évaluations, suivi des migrations.

-- ============================================================
-- 1. Suivi des migrations
-- ============================================================
create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
insert into public.schema_migrations (version) values
  ('0001_base_schema'), ('0002_policies_baseline'), ('0003_storage'), ('0004_core_product')
on conflict (version) do nothing;

alter table public.schema_migrations enable row level security;
create policy "schema_migrations_read" on public.schema_migrations for select to authenticated using (true);

-- ============================================================
-- 2. Identité complète et marque de l'organisme
--    (aucune valeur d'organisme dans le code : tout est ici)
-- ============================================================
alter table public.organization_settings
  add column if not exists legal_name text,
  add column if not exists forme_juridique text,
  add column if not exists capital_social text,
  add column if not exists siren varchar(9),
  add column if not exists naf varchar(10),
  add column if not exists tva_intra varchar(20),
  add column if not exists tva_applicable boolean default true,
  add column if not exists rcs text,
  add column if not exists tribunal_competent text,
  add column if not exists nda_region text,
  add column if not exists qualiopi_certified boolean default false,
  add column if not exists qualiopi_since date,
  add column if not exists qualiopi_organisme text,
  add column if not exists bank_name text,
  add column if not exists iban text,
  add column if not exists bic text,
  add column if not exists dirigeant_title text,
  add column if not exists lieu_signature text,
  add column if not exists cgv_url text,
  add column if not exists conditions_annulation text,
  add column if not exists google_review_url text,
  add column if not exists zone_departements text[] default '{}'::text[],
  add column if not exists region text,
  add column if not exists email_bcc text,
  add column if not exists email_default_sender text,
  add column if not exists app_name text,
  add column if not exists app_short_name text,
  add column if not exists brand_primary varchar(7) default '#1C2024',
  add column if not exists brand_accent varchar(7) default '#C8102E',
  add column if not exists brand_highlight varchar(7) default '#D9A62E',
  add column if not exists brand_nav varchar(7),
  add column if not exists font_pair text default 'atelier',
  add column if not exists logo_on_dark_url text,
  add column if not exists favicon_url text,
  add column if not exists icon_192_url text,
  add column if not exists icon_512_url text,
  add column if not exists ai_profile jsonb not null default '{}'::jsonb,
  add column if not exists demo_mode boolean not null default false,
  add column if not exists setup_completed boolean not null default false,
  add column if not exists setup_step integer not null default 0,
  add column if not exists exercice_start_month integer not null default 1,
  add column if not exists date_creation date,
  add column if not exists activity_kind text not null default 'of';

alter table public.organization_settings
  drop constraint if exists organization_settings_activity_kind_check;
alter table public.organization_settings
  add constraint organization_settings_activity_kind_check check (activity_kind in ('of', 'entreprise', 'mixte'));

comment on column public.organization_settings.ai_profile is 'Profil injecté dans les prompts de l''aide interactive : zone, ton, règles de vocabulaire, catalogue résumé';
comment on column public.organization_settings.demo_mode is 'En mode démo, les envois sortants sont redirigés vers MAIL_SINK (variable serveur)';

-- ============================================================
-- 3. Profils utilisateurs et rôles
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  first_name text,
  last_name text,
  display_name text,
  role text not null default 'gestionnaire'
    check (role in ('superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture')),
  phone text,
  fonction text,
  sender_email text,
  trainer_id uuid references public.trainers(id) on delete set null,
  ui_prefs jsonb not null default '{}'::jsonb,
  gcal_id text,
  gcal_enabled boolean not null default false,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Un profil par compte Auth : rôle, identité affichée, préférences d''affichage';

create or replace function public.current_profile_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'superadmin' from public.profiles where id = auth.uid() and is_active), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('superadmin', 'admin') from public.profiles where id = auth.uid() and is_active), false)
$$;

-- Création automatique du profil à la création du compte Auth
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, first_name, last_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    coalesce(new.raw_user_meta_data ->> 'role', 'gestionnaire')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Le rôle ne se change pas soi-même ; seul un super admin peut donner le rôle superadmin
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role then
    if not public.is_admin() then
      raise exception 'Seul un administrateur peut modifier un rôle';
    end if;
    if new.role = 'superadmin' and not public.is_superadmin() then
      raise exception 'Seul un super administrateur peut attribuer le rôle super administrateur';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

alter table public.profiles enable row level security;
create policy "profiles_select" on public.profiles for select to authenticated using (true);
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_admin_update" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "profiles_admin_insert" on public.profiles for insert to authenticated with check (public.is_admin());
create policy "profiles_admin_delete" on public.profiles for delete to authenticated using (public.is_admin());

-- Profils pour les comptes déjà existants
insert into public.profiles (id, email, display_name)
select u.id, u.email, split_part(u.email, '@', 1) from auth.users u
on conflict (id) do nothing;

-- ============================================================
-- 4. Modules activables
-- ============================================================
create table if not exists public.org_modules (
  key text primary key,
  label text not null,
  enabled boolean not null default true,
  position integer not null default 0,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.org_modules (key, label, enabled, position) values
  ('formation',     'Formation',                         true,  10),
  ('portail',       'Portails stagiaire et entreprise',  true,  20),
  ('prevention',    'Prévention et SST',                 true,  30),
  ('qualite',       'Qualité et Qualiopi',               true,  40),
  ('commercial',    'Clients, devis, factures',          true,  50),
  ('prospection',   'Prospection et suivi commercial',   true,  60),
  ('mailing',       'Campagnes email',                   true,  70),
  ('finance',       'Budget et trésorerie',              false, 80),
  ('comptabilite',  'Espace comptable',                  false, 90),
  ('duerp',         'DUERP',                             true,  100),
  ('social',        'Réseaux sociaux',                   false, 110),
  ('interventions', 'Interventions et tournées',         false, 120),
  ('rh',            'Collaborateurs et RH',              false, 130),
  ('frais',         'Notes de frais',                    false, 140)
on conflict (key) do nothing;

alter table public.org_modules enable row level security;
create policy "org_modules_select" on public.org_modules for select to authenticated using (true);
create policy "org_modules_admin_write" on public.org_modules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- 5. Sites (siège, salles de formation, sites clients)
-- ============================================================
create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'salle' check (kind in ('siege', 'salle', 'client', 'autre')),
  name text not null,
  address text,
  postal_code varchar(10),
  city varchar(100),
  client_id uuid references public.clients(id) on delete cascade,
  capacity integer,
  access_notes text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sites_client_id_idx on public.sites(client_id);
alter table public.sessions add column if not exists site_id uuid references public.sites(id) on delete set null;

alter table public.sites enable row level security;
create policy "sites_auth_all" on public.sites for all to authenticated using (true) with check (true);

-- ============================================================
-- 6. Évaluations inviolables : modification et suppression
--    réservées au super administrateur (motif tracé par l'audit)
-- ============================================================
do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('trainee_evaluations', 'evaluations_cold', 'trainer_evaluations')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- trainee_evaluations : lecture et saisie pour les connectés ; dépôt par le portail (anon) ; pas de modification
create policy "trainee_evaluations_select" on public.trainee_evaluations for select to authenticated using (true);
create policy "trainee_evaluations_insert" on public.trainee_evaluations for insert to authenticated with check (true);
create policy "trainee_evaluations_portal_select" on public.trainee_evaluations for select to anon using (true);
create policy "trainee_evaluations_portal_insert" on public.trainee_evaluations for insert to anon with check (true);
create policy "trainee_evaluations_update_superadmin" on public.trainee_evaluations for update to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());
create policy "trainee_evaluations_delete_superadmin" on public.trainee_evaluations for delete to authenticated
  using (public.is_superadmin());

create policy "evaluations_cold_select" on public.evaluations_cold for select to authenticated using (true);
create policy "evaluations_cold_insert" on public.evaluations_cold for insert to authenticated with check (true);
create policy "evaluations_cold_portal_select" on public.evaluations_cold for select to anon using (true);
create policy "evaluations_cold_portal_insert" on public.evaluations_cold for insert to anon with check (true);
create policy "evaluations_cold_update_superadmin" on public.evaluations_cold for update to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());
create policy "evaluations_cold_delete_superadmin" on public.evaluations_cold for delete to authenticated
  using (public.is_superadmin());

create policy "trainer_evaluations_select" on public.trainer_evaluations for select to authenticated using (true);
create policy "trainer_evaluations_insert" on public.trainer_evaluations for insert to authenticated with check (true);
create policy "trainer_evaluations_update_superadmin" on public.trainer_evaluations for update to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());
create policy "trainer_evaluations_delete_superadmin" on public.trainer_evaluations for delete to authenticated
  using (public.is_superadmin());

-- ============================================================
-- 7. Préférences d'affichage : trois préréglages et réglages fins (stockés dans profiles.ui_prefs)
--    { "preset": "atelier|terrain|cockpit", "density": "compact|normal|large",
--      "nav": "dark|light|rail", "radius": "sm|md|lg", "lists": "table|cards" }
-- ============================================================
comment on column public.profiles.ui_prefs is 'Préférences d''affichage de l''utilisateur : preset, density, nav, radius, lists';
