-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (nir-15) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0439_nir_15.sql, retour arrière,
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

-- ===== supabase/migrations/0439_nir_15.sql =====
-- 0439 : n° de sécurité sociale et genre (décision de H du 22/10, 12 h 54).
--  - app.nir_complet n'accepte plus que les 15 caractères (13 + clé), et les numéros provisoires (7 ou 8) ;
--  - le genre de chaque participant saisi par le client devient obligatoire.
-- Fonctions seulement. Idempotente. Retour arrière : supabase/rollback/0439_nir_15_retour.sql

create or replace function app.nir_complet(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := upper(regexp_replace(coalesce(p, ''), '[\s.\-_]', '', 'g'));
  v13 text;
begin
  if length(v) <> 15 then return null; end if;
  v13 := left(v, 13);
  if v13 !~ '^[1278][0-9]{4}([0-9]{2}|2A|2B)[0-9]{6}$' or substr(v, 14, 2) !~ '^[0-9]{2}$' then return null; end if;
  if substr(v, 14, 2)::int <> 97 - (replace(replace(v13, '2A', '19'), '2B', '18')::numeric % 97)::int then return null; end if;
  return v;
end
$$;
revoke all on function app.nir_complet(text) from public, anon, authenticated;

do $do$
declare
  d text := pg_get_functiondef('app.participants_enregistrer(uuid,text,uuid,uuid,uuid,jsonb)'::regprocedure);
  avant text := $a$    if v_genre is not null and v_genre not in ('female', 'male', 'non_binary') then$a$;
  apres text := $b$    if v_genre is null then
      raise exception 'Genre à indiquer pour % %', v_prenom, v_nom using errcode = '22023';
    end if;
    if v_genre not in ('female', 'male', 'non_binary') then$b$;
begin
  if position('Genre à indiquer' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, avant, ''))) / length(avant) <> 1 then raise exception 'Contrôle du genre introuvable'; end if;
  execute replace(d, avant, apres);
end
$do$;

insert into public.schema_migrations (version) values ('0439_nir_15') on conflict (version) do nothing;

-- ===== supabase/rollback/0439_nir_15_retour.sql =====
-- Retour arrière de 0439_nir_15.sql. Idempotent.
CREATE OR REPLACE FUNCTION app.nir_complet(p text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v text := upper(regexp_replace(coalesce(p, ''), '[\s.\-]', '', 'g'));
  v13 text;
  v_cle int;
begin
  if v = '' then return null; end if;
  if length(v) not in (13, 15) then return null; end if;
  v13 := left(v, 13);
  if v13 !~ '^[12][0-9]{4}([0-9]{2}|2A|2B)[0-9]{6}$' then return null; end if;
  v_cle := 97 - (replace(replace(v13, '2A', '19'), '2B', '18')::numeric % 97)::int;
  if length(v) = 15 and substr(v, 14, 2) !~ '^[0-9]{2}$' then return null; end if;
  if length(v) = 15 and substr(v, 14, 2)::int <> v_cle then return null; end if;
  return v13 || lpad(v_cle::text, 2, '0');
end
$function$;
revoke all on function app.nir_complet(text) from public, anon, authenticated;
do $do$
declare
  d text := pg_get_functiondef('app.participants_enregistrer(uuid,text,uuid,uuid,uuid,jsonb)'::regprocedure);
  avant text := $b$    if v_genre is null then
      raise exception 'Genre à indiquer pour % %', v_prenom, v_nom using errcode = '22023';
    end if;
    if v_genre not in ('female', 'male', 'non_binary') then$b$;
  apres text := $a$    if v_genre is not null and v_genre not in ('female', 'male', 'non_binary') then$a$;
begin
  if position(avant in d) = 0 then return; end if;
  execute replace(d, avant, apres);
end
$do$;
delete from public.schema_migrations where version = '0439_nir_15';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE nir-15 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
