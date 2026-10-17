-- 0084_securite_portails.sql : les portails publics ne passent plus que par des fonctions à jeton (chantier 2).
-- 1. Portail stagiaire : quand le stagiaire a un code d'accès, la vérification du code délivre un ticket
--    (valable 12 heures) exigé ensuite pour lire ou modifier ses données. Le numéro de sécurité sociale
--    n'est plus jamais renvoyé : seulement « connu ou non » et ses 3 derniers chiffres (décision du 14/10 : masque au plus restrictif).
--    Les fonctions gardent leurs noms ; le ticket est un paramètre facultatif ajouté à la fin.
-- 2. Documents du stagiaire : lus et tracés par portal_documents et portal_log_download
--    (avant : lecture directe de course_documents et session_document_access par anon).
-- 3. Formulaire public de réclamation : public_reclamation_session et public_reclamation_submit
--    (avant : lecture directe de sessions par anon, refusée depuis 0013 : le formulaire était cassé).
-- Migration idempotente. Retour arrière : supabase/rollback/0080-0087_securite_retour.sql (les huit migrations ensemble)

alter table public.session_trainees add column if not exists portal_ticket text;
alter table public.session_trainees add column if not exists portal_ticket_expires_at timestamptz;

-- Contrôle commun : jeton de session, stagiaire inscrit, ticket si le stagiaire a un code
create or replace function app.portal_session_for(p_token text, p_trainee_id uuid, p_ticket text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_session_id uuid;
  v_st record;
begin
  select s.id into v_session_id from public.sessions s where s.attendance_token = p_token;
  if v_session_id is null or p_token is null or p_token = '' then
    raise exception 'Token invalide';
  end if;
  select st.access_code, st.portal_ticket, st.portal_ticket_expires_at into v_st
  from public.session_trainees st
  where st.session_id = v_session_id and st.trainee_id = p_trainee_id;
  if not found then
    raise exception 'Stagiaire non trouvé dans cette session';
  end if;
  if v_st.access_code is not null then
    if p_ticket is null or v_st.portal_ticket is null or v_st.portal_ticket <> p_ticket
       or v_st.portal_ticket_expires_at is null or v_st.portal_ticket_expires_at < now() then
      raise exception 'Code d''accès requis' using errcode = '42501';
    end if;
  end if;
  return v_session_id;
end
$function$;
revoke all on function app.portal_session_for(text, uuid, text) from public, anon, authenticated;

-- Vérification du code : délivre le ticket
create or replace function public.verify_trainee_access_code(p_session_trainee_id uuid, p_access_code character varying)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_session_trainee record;
  v_ticket text;
begin
  select * into v_session_trainee
  from session_trainees
  where id = p_session_trainee_id
  for update;

  if not found then
    return json_build_object('success', false, 'error', 'Stagiaire non trouvé');
  end if;

  if v_session_trainee.access_code_locked = true then
    return json_build_object('success', false, 'error', 'Compte verrouillé. Contactez l''administrateur.');
  end if;

  if v_session_trainee.access_code = p_access_code then
    v_ticket := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    update session_trainees
    set access_code_attempts = 0,
        access_code_locked = false,
        portal_ticket = v_ticket,
        portal_ticket_expires_at = now() + interval '12 hours'
    where id = p_session_trainee_id;
    return json_build_object('success', true, 'ticket', v_ticket);
  else
    update session_trainees
    set access_code_attempts = coalesce(access_code_attempts, 0) + 1,
        access_code_locked = case when coalesce(access_code_attempts, 0) + 1 >= 5 then true else false end,
        access_code_locked_at = case when coalesce(access_code_attempts, 0) + 1 >= 5 then now() else null end
    where id = p_session_trainee_id;

    if coalesce(v_session_trainee.access_code_attempts, 0) + 1 >= 5 then
      return json_build_object('success', false, 'error', 'Trop de tentatives. Compte verrouillé.');
    else
      return json_build_object('success', false, 'error', 'Code incorrect',
        'attempts_remaining', 5 - (coalesce(v_session_trainee.access_code_attempts, 0) + 1));
    end if;
  end if;
end;
$function$;

-- Lecture des données du stagiaire (sans numéro de sécurité sociale)
drop function if exists public.load_trainee_data(text, uuid);
create or replace function public.load_trainee_data(p_token text, p_trainee_id uuid, p_ticket text default null)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_session_id uuid;
  v_result json;
  v_trainee record;
  v_info_sheet record;
  v_theme_id uuid;
  v_ssn text;
begin
  v_session_id := app.portal_session_for(p_token, p_trainee_id, p_ticket);

  select * into v_trainee from trainees where id = p_trainee_id;
  select * into v_info_sheet from trainee_info_sheets where session_id = v_session_id and trainee_id = p_trainee_id;
  select c.theme_id into v_theme_id from sessions s join courses c on c.id = s.course_id where s.id = v_session_id;
  select s.ssn into v_ssn from trainee_ssn s where s.trainee_id = p_trainee_id;

  select json_build_object(
    'gender', v_trainee.gender,
    'info_sheet', json_build_object(
      'id', v_info_sheet.id,
      'session_id', v_session_id,
      'trainee_id', p_trainee_id,
      'email', coalesce(v_trainee.email, v_info_sheet.email),
      'ssn', null,
      'ssn_on_file', v_ssn is not null,
      'ssn_last3', case when v_ssn is not null then right(v_ssn, 3) end,
      'ssn_refused', coalesce(v_trainee.refused_ssn, v_info_sheet.ssn_refused, false),
      'csp', coalesce(v_trainee.csp, v_info_sheet.csp),
      'job_title', coalesce(v_trainee.job_title, v_info_sheet.job_title),
      'last_training_year', v_info_sheet.last_training_year,
      'highest_diploma', v_info_sheet.highest_diploma,
      'training_expectations', v_info_sheet.training_expectations,
      'rgpd_consent', v_info_sheet.rgpd_consent,
      'rgpd_consent_date', v_info_sheet.rgpd_consent_date,
      'filled_at', v_info_sheet.filled_at,
      'filled_online', v_info_sheet.filled_online
    ),
    'attendance', (
      select json_agg(row_to_json(a.*))
      from attendance_halfdays a
      where a.session_id = v_session_id and a.trainee_id = p_trainee_id
    ),
    'evaluation', (
      select row_to_json(e.*)
      from trainee_evaluations e
      where e.session_id = v_session_id and e.trainee_id = p_trainee_id
    ),
    'positioning_questions', (
      select json_agg(json_build_object(
        'id', tq.id, 'question_text', tq.question_text, 'question_type', tq.question_type,
        'options', tq.options, 'position', tq.position, 'score', tq.score, 'critical', tq.critical
      ) order by tq.position)
      from theme_questions tq
      where tq.theme_id = v_theme_id
    ),
    'positioning_test_completed', (
      select positioning_test_completed from session_trainees
      where session_id = v_session_id and trainee_id = p_trainee_id
    )
  ) into v_result;

  return v_result;
end;
$function$;

-- Mise à jour de la fiche du stagiaire (numéro vide = numéro conservé)
drop function if exists public.update_trainee_data(text, uuid, jsonb);
create or replace function public.update_trainee_data(p_token text, p_trainee_id uuid, p_data jsonb, p_ticket text default null)
returns json
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform app.portal_session_for(p_token, p_trainee_id, p_ticket);

  update trainees set
    first_name = coalesce(p_data->>'first_name', first_name),
    last_name = coalesce(p_data->>'last_name', last_name),
    email = coalesce(p_data->>'email', email),
    phone = coalesce(p_data->>'phone', phone),
    birth_date = coalesce((p_data->>'birth_date')::date, birth_date),
    social_security_number = nullif(regexp_replace(coalesce(p_data->>'social_security_number', ''), '\s', '', 'g'), ''),
    refused_ssn = coalesce((p_data->>'refused_ssn')::boolean, refused_ssn),
    csp = coalesce(p_data->>'csp', csp),
    job_title = coalesce(p_data->>'job_title', job_title),
    gender = coalesce(p_data->>'gender', gender),
    updated_at = now()
  where id = p_trainee_id;

  return json_build_object('success', true, 'id', p_trainee_id);
end;
$function$;

-- Fiche de renseignements (numéro vide = numéro conservé)
drop function if exists public.save_trainee_info(text, uuid, jsonb);
create or replace function public.save_trainee_info(p_token text, p_trainee_id uuid, p_data jsonb, p_ticket text default null)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_session_id uuid;
  v_id uuid;
begin
  v_session_id := app.portal_session_for(p_token, p_trainee_id, p_ticket);

  insert into trainee_info_sheets (
    session_id, trainee_id, email, ssn, ssn_refused, last_training_year,
    highest_diploma, csp, job_title, training_expectations, rgpd_consent,
    rgpd_consent_date, filled_at, filled_online
  ) values (
    v_session_id, p_trainee_id, p_data->>'email',
    nullif(regexp_replace(coalesce(p_data->>'ssn', ''), '\s', '', 'g'), ''),
    coalesce((p_data->>'ssn_refused')::boolean, false),
    (p_data->>'last_training_year')::integer, p_data->>'highest_diploma',
    p_data->>'csp', p_data->>'job_title', p_data->>'training_expectations',
    coalesce((p_data->>'rgpd_consent')::boolean, false),
    coalesce((p_data->>'rgpd_consent_date')::timestamptz, now()),
    coalesce((p_data->>'filled_at')::timestamptz, now()),
    coalesce((p_data->>'filled_online')::boolean, true)
  )
  on conflict (session_id, trainee_id)
  do update set
    email = excluded.email, ssn = excluded.ssn, ssn_refused = excluded.ssn_refused,
    last_training_year = excluded.last_training_year, highest_diploma = excluded.highest_diploma,
    csp = excluded.csp, job_title = excluded.job_title,
    training_expectations = excluded.training_expectations, rgpd_consent = excluded.rgpd_consent,
    rgpd_consent_date = excluded.rgpd_consent_date, filled_at = excluded.filled_at,
    filled_online = excluded.filled_online
  returning id into v_id;

  return json_build_object('success', true, 'id', v_id);
end;
$function$;

-- Documents du stagiaire activés pour la session
create or replace function public.portal_documents(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_session_id uuid;
  v_course_id uuid;
begin
  select s.id, s.course_id into v_session_id, v_course_id from sessions s where s.attendance_token = p_token;
  if v_session_id is null or p_token is null or p_token = '' then
    raise exception 'Token invalide';
  end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', d.id, 'course_id', d.course_id, 'type', d.type, 'title', d.title,
      'file_url', d.file_url, 'file_name', d.file_name, 'file_size', d.file_size
    ) order by d.title)
    from course_documents d
    join session_document_access a on a.document_id = d.id and a.session_id = v_session_id and a.is_active
    where d.course_id = v_course_id and d.type = 'document_stagiaire'
  ), '[]'::json);
