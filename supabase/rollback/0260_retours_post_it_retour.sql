-- Retour arrière de 0260_retours_post_it.sql : supprime la table des retours (et les retours qu'elle contient).
drop table if exists public.user_feedback;
delete from public.schema_migrations where version = '0260_retours_post_it';
