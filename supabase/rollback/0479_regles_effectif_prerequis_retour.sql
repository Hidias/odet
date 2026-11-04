-- Retour arrière de 0479 : contrôles retirés ; colonnes retirées (les réglages et certificats saisis sont perdus).
drop trigger if exists sessions_effectif_strict on public.sessions;
drop trigger if exists session_trainees_effectif_strict on public.session_trainees;
drop function if exists app.controle_effectif_session();
drop function if exists app.controle_effectif_inscription();
drop function if exists app.effectif_strict_max(uuid);
alter table public.session_trainees drop constraint if exists session_trainees_prerequis_file_path_check;
alter table public.session_trainees drop column if exists prerequis_checked_by;
alter table public.session_trainees drop column if exists prerequis_checked_at;
alter table public.session_trainees drop column if exists prerequis_file_path;
alter table public.session_trainees drop column if exists prerequis_valid_until;
alter table public.courses drop constraint if exists courses_prerequis_certificat_mois_check;
alter table public.courses drop column if exists prerequis_certificat_mois;
alter table public.courses drop column if exists effectif_strict;
delete from public.schema_migrations where version = '0479_regles_effectif_prerequis';
