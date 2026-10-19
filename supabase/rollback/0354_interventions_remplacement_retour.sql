-- Retour arrière de 0354_interventions_remplacement.sql : retire la garde de clôture, la reprise des numéros de série
-- et les colonnes ajoutées. Idempotent. Les motifs et numéros de série saisis sont perdus (ce sont des ajouts).

drop trigger if exists itv_visite_cloture_series on public.itv_visits;
drop function if exists app.itv_visite_cloture_series();
drop trigger if exists itv_visite_cloture_garde on public.itv_visits;
drop function if exists app.itv_visite_cloture_garde();

alter table public.itv_equipment drop constraint if exists itv_equipment_serial_number_check;
alter table public.itv_equipment drop column if exists serial_number;
alter table public.itv_visit_items drop constraint if exists itv_visit_items_new_serial_number_check;
alter table public.itv_visit_items drop constraint if exists itv_visit_items_replace_reason_check;
alter table public.itv_visit_items drop column if exists new_serial_number;
alter table public.itv_visit_items drop column if exists client_informed;
alter table public.itv_visit_items drop column if exists replace_note;
alter table public.itv_visit_items drop column if exists replace_reason;

delete from public.schema_migrations where version = '0354_interventions_remplacement';
