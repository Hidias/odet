-- Retour arrière de 0320_vehicules_parc.sql : retire le parc (tables, vues, fonctions, règles du bucket) et le module
-- s'il est coupé. Idempotent. Refusé si un véhicule a été saisi ou si un fichier est dans le bucket « vehicules ».

do $$
begin
  if (to_regclass('public.vehicles') is not null and exists (select 1 from public.vehicles))
     or exists (select 1 from storage.objects where bucket_id = 'vehicules') then
    raise exception 'Retour arrière refusé : des véhicules ou des tickets ont été saisis (à exporter d''abord)';
  end if;
end $$;

drop policy if exists vehicules_lire on storage.objects;
drop policy if exists vehicules_creer on storage.objects;
drop policy if exists vehicules_supprimer on storage.objects;
do $$
begin
  if not exists (select 1 from storage.objects where bucket_id = 'vehicules') then
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.buckets where id = 'vehicules';
  end if;
end $$;
drop view if exists public.v_vehicle_consumption;
drop view if exists public.v_vehicle_deadlines;
drop table if exists public.vehicle_fuel;
drop table if exists public.vehicle_events;
drop table if exists public.vehicle_maintenance_rules;
drop table if exists public.vehicle_odometer;
drop table if exists public.vehicle_assignments;
drop table if exists public.vehicles;
drop function if exists app.vehicule_releve();
drop function if exists app.vehicule_plein_controle();
drop function if exists app.vehicule_enfant_garde();
drop function if exists app.vehicule_km(uuid);
drop function if exists app.vehicules_miens();
delete from public.org_modules where key = 'vehicules' and not enabled;

delete from public.schema_migrations where version = '0320_vehicules_parc';
