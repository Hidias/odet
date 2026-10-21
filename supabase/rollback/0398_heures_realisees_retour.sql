-- Retour arrière de 0398_heures_realisees.sql : plus de régularisation des émargements. Idempotent.

drop table if exists public.attendance_regularisations;
drop function if exists app.regularisation_auteur();

delete from public.schema_migrations where version = '0398_heures_realisees';
