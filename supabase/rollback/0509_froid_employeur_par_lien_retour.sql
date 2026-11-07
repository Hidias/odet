-- Retour arrière de 0509 : ent_froid et ent_froid_repondre remises au corps de 0482, fonctions de l'espace par lien et
-- règles communes retirées (le questionnaire de l'employeur ne se remplit plus que par compte). Les réponses déjà
-- reçues par le lien restent ; l'accès qui les a données est recopié dans le journal d'audit avant le retrait de la
-- colonne repondu_acces. À retirer avec le code de l'écran et de l'API de la même PR (le mail mènerait sinon à un espace
-- par lien sans la rubrique).

-- Rejouable : la recopie n'a lieu que si la colonne existe encore
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'froid_employeur' and column_name = 'repondu_acces') then
    execute $q$
      insert into public.audit_logs (action, entity_type, entity_id, entity_name, details, company_id, source)
      select 'update', 'evaluation', fe.id, 'Réponse de l''employeur reçue par l''espace par lien (retour arrière de 0509)',
             jsonb_build_object('table', 'froid_employeur', 'repondu_acces', fe.repondu_acces, 'completed_at', fe.completed_at), fe.company_id, 'base'
        from public.froid_employeur fe where fe.repondu_acces is not null$q$;
  end if;
end
$$;

drop function if exists public.client_portal_froid_repondre(text, text, uuid, jsonb);
drop function if exists public.client_portal_froid(text, text);

create or replace function public.ent_froid()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte(); r public.froid_reglages := app.froid_reglage(v.company_id);
begin
  return jsonb_build_object(
    'actif', r.actif,
    'sessions', coalesce((select jsonb_agg(jsonb_build_object(
        'session_id', se.id, 'formation', co.title, 'debut', se.start_date, 'fin', coalesce(se.end_date, se.start_date),
        'employeur', case when r.employeur_actif or exists (select 1 from public.froid_envois e where e.session_id = se.id and e.client_id = v.client_id and e.cible = 'employeur' and e.statut = 'envoye') then jsonb_build_object(
            'recue', fe.completed_at is not null, 'recue_le', fe.completed_at,
            'questions', app.froid_questions(se.id, 'employeur')) end,
        'stagiaires', coalesce((select jsonb_agg(jsonb_build_object('prenom', tr.first_name, 'nom', tr.last_name,
              'recue', ec.completed_at is not null, 'code', st.access_code, 'jeton', se.attendance_token) order by tr.last_name, tr.first_name)
            from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
            left join public.evaluations_cold ec on ec.session_id = st.session_id and ec.trainee_id = st.trainee_id
            where st.session_id = se.id and tr.client_id = v.client_id and not coalesce(st.absent, false)
              and exists (select 1 from public.froid_envois e where e.session_id = se.id and e.trainee_id = st.trainee_id and e.cible = 'contact')), '[]'::jsonb))
        order by coalesce(se.end_date, se.start_date) desc)
      from public.sessions se left join public.courses co on co.id = se.course_id
      left join public.froid_employeur fe on fe.session_id = se.id and fe.client_id = v.client_id
      where se.company_id = v.company_id
        -- questionnaire ouvert par les réglages, ou déjà envoyé à l'employeur (il reste accessible si les réglages changent)
        and ((r.actif
              and se.status = 'completed' and coalesce(se.session_type, 'intra') <> 'subcontract'
       and not exists (select 1 from public.clients oc where oc.id = se.client_id and oc.client_type = 'organisme_formation')
              and coalesce(se.end_date, se.start_date) + coalesce(co.froid_delai_jours, r.premier_envoi_jours) <= public.paris_today()
              and (coalesce(se.end_date, se.start_date) >= public.paris_today() - r.anciennete_max_jours or se.froid_inclure))
             or exists (select 1 from public.froid_envois e where e.session_id = se.id and e.client_id = v.client_id and e.cible = 'employeur' and e.statut = 'envoye'))
        and (se.client_id = v.client_id or exists (select 1 from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
                                                    where st.session_id = se.id and tr.client_id = v.client_id))), '[]'::jsonb));
end
$$;
revoke all on function public.ent_froid() from public, anon;
grant execute on function public.ent_froid() to authenticated;

create or replace function public.ent_froid_repondre(p_session uuid, p_reponses jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte(); r public.froid_reglages := app.froid_reglage(v.company_id); v_q jsonb; v_ok boolean;
begin
  -- session visible dans l'espace entreprise, avec un questionnaire employeur proposé (réglage actif ou déjà envoyé)
  select exists (select 1 from jsonb_array_elements(public.ent_froid() -> 'sessions') x
                  where (x ->> 'session_id')::uuid = p_session and jsonb_typeof(x -> 'employeur') = 'object') into v_ok;
  if not v_ok then raise exception 'Questionnaire non disponible pour cette formation' using errcode = '22023'; end if;
  if exists (select 1 from public.froid_employeur fe where fe.session_id = p_session and fe.client_id = v.client_id and fe.completed_at is not null) then
    raise exception 'Votre réponse est déjà enregistrée : merci' using errcode = '23505';
  end if;
  v_q := app.froid_questions(p_session, 'employeur');
  if not app.froid_reponses_valides(v_q, p_reponses) then raise exception 'Merci de répondre à toutes les questions' using errcode = '22023'; end if;
  insert into public.froid_employeur (company_id, session_id, client_id, reponses, completed_at, repondu_par)
  values (v.company_id, p_session, v.client_id, p_reponses, now(), (select auth.uid()))
  on conflict (session_id, client_id) do update set reponses = excluded.reponses, completed_at = excluded.completed_at, repondu_par = excluded.repondu_par;
  update public.froid_envois set statut = 'ignore', motif = 'Réponse reçue'
   where session_id = p_session and client_id = v.client_id and cible = 'employeur' and statut = 'prepare';
  return jsonb_build_object('success', true);
end
$$;
revoke all on function public.ent_froid_repondre(uuid, jsonb) from public, anon;
grant execute on function public.ent_froid_repondre(uuid, jsonb) to authenticated;

drop function if exists app.froid_employeur_repondre(uuid, uuid, uuid, jsonb, uuid, uuid);
drop function if exists app.froid_employeur_client(uuid, uuid);

alter table public.froid_employeur drop column if exists repondu_acces;
comment on table public.froid_employeur is 'Évaluation à froid de l''employeur (0482) : réponse figée dès sa réception';

delete from public.schema_migrations where version = '0509_froid_employeur_par_lien';
