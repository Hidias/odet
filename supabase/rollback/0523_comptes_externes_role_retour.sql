-- Retour arrière de 0523 : garde de 0004 remise à l'identique, profils et appartenances repris remis à leurs valeurs
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

delete from public.schema_migrations where version = '0523_comptes_externes_role';
