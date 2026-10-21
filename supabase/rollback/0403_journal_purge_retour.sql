-- Retour arrière de 0403_journal_purge.sql : la version de 0401 (toute modification refusée). Idempotent.

create or replace function app.portal_events_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Journal de l''espace client : une ligne ne se modifie pas' using errcode = '42501';
end
$$;
revoke all on function app.portal_events_fige() from public, anon, authenticated;

delete from public.schema_migrations where version = '0403_journal_purge';
