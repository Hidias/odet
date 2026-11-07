-- Retour arrière de 0502 : numéros remis en clair dans trainee_ssn.ssn (avant de retirer les colonnes), lectures
-- d'origine, clé retirée du coffre.
drop function if exists public.trainee_ssn_a_reprendre();
alter table public.trainee_ssn drop constraint if exists trainee_ssn_jamais_en_clair;
drop trigger if exists a_trainee_ssn_chiffrer on public.trainee_ssn;
update public.trainee_ssn set ssn = extensions.pgp_sym_decrypt(ssn_chiffre, app.ssn_cle()) where ssn_chiffre is not null;
alter table public.trainee_ssn alter column ssn set not null;

CREATE OR REPLACE FUNCTION public.load_trainee_data(p_token text, p_trainee_id uuid, p_ticket text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION public.get_trainee_with_ssn(p_id uuid)
 RETURNS TABLE(id uuid, first_name text, last_name text, email text, phone text, social_security_number text, client_id uuid, notes text, birth_date date, refused_ssn boolean, has_disability boolean, disability_details text, disability_adaptations text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := app.role();
  v_handi boolean := app.can_see_disability();
begin
  /* société (C2) */ perform app.exiger_societe('trainees', p_id, false);
  if not (v_role = any (array['superadmin', 'admin', 'direction', 'gestionnaire'])
          or (v_role = 'formateur' and p_id in (select app.trainer_trainee_ids()))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return query
  select t.id, t.first_name::text, t.last_name::text, t.email::text, t.phone::text,
         (select repeat('•', greatest(length(s.ssn) - 3, 0)) || right(s.ssn, 3) from public.trainee_ssn s where s.trainee_id = t.id),
         t.client_id, t.notes, t.birth_date, t.refused_ssn,
         case when v_handi then coalesce(d.has_disability, false) end,
         case when v_handi then d.details end,
         case when v_handi then d.adaptations end,
         t.created_at, t.updated_at
  from public.trainees t
  left join public.trainee_disability d on d.trainee_id = t.id
  where t.id = p_id;
end
$function$;

alter table public.trainee_ssn drop column if exists ssn_chiffre;
alter table public.trainee_ssn drop column if exists fin;
drop function if exists app.trainee_ssn_chiffrer();
drop function if exists app.ssn_cle();
delete from vault.secrets where name = 'odet_trainee_ssn';

delete from public.schema_migrations where version = '0502_nir_chiffre';
