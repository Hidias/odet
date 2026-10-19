-- Retour arrière de 0381_audit_correctifs.sql : retire le verrou des visites terminées. Idempotent.

drop trigger if exists itv_visit_parts_figee on public.itv_visit_parts;
drop trigger if exists itv_visit_items_figee on public.itv_visit_items;
drop trigger if exists itv_visits_figee on public.itv_visits;
drop function if exists app.itv_visite_figee();

delete from public.schema_migrations where version = '0381_audit_correctifs';
