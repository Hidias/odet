-- Retour arrière de 0400_portails_documents_emis.sql. Idempotent.

drop function if exists public.client_portal_documents_emis(text, text);
drop function if exists public.ent_documents_emis();

delete from public.schema_migrations where version = '0400_portails_documents_emis';
