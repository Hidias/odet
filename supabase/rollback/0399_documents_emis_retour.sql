-- Retour arrière de 0399_documents_emis.sql : plus d'enregistrement des certificats émis. Idempotent.

drop table if exists public.training_documents_issued;
drop function if exists app.document_emis_auteur();

delete from public.schema_migrations where version = '0399_documents_emis';
