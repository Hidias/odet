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
