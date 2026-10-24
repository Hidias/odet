-- Retour arrière de 0450_espace_client_multisocietes.sql. Idempotent. Refusé si un profil a plusieurs accès (la règle
-- « un accès par profil » ne pourrait pas revenir) : retirer d'abord les accès en trop.
do $do$
begin
  if exists (select 1 from public.client_accounts group by profile_id having count(*) > 1) then
    raise exception 'Un profil a plusieurs accès entreprise : retour arrière refusé';
  end if;
end
$do$;
drop function if exists public.ent_choisir(uuid);
drop function if exists public.ent_societes();
create or replace function app.ent_dossier_registre()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.company_id::text || '/' || a.client_id::text
  from public.client_accounts a join public.profiles p on p.id = a.profile_id
  where a.profile_id = (select auth.uid()) and a.is_active and p.role = 'entreprise' and coalesce(p.is_active, true)
$$;
create or replace function app.ent_compte()
returns public.client_accounts
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.client_accounts;
begin
  select a.* into v
  from public.client_accounts a
  join public.profiles p on p.id = a.profile_id
  where a.profile_id = (select auth.uid()) and a.is_active and p.role = 'entreprise' and coalesce(p.is_active, true);
  if v.id is null then
    raise exception 'Espace entreprise : compte inconnu ou désactivé' using errcode = '42501';
  end if;
  return v;
end
$$;
drop table if exists public.client_account_actif;
drop index if exists public.client_accounts_profile_idx;
alter table public.client_accounts drop constraint if exists client_accounts_profil_client_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_accounts_profile_id_key') then
    alter table public.client_accounts add constraint client_accounts_profile_id_key unique (profile_id);
  end if;
end
$$;
delete from public.schema_migrations where version = '0450_espace_client_multisocietes';
