-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (formation_0049) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0049_site_exploitation_pictogramme.sql, retour arrière,
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

-- ===== supabase/migrations/0049_site_exploitation_pictogramme.sql =====
-- 0049_site_exploitation_pictogramme.sql : adresse du site d'exploitation de l'organisme et pictogramme des
-- formations (suggestions validées par H, 19/10).
--
-- 1. organization_settings : adresse du site d'exploitation (GLD Sécurité : siège à Quimper, site d'exploitation à
--    Plomelin). Le siège reste l'adresse légale (mentions, pieds de page) ; le site d'exploitation s'affiche en plus
--    dans l'en-tête des documents et sur les programmes.
-- 2. courses.pictogram : pictogramme du programme, choisi dans une bibliothèque fermée (liste du code).
-- Aucune table nouvelle : colonnes couvertes par les règles existantes. Migration additive. Idempotente.
-- Retour arrière : supabase/rollback/0049_site_exploitation_pictogramme_retour.sql

alter table public.organization_settings add column if not exists exploitation_address text;
alter table public.organization_settings add column if not exists exploitation_postal_code text;
alter table public.organization_settings add column if not exists exploitation_city text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organization_settings_exploitation_check') then
    alter table public.organization_settings add constraint organization_settings_exploitation_check check (
      coalesce(length(exploitation_address), 0) <= 200 and coalesce(length(exploitation_postal_code), 0) <= 10
      and coalesce(length(exploitation_city), 0) <= 100);
  end if;
end $$;
comment on column public.organization_settings.exploitation_address is 'Adresse du site d''exploitation, affichée avec le siège sur les documents';

alter table public.courses add column if not exists pictogram text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'courses_pictogram_check') then
    alter table public.courses add constraint courses_pictogram_check check (
      pictogram is null or pictogram in ('flamme', 'secours', 'coeur', 'electricite', 'posture', 'conduite', 'document',
                                         'bouclier', 'alarme', 'chantier'));
  end if;
end $$;

insert into public.schema_migrations (version) values ('0049_site_exploitation_pictogramme') on conflict (version) do nothing;

-- ===== supabase/rollback/0049_site_exploitation_pictogramme_retour.sql =====
-- Retour arrière de 0049_site_exploitation_pictogramme.sql. Idempotent. Les valeurs saisies sont perdues (ajouts).

alter table public.courses drop constraint if exists courses_pictogram_check;
alter table public.courses drop column if exists pictogram;
alter table public.organization_settings drop constraint if exists organization_settings_exploitation_check;
alter table public.organization_settings drop column if exists exploitation_city;
alter table public.organization_settings drop column if exists exploitation_postal_code;
alter table public.organization_settings drop column if exists exploitation_address;

delete from public.schema_migrations where version = '0049_site_exploitation_pictogramme';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE formation_0049 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
