-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (espaces_0424) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0424_espaces_sans_autres_participants.sql, retour arrière,
-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_schema || '.' || table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace)
  union all
  select 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal
    and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'migrations', 'public.schema_migrations', md5(coalesce(string_agg(version, ',' order by version), ''))
  from public.schema_migrations
  union all
  select 'données', 'organization_settings', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.organization_settings t
  union all
  select 'données', 'profiles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t
  union all
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t
  union all
  select 'données', 'company_members', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_members t
  union all
  select 'données', 'company_member_roles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_member_roles t;
create temp table etat_essai_avant as select * from etat_essai;

-- ===== supabase/migrations/0424_espaces_sans_autres_participants.sql =====
-- 0424 : espaces entreprise sans les participants des autres entreprises (demande de H, 21/10, 20 h 52 et 20 h 58).
-- Dans une session inter, l'entreprise « client principal » voyait tous les inscrits de la session (noms, résultats,
-- émargements, signatures), y compris ceux des autres entreprises. Désormais, en inter, chaque entreprise ne voit que
-- ses propres salariés (stagiaires rattachés au client ou inscrits dans son groupe), dans l'espace par lien et code
-- (client_portal_data) comme dans l'espace avec compte (ent_sessions). En intra, rien ne change.
-- Fonctions seulement. Idempotente. Retour arrière : supabase/rollback/0424_espaces_sans_autres_participants_retour.sql

CREATE OR REPLACE FUNCTION public.ent_sessions()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.client_accounts := app.ent_compte();
  v_sites uuid[] := app.ent_sites(v);
