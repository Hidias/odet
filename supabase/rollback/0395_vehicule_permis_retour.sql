-- Retour arrière de 0395_vehicule_permis.sql : plus de vérification du permis à l'attribution. Idempotent.

drop trigger if exists vehicle_assignments_permis on public.vehicle_assignments;
drop function if exists app.vehicule_attribution_permis();
drop function if exists public.vehicule_permis_verifier(uuid, uuid, date);
drop function if exists app.permis_motif(uuid, uuid, uuid, date);

delete from public.schema_migrations where version = '0395_vehicule_permis';
