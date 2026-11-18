-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (comptes_externes_0522) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0522_comptes_externes_role.sql, retour arrière,
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

-- ===== supabase/migrations/0522_comptes_externes_role.sql =====
-- 0522 : un compte extérieur (espace entreprise, formateur externe, stagiaire) ne devient jamais un compte de l'équipe,
-- et l'inverse (constat de H du 18/11 : le compte de l'espace client de M. Rolland, créé le 09/11 depuis la fiche du
-- client, figurait dans Paramètres › Utilisateurs ; son rôle y a été passé à « Lecture seule », ce qui lui donnait
-- une appartenance à la société et les droits de lecture de l'équipe, et cassait son espace client).
-- Règles :
--   1. protect_profile_role : un rôle extérieur ne se change pas en rôle de l'équipe, ni l'inverse, quel que soit
--      l'auteur (super administrateur compris). Il faut un autre compte, créé au bon endroit. Corps repris de 0004
--      (identique en production le 18/11), règle ajoutée.
--   2. Reprise : un profil relié à un compte de l'espace client (client_accounts) mais qui n'a plus le rôle
--      « entreprise » le retrouve ; le déclencheur sync_profile_member désactive alors son appartenance à la société
--      (aucune ligne supprimée). En production le 18/11 : 1 profil (jamais connecté).
-- Idempotente. Retour arrière : supabase/rollback/0522_comptes_externes_role_retour.sql

-- 2. Reprise d'abord (le déclencheur de garde refuserait la correction : il est mis de côté le temps de la mise à jour).
-- Valeurs d'avant gardées dans app.reprise_0522 pour un retour arrière à l'identique (table supprimée par le retour).
create table if not exists app.reprise_0522 (
  profile_id uuid primary key,
  role text not null,
  profile_updated_at timestamptz,
  members jsonb not null default '[]'::jsonb
);
revoke all on app.reprise_0522 from public, anon, authenticated;
insert into app.reprise_0522 (profile_id, role, profile_updated_at, members)
select p.id, p.role, p.updated_at,
       coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'is_active', m.is_active, 'role', m.role, 'updated_at', m.updated_at))
                   from public.company_members m where m.profile_id = p.id), '[]'::jsonb)
  from public.profiles p
 where p.role is distinct from 'entreprise'
   and p.role not in ('superadmin', 'formateur_externe', 'stagiaire')
   and exists (select 1 from public.client_accounts a where a.profile_id = p.id)
on conflict (profile_id) do nothing;
alter table public.profiles disable trigger profiles_protect_role;
update public.profiles p
   set role = 'entreprise', updated_at = now()
 where p.role is distinct from 'entreprise'
   and p.role not in ('superadmin', 'formateur_externe', 'stagiaire')
   and exists (select 1 from public.client_accounts a where a.profile_id = p.id);
alter table public.profiles enable trigger profiles_protect_role;

-- 1. Garde
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_externes constant text[] := array['entreprise', 'formateur_externe', 'stagiaire'];
begin
  if new.role is distinct from old.role then
    if not public.is_admin() then
      raise exception 'Seul un administrateur peut modifier un rôle';
    end if;
    if new.role = 'superadmin' and not public.is_superadmin() then
      raise exception 'Seul un super administrateur peut attribuer le rôle super administrateur';
    end if;
    if coalesce(old.role = any (v_externes), false) <> coalesce(new.role = any (v_externes), false) then
      raise exception 'Un compte extérieur (client, formateur externe, stagiaire) ne peut pas devenir un compte de l''équipe, ni l''inverse : créez un autre compte';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ===== supabase/rollback/0522_comptes_externes_role_retour.sql =====
-- Retour arrière de 0522 : garde de 0004 remise à l'identique, profils et appartenances repris remis à leurs valeurs
-- d'avant (app.reprise_0522), puis table de reprise supprimée. Déclencheurs mis de côté le temps de la remise en état
-- (sinon updated_at serait réécrit et la garde refuserait le changement de rôle).
do $$
begin
  if to_regclass('app.reprise_0522') is not null then
    alter table public.profiles disable trigger profiles_protect_role;
    alter table public.profiles disable trigger profiles_sync_company_member;
    update public.profiles p set role = r.role, updated_at = r.profile_updated_at
      from app.reprise_0522 r where p.id = r.profile_id;
    update public.company_members m set is_active = (x->>'is_active')::boolean, role = x->>'role', updated_at = (x->>'updated_at')::timestamptz
      from app.reprise_0522 r, jsonb_array_elements(r.members) x where m.id = (x->>'id')::uuid;
    alter table public.profiles enable trigger profiles_sync_company_member;
    alter table public.profiles enable trigger profiles_protect_role;
    drop table app.reprise_0522;
  end if;
end $$;

create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role then
    if not public.is_admin() then
      raise exception 'Seul un administrateur peut modifier un rôle';
    end if;
    if new.role = 'superadmin' and not public.is_superadmin() then
      raise exception 'Seul un super administrateur peut attribuer le rôle super administrateur';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE comptes_externes_0522 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
