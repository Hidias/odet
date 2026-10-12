-- 0033_referents_noms_demo.sql : noms fictifs des responsables et référents qualité pour la démonstration.
--
-- Les documents qualité affichent normalement le compte utilisateur désigné pour chaque rôle. Pour une
-- démonstration, chaque rôle peut porter un nom fictif (titulaire et suppléant) sans créer de compte.
-- Ces noms ne s'affichent que tant que la ligne « quality_role_names » existe dans demo_records :
-- l'effacement des données de démonstration (Console) les fait disparaître et les comptes désignés
-- reprennent leur place, sans autre opération.

alter table public.quality_roles add column if not exists demo_name text;
alter table public.quality_roles add column if not exists demo_deputy_name text;

-- Vrai si les noms fictifs sont en service (compte connecté uniquement)
create or replace function public.quality_demo_names_active()
returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.demo_records where tbl = 'quality_role_names')
$$;
grant execute on function public.quality_demo_names_active() to authenticated;

-- Nom affiché du titulaire d'un rôle : nom fictif pendant la démonstration, sinon le compte désigné
create or replace function public.quality_role_name(p_code text)
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(
           case when exists (select 1 from public.demo_records where tbl = 'quality_role_names') then nullif(trim(r.demo_name), '') end,
           nullif(trim(concat_ws(' ', p.first_name, upper(p.last_name))), ''), nullif(trim(p.display_name), ''), p.email, '')
    from public.quality_roles r
    left join public.profiles p on p.id = r.profile_id
   where r.code = p_code;
$function$;

insert into public.schema_migrations (version) values ('0033_referents_noms_demo') on conflict (version) do nothing;
