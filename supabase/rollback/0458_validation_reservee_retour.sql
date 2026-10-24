-- Retour arrière de 0458 (validation réservée)
drop policy if exists notifications_audience_profils on public.notifications;
drop function if exists public.demander_validation(text, text, text);
drop function if exists public.validation_reservee_regler(uuid[], text[]);
drop trigger if exists doc_review_settings_reserve on public.doc_review_settings;
drop function if exists app.doc_review_settings_reserve();
drop trigger if exists quality_documents_reserve on public.quality_documents;
drop function if exists app.doc_statut_reserve();
drop trigger if exists quality_doc_versions_reserve on public.quality_doc_versions;
drop function if exists app.doc_version_reservee();
drop function if exists app.peut_valider_ce_doc(uuid, text);
drop function if exists app.validation_reservee(uuid, text);
alter table public.doc_review_settings drop column if exists docs_reserves;
alter table public.doc_review_settings drop column if exists validateurs;
delete from public.schema_migrations where version = '0458_validation_reservee';
