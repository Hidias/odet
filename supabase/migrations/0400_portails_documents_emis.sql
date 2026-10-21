-- 0400 : le portail client et l'espace entreprise servent la version émise des certificats et attestations (0399).
-- Ils recalculaient le document : après une absence décidée ou une correction, le client pouvait télécharger des
-- heures différentes de celles remises. Deux lectures, avec exactement les mêmes droits que les données de session
-- de chaque portail (mêmes sessions, mêmes stagiaires) ; ni motif ni auteur ne sortent. Volatiles : le contrôle du
-- lien du portail peut compter un essai. Idempotent.

create or replace function public.client_portal_documents_emis(p_token text, p_code text)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with vis as (
    select (s->>'id')::uuid as sid, (st->>'trainee_id')::uuid as tid
    from jsonb_array_elements(coalesce(public.client_portal_data(p_token, p_code)->'sessions', '[]'::jsonb)) s,
         jsonb_array_elements(coalesce(s->'session_trainees', '[]'::jsonb)) st
  )
  select coalesce(jsonb_agg(jsonb_build_object('session_id', d.session_id, 'trainee_id', d.trainee_id, 'kind', d.kind,
      'version', d.version, 'issued_on', d.issued_on, 'hours', d.hours, 'result', d.result, 'absences', d.absences)
    order by d.session_id, d.trainee_id, d.kind, d.version), '[]'::jsonb)
  from public.training_documents_issued d
  join vis on vis.sid = d.session_id and vis.tid = d.trainee_id
$$;
revoke all on function public.client_portal_documents_emis(text, text) from public;
grant execute on function public.client_portal_documents_emis(text, text) to anon, authenticated;

create or replace function public.ent_documents_emis()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with vis as (
    select (s->>'id')::uuid as sid, (st->>'trainee_id')::uuid as tid
    from jsonb_array_elements(coalesce(public.ent_sessions()->'sessions', '[]'::jsonb)) s,
         jsonb_array_elements(coalesce(s->'session_trainees', '[]'::jsonb)) st
  )
  select coalesce(jsonb_agg(jsonb_build_object('session_id', d.session_id, 'trainee_id', d.trainee_id, 'kind', d.kind,
      'version', d.version, 'issued_on', d.issued_on, 'hours', d.hours, 'result', d.result, 'absences', d.absences)
    order by d.session_id, d.trainee_id, d.kind, d.version), '[]'::jsonb)
  from public.training_documents_issued d
  join vis on vis.sid = d.session_id and vis.tid = d.trainee_id
$$;
revoke all on function public.ent_documents_emis() from public, anon;
grant execute on function public.ent_documents_emis() to authenticated;

insert into public.schema_migrations (version) values ('0400_portails_documents_emis') on conflict (version) do nothing;
