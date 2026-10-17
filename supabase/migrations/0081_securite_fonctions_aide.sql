-- 0081_securite_fonctions_aide.sql : fonctions d'aide utilisées par les règles d'accès (chantier 2).
-- Elles vivent dans le schéma app, non exposé par l'API : on ne peut pas les appeler comme des RPC.
-- Toutes sont stables et appelées dans les règles sous la forme (select app.xxx()) pour n'être
-- évaluées qu'une fois par requête, et non une fois par ligne.
--
-- Rôle effectif (app.role()) :
--   superadmin, admin, direction, gestionnaire, formateur, commercial, comptable, lecture
--   technicien  : compte « lecture » coché technicien actif, module Interventions actif
--                 (même règle que le mode terrain de l'application, fieldOnly)
--   entreprise, formateur_externe, stagiaire : comptes externes prévus (lot 2), aucun accès aux tables
--   null        : pas de profil, ou profil désactivé
-- Migration idempotente. Retour arrière : supabase/rollback/0080-0087_securite_retour.sql (les huit migrations ensemble)

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- Rôle effectif de l'utilisateur connecté
create or replace function app.role()
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
  where p.id = (select auth.uid()) and p.is_active
$$;

-- Module activé dans org_modules
create or replace function app.module_on(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select m.enabled from public.org_modules m where m.key = p_key), false)
$$;

-- Super administrateur actif
create or replace function app.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.role() = 'superadmin', false)
$$;

-- Personnel de l'organisme (comptes internes, technicien compris)
create or replace function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.role() = any (array[
    'superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture', 'technicien'
  ]), false)
$$;

-- Données de handicap (santé) : direction (superadmin, admin, direction) et référent handicap désigné
-- dans Qualité > Référents (quality_roles, code referent_handicap). Compte désactivé : jamais.
create or replace function app.can_see_disability()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.role() = any (array['superadmin', 'admin', 'direction'])
    or (app.role() is not null and exists (
          select 1 from public.quality_roles q
          where q.code = 'referent_handicap' and q.profile_id = (select auth.uid()))),
    false)
$$;

-- Sessions dont l'utilisateur est le formateur (fiche formateur reliée au compte)
create or replace function app.trainer_session_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.sessions s
  join public.profiles p on p.id = (select auth.uid()) and p.is_active and p.trainer_id is not null
  where s.trainer_id = p.trainer_id
  union
  select st.session_id
  from public.session_trainers st
  join public.profiles p on p.id = (select auth.uid()) and p.is_active and p.trainer_id is not null
  where st.trainer_id = p.trainer_id
$$;

-- Stagiaires inscrits aux sessions du formateur
create or replace function app.trainer_trainee_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct st.trainee_id
  from public.session_trainees st
  where st.session_id in (select app.trainer_session_ids())
$$;

-- Visites attribuées au technicien
create or replace function app.tech_visit_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id from public.itv_visits v where v.technician_id = (select auth.uid())
$$;

-- Clients des visites du technicien
create or replace function app.tech_client_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct v.client_id from public.itv_visits v
  where v.technician_id = (select auth.uid()) and v.client_id is not null
$$;

-- Visites des clients du technicien (historique d'un client, toutes visites confondues)
create or replace function app.tech_scope_visit_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id from public.itv_visits v
  where v.client_id in (select app.tech_client_ids())
$$;

revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
alter default privileges for role postgres in schema app revoke execute on functions from public, anon;

-- Index utilisés par les règles
create index if not exists sessions_trainer_id_idx on public.sessions (trainer_id);
create index if not exists session_trainers_trainer_id_idx on public.session_trainers (trainer_id);
create index if not exists session_trainees_session_id_idx on public.session_trainees (session_id);
create index if not exists session_trainees_trainee_id_idx on public.session_trainees (trainee_id);
create index if not exists itv_visits_technician_id_idx on public.itv_visits (technician_id);
create index if not exists itv_visits_client_id_idx on public.itv_visits (client_id);
create index if not exists itv_equipment_client_id_idx on public.itv_equipment (client_id);
create index if not exists itv_visit_items_visit_id_idx on public.itv_visit_items (visit_id);
create index if not exists itv_visit_parts_visit_id_idx on public.itv_visit_parts (visit_id);
create index if not exists sites_client_id_idx on public.sites (client_id);
create index if not exists client_contacts_client_id_idx on public.client_contacts (client_id);
create index if not exists attendance_halfdays_session_id_idx on public.attendance_halfdays (session_id);
create index if not exists trainee_objectives_session_id_idx on public.trainee_objectives (session_id);
create index if not exists trainee_evaluations_session_id_idx on public.trainee_evaluations (session_id);
create index if not exists evaluations_cold_session_id_idx on public.evaluations_cold (session_id);
create index if not exists trainee_info_sheets_session_id_idx on public.trainee_info_sheets (session_id);
create index if not exists dashboard_widget_configs_user_id_idx on public.dashboard_widget_configs (user_id);
create index if not exists user_planning_events_user_id_idx on public.user_planning_events (user_id);
create index if not exists profiles_trainer_id_idx on public.profiles (trainer_id);

insert into public.schema_migrations (version) values ('0081_securite_fonctions_aide') on conflict (version) do nothing;
