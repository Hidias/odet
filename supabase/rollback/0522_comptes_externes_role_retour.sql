-- Retour arrière de 0522 : garde de 0004 remise à l'identique. La reprise du rôle « entreprise » n'est pas défaite
-- (remettre un compte client dans l'équipe redonnerait des droits de lecture à un client).
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
