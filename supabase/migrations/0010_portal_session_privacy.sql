-- 0010_portal_session_privacy.sql : la page publique du portail ne reçoit que le strict nécessaire
-- (plus de ligne client complète ni d'emails des stagiaires dans la liste de sélection)

create or replace function public.get_portal_session(token_param text)
returns json language plpgsql security definer set search_path = public as $$
declare
  session_record record;
  result json;
begin
  select s.*,
         json_build_object('id', c.id, 'title', c.title, 'code', c.code, 'duration_hours', c.duration_hours, 'duration_days', c.duration_days, 'objectives', c.objectives, 'theme_id', c.theme_id) as course_data,
         json_build_object('id', cl.id, 'name', cl.name, 'city', cl.city) as client_data
  into session_record
  from sessions s
  left join courses c on c.id = s.course_id
  left join clients cl on cl.id = s.client_id
  where s.attendance_token = token_param;

  if not found then
    raise exception 'Session non trouvée';
  end if;

  select json_build_object(
    'id', session_record.id,
    'reference', session_record.reference,
    'start_date', session_record.start_date,
    'end_date', session_record.end_date,
    'start_time', session_record.start_time,
    'end_time', session_record.end_time,
    'status', session_record.status,
    'day_type', session_record.day_type,
    'signature_mode', session_record.signature_mode,
    'session_type', session_record.session_type,
    'location_name', session_record.location_name,
    'location_city', session_record.location_city,
    'course_id', session_record.course_id,
    'client_id', session_record.client_id,
    'courses', session_record.course_data,
    'clients', session_record.client_data,
    'trainees', (
      select json_agg(json_build_object(
        'id', t.id,
        'first_name', t.first_name,
        'last_name', t.last_name,
        'session_trainee_id', st.id,
        'has_access_code', (st.access_code is not null),
        'access_code_attempts', st.access_code_attempts,
        'access_code_locked', coalesce(st.access_code_locked, false),
        'absent', coalesce(st.absent, false)
      ) order by t.last_name, t.first_name)
      from session_trainees st
      join trainees t on t.id = st.trainee_id
      where st.session_id = session_record.id
    )
  ) into result;

  return result;
end $$;
grant execute on function public.get_portal_session(text) to anon, authenticated;

insert into public.schema_migrations (version) values ('0010_portal_session_privacy') on conflict (version) do nothing;
