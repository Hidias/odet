-- 0013_lock_public_access.sql : fermeture des accès publics directs aux tables.
-- Les visiteurs non connectés (portail stagiaire, réclamation) passent par les fonctions
-- SECURITY DEFINER du portail. Seules quelques écritures et lectures limitées restent ouvertes.
--
-- 1. On supprime toutes les règles qui s'appliquent aux rôles anon ou public.
-- 2. Une table qui n'a plus aucune règle pour les utilisateurs connectés reçoit un accès complet
--    pour authenticated (les tables à règles fines, comme les évaluations verrouillées, gardent les leurs).
-- 3. On recrée les quelques accès publics nécessaires.

do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and (roles && array['anon', 'public']::name[])
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;

  for r in
    select c.relname as tablename
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname and 'authenticated' = any(p.roles)
      )
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', r.tablename || '_authenticated_all', r.tablename);
  end loop;
end $$;

-- Portail : documents pédagogiques destinés aux stagiaires et suivi des téléchargements
create policy "course_documents_portal_select" on public.course_documents
  for select to anon using (type = 'document_stagiaire');
create policy "session_document_access_portal_select" on public.session_document_access
  for select to anon using (true);
create policy "course_document_downloads_portal_insert" on public.course_document_downloads
  for insert to anon with check (true);

-- Formulaire public de réclamation (Qualiopi indicateur 31)
create policy "reclamations_public_insert" on public.reclamations
  for insert to anon with check (true);
create policy "non_conformites_reclamation_insert" on public.non_conformites
  for insert to anon with check (source = 'reclamation');
create policy "notifications_reclamation_insert" on public.notifications
  for insert to anon with check (type = 'reclamation');

-- Le formulaire de réclamation retrouve la session par sa référence : colonnes non sensibles uniquement
revoke select on public.sessions from anon;
grant select (id, reference, start_date, end_date, course_id) on public.sessions to anon;
create policy "sessions_reclamation_lookup" on public.sessions for select to anon using (true);
revoke select on public.courses from anon;
grant select (id, title) on public.courses to anon;
create policy "courses_public_title" on public.courses for select to anon using (true);

-- Plus aucune écriture directe des visiteurs sur les tables de personnes
revoke insert, update, delete on public.trainees, public.session_trainees, public.clients, public.client_contacts from anon;
revoke select on public.trainees, public.session_trainees, public.clients, public.client_contacts, public.organization_settings from anon;

insert into public.schema_migrations (version) values ('0013_lock_public_access') on conflict (version) do nothing;
