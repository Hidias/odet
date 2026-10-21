-- Retour arrière de 0401_journal_espace_client.sql. Idempotent.

drop function if exists public.client_portal_journal(text, text, text, text, uuid, text, text, text);
drop function if exists public.ent_journal(text, text, uuid, text, text, text);
drop function if exists app.portail_noter(uuid, text, uuid, uuid, text, text, uuid, text, text, text);
drop function if exists app.objet_du_client(text, uuid, uuid);
drop table if exists public.portal_events;
drop function if exists app.portal_events_fige();

delete from public.schema_migrations where version = '0401_journal_espace_client';
