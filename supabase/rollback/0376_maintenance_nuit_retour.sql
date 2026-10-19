-- Retour arrière de 0376_maintenance_nuit.sql : retire la fonction des écritures de la nuit.
-- Les lignes déjà écrites (sessions terminées, rappels, alertes, statuts des factures) restent : ce sont les mêmes
-- écritures que faisaient les pages. Après ce retour arrière, revenir aussi au code d'avant (les pages refont ces
-- écritures à leur ouverture). Idempotent.

drop function if exists public.daily_maintenance();

delete from public.schema_migrations where version = '0376_maintenance_nuit';
