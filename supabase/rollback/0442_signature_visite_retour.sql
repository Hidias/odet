-- Retour arrière de 0442_signature_visite.sql. Idempotent. Les preuves déjà enregistrées (document_signatures) restent.
drop trigger if exists itv_visits_signature_protegee on public.itv_visits;
drop function if exists public.itv_visit_preuve_signature(uuid);
drop function if exists public.itv_visit_signer(uuid, text, text, text);
drop function if exists app.itv_signature_preuve(uuid, text);
drop function if exists app.itv_signature_protegee();
delete from public.schema_migrations where version = '0442_signature_visite';
