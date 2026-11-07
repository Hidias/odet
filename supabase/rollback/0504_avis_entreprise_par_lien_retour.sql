-- Retour arrière de 0504 : ent_satisfaction et ent_satisfactions remises au corps de 0415, fonctions de l'espace par
-- lien et règles communes retirées (l'avis ne se donne plus que par compte). Les avis déjà donnés par le lien restent
-- (profil vide), lisibles par l'organisme comme avant.

create or replace function public.ent_satisfaction(p_session uuid, p_reponses jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
  s record;
  v_nouveau boolean;
  v_note int;
  r public.client_satisfactions;
  n text;
begin
  if not app.objet_du_client('session', p_session, v.client_id) then
    raise exception 'Session inconnue pour ce client' using errcode = '42501';
  end if;
  if p_reponses is not null then
    select se.company_id, se.start_date, coalesce(se.end_date, se.start_date) as fin, co.title into s
      from public.sessions se left join public.courses co on co.id = se.course_id where se.id = p_session;
    if s.fin > (now() at time zone 'Europe/Paris')::date then
      raise exception 'L''avis se donne à la fin de la formation' using errcode = '22023';
    end if;
    v_note := (p_reponses->>'note_globale')::int;
    if v_note is null or v_note < 1 or v_note > 5 then raise exception 'Note globale requise (de 1 à 5)' using errcode = '22023'; end if;
    foreach n in array array['q_organisation', 'q_communication', 'q_objectifs', 'q_suivi'] loop
      if p_reponses ? n and p_reponses->>n is not null and ((p_reponses->>n)::int < 1 or (p_reponses->>n)::int > 5) then
        raise exception 'Note invalide' using errcode = '22023';
      end if;
    end loop;
    v_nouveau := not exists (select 1 from public.client_satisfactions x where x.session_id = p_session and x.client_id = v.client_id);
    insert into public.client_satisfactions (session_id, client_id, profile_id, note_globale, q_organisation, q_communication,
                                             q_objectifs, q_suivi, recommande, commentaire, besoins)
    values (p_session, v.client_id, v.profile_id, v_note, (p_reponses->>'q_organisation')::int, (p_reponses->>'q_communication')::int,
            (p_reponses->>'q_objectifs')::int, (p_reponses->>'q_suivi')::int, (p_reponses->>'recommande')::boolean,
            nullif(btrim(left(coalesce(p_reponses->>'commentaire', ''), 2000)), ''),
            nullif(btrim(left(coalesce(p_reponses->>'besoins', ''), 1000)), ''))
    on conflict (session_id, client_id) do update
      set profile_id = excluded.profile_id, note_globale = excluded.note_globale, q_organisation = excluded.q_organisation,
          q_communication = excluded.q_communication, q_objectifs = excluded.q_objectifs, q_suivi = excluded.q_suivi,
          recommande = excluded.recommande, commentaire = excluded.commentaire, besoins = excluded.besoins, updated_at = now();
    if v_nouveau then
      insert into public.notifications (type, title, message, link, company_id, metadata)
      select 'satisfaction_entreprise',
             left('Avis de l''entreprise : ' || c.name || coalesce(' (' || s.title || ')', ''), 255),
             format('Note globale : %s sur 5', v_note)
               || case when (p_reponses->>'recommande')::boolean is true then ', recommande la formation'
                       when (p_reponses->>'recommande')::boolean is false then ', ne la recommande pas' else '' end
               || coalesce('. Besoins à venir : ' || nullif(btrim(left(coalesce(p_reponses->>'besoins', ''), 200)), ''), '') || '.',
             '/sessions/' || p_session, s.company_id,
             jsonb_build_object('session_id', p_session, 'client_id', v.client_id)
      from public.clients c where c.id = v.client_id;
    end if;
  end if;
  select * into r from public.client_satisfactions x where x.session_id = p_session and x.client_id = v.client_id;
  if r.id is null then return null; end if;
  return jsonb_build_object('note_globale', r.note_globale, 'q_organisation', r.q_organisation, 'q_communication', r.q_communication,
    'q_objectifs', r.q_objectifs, 'q_suivi', r.q_suivi, 'recommande', r.recommande, 'commentaire', r.commentaire,
    'besoins', r.besoins, 'updated_at', r.updated_at);
end
$$;
revoke all on function public.ent_satisfaction(uuid, jsonb) from public, anon;
grant execute on function public.ent_satisfaction(uuid, jsonb) to authenticated;

create or replace function public.ent_satisfactions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('session_id', x.session_id, 'note_globale', x.note_globale))
                   from public.client_satisfactions x where x.client_id = v.client_id), '[]'::jsonb);
end
$$;
revoke all on function public.ent_satisfactions() from public, anon;
grant execute on function public.ent_satisfactions() to authenticated;

drop function if exists public.client_portal_satisfaction(text, text, uuid, jsonb);
drop function if exists public.client_portal_satisfactions(text, text);
drop function if exists app.satisfaction_client(uuid, uuid, uuid, jsonb);
drop function if exists app.satisfactions_client(uuid);
comment on table public.client_satisfactions is 'Avis de l''entreprise cliente sur une formation, donné depuis l''espace entreprise';

delete from public.schema_migrations where version = '0504_avis_entreprise_par_lien';
