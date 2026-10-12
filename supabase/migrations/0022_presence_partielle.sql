-- 0022_presence_partielle.sql : arrivée tardive et départ anticipé à l'heure près, pour l'attestation de présence.
-- Par défaut rien n'est saisi : le stagiaire est compté du début à la fin de la formation.
-- presence_hours : heures retenues, calculées dans la fenêtre « Présence partielle » (modifiables avant enregistrement).
-- Heures locales (heure de Paris), type time sans fuseau.

alter table public.session_trainees
  add column if not exists arrival_date date,
  add column if not exists arrival_time time,
  add column if not exists departure_time time,
  add column if not exists presence_hours numeric(6,2);

-- Espace entreprise : les attestations générées côté client doivent porter les mêmes heures que dans l'application.
create or replace function public.client_portal_data(p_token text, p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  v_check jsonb;
  v_client uuid;
begin
  v_check := client_portal_check(p_token, p_code);
  if v_check ? 'error' then return v_check; end if;
  v_client := (v_check->>'client_id')::uuid;
  return jsonb_build_object(
    'client', (
      select jsonb_build_object('id', c.id, 'name', c.name, 'address', c.address, 'postal_code', c.postal_code, 'city', c.city,
        'siret', c.siret, 'contact_name', c.contact_name, 'contact_function', c.contact_function,
        'contact_email', c.contact_email, 'contact_phone', c.contact_phone)
      from clients c where c.id = v_client
    ),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'reference', s.reference, 'start_date', s.start_date, 'end_date', s.end_date,
        'start_time', s.start_time, 'end_time', s.end_time, 'day_type', s.day_type, 'status', s.status,
        'location_name', s.location_name, 'location_address', s.location_address,
        'location_postal_code', s.location_postal_code, 'location_city', s.location_city,
        'is_intra', s.is_intra, 'is_remote', s.is_remote, 'session_type', s.session_type,
        'total_price', s.total_price, 'funding_type', s.funding_type, 'funding_details', s.funding_details,
        'signatory_name', s.signatory_name, 'signatory_role', s.signatory_role,
        'inter_group_id', s.inter_group_id, 'inter_total_price', s.inter_total_price,
        'convention_signed', s.convention_signed, 'attendance_token', s.attendance_token,
        'courses', (select jsonb_build_object('id', co.id, 'title', co.title, 'objectives', co.objectives, 'content', co.content,
            'program', co.program, 'duration_hours', co.duration_hours, 'duration_days', co.duration_days, 'duration', co.duration,
            'price_ht', co.price_ht, 'price_per_day', co.price_per_day, 'target_audience', co.target_audience,
            'prerequisites', co.prerequisites, 'material', co.material, 'teaching_methods', co.teaching_methods,
            'evaluation_methods', co.evaluation_methods)
          from courses co where co.id = s.course_id),
        'trainers', (select jsonb_build_object('id', t.id, 'first_name', t.first_name, 'last_name', t.last_name, 'signature_url', t.signature_url)
          from trainers t where t.id = s.trainer_id),
        'session_trainees', coalesce((
          select jsonb_agg(jsonb_build_object('trainee_id', st.trainee_id, 'result', st.result, 'absent', coalesce(st.absent, false),
            'access_code', st.access_code,
            'early_departure', coalesce(st.early_departure, false), 'departure_date', st.departure_date, 'departure_time', st.departure_time,
            'arrival_date', st.arrival_date, 'arrival_time', st.arrival_time, 'presence_hours', st.presence_hours,
            'trainees', jsonb_build_object('id', tr.id, 'first_name', tr.first_name, 'last_name', tr.last_name, 'gender', tr.gender, 'job_title', tr.job_title))
            order by tr.last_name, tr.first_name)
          from session_trainees st join trainees tr on tr.id = st.trainee_id where st.session_id = s.id
        ), '[]'::jsonb),
        'halfdays', coalesce((
          select jsonb_agg(jsonb_build_object('trainee_id', h.trainee_id, 'date', h.date, 'morning', h.morning, 'afternoon', h.afternoon,
            'signature_morning', h.signature_morning, 'signature_afternoon', h.signature_afternoon))
          from attendance_halfdays h where h.session_id = s.id
        ), '[]'::jsonb),
        'proxies', coalesce((
          select jsonb_agg(to_jsonb(p)) from attendance_proxy_signatures p where p.session_id = s.id
        ), '[]'::jsonb)
      ) order by s.start_date desc)
      from sessions s
      where s.client_id = v_client
    ), '[]'::jsonb)
  );
end $function$;