end;
$function$;

-- Traçabilité d'un téléchargement (Qualiopi)
create or replace function public.portal_log_download(p_token text, p_document_id uuid, p_trainee_id uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_session_id uuid;
begin
  select s.id into v_session_id from sessions s where s.attendance_token = p_token;
  if v_session_id is null or p_token is null or p_token = '' then
    raise exception 'Token invalide';
  end if;
  if not exists (select 1 from session_document_access a
                 where a.session_id = v_session_id and a.document_id = p_document_id and a.is_active) then
    raise exception 'Document non disponible';
  end if;
  if p_trainee_id is not null and not exists (select 1 from session_trainees st
                                              where st.session_id = v_session_id and st.trainee_id = p_trainee_id) then
    p_trainee_id := null;
  end if;
  insert into course_document_downloads (document_id, session_id, trainee_id)
  values (p_document_id, v_session_id, p_trainee_id);
  return json_build_object('ok', true);
end;
$function$;

-- Réclamation publique : vérification du numéro de session
create or replace function public.public_reclamation_session(p_reference text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_ref text := upper(trim(coalesce(p_reference, '')));
  v json;
begin
  if length(v_ref) < 4 or length(v_ref) > 50 then
    return null;
  end if;
  -- Référence exacte (tous formats), sinon avec le préfixe SES- ajouté
  select json_build_object('id', s.id, 'reference', s.reference, 'title', coalesce(c.title, 'Formation'),
                           'start_date', s.start_date, 'end_date', s.end_date)
  into v
  from sessions s left join courses c on c.id = s.course_id
  where upper(s.reference) in (v_ref, 'SES-' || v_ref)
  order by upper(s.reference) = v_ref desc
  limit 1;
  return v;
end;
$function$;

-- Réclamation publique : enregistrement et notification
create or replace function public.public_reclamation_submit(
  p_session_id uuid, p_full_name text, p_email text, p_phone text default null,
  p_company text default null, p_message text default null)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_ref text;
  v_title text;
begin
  if coalesce(trim(p_full_name), '') = '' or coalesce(trim(p_email), '') = '' or coalesce(trim(p_message), '') = '' then
    raise exception 'Champs obligatoires manquants';
  end if;
  if length(p_full_name) > 200 or length(p_email) > 200 or length(coalesce(p_phone, '')) > 50
     or length(coalesce(p_company, '')) > 200 or length(p_message) > 10000 then
    raise exception 'Texte trop long';
  end if;
  select s.reference, coalesce(c.title, 'Formation') into v_ref, v_title
  from sessions s left join courses c on c.id = s.course_id where s.id = p_session_id;
  if v_ref is null then
    raise exception 'Session introuvable';
  end if;

  insert into reclamations (source, canal, session_id, subject, description, status)
  values ('stagiaire', 'formulaire', p_session_id, 'Réclamation - ' || trim(p_full_name),
    '**Réclamation reçue via formulaire public**' || E'\n\n' ||
    '**Informations du réclamant:**' || E'\n' ||
    '- Nom: ' || trim(p_full_name) || E'\n' ||
    '- Email: ' || trim(p_email) || E'\n' ||
    '- Téléphone: ' || coalesce(nullif(trim(p_phone), ''), 'Non renseigné') || E'\n' ||
    '- Entreprise: ' || coalesce(nullif(trim(p_company), ''), 'Non renseignée') || E'\n\n' ||
    '**Session concernée:**' || E'\n' ||
    '- Référence: ' || v_ref || E'\n' ||
    '- Formation: ' || v_title || E'\n\n' ||
    '**Message:**' || E'\n' || trim(p_message),
    'open');

  insert into notifications (type, title, message, link, metadata)
  values ('reclamation', 'Nouvelle réclamation reçue', trim(p_full_name) || ' - ' || v_ref, '/non-conformites',
          jsonb_build_object('fullName', trim(p_full_name), 'email', trim(p_email), 'sessionRef', v_ref));

  return json_build_object('ok', true);
end;
$function$;

-- Droits d'exécution des fonctions du portail
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('verify_trainee_access_code', 'load_trainee_data', 'update_trainee_data', 'save_trainee_info',
                        'portal_documents', 'portal_log_download', 'public_reclamation_session', 'public_reclamation_submit')
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('grant execute on function %s to anon, authenticated, service_role', r.sig);
  end loop;
end $$;

insert into public.schema_migrations (version) values ('0084_securite_portails') on conflict (version) do nothing;
