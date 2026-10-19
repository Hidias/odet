-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (perf_0090) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0090_cache_droits.sql, retour arrière,
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

-- ===== supabase/migrations/0090_cache_droits.sql =====
-- 0090_cache_droits.sql : performance (demande de H, 19/10 12h17). Droits et société courante calculés UNE fois par
-- requête au lieu d'une dizaine.
--
-- Constat en production (19/10, EXPLAIN ANALYZE, compte simulé, transaction annulée) : lecture des 38 clients 384 ms
-- + 94 ms de préparation ; « sociétés lisibles » 195 ms et « a le droit » 123 ms : les règles sont bien évaluées une
-- fois par requête (InitPlan), mais chacune refait tout le calcul (rôle, sociétés visibles, société courante, droits)
-- à travers des fonctions imbriquées non dépliables, appelées une dizaine de fois.
--
-- Solution : les sept fonctions de base (role, rights, current_company, vue_groupe, visible_companies,
-- societes_lisibles, societes_ecriture) gardent leur nom, leur signature et leur résultat ; leur calcul d'origine est
-- recopié tel quel dans app.<nom>_calc() ; la fonction publique lit d'abord un cache de transaction (réglage local
-- app.m_<nom>, effacé à la fin de chaque requête), sinon calcule et range le résultat.
-- Clé du cache (app.ctx_cle) : identité (request.jwt.claims, request.jwt.claim.sub), en-têtes de la requête (société
-- choisie, vue groupe), rôle de la requête (anon, authenticated) et compteur de changements app.droits_gen.
-- Le compteur est augmenté par un déclencheur sur chaque table dont dépend le calcul (comptes, techniciens, modules,
-- appartenances, profils, droits, sociétés, offres, accès de support) : une écriture dans la même transaction (tests,
-- fonctions) invalide le cache. Aucune règle d'accès ne change.
-- Migration additive (fonctions remplacées à résultat identique). Retour arrière :
-- supabase/rollback/0090_cache_droits_retour.sql (définitions d'origine).

create or replace function app.ctx_cle()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(coalesce(current_setting('request.jwt.claims', true), '') || '|'
          || coalesce(current_setting('request.jwt.claim.sub', true), '') || '|'
          || coalesce(current_setting('request.headers', true), '') || '|'
          || coalesce(current_setting('role', true), '') || '|'
          || coalesce(current_setting('app.droits_gen', true), ''))
$$;
revoke all on function app.ctx_cle() from public, anon, authenticated;


-- Compteur de changements (local à la transaction)
create or replace function app.droits_gen_suivant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.droits_gen', (coalesce(nullif(current_setting('app.droits_gen', true), ''), '0')::bigint + 1)::text, true);
  return null;
end
$$;
revoke all on function app.droits_gen_suivant() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'itv_technicians', 'org_modules', 'company_members', 'company_member_roles', 'company_member_rights', 'companies', 'permission_profiles', 'permission_profile_rights', 'permissions', 'offer_items', 'offer_restrictions', 'support_access_grants', 'company_modules'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists zz_droits_gen on public.%I', t);
      execute format('create trigger zz_droits_gen after insert or update or delete or truncate on public.%I for each statement execute function app.droits_gen_suivant()', t);
    end if;
  end loop;
end $$;

-- Calcul d'origine de app.role(), recopié tel quel
CREATE OR REPLACE FUNCTION app.role_calc()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when p.role = 'lecture'
     and exists (select 1 from public.itv_technicians t where t.profile_id = p.id and t.is_active)
     and exists (select 1 from public.org_modules m where m.key = 'interventions' and m.enabled)
    then 'technicien'
    else p.role
  end
  from public.profiles p
  where p.id = (select auth.uid()) and p.is_active
$function$;
revoke all on function app.role_calc() from public, anon, authenticated;


-- app.role() : même résultat, calculé une fois par requête
create or replace function app.role()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text := app.ctx_cle();
  c text := current_setting('app.m_role', true);
  x text;
  v text;
begin
  if c is not null and left(c, 32) = k then
    x := substr(c, 34);
    if x = '~' then return null; end if;
    return x;
  end if;
  v := app.role_calc();
  perform set_config('app.m_role', k || '|' || coalesce(v::text, '~'), true);
  return v;
end
$$;

-- Calcul d'origine de app.rights(), recopié tel quel
CREATE OR REPLACE FUNCTION app.rights_calc()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when app.vue_groupe() then
    (select coalesce(array_agg(x.code order by x.code), '{}'::text[]) from (
       select r.code from app.visible_companies() v, unnest(app.rights_for((select auth.uid()), v)) r(code)
       group by r.code having count(*) = (select count(*) from app.visible_companies())) x)
  else app.rights_for((select auth.uid()), app.current_company()) end
$function$;
revoke all on function app.rights_calc() from public, anon, authenticated;


-- app.rights() : même résultat, calculé une fois par requête
create or replace function app.rights()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text := app.ctx_cle();
  c text := current_setting('app.m_rights', true);
  v text[];
begin
  if c is not null and left(c, 32) = k then
    if substr(c, 34) = '~' then return null; end if;
    return substr(c, 34)::text[];
  end if;
  v := app.rights_calc();
  perform set_config('app.m_rights', k || '|' || coalesce(v::text, '~'), true);
  return v;
end
$$;

-- Calcul d'origine de app.current_company(), recopié tel quel
CREATE OR REPLACE FUNCTION app.current_company_calc()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when app.vue_groupe() then null else coalesce(
    (select h.v from (select app.header_company() as v) h
      where h.v in (select app.visible_companies())),
    (select m.company_id from public.company_members m
      where m.profile_id = (select auth.uid()) and m.is_active and m.is_default
        and m.company_id in (select app.visible_companies())
      limit 1),
    (select c.id from public.companies c
      where c.id in (select app.visible_companies())
      order by c.is_instance_owner desc, c.position, c.created_at
      limit 1)) end
$function$;
revoke all on function app.current_company_calc() from public, anon, authenticated;


-- app.current_company() : même résultat, calculé une fois par requête
create or replace function app.current_company()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text := app.ctx_cle();
  c text := current_setting('app.m_current_company', true);
  x text;
  v uuid;
begin
  if c is not null and left(c, 32) = k then
    x := substr(c, 34);
    if x = '~' then return null; end if;
    return x::uuid;
  end if;
  v := app.current_company_calc();
  perform set_config('app.m_current_company', k || '|' || coalesce(v::text, '~'), true);
  return v;
end
$$;

-- Calcul d'origine de app.vue_groupe(), recopié tel quel
CREATE OR REPLACE FUNCTION app.vue_groupe_calc()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app.header_groupe() and exists (
    select 1 from public.company_members m join public.profiles p on p.id = m.profile_id
    where m.profile_id = (select auth.uid()) and m.is_active and m.can_consolidate and p.is_active)
$function$;
revoke all on function app.vue_groupe_calc() from public, anon, authenticated;


-- app.vue_groupe() : même résultat, calculé une fois par requête
create or replace function app.vue_groupe()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text := app.ctx_cle();
  c text := current_setting('app.m_vue_groupe', true);
  x text;
  v boolean;
begin
  if c is not null and left(c, 32) = k then
    x := substr(c, 34);
    if x = '~' then return null; end if;
    return x::boolean;
  end if;
  v := app.vue_groupe_calc();
  perform set_config('app.m_vue_groupe', k || '|' || coalesce(v::text, '~'), true);
  return v;
end
$$;

-- Calcul d'origine de app.visible_companies(), recopié tel quel
CREATE OR REPLACE FUNCTION app.visible_companies_calc()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select m.company_id
  from public.company_members m
  join public.profiles p on p.id = m.profile_id
  where m.profile_id = (select auth.uid()) and m.is_active and p.is_active and p.role <> 'superadmin'
  union
  select c.id from public.companies c
  where (select app.is_superadmin()) and app.support_open(c.id)
$function$;
revoke all on function app.visible_companies_calc() from public, anon, authenticated;


-- app.visible_companies() : même résultat, calculé une fois par requête
create or replace function app.visible_companies()
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text := app.ctx_cle();
  c text := current_setting('app.m_visible_companies', true);
  v uuid[];
begin
  if c is not null and left(c, 32) = k then
    v := substr(c, 34)::uuid[];
  else
    v := coalesce((select array_agg(x) from app.visible_companies_calc() x), '{}'::uuid[]);
    perform set_config('app.m_visible_companies', k || '|' || v::text, true);
  end if;
  return query select unnest(v);
end
$$;

-- Calcul d'origine de app.societes_lisibles(), recopié tel quel
CREATE OR REPLACE FUNCTION app.societes_lisibles_calc()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id from public.companies c where (select app.role()) = any (array['entreprise', 'formateur_externe', 'stagiaire'])
  union
  select v from app.visible_companies() v where not coalesce((select app.role()) = any (array['entreprise', 'formateur_externe', 'stagiaire']), false)
$function$;
revoke all on function app.societes_lisibles_calc() from public, anon, authenticated;


-- app.societes_lisibles() : même résultat, calculé une fois par requête
create or replace function app.societes_lisibles()
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text := app.ctx_cle();
  c text := current_setting('app.m_societes_lisibles', true);
  v uuid[];
begin
  if c is not null and left(c, 32) = k then
    v := substr(c, 34)::uuid[];
  else
    v := coalesce((select array_agg(x) from app.societes_lisibles_calc() x), '{}'::uuid[]);
    perform set_config('app.m_societes_lisibles', k || '|' || v::text, true);
  end if;
  return query select unnest(v);
end
$$;

-- Calcul d'origine de app.societes_ecriture(), recopié tel quel
CREATE OR REPLACE FUNCTION app.societes_ecriture_calc()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id from public.companies c where (select app.role()) = any (array['entreprise', 'formateur_externe', 'stagiaire'])
  union
  select app.current_company() where app.current_company() is not null
    and not coalesce((select app.role()) = any (array['entreprise', 'formateur_externe', 'stagiaire']), false)
$function$;
revoke all on function app.societes_ecriture_calc() from public, anon, authenticated;


-- app.societes_ecriture() : même résultat, calculé une fois par requête
create or replace function app.societes_ecriture()
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text := app.ctx_cle();
  c text := current_setting('app.m_societes_ecriture', true);
  v uuid[];
begin
  if c is not null and left(c, 32) = k then
    v := substr(c, 34)::uuid[];
  else
    v := coalesce((select array_agg(x) from app.societes_ecriture_calc() x), '{}'::uuid[]);
    perform set_config('app.m_societes_ecriture', k || '|' || v::text, true);
  end if;
  return query select unnest(v);
end
$$;

insert into public.schema_migrations (version) values ('0090_cache_droits') on conflict (version) do nothing;

-- ===== supabase/rollback/0090_cache_droits_retour.sql =====
-- Retour arrière de 0090_cache_droits.sql : remet les définitions d'origine des sept fonctions, retire le cache,
-- les déclencheurs du compteur et les copies *_calc. Idempotent.

CREATE OR REPLACE FUNCTION app.role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when p.role = 'lecture'
     and exists (select 1 from public.itv_technicians t where t.profile_id = p.id and t.is_active)
     and exists (select 1 from public.org_modules m where m.key = 'interventions' and m.enabled)
    then 'technicien'
    else p.role
  end
  from public.profiles p
  where p.id = (select auth.uid()) and p.is_active
$function$;

CREATE OR REPLACE FUNCTION app.rights()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when app.vue_groupe() then
    (select coalesce(array_agg(x.code order by x.code), '{}'::text[]) from (
       select r.code from app.visible_companies() v, unnest(app.rights_for((select auth.uid()), v)) r(code)
       group by r.code having count(*) = (select count(*) from app.visible_companies())) x)
  else app.rights_for((select auth.uid()), app.current_company()) end
$function$;

CREATE OR REPLACE FUNCTION app.current_company()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when app.vue_groupe() then null else coalesce(
    (select h.v from (select app.header_company() as v) h
      where h.v in (select app.visible_companies())),
    (select m.company_id from public.company_members m
      where m.profile_id = (select auth.uid()) and m.is_active and m.is_default
        and m.company_id in (select app.visible_companies())
      limit 1),
    (select c.id from public.companies c
      where c.id in (select app.visible_companies())
      order by c.is_instance_owner desc, c.position, c.created_at
      limit 1)) end
$function$;

CREATE OR REPLACE FUNCTION app.vue_groupe()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app.header_groupe() and exists (
    select 1 from public.company_members m join public.profiles p on p.id = m.profile_id
    where m.profile_id = (select auth.uid()) and m.is_active and m.can_consolidate and p.is_active)
$function$;

CREATE OR REPLACE FUNCTION app.visible_companies()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select m.company_id
  from public.company_members m
  join public.profiles p on p.id = m.profile_id
  where m.profile_id = (select auth.uid()) and m.is_active and p.is_active and p.role <> 'superadmin'
  union
  select c.id from public.companies c
  where (select app.is_superadmin()) and app.support_open(c.id)
$function$;

CREATE OR REPLACE FUNCTION app.societes_lisibles()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id from public.companies c where (select app.role()) = any (array['entreprise', 'formateur_externe', 'stagiaire'])
  union
  select v from app.visible_companies() v where not coalesce((select app.role()) = any (array['entreprise', 'formateur_externe', 'stagiaire']), false)
$function$;

CREATE OR REPLACE FUNCTION app.societes_ecriture()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id from public.companies c where (select app.role()) = any (array['entreprise', 'formateur_externe', 'stagiaire'])
  union
  select app.current_company() where app.current_company() is not null
    and not coalesce((select app.role()) = any (array['entreprise', 'formateur_externe', 'stagiaire']), false)
$function$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'itv_technicians', 'org_modules', 'company_members', 'company_member_roles', 'company_member_rights', 'companies', 'permission_profiles', 'permission_profile_rights', 'permissions', 'offer_items', 'offer_restrictions', 'support_access_grants', 'company_modules'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists zz_droits_gen on public.%I', t);
    end if;
  end loop;
end $$;

drop function if exists app.role_calc();
drop function if exists app.rights_calc();
drop function if exists app.current_company_calc();
drop function if exists app.vue_groupe_calc();
drop function if exists app.visible_companies_calc();
drop function if exists app.societes_lisibles_calc();
drop function if exists app.societes_ecriture_calc();
drop function if exists app.droits_gen_suivant();
drop function if exists app.ctx_cle();

delete from public.schema_migrations where version = '0090_cache_droits';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE perf_0090 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
