-- Retour arrière de 0402_signature_espace_client.sql : les signatures déjà faites restent. Idempotent.

drop function if exists public.client_portal_signer(text, text, uuid, text, text, text, text, text, text, text);
drop function if exists public.client_portal_signatures(text, text);
drop function if exists public.ent_signer(uuid, text, text, text, text, text, text, text);
drop function if exists public.ent_signatures();
drop function if exists app.portail_signer(uuid, text, uuid, uuid, uuid, text, text, text, text, text, text, text);
drop function if exists app.portail_signatures(uuid);
drop trigger if exists document_signatures_client_figee on public.document_signatures;
drop function if exists app.signature_client_figee();

delete from public.schema_migrations where version = '0402_signature_espace_client';
