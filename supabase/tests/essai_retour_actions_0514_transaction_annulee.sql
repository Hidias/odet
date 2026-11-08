-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (actions_0514) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0514_actions_enchainees.sql, retour arrière,
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

-- ===== supabase/migrations/0514_actions_enchainees.sql =====
-- 0514 : activités enchaînées (idée n° 2 reprise d'Odoo, choix de H du 08/11).
-- Décisions de H (08/11) : des types d'action par société (délai, responsable par défaut, type suivant), réglés dans les
-- Paramètres par la direction ; une liste de départ modifiable ; quand une action d'un type qui a une suite est faite,
-- la suite est PROPOSÉE (fenêtre pré-remplie), jamais créée d'office ; rien n'est envoyé.
--   1. team_action_types : nom, délai en jours (échéance proposée = jour de création + délai), responsable par défaut,
--      type suivant (même société), actif, ordre.
--   2. team_actions.type_id (type de l'action) et team_actions.previous_id (action dont elle est la suite, figée à la
--      création, une seule suite par action).
--   3. Liste de départ posée pour chaque société existante et chaque nouvelle société : Appeler, Envoyer un devis (suite :
--      Relancer le devis), Relancer le devis (7 jours), Rendez-vous. Ce sont des valeurs de départ (choix de gestion),
--      modifiables et supprimables ; rien n'est reposé ensuite.
-- Additive. Idempotente. Retour arrière : supabase/rollback/0514_actions_enchainees_retour.sql

-- ── 1. Types d'action ──
create table if not exists public.team_action_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 80),
  delay_days int not null default 0 check (delay_days between 0 and 365),
  default_owner_id uuid references public.profiles(id) on delete set null,
  next_type_id uuid references public.team_action_types(id) on delete set null,
  active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists team_action_types_nom_uniq on public.team_action_types (company_id, lower(btrim(name)));
create index if not exists team_action_types_suivant_idx on public.team_action_types (next_type_id);
comment on table public.team_action_types is 'Types d''action de l''équipe (0514) : délai, responsable par défaut et type suivant proposé une fois l''action faite';

-- Société figée ; type suivant de la même société
create or replace function app.team_action_types_regle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.name := btrim(new.name);
  if new.next_type_id is not null and not exists (
    select 1 from public.team_action_types t where t.id = new.next_type_id and t.company_id = new.company_id) then
    raise exception 'Type suivant d''une autre société' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.team_action_types_regle() from public, anon, authenticated;
drop trigger if exists team_action_types_regle on public.team_action_types;
create trigger team_action_types_regle before insert or update on public.team_action_types
  for each row execute function app.team_action_types_regle();

-- ── 2. Type et suite d'une action ──
alter table public.team_actions add column if not exists type_id uuid references public.team_action_types(id) on delete set null;
alter table public.team_actions add column if not exists previous_id uuid references public.team_actions(id) on delete set null;
create index if not exists team_actions_type_idx on public.team_actions (type_id);
-- Une seule suite par action (un double clic ne crée pas deux suites)
create unique index if not exists team_actions_suite_uniq on public.team_actions (previous_id) where previous_id is not null;
comment on column public.team_actions.type_id is 'Type de l''action (0514), de la même société';
comment on column public.team_actions.previous_id is 'Action dont celle-ci est la suite (0514), figée à la création';

-- Type et action précédente de la même société ; la précédente ne change plus après la création
create or replace function app.team_actions_suite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Le lien ne change jamais ; il se vide seulement par la clé étrangère (action précédente supprimée : mise à jour
  -- lancée par un déclencheur, profondeur 2), jamais par un compte (sinon la règle « une seule suite » se contourne)
  if tg_op = 'UPDATE' and (new.previous_id is not null or pg_trigger_depth() < 2) then
    new.previous_id := old.previous_id;
  end if;
  if new.type_id is not null and (tg_op = 'INSERT' or new.type_id is distinct from old.type_id) and not exists (
    select 1 from public.team_action_types t where t.id = new.type_id and t.company_id = new.company_id) then
    raise exception 'Type d''action d''une autre société' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.previous_id is not null and not exists (
    select 1 from public.team_actions a where a.id = new.previous_id and a.company_id = new.company_id) then
    raise exception 'Action précédente introuvable ou d''une autre société' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function app.team_actions_suite() from public, anon, authenticated;
drop trigger if exists team_actions_suite on public.team_actions;
create trigger team_actions_suite before insert or update on public.team_actions
  for each row execute function app.team_actions_suite();

