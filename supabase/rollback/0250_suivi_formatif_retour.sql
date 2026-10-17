-- Retour arrière de 0250_suivi_formatif.sql (module Suivi formatif et archives de formation).
-- À coller dans l'éditeur SQL de Supabase. Efface les séquences du catalogue et des sessions, les saisies du
-- suivi formatif, le registre des fiches archivées et la colonne courses.formative_enabled.
-- Les fichiers déjà déposés dans le bucket « archives-formation » ne sont PAS effacés (archives) : le bucket et ses
-- fichiers restent, seules ses deux règles sont retirées (plus personne ne peut les lire depuis l'application).
-- Les grilles de certification SST déjà archivées gardent leur adresse dans sst_certifications.pdf_url.
-- Rien d'autre n'est touché.

begin;

drop policy if exists archives_formation_lire on storage.objects;
drop policy if exists archives_formation_deposer on storage.objects;

drop function if exists public.sf_register_sheet(uuid, text, text, text, text);
drop function if exists public.save_formative_batch(jsonb);
drop function if exists public.sf_init_session(uuid);

drop table if exists public.formative_sheets;
drop table if exists public.formative_evaluations;
drop table if exists public.session_sequences;
drop table if exists public.course_sequences;

drop function if exists public.sf_touch_updated_at();

alter table public.courses drop column if exists formative_enabled;

drop function if exists public.sf_archive_can(text, boolean);
drop function if exists public.sf_catalog_write();
drop function if exists public.sf_catalog_read();
drop function if exists public.sf_can_write(uuid, text);
drop function if exists public.sf_can_read(uuid, text);
drop function if exists public.sf_is_trainer_of(uuid);
drop function if exists public.sf_module_on(text);
drop function if exists public.sf_role();

delete from public.org_modules where key = 'suivi_formatif';
delete from public.schema_migrations where version = '0250_suivi_formatif';

commit;
