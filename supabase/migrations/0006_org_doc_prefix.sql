-- 0006_org_doc_prefix.sql : préfixe des codes documentaires et politique de lecture du Storage media

alter table public.organization_settings add column if not exists doc_prefix varchar(5);

-- Bucket media : public en lecture, écriture par les utilisateurs connectés (branding, visuels)
insert into storage.buckets (id, name, public) values ('media', 'media', true) on conflict (id) do nothing;
drop policy if exists "media_auth_write" on storage.objects;
create policy "media_auth_write" on storage.objects for insert to authenticated with check (bucket_id = 'media');
drop policy if exists "media_auth_update" on storage.objects;
create policy "media_auth_update" on storage.objects for update to authenticated using (bucket_id = 'media') with check (bucket_id = 'media');
drop policy if exists "media_public_read" on storage.objects;
create policy "media_public_read" on storage.objects for select to anon, authenticated using (bucket_id = 'media');

update public.organization_settings set doc_prefix = upper(left(regexp_replace(app_short_name, '[^A-Za-z0-9]', '', 'g'), 6))
 where doc_prefix is null and nullif(btrim(app_short_name), '') is not null;
insert into public.schema_migrations (version) values ('0006_org_doc_prefix') on conflict (version) do nothing;
