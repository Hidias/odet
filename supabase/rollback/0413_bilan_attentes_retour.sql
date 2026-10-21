-- Retour arrière de 0413_bilan_attentes.sql. Les avis et bilans des attentes sont effacés ; les notifications déjà
-- créées restent. Idempotent.

drop function if exists public.portal_save_attentes(text, uuid, text, text, text);
alter table public.session_trainees drop constraint if exists session_trainees_attentes_bilan_check;
alter table public.session_trainees drop column if exists attentes_bilan_at;
alter table public.session_trainees drop column if exists attentes_bilan_note;
alter table public.session_trainees drop column if exists attentes_bilan;
alter table public.trainee_evaluations drop constraint if exists trainee_evaluations_attentes_satisfaites_check;
alter table public.trainee_evaluations drop column if exists attentes_commentaire;
alter table public.trainee_evaluations drop column if exists attentes_satisfaites;

delete from public.schema_migrations where version = '0413_bilan_attentes';
