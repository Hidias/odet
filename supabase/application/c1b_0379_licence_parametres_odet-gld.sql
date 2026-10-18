-- APPLICATION RÉELLE de 0379 (droits de configuration réservés à la licence totale) sur l'instance odet-gld.
-- À lancer seulement après C1b (0370 à 0375) appliqué et fusionné. Une seule transaction implicite : si une
-- instruction échoue, rien n'est appliqué. Retour arrière : supabase/rollback/0379_droits_licence_parametres_retour.sql
select set_config('lock_timeout', '5s', true);

-- 0379_droits_licence_parametres.sql : droits de configuration réservés à la licence totale (chantier C1b).
--
-- Décision de H (17/10, confirmée le 18/10) : les Paramètres sont au super administrateur ; l'administrateur d'une
-- société ne les a que si la société a la licence totale (companies.full_license) ; la direction jamais.
-- 0372 a créé ces quatre droits sans le drapeau pour que l'application de C1b ne change aucun accès ; cette
-- migration le pose. Effet : sans licence totale, l'administrateur ne modifie plus l'identité de l'organisme
-- (organization_settings, org_settings), les modules (org_modules), les référents (quality_roles) ni les comptes
-- (profiles des autres personnes) ; il lit toujours tout cela et modifie son propre profil. Le super administrateur
-- garde tous ses droits.
-- Liste source : scripts/securite/droits.py (LICENCE_0379). Toujours après 0372.
-- Routes /api et fonctions SECURITY DEFINER : encore contrôlées par rôle (branche droits/fonctions).
-- Migration idempotente. Retour arrière : supabase/rollback/0379_droits_licence_parametres_retour.sql

update public.permissions set full_license_only = true, updated_at = now()
where code in ('parametres.organisme.modifier', 'parametres.modules.gerer', 'parametres.referents.gerer',
               'parametres.utilisateurs.gerer')
  and not full_license_only;

do $$
begin
  if (select count(*) from public.permissions
      where code in ('parametres.organisme.modifier', 'parametres.modules.gerer', 'parametres.referents.gerer',
                     'parametres.utilisateurs.gerer') and full_license_only) <> 4 then
    raise exception '0379 : les quatre droits de configuration sont introuvables (0372 appliquée ?)';
  end if;
end
$$;

insert into public.schema_migrations (version) values ('0379_droits_licence_parametres') on conflict (version) do nothing;
