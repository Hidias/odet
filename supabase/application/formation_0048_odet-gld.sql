-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (formation_0048) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0048_fiche_programme.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0048_fiche_programme_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0048_fiche_programme.sql =====
-- 0048_fiche_programme.sql : fiche formation complète pour le programme (indicateur 1 de Qualiopi) et suivi des
-- versions des programmes.
--
-- Demande de H (19/10) : saisir dans la fiche formation toutes les informations d'un programme audité (modèle des
-- programmes Access Formation) et les retrouver sur le programme généré, sur une seule page.
-- 1. courses : effectif minimum et maximum, délai d'accès, recyclage conseillé ou durée de validité, documents
--    remis, profil du formateur, mention du tarif, modalités, modalités d'évaluation (existante), référence, version
--    et date de mise à jour du programme.
-- 2. programme_versions.course_id : chaque version enregistrée est reliée à sa formation (l'historique existant,
--    sans formation, reste lisible).
-- Aucune table nouvelle : les colonnes sont couvertes par les règles existantes de courses et programme_versions.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0048_fiche_programme_retour.sql

alter table public.courses add column if not exists min_participants integer;
alter table public.courses add column if not exists max_participants integer;
alter table public.courses add column if not exists access_delay text;
alter table public.courses add column if not exists validity_kind text;
alter table public.courses add column if not exists validity_text text;
alter table public.courses add column if not exists deliverables text;
alter table public.courses add column if not exists trainer_profile text;
alter table public.courses add column if not exists price_mention text;
alter table public.courses add column if not exists modalities text;
alter table public.courses add column if not exists program_ref text;
alter table public.courses add column if not exists program_version text;
alter table public.courses add column if not exists program_updated_on date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'courses_participants_check') then
    alter table public.courses add constraint courses_participants_check check (
      (min_participants is null or min_participants between 1 and 500)
      and (max_participants is null or max_participants between 1 and 500)
      and (min_participants is null or max_participants is null or min_participants <= max_participants));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'courses_validity_kind_check') then
    alter table public.courses add constraint courses_validity_kind_check
      check (validity_kind is null or validity_kind in ('recyclage', 'validite'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'courses_programme_textes_check') then
    alter table public.courses add constraint courses_programme_textes_check check (
      coalesce(length(access_delay), 0) <= 200 and coalesce(length(validity_text), 0) <= 60
      and coalesce(length(deliverables), 0) <= 600 and coalesce(length(trainer_profile), 0) <= 300
      and coalesce(length(price_mention), 0) <= 200 and coalesce(length(modalities), 0) <= 200
      and coalesce(length(program_ref), 0) <= 40 and coalesce(length(program_version), 0) <= 10);
  end if;
end $$;

comment on column public.courses.access_delay is 'Délai d''accès affiché sur le programme (vide : « En moyenne sous 15 jours »)';
comment on column public.courses.validity_kind is 'recyclage (Recyclage conseillé) ou validite (Durée de validité)';
comment on column public.courses.deliverables is 'Documents remis à l''issue de la formation (validation de la formation)';
comment on column public.courses.program_updated_on is 'Date de mise à jour du programme (posée à chaque version enregistrée)';

alter table public.programme_versions add column if not exists course_id uuid references public.courses(id) on delete set null;
create index if not exists programme_versions_course_id_idx on public.programme_versions (course_id);

insert into public.schema_migrations (version) values ('0048_fiche_programme') on conflict (version) do nothing;
