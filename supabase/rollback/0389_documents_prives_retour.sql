-- Retour arrière de 0389_documents_prives.sql : remet le bucket « documents » public. Idempotent.

drop policy if exists odet_documents_programmes_lire on storage.objects;
update storage.buckets set public = true where id = 'documents';

delete from public.schema_migrations where version = '0389_documents_prives';
