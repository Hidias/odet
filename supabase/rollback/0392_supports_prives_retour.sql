-- Retour arrière de 0392_supports_prives.sql : supports de formation de nouveau publics. Idempotent.

drop policy if exists odet_supports_lire on storage.objects;
drop policy if exists odet_public_lire on storage.objects;
create policy odet_public_lire on storage.objects for select to anon, authenticated
  using (bucket_id = any (array['course-documents', 'media']));
update storage.buckets set public = true where id = 'course-documents';

delete from public.schema_migrations where version = '0392_supports_prives';
