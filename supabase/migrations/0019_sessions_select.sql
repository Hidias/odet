-- 0019_sessions_select.sql : la lecture des sessions par les utilisateurs connectés passait par une règle
-- « public » supprimée en 0013. On la rétablit explicitement pour le rôle authenticated.
create policy "sessions_authenticated_select" on public.sessions for select to authenticated using (true);
insert into public.schema_migrations (version) values ('0019_sessions_select') on conflict (version) do nothing;
