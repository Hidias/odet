-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (vue_groupe_0516) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0516_vue_groupe_lecture_seule.sql, retour arrière,
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

-- ===== supabase/migrations/0516_vue_groupe_lecture_seule.sql =====
-- 0516 : vue groupe en vraie lecture seule (décision de H du 08/11).
-- Le sélecteur de sociétés annonce « Vue groupe, lecture seule » et le bandeau dit « pour créer ou modifier, choisissez
-- une société dans l'en-tête », mais la base acceptait les écritures (elles partaient dans la société par défaut du
-- compte). Désormais, en vue groupe, toute écriture d'un compte connecté sur une table rattachée à une société est
-- refusée avec ce message.
--   1. app.vue_groupe_lecture_seule() : déclencheur par instruction (une seule lecture du contexte par requête,
--      app.vue_groupe() est mémorisée) ; sans compte connecté (tâches de nuit, clé de service), rien ne change.
--      Une écriture faite par un autre déclencheur (pg_trigger_depth() > 1) passe : c'est la suite d'une écriture
--      déjà admise (ex. profile_to_trainer : le compte qui corrige son propre nom met à jour sa fiche formateur).
--      Vigilance : un futur déclencheur posé sur une table laissée ouverte (ou sans company_id) qui INSÈRE dans une
--      table fermée passerait aussi en vue groupe, rangé dans la société par défaut : à éviter, ou à contrôler.
--   2. app.vue_groupe_poser() : pose le déclencheur sur toutes les tables de public qui ont une colonne company_id,
--      sauf les journaux et les réglages qui désignent leur société eux-mêmes (liste ci-dessous) ; idempotente, à
--      rappeler après la création d'une table rattachée à une société.
-- Tables laissées ouvertes : journaux (audit_logs, error_logs, job_runs, import_logs, auto_send_switch_log,
-- session_document_access), notifications lues, retours des utilisateurs (user_feedback), « Quoi de neuf »
-- (platform_notices), réglages qui désignent leur société eux-mêmes (company_members, company_member_rights,
-- company_modules, company_establishments, permission_profile_rights, support_access_grants), abonnements aux
-- alertes du téléphone de chaque compte (push_subscriptions).
-- Additive. Idempotente. Retour arrière : supabase/rollback/0516_vue_groupe_lecture_seule_retour.sql

create or replace function app.vue_groupe_lecture_seule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if (select auth.uid()) is not null and coalesce(app.vue_groupe(), false) then
    raise exception 'Vue groupe : lecture seule. Pour créer ou modifier, choisissez une société dans l''en-tête.'
      using errcode = '42501';
  end if;
  return null;
end
$$;
revoke all on function app.vue_groupe_lecture_seule() from public, anon, authenticated;

create or replace function app.vue_groupe_poser()
returns int
language plpgsql
set search_path = ''
as $$
declare
  t text;
  n int := 0;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'company_id'
      and c.table_name <> all (array['audit_logs', 'error_logs', 'job_runs', 'import_logs', 'auto_send_switch_log',
        'session_document_access', 'notifications', 'user_feedback', 'platform_notices', 'company_members',
        'company_member_rights', 'company_modules', 'company_establishments', 'permission_profile_rights',
        'support_access_grants', 'push_subscriptions'])
    order by 1
  loop
    if not exists (select 1 from pg_trigger g where g.tgrelid = format('public.%I', t)::regclass and g.tgname = 'aa_vue_groupe_lecture') then
      execute format('create trigger aa_vue_groupe_lecture before insert or update or delete on public.%I for each statement execute function app.vue_groupe_lecture_seule()', t);
      n := n + 1;
    end if;
  end loop;
  return n;
end
$$;
revoke all on function app.vue_groupe_poser() from public, anon, authenticated;

select app.vue_groupe_poser();

insert into public.schema_migrations (version) values ('0516_vue_groupe_lecture_seule') on conflict (version) do nothing;

-- ===== supabase/rollback/0516_vue_groupe_lecture_seule_retour.sql =====
-- Retour arrière de 0516 : déclencheurs de la vue groupe retirés de toutes les tables, fonctions retirées. Rien d'autre
-- n'avait changé.
do $$
declare r record;
begin
  for r in select g.tgrelid::regclass as t from pg_trigger g where g.tgname = 'aa_vue_groupe_lecture' loop
    execute format('drop trigger if exists aa_vue_groupe_lecture on %s', r.t);
  end loop;
end $$;
drop function if exists app.vue_groupe_poser();
drop function if exists app.vue_groupe_lecture_seule();

delete from public.schema_migrations where version = '0516_vue_groupe_lecture_seule';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE vue_groupe_0516 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
