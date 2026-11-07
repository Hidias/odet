-- 0504 : avis de l'entreprise donné depuis l'espace par lien (passage d'écran A11 du 07/11, V30).
-- Défaut : l'avis de l'entreprise sur une formation (0415, Qualiopi indicateur 30) ne se donnait que depuis l'espace
-- entreprise par compte. En production, aucun client n'a de compte : tous passent par le lien et le code. Aucune
-- entreprise ne pouvait donc donner son avis.
--   1. app.satisfaction_client(client, profil, session, réponses) : la règle de 0415 (session de ce client, terminée,
--      note globale de 1 à 5, notes facultatives de 1 à 5, textes bornés, notification au premier avis), sortie telle
--      quelle de public.ent_satisfaction pour servir aux deux espaces ; une session annulée n'est plus notée (relevé
--      par la relecture : le bouton s'affichait aussi pour elle). app.satisfactions_client(client) : avis donnés.
--   2. public.ent_satisfaction et public.ent_satisfactions appellent ces règles (même résultat qu'avant).
--   3. public.client_portal_satisfaction(jeton, code, session, réponses) et public.client_portal_satisfactions(jeton,
--      code) : même règle depuis l'espace par lien, après client_portal_check (erreurs du lien en JSON { error },
--      comme les autres fonctions de cet espace). Profil vide : l'avis vient du lien.
-- Retour arrière : supabase/rollback/0504_avis_entreprise_par_lien_retour.sql (corps de 0415, fonctions du lien retirées).

-- ── 1. Règles communes ──
create or replace function app.satisfaction_client(p_client uuid, p_profile uuid, p_session uuid, p_reponses jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  v_nouveau boolean;
  v_note int;
  r public.client_satisfactions;
  n text;
begin
  if p_client is null or not app.objet_du_client('session', p_session, p_client) then
    raise exception 'Session inconnue pour ce client' using errcode = '42501';
  end if;
  if p_reponses is not null then
    select se.company_id, se.start_date, coalesce(se.end_date, se.start_date) as fin, se.status, co.title into s
      from public.sessions se left join public.courses co on co.id = se.course_id where se.id = p_session;
    if s.status = 'cancelled' then
      raise exception 'Cette formation a été annulée' using errcode = '22023';
    end if;
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
    v_nouveau := not exists (select 1 from public.client_satisfactions x where x.session_id = p_session and x.client_id = p_client);
    insert into public.client_satisfactions (session_id, client_id, profile_id, note_globale, q_organisation, q_communication,
                                             q_objectifs, q_suivi, recommande, commentaire, besoins)
    values (p_session, p_client, p_profile, v_note, (p_reponses->>'q_organisation')::int, (p_reponses->>'q_communication')::int,
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
             jsonb_build_object('session_id', p_session, 'client_id', p_client)
      from public.clients c where c.id = p_client;
    end if;
  end if;
  select * into r from public.client_satisfactions x where x.session_id = p_session and x.client_id = p_client;
  if r.id is null then return null; end if;
  return jsonb_build_object('note_globale', r.note_globale, 'q_organisation', r.q_organisation, 'q_communication', r.q_communication,
    'q_objectifs', r.q_objectifs, 'q_suivi', r.q_suivi, 'recommande', r.recommande, 'commentaire', r.commentaire,
    'besoins', r.besoins, 'updated_at', r.updated_at);
end
$$;
revoke all on function app.satisfaction_client(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function app.satisfactions_client(p_client uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select jsonb_agg(jsonb_build_object('session_id', x.session_id, 'note_globale', x.note_globale))
                   from public.client_satisfactions x where x.client_id = p_client), '[]'::jsonb)
$$;
revoke all on function app.satisfactions_client(uuid) from public, anon, authenticated;

-- ── 2. Espace entreprise par compte ──
create or replace function public.ent_satisfaction(p_session uuid, p_reponses jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
begin
  return app.satisfaction_client(v.client_id, v.profile_id, p_session, p_reponses);
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
  return app.satisfactions_client(v.client_id);
end
$$;
revoke all on function public.ent_satisfactions() from public, anon;
grant execute on function public.ent_satisfactions() to authenticated;

-- ── 3. Espace par lien ──
create or replace function public.client_portal_satisfaction(p_token text, p_code text, p_session uuid, p_reponses jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_check jsonb := public.client_portal_check(p_token, p_code);
begin
  if v_check ? 'error' then return v_check; end if;
  return app.satisfaction_client((v_check ->> 'client_id')::uuid, null, p_session, p_reponses);
end
$$;
revoke all on function public.client_portal_satisfaction(text, text, uuid, jsonb) from public;
grant execute on function public.client_portal_satisfaction(text, text, uuid, jsonb) to anon, authenticated;

create or replace function public.client_portal_satisfactions(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_check jsonb := public.client_portal_check(p_token, p_code);
begin
  if v_check ? 'error' then return v_check; end if;
  return app.satisfactions_client((v_check ->> 'client_id')::uuid);
end
$$;
revoke all on function public.client_portal_satisfactions(text, text) from public;
grant execute on function public.client_portal_satisfactions(text, text) to anon, authenticated;

comment on table public.client_satisfactions is 'Avis de l''entreprise cliente sur une formation, donné depuis l''espace entreprise (compte ou lien ; profil vide : lien)';

insert into public.schema_migrations (version) values ('0504_avis_entreprise_par_lien') on conflict (version) do nothing;
