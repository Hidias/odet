-- Retour arrière de 0419_calendrier_public.sql. Les sessions publiées le restent (is_public, colonne existante).
-- Idempotent.

drop function if exists public.public_calendrier();
alter table public.organization_settings drop column if exists mention_maintien;
alter table public.organization_settings drop column if exists calendrier_public;

delete from public.schema_migrations where version = '0419_calendrier_public';
