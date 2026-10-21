-- Retour arrière de 0409_apports.sql. L'origine notée sur les clients et les affaires, et les apporteurs, sont effacés.
-- Idempotent.

drop function if exists public.ca_apports(date, date);
alter table public.opportunities drop column if exists introduced_by_contributor;
alter table public.opportunities drop column if exists introduced_by_profile;
alter table public.opportunities drop column if exists idea_by;
alter table public.clients drop column if exists introduced_by_contributor;
alter table public.clients drop column if exists introduced_by_profile;
drop table if exists public.business_contributors;
drop function if exists app.business_contributors_maj();

delete from public.schema_migrations where version = '0409_apports';
