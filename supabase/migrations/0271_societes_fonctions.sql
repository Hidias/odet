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
