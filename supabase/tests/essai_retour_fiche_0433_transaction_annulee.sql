-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (fiche_0433) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0433_espaces_fiche_formation.sql, retour arrière,
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

-- ===== supabase/migrations/0433_espaces_fiche_formation.sql =====
-- 0433 : les espaces (client par code, entreprise avec compte, formateur et stagiaire avec compte) reçoivent aussi les
-- moyens pédagogiques (methods) et les moyens techniques (trainer_equipment) de la formation, pour que la convention
-- générée dans l'espace soit identique à celle de l'organisme (contenu, moyens, intervenant : article D6353-1).
-- Ajout de deux champs dans le bloc « courses » de client_portal_data, ent_sessions et ext_sessions, à partir des
-- versions en production. Idempotente. Retour arrière : supabase/rollback/0433_espaces_fiche_formation_retour.sql
do $do$
declare
  f text;
  d text;
  avant text := $a$'teaching_methods', co.teaching_methods$a$;
  apres text := $b$'teaching_methods', co.teaching_methods, 'methods', co.methods, 'trainer_equipment', co.trainer_equipment$b$;
begin
  foreach f in array array['public.client_portal_data(text,text)', 'public.ent_sessions()', 'public.ext_sessions()'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position($c$'methods', co.methods$c$ in d) > 0 then continue; end if;
    if (length(d) - length(replace(d, avant, ''))) / length(avant) <> 1 then raise exception 'Bloc formation introuvable dans %', f; end if;
    execute replace(d, avant, apres);
  end loop;
end
$do$;

insert into public.schema_migrations (version) values ('0433_espaces_fiche_formation') on conflict (version) do nothing;

-- ===== supabase/rollback/0433_espaces_fiche_formation_retour.sql =====
-- Retour arrière de 0433_espaces_fiche_formation.sql : les deux champs retirés du bloc « courses ». Idempotent.
do $do$
declare
  f text;
  d text;
  avant text := $b$'teaching_methods', co.teaching_methods, 'methods', co.methods, 'trainer_equipment', co.trainer_equipment$b$;
  apres text := $a$'teaching_methods', co.teaching_methods$a$;
begin
  foreach f in array array['public.client_portal_data(text,text)', 'public.ent_sessions()', 'public.ext_sessions()'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position(avant in d) = 0 then continue; end if;
    execute replace(d, avant, apres);
  end loop;
end
$do$;
delete from public.schema_migrations where version = '0433_espaces_fiche_formation';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE fiche_0433 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
