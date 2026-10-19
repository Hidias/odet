-- Retour arrière de 0346_signature_ip.sql. Idempotent. Les adresses déjà enregistrées restent.
drop trigger if exists signature_ip on public.document_signatures;
drop function if exists app.signature_ip();
delete from public.schema_migrations where version = '0346_signature_ip';
