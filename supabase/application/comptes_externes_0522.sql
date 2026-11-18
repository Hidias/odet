-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (comptes_externes_0522) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0522_comptes_externes_role.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0522_comptes_externes_role_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

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

-- 2. Reprise d'abord (le déclencheur de garde refuserait la correction : il est mis de côté le temps de la mise à jour)
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