begin
  return jsonb_build_object(
    'client', (select jsonb_build_object('id', c.id, 'name', c.name, 'address', c.address, 'postal_code', c.postal_code, 'city', c.city,
        'siret', c.siret, 'contact_name', c.contact_name, 'contact_function', c.contact_function,
        'contact_email', c.contact_email, 'contact_phone', c.contact_phone)
      from public.clients c where c.id = v.client_id),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'reference', s.reference, 'start_date', s.start_date, 'end_date', s.end_date,
        'start_time', s.start_time, 'end_time', s.end_time, 'day_type', s.day_type, 'status', s.status,
        'location_name', s.location_name, 'location_address', s.location_address,
        'location_postal_code', s.location_postal_code, 'location_city', s.location_city,
        'is_intra', s.is_intra, 'is_remote', s.is_remote, 'session_type', s.session_type,
        'total_price', case when s.client_id = v.client_id then s.total_price else (select g.price_total from public.session_groups g where g.id = x.group_id) end,
        'funding_type', s.funding_type, 'funding_details', s.funding_details,
        'signatory_name', s.signatory_name, 'signatory_role', s.signatory_role,
        'convention_signed', s.convention_signed, 'attendance_token', s.attendance_token,
        'group_id', x.group_id,
        'courses', (select jsonb_build_object('id', co.id, 'title', co.title, 'objectives', co.objectives, 'content', co.content,
            'program', co.program, 'duration_hours', co.duration_hours, 'duration_days', co.duration_days, 'duration', co.duration,
            'price_ht', co.price_ht, 'price_per_day', co.price_per_day, 'target_audience', co.target_audience,
            'prerequisites', co.prerequisites, 'material', co.material, 'teaching_methods', co.teaching_methods,
            'evaluation_methods', co.evaluation_methods)
          from public.courses co where co.id = s.course_id),
        'trainers', (select jsonb_build_object('id', t.id, 'first_name', t.first_name, 'last_name', t.last_name)
          from public.trainers t where t.id = s.trainer_id),
        'session_trainees', coalesce((
          select jsonb_agg(jsonb_build_object('trainee_id', st.trainee_id, 'result', st.result, 'absent', coalesce(st.absent, false),
            'access_code', st.access_code,
            'early_departure', coalesce(st.early_departure, false), 'departure_date', st.departure_date, 'departure_time', st.departure_time,
            'arrival_date', st.arrival_date, 'arrival_time', st.arrival_time, 'presence_hours', st.presence_hours,
            'trainees', jsonb_build_object('id', tr.id, 'first_name', tr.first_name, 'last_name', tr.last_name, 'gender', tr.gender, 'job_title', tr.job_title))
            order by tr.last_name, tr.first_name)
          from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
          where st.session_id = s.id
            and ((s.client_id = v.client_id and coalesce(s.session_type, 'intra') <> 'inter') or st.group_id = x.group_id or tr.client_id = v.client_id or st.group_id in (select g2.id from public.session_groups g2 where g2.session_id = s.id and g2.client_id = v.client_id))
            and (v_sites is null or tr.site_id is null or tr.site_id = any (v_sites))
        ), '[]'::jsonb),
        'halfdays', coalesce((
          select jsonb_agg(jsonb_build_object('trainee_id', h.trainee_id, 'date', h.date, 'morning', h.morning, 'afternoon', h.afternoon,
            'signature_morning', h.signature_morning, 'signature_afternoon', h.signature_afternoon))
          from public.attendance_halfdays h
          where h.session_id = s.id and exists (
            select 1 from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
            where st.session_id = s.id and st.trainee_id = h.trainee_id
              and ((s.client_id = v.client_id and coalesce(s.session_type, 'intra') <> 'inter') or st.group_id = x.group_id or tr.client_id = v.client_id or st.group_id in (select g2.id from public.session_groups g2 where g2.session_id = s.id and g2.client_id = v.client_id)))
        ), '[]'::jsonb),
        'proxies', '[]'::jsonb
      ) order by s.start_date desc)
      from (
        select s0.id as session_id, null::uuid as group_id from public.sessions s0 where s0.client_id = v.client_id
        union
        select g.session_id, g.id from public.session_groups g
        join public.sessions s1 on s1.id = g.session_id
        where g.client_id = v.client_id and s1.client_id is distinct from v.client_id
      ) x
      join public.sessions s on s.id = x.session_id
      where v_sites is null or s.site_id is null or s.site_id = any (v_sites)
    ), '[]'::jsonb)
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_data(p_token text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
            and (coalesce(s.session_type, 'intra') <> 'inter' or tr.client_id = v_client or st.group_id in (select g2.id from session_groups g2 where g2.session_id = s.id and g2.client_id = v_client))
        ), '[]'::jsonb),
        'halfdays', coalesce((
          select jsonb_agg(jsonb_build_object('trainee_id', h.trainee_id, 'date', h.date, 'morning', h.morning, 'afternoon', h.afternoon,
            'signature_morning', h.signature_morning, 'signature_afternoon', h.signature_afternoon))
          from attendance_halfdays h where h.session_id = s.id and exists (select 1 from session_trainees st join trainees tr on tr.id = st.trainee_id where st.session_id = s.id and st.trainee_id = h.trainee_id and (coalesce(s.session_type, 'intra') <> 'inter' or tr.client_id = v_client or st.group_id in (select g2.id from session_groups g2 where g2.session_id = s.id and g2.client_id = v_client)))
        ), '[]'::jsonb),
        'proxies', coalesce((
          select jsonb_agg(to_jsonb(p)) from attendance_proxy_signatures p where p.session_id = s.id and exists (select 1 from session_trainees st join trainees tr on tr.id = st.trainee_id where st.session_id = s.id and st.trainee_id = p.trainee_id and (coalesce(s.session_type, 'intra') <> 'inter' or tr.client_id = v_client or st.group_id in (select g2.id from session_groups g2 where g2.session_id = s.id and g2.client_id = v_client)))
        ), '[]'::jsonb)
      ) order by s.start_date desc)
      from sessions s
      where s.client_id = v_client
    ), '[]'::jsonb)
  );
end $function$;

insert into public.schema_migrations (version) values ('0424_espaces_sans_autres_participants') on conflict (version) do nothing;

-- ===== supabase/rollback/0424_espaces_sans_autres_participants_retour.sql =====
-- Retour arrière de 0424 : les deux fonctions reprennent leur version d'avant. Idempotent.

CREATE OR REPLACE FUNCTION public.ent_sessions()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.client_accounts := app.ent_compte();
  v_sites uuid[] := app.ent_sites(v);
