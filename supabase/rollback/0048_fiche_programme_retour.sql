-- Retour arrière de 0048_fiche_programme.sql : retire les champs du programme de la fiche formation et le lien des
-- versions vers la formation. Idempotent. Les valeurs saisies dans ces champs sont perdues (ce sont des ajouts) ;
-- les lignes de programme_versions sont gardées.

drop index if exists public.programme_versions_course_id_idx;
alter table public.programme_versions drop column if exists course_id;

alter table public.courses drop constraint if exists courses_programme_textes_check;
alter table public.courses drop constraint if exists courses_validity_kind_check;
alter table public.courses drop constraint if exists courses_participants_check;
alter table public.courses drop column if exists program_updated_on;
alter table public.courses drop column if exists program_version;
alter table public.courses drop column if exists program_ref;
alter table public.courses drop column if exists modalities;
alter table public.courses drop column if exists price_mention;
alter table public.courses drop column if exists trainer_profile;
alter table public.courses drop column if exists deliverables;
alter table public.courses drop column if exists validity_text;
alter table public.courses drop column if exists validity_kind;
alter table public.courses drop column if exists access_delay;
alter table public.courses drop column if exists max_participants;
alter table public.courses drop column if exists min_participants;

delete from public.schema_migrations where version = '0048_fiche_programme';
