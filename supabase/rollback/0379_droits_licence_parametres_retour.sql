-- Retour arrière de 0379_droits_licence_parametres.sql : l'administrateur retrouve, sans licence totale, la
-- configuration de l'organisme, des modules, des référents et des comptes (état d'après C1b, avant 0379).
-- Sans effet sur le reste de C1b. Idempotent.

update public.permissions set full_license_only = false, updated_at = now()
where code in ('parametres.organisme.modifier', 'parametres.modules.gerer', 'parametres.referents.gerer',
               'parametres.utilisateurs.gerer')
  and full_license_only;

delete from public.schema_migrations where version = '0379_droits_licence_parametres';
