-- Retour arrière de 0303_rh_fichiers_suppression.sql : remet la règle de lecture du bucket « rh » de 0301. Idempotent.

drop policy if exists rh_lire on storage.objects;
create policy rh_lire on storage.objects for select to authenticated
  using (bucket_id = 'rh' and exists (select 1 from public.hr_documents d where d.file_path = objects.name));

delete from public.schema_migrations where version = '0303_rh_fichiers_suppression';
