-- Retour arrière de 0447_vehicules_papiers.sql. Idempotent. Refusé s'il existe des papiers déposés (les fichiers
-- resteraient sans fiche) : les retirer d'abord.
do $do$
begin
  if to_regclass('public.vehicle_papers') is not null and exists (select 1 from public.vehicle_papers) then
    raise exception 'Des papiers de véhicules sont déposés : retour arrière refusé';
  end if;
end
$do$;
drop trigger if exists vehicle_events_sinistre on public.vehicle_events;
drop function if exists app.vehicule_sinistre_suivi();
drop function if exists app.jours_ouvres_apres(date, int);
alter table public.vehicle_events drop constraint if exists vehicle_events_sinistre_check;
alter table public.vehicle_events drop column if exists indemnity;
alter table public.vehicle_events drop column if exists deductible;
alter table public.vehicle_events drop column if exists injuries;
alter table public.vehicle_events drop column if exists at_fault;
alter table public.vehicle_events drop column if exists third_party;
alter table public.vehicle_events drop column if exists claim_ref;
alter table public.vehicle_events drop column if exists claim_declared_on;
alter table public.vehicle_events drop column if exists claim_deadline_on;
alter table public.vehicle_events drop column if exists claim_status;
drop policy if exists vehicules_papiers_lire on storage.objects;
drop table if exists public.vehicle_papers;
drop function if exists app.vehicule_papier_garde();
alter table public.vehicles drop constraint if exists vehicles_papiers_longueurs;
alter table public.vehicles drop column if exists own_damage_covered;
alter table public.vehicles drop column if exists insurer_agency_contact;
alter table public.vehicles drop column if exists insurer_agency_address;
alter table public.vehicles drop column if exists insurer_agency;
alter table public.vehicles drop column if exists green_card_number;
alter table public.vehicles drop column if exists registration_formula;
alter table public.vehicles drop column if exists commercial_name;
alter table public.vehicles drop column if exists national_genre;
alter table public.vehicles drop column if exists type_variant;
delete from public.schema_migrations where version = '0447_vehicules_papiers';