-- ── 3. Liste de départ ──
-- Posée seulement pour une société qui n'a encore aucun type (jamais reposée après des suppressions)
create or replace function app.team_action_types_depart(p_company uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_relance uuid;
begin
  if exists (select 1 from public.team_action_types t where t.company_id = p_company) then return; end if;
  insert into public.team_action_types (company_id, name, delay_days, position)
    values (p_company, 'Relancer le devis', 7, 3) returning id into v_relance;
  insert into public.team_action_types (company_id, name, delay_days, next_type_id, position) values
    (p_company, 'Appeler', 0, null, 1),
    (p_company, 'Envoyer un devis', 0, v_relance, 2),
    (p_company, 'Rendez-vous', 0, null, 4);
end
$$;
revoke all on function app.team_action_types_depart(uuid) from public, anon, authenticated;
select app.team_action_types_depart(c.id) from public.companies c;

-- Corps en production repris à l'identique (0314 et suivantes), plus la liste de départ des types d'action
create or replace function app.societe_referentiels_depart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.subcontractor_doc_types_depart(new.id);
  if to_regprocedure('app.obligation_rules_depart(uuid)') is not null then
    execute 'select app.obligation_rules_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.commercial_lists_depart(uuid)') is not null then
    execute 'select app.commercial_lists_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_sous_traitants_depart(uuid)') is not null then
    execute 'select app.rgpd_sous_traitants_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_purge_regles_depart(uuid)') is not null then
    execute 'select app.rgpd_purge_regles_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.cert_pitfalls_depart(uuid)') is not null then
    execute 'select app.cert_pitfalls_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_horaires_depart(uuid)') is not null then
    execute 'select app.hr_horaires_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_types_absence_depart(uuid)') is not null then
    execute 'select app.hr_types_absence_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_feries_depart(uuid)') is not null then
    execute 'select app.hr_feries_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_listes_depart(uuid)') is not null then
    execute 'select app.hr_listes_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.team_action_types_depart(uuid)') is not null then
    execute 'select app.team_action_types_depart($1)' using new.id;
  end if;
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;

-- ── Droits : lecture par les membres de la société, réglage par la direction ──
alter table public.team_action_types enable row level security;
revoke all on table public.team_action_types from public, anon;
grant select, insert, update, delete on table public.team_action_types to authenticated;
grant all on table public.team_action_types to service_role;

do $$
declare t text := 'team_action_types';
begin
  execute format('drop policy if exists %I on public.%I', t || '_lire', t);
  execute format('drop policy if exists %I on public.%I', t || '_creer', t);
  execute format('drop policy if exists %I on public.%I', t || '_modifier', t);
  execute format('drop policy if exists %I on public.%I', t || '_supprimer', t);
  execute format('create policy %I on public.%I for select to authenticated using (company_id in (select app.visible_companies()))', t || '_lire', t);
  execute format('create policy %I on public.%I for insert to authenticated with check (company_id in (select app.societes_avec_droit(%L)))', t || '_creer', t, 'manager.cockpit.voir');
  execute format('create policy %I on public.%I for update to authenticated using (company_id in (select app.societes_avec_droit(%L))) with check (company_id in (select app.societes_avec_droit(%L)))', t || '_modifier', t, 'manager.cockpit.voir', 'manager.cockpit.voir');
  execute format('create policy %I on public.%I for delete to authenticated using (company_id in (select app.societes_avec_droit(%L)))', t || '_supprimer', t, 'manager.cockpit.voir');
end $$;

insert into public.schema_migrations (version) values ('0514_actions_enchainees') on conflict (version) do nothing;

-- ===== supabase/rollback/0514_actions_enchainees_retour.sql =====
-- Retour arrière de 0514 : types d'action, type et suite des actions retirés ; app.societe_referentiels_depart remise au
-- corps en production avant 0514. Les actions restent (le travail fait n'est pas perdu), sans type ni lien de suite.

CREATE OR REPLACE FUNCTION app.societe_referentiels_depart()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.subcontractor_doc_types_depart(new.id);
  if to_regprocedure('app.obligation_rules_depart(uuid)') is not null then
    execute 'select app.obligation_rules_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.commercial_lists_depart(uuid)') is not null then
    execute 'select app.commercial_lists_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_sous_traitants_depart(uuid)') is not null then
    execute 'select app.rgpd_sous_traitants_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_purge_regles_depart(uuid)') is not null then
    execute 'select app.rgpd_purge_regles_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.cert_pitfalls_depart(uuid)') is not null then
    execute 'select app.cert_pitfalls_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_horaires_depart(uuid)') is not null then
    execute 'select app.hr_horaires_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_types_absence_depart(uuid)') is not null then
    execute 'select app.hr_types_absence_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_feries_depart(uuid)') is not null then
    execute 'select app.hr_feries_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_listes_depart(uuid)') is not null then
    execute 'select app.hr_listes_depart($1)' using new.id;
  end if;
  return null;
end
$function$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;

drop function if exists app.team_action_types_depart(uuid);
drop trigger if exists team_actions_suite on public.team_actions;
drop function if exists app.team_actions_suite();
drop index if exists public.team_actions_suite_uniq;
drop index if exists public.team_actions_type_idx;
alter table public.team_actions drop column if exists previous_id;
alter table public.team_actions drop column if exists type_id;
drop trigger if exists team_action_types_regle on public.team_action_types;
drop function if exists app.team_action_types_regle();
drop table if exists public.team_action_types;

delete from public.schema_migrations where version = '0514_actions_enchainees';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE actions_0514 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