begin
  return jsonb_build_object(
    'client', (select jsonb_build_object('id', c.id, 'name', c.name, 'address', c.address, 'postal_code', c.postal_code, 'city', c.city,
        'siret', c.siret, 'contact_name', c.contact_name, 'contact_function', c.contact_function,
        'contact_email', c.contact_email, 'contact_phone', c.contact_phone)
      from public.clients c where c.id = v.client_id),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'reference', s.reference, 'start_date', s.start_date, 'end_date', s.end_date,
        'start_time', s.start_time, 'end_time', s.end_time, 'day_type', s.day_type, 'status', s.status,
        'location_name', s.location_name, 'location_address', s.location_address,
        'location_postal_code', s.location_postal_code, 'location_city', s.location_city,
        'is_intra', s.is_intra, 'is_remote', s.is_remote, 'session_type', s.session_type,
        'total_price', case when s.client_id = v.client_id then s.total_price else (select g.price_total from public.session_groups g where g.id = x.group_id) end,
        'funding_type', s.funding_type, 'funding_details', s.funding_details,
        'signatory_name', s.signatory_name, 'signatory_role', s.signatory_role,
        'convention_signed', s.convention_signed, 'attendance_token', s.attendance_token,
        'group_id', x.group_id,
        'courses', (select jsonb_build_object('id', co.id, 'title', co.title, 'objectives', co.objectives, 'content', co.content,
            'program', co.program, 'duration_hours', co.duration_hours, 'duration_days', co.duration_days, 'duration', co.duration,
            'price_ht', co.price_ht, 'price_per_day', co.price_per_day, 'target_audience', co.target_audience,
            'prerequisites', co.prerequisites, 'material', co.material, 'teaching_methods', co.teaching_methods,
            'evaluation_methods', co.evaluation_methods)
          from public.courses co where co.id = s.course_id),
        'trainers', (select jsonb_build_object('id', t.id, 'first_name', t.first_name, 'last_name', t.last_name)
          from public.trainers t where t.id = s.trainer_id),
        'session_trainees', coalesce((
          select jsonb_agg(jsonb_build_object('trainee_id', st.trainee_id, 'result', st.result, 'absent', coalesce(st.absent, false),
            'access_code', st.access_code,
            'early_departure', coalesce(st.early_departure, false), 'departure_date', st.departure_date, 'departure_time', st.departure_time,
            'arrival_date', st.arrival_date, 'arrival_time', st.arrival_time, 'presence_hours', st.presence_hours,
            'trainees', jsonb_build_object('id', tr.id, 'first_name', tr.first_name, 'last_name', tr.last_name, 'gender', tr.gender, 'job_title', tr.job_title))
            order by tr.last_name, tr.first_name)
          from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
          where st.session_id = s.id
            and (s.client_id = v.client_id or st.group_id = x.group_id or (x.group_id is null and tr.client_id = v.client_id))
            and (v_sites is null or tr.site_id is null or tr.site_id = any (v_sites))
        ), '[]'::jsonb),
        'halfdays', coalesce((
          select jsonb_agg(jsonb_build_object('trainee_id', h.trainee_id, 'date', h.date, 'morning', h.morning, 'afternoon', h.afternoon,
            'signature_morning', h.signature_morning, 'signature_afternoon', h.signature_afternoon))
          from public.attendance_halfdays h
          where h.session_id = s.id and exists (
            select 1 from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
            where st.session_id = s.id and st.trainee_id = h.trainee_id
              and (s.client_id = v.client_id or st.group_id = x.group_id or (x.group_id is null and tr.client_id = v.client_id)))
        ), '[]'::jsonb),
        'proxies', '[]'::jsonb
      ) order by s.start_date desc)
      from (
        select s0.id as session_id, null::uuid as group_id from public.sessions s0 where s0.client_id = v.client_id
        union
        select g.session_id, g.id from public.session_groups g
        join public.sessions s1 on s1.id = g.session_id
        where g.client_id = v.client_id and s1.client_id is distinct from v.client_id
      ) x
      join public.sessions s on s.id = x.session_id
      where v_sites is null or s.site_id is null or s.site_id = any (v_sites)
    ), '[]'::jsonb)
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_data(p_token text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

delete from public.schema_migrations where version = '0424_espaces_sans_autres_participants';

do $verif$
declare
  v_diff text[];
  v_n int;
  v_par text;
begin
  select count(*), (array_agg(coalesce(a.kind, b.kind) || ' ' || coalesce(a.name, b.name) || case
           when a.name is null then ' (en trop après retour)' when b.name is null then ' (manquant après retour)'
           else ' (différent)' end order by coalesce(a.kind, b.kind) desc, coalesce(a.name, b.name)))[1:40]
    into v_n, v_diff
  from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
  where a.v is distinct from b.v;
  select string_agg(k || ' ' || n, ', ') into v_par from (
    select coalesce(a.kind, b.kind) k, count(*) n
    from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
    where a.v is distinct from b.v group by 1) z;
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE espaces_0424 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
