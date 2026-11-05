-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (espace_lien_inter_0493) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0493_espace_lien_inter_numerotation.sql, retour arrière,
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

-- ===== supabase/migrations/0493_espace_lien_inter_numerotation.sql =====
-- 0493 : espace client par lien et code, sessions inter visibles par les groupes (C1) ; numérotation des sessions
-- sans collision (C5) ; convention d'une session signée par son seul client principal.
-- C1 : client_portal_data ne listait que les sessions dont le client est le client principal. Une entreprise inscrite
-- à une inter par un groupe ne voyait ni dates, ni lieu, ni participants (relevé en A12 le 05/11 ; l'espace avec
-- compte, ent_sessions, les voit). Elle les voit désormais, avec les mêmes règles qu'ent_sessions : seulement ses
-- propres participants, le prix de son groupe, ni le prix ni le groupe de l'inter (inter_group_id, inter_total_price).
-- C5 : generate_session_reference_v3 calculait le compteur sans verrou ; deux créations simultanées (même formation,
-- même jour) prenaient le même numéro et la seconde échouait. Un verrou consultatif de transaction les met en file.
-- Signature : app.portail_signer acceptait la convention d'une session de la part d'une entreprise inscrite par un
-- groupe (app.objet_du_client voit aussi les groupes) et marquait alors la session entière « signée ». Seul le client
-- principal signe la convention d'une session ; un groupe signe son propre document (0420, 0490). Aucune signature
-- de ce genre en production (contrôle du 05/11).
-- Les deux espaces (client_portal_data et ent_sessions) ne donnent plus à un groupe le financement ni le signataire du
-- client principal de l'inter.
-- Idempotente. Retour arrière : supabase/rollback/0493_espace_lien_inter_numerotation_retour.sql

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
        'total_price', case when x.group_id is null then s.total_price else (select g.price_total from session_groups g where g.id = x.group_id) end,
        -- Financement et signataire appartiennent au client principal : rien pour un groupe
        'funding_type', case when x.group_id is null then s.funding_type end,
        'funding_details', case when x.group_id is null then s.funding_details end,
        'signatory_name', case when x.group_id is null then s.signatory_name end,
        'signatory_role', case when x.group_id is null then s.signatory_role end,
        'inter_group_id', case when x.group_id is null then s.inter_group_id end,
        'inter_total_price', case when x.group_id is null then s.inter_total_price end,
        'group_id', x.group_id,
        'convention_signed', s.convention_signed, 'attendance_token', s.attendance_token,
        'courses', (select jsonb_build_object('id', co.id, 'title', co.title, 'objectives', co.objectives, 'content', co.content,
            'program', co.program, 'duration_hours', co.duration_hours, 'duration_days', co.duration_days, 'duration', co.duration,
            'price_ht', co.price_ht, 'price_per_day', co.price_per_day, 'target_audience', co.target_audience,
            'prerequisites', co.prerequisites, 'material', co.material, 'teaching_methods', co.teaching_methods, 'methods', co.methods, 'trainer_equipment', co.trainer_equipment,
            'evaluation_methods', co.evaluation_methods)
          from courses co where co.id = s.course_id),
        'trainers', (select jsonb_build_object('id', t.id, 'first_name', t.first_name, 'last_name', t.last_name, 'signature_url', t.signature_url)
          from trainers t where t.id = s.trainer_id),
        'session_trainees', coalesce((
          select jsonb_agg(jsonb_build_object('trainee_id', st.trainee_id, 'result', st.result, 'absent', coalesce(st.absent, false),
            'access_code', st.access_code, 'convocation_sent_at', st.convocation_sent_at,
            'early_departure', coalesce(st.early_departure, false), 'departure_date', st.departure_date, 'departure_time', st.departure_time,
            'arrival_date', st.arrival_date, 'arrival_time', st.arrival_time, 'presence_hours', st.presence_hours,
            'trainees', jsonb_build_object('id', tr.id, 'first_name', tr.first_name, 'last_name', tr.last_name, 'gender', tr.gender, 'job_title', tr.job_title))
            order by tr.last_name, tr.first_name)
          from session_trainees st join trainees tr on tr.id = st.trainee_id where st.session_id = s.id
            and ((x.group_id is null and coalesce(s.session_type, 'intra') <> 'inter') or tr.client_id = v_client or st.group_id in (select g2.id from session_groups g2 where g2.session_id = s.id and g2.client_id = v_client))
        ), '[]'::jsonb),
        'halfdays', coalesce((
          select jsonb_agg(jsonb_build_object('trainee_id', h.trainee_id, 'date', h.date, 'morning', h.morning, 'afternoon', h.afternoon,
            'signature_morning', h.signature_morning, 'signature_afternoon', h.signature_afternoon))
          from attendance_halfdays h where h.session_id = s.id and exists (select 1 from session_trainees st join trainees tr on tr.id = st.trainee_id where st.session_id = s.id and st.trainee_id = h.trainee_id and ((x.group_id is null and coalesce(s.session_type, 'intra') <> 'inter') or tr.client_id = v_client or st.group_id in (select g2.id from session_groups g2 where g2.session_id = s.id and g2.client_id = v_client)))
        ), '[]'::jsonb),
        'proxies', coalesce((
          select jsonb_agg(to_jsonb(p)) from attendance_proxy_signatures p where p.session_id = s.id and exists (select 1 from session_trainees st join trainees tr on tr.id = st.trainee_id where st.session_id = s.id and st.trainee_id = p.trainee_id and ((x.group_id is null and coalesce(s.session_type, 'intra') <> 'inter') or tr.client_id = v_client or st.group_id in (select g2.id from session_groups g2 where g2.session_id = s.id and g2.client_id = v_client)))
        ), '[]'::jsonb)
      ) order by s.start_date desc)
      from (
        -- Sessions dont le client est le client principal, puis sessions inter où il est inscrit par un groupe (C1,
        -- comme ent_sessions) ; une session dont il est déjà client principal n'est pas répétée par ses groupes
        select s0.id as session_id, null::uuid as group_id from sessions s0 where s0.client_id = v_client
        union
        select g.session_id, g.id from session_groups g
        join sessions s1 on s1.id = g.session_id
        where g.client_id = v_client and s1.client_id is distinct from v_client
      ) x
      join sessions s on s.id = x.session_id
    ), '[]'::jsonb)
  );
end $function$;

CREATE OR REPLACE FUNCTION public.generate_session_reference_v3()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prefix text;
  v_course_code text;
  v_date_str text;
  v_counter integer;
begin
  select nullif(trim(o.doc_prefix), '') into v_prefix from app.identite_societe(new.company_id) o;
  v_prefix := upper(coalesce(v_prefix, 'SES'));

  select code into v_course_code from courses where id = new.course_id;
  if v_course_code is null or v_course_code = '' then
    v_course_code := 'FORM';
  end if;

  v_date_str := to_char(new.start_date, 'YYMMDD');

  -- C5 : deux créations simultanées (même société, même formation, même jour) attendent leur tour au lieu de
  -- calculer le même numéro ; le verrou tombe à la fin de la transaction. Suffisant en « read committed » (réglage
  -- de la base) : sous « repeatable read », la seconde ne verrait pas la première et échouerait encore
  perform pg_advisory_xact_lock(hashtextextended('session_reference:' || v_prefix || '-' || v_course_code || '-' || v_date_str, 0));

  select coalesce(max(cast(substring(reference from '-(\d{3})$') as integer)), 0) + 1
    into v_counter
  from sessions
  where reference like v_prefix || '-' || v_course_code || '-' || v_date_str || '-%';

  new.reference := v_prefix || '-' || v_course_code || '-' || v_date_str || '-' || lpad(v_counter::text, 3, '0');
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app.portail_signer(p_client uuid, p_channel text, p_access uuid, p_profile uuid, p_session uuid, p_kind text, p_sha256 text, p_name text, p_role text, p_signature text, p_consent text, p_label text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_s public.sessions;
  v_id uuid;
  v_ex public.document_signatures;
  v_nom text := btrim(coalesce(p_name, ''));
begin
  if p_kind is distinct from 'convention' then raise exception 'Document non signable ici' using errcode = '22023'; end if;
  if not app.objet_du_client('session', p_session, p_client) then raise exception 'Session inconnue pour ce client' using errcode = '42501'; end if;
  if length(v_nom) < 2 or length(v_nom) > 120 then raise exception 'Nom du signataire requis' using errcode = '22023'; end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Empreinte du document invalide' using errcode = '22023'; end if;
  if p_signature is null or p_signature !~ '^data:image/png;base64,' or length(p_signature) > 400000 then
    raise exception 'Signature invalide' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_consent, ''))) < 20 then raise exception 'Accord du signataire requis' using errcode = '22023'; end if;
  -- Mention écrite au clavier par le signataire (0429) : « Bon pour accord » ou « Lu et approuvé, bon pour accord »
  if coalesce(p_consent, '') !~* '«[^»]*bon pour accord[^»]*»' then
    raise exception 'Mention « Bon pour accord » à écrire par le signataire' using errcode = '22023';
  end if;

  select * into v_s from public.sessions where id = p_session;
  -- La convention d'une session se signe par son client principal ; une entreprise inscrite à une inter par un
  -- groupe signe la convention de son groupe (document de l'espace client), jamais celle de la session
  if v_s.client_id is distinct from p_client then
    raise exception 'La convention de cette session se signe par votre groupe' using errcode = '42501';
  end if;
  -- Déjà signée avec ce même document : rien de plus
  select * into v_ex from public.document_signatures d
  where d.session_id = p_session and d.document_type = 'convention' and d.signer_type = 'client' and d.status = 'valid'
    and d.document_hash = p_sha256 order by d.signed_at desc limit 1;
  if v_ex.id is not null then return jsonb_build_object('id', v_ex.id, 'deja', true); end if;

  insert into public.document_signatures (document_type, session_id, client_id, signer_type, signer_name, signer_role,
    signature_data, document_hash, signed_at, metadata, status, company_id)
  values ('convention', p_session, p_client, 'client', v_nom, nullif(left(btrim(coalesce(p_role, '')), 120), ''),
    p_signature, p_sha256, now(),
    jsonb_build_object('canal', p_channel, 'access_id', p_access, 'profile_id', p_profile, 'consentement', left(p_consent, 1000),
      'document', left(p_label, 200), 'reference', v_s.reference),
    'valid', v_s.company_id)
  returning id into v_id;

  update public.sessions set convention_signed = true, convention_signed_date = now()
  where id = p_session and not coalesce(convention_signed, false);

  insert into public.portal_events (company_id, client_id, channel, access_id, profile_id, event, object_type, object_id,
    document_kind, document_label, document_sha256, ip, user_agent)
  values (v_s.company_id, p_client, p_channel, p_access, p_profile, 'signature', 'session', p_session, 'convention',
    left(coalesce(p_label, 'Convention de formation'), 200), p_sha256,
    left(coalesce(app.audit_entete('x-forwarded-for'), app.audit_entete('x-real-ip')), 64), left(app.entete_complet('user-agent'), 400));

  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (v_s.company_id, 'convention_signee', 'Convention signée en ligne',
    v_nom || coalesce(', ' || nullif(btrim(coalesce(p_role, '')), ''), '') || ' a signé la convention ' || coalesce(v_s.reference, '')
      || ' (' || (select c.name from public.clients c where c.id = p_client) || ').',
    '/sessions/' || p_session, jsonb_build_object('session_id', p_session, 'signature_id', v_id));

  return jsonb_build_object('id', v_id, 'deja', false);
end
$function$;

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
        -- Financement et signataire appartiennent au client principal : rien pour un groupe (0493)
        'funding_type', case when x.group_id is null then s.funding_type end,
        'funding_details', case when x.group_id is null then s.funding_details end,
        'signatory_name', case when x.group_id is null then s.signatory_name end,
        'signatory_role', case when x.group_id is null then s.signatory_role end,
        'convention_signed', s.convention_signed, 'attendance_token', s.attendance_token,
        'group_id', x.group_id,
        'courses', (select jsonb_build_object('id', co.id, 'title', co.title, 'objectives', co.objectives, 'content', co.content,
            'program', co.program, 'duration_hours', co.duration_hours, 'duration_days', co.duration_days, 'duration', co.duration,
            'price_ht', co.price_ht, 'price_per_day', co.price_per_day, 'target_audience', co.target_audience,
            'prerequisites', co.prerequisites, 'material', co.material, 'teaching_methods', co.teaching_methods, 'methods', co.methods, 'trainer_equipment', co.trainer_equipment,
            'evaluation_methods', co.evaluation_methods)
          from public.courses co where co.id = s.course_id),
        'trainers', (select jsonb_build_object('id', t.id, 'first_name', t.first_name, 'last_name', t.last_name)
          from public.trainers t where t.id = s.trainer_id),
        'session_trainees', coalesce((
          select jsonb_agg(jsonb_build_object('trainee_id', st.trainee_id, 'result', st.result, 'absent', coalesce(st.absent, false),
            'access_code', st.access_code, 'convocation_sent_at', st.convocation_sent_at,
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

insert into public.schema_migrations (version) values ('0493_espace_lien_inter_numerotation') on conflict (version) do nothing;

-- ===== supabase/rollback/0493_espace_lien_inter_numerotation_retour.sql =====
-- Retour arrière de 0493 : les quatre fonctions reprennent leur définition d'avant 0493 (texte relevé en production le
-- 05/11, empreintes identiques à une base reconstruite jusqu'à 0492). Aucune donnée n'est touchée.

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
            'prerequisites', co.prerequisites, 'material', co.material, 'teaching_methods', co.teaching_methods, 'methods', co.methods, 'trainer_equipment', co.trainer_equipment,
            'evaluation_methods', co.evaluation_methods)
          from courses co where co.id = s.course_id),
        'trainers', (select jsonb_build_object('id', t.id, 'first_name', t.first_name, 'last_name', t.last_name, 'signature_url', t.signature_url)
          from trainers t where t.id = s.trainer_id),
        'session_trainees', coalesce((
          select jsonb_agg(jsonb_build_object('trainee_id', st.trainee_id, 'result', st.result, 'absent', coalesce(st.absent, false),
            'access_code', st.access_code, 'convocation_sent_at', st.convocation_sent_at,
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

CREATE OR REPLACE FUNCTION public.generate_session_reference_v3()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prefix text;
  v_course_code text;
  v_date_str text;
  v_counter integer;
begin
  select nullif(trim(o.doc_prefix), '') into v_prefix from app.identite_societe(new.company_id) o;
  v_prefix := upper(coalesce(v_prefix, 'SES'));

  select code into v_course_code from courses where id = new.course_id;
  if v_course_code is null or v_course_code = '' then
    v_course_code := 'FORM';
  end if;

  v_date_str := to_char(new.start_date, 'YYMMDD');

  select coalesce(max(cast(substring(reference from '-(\d{3})$') as integer)), 0) + 1
    into v_counter
  from sessions
  where reference like v_prefix || '-' || v_course_code || '-' || v_date_str || '-%';

  new.reference := v_prefix || '-' || v_course_code || '-' || v_date_str || '-' || lpad(v_counter::text, 3, '0');
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app.portail_signer(p_client uuid, p_channel text, p_access uuid, p_profile uuid, p_session uuid, p_kind text, p_sha256 text, p_name text, p_role text, p_signature text, p_consent text, p_label text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_s public.sessions;
  v_id uuid;
  v_ex public.document_signatures;
  v_nom text := btrim(coalesce(p_name, ''));
begin
  if p_kind is distinct from 'convention' then raise exception 'Document non signable ici' using errcode = '22023'; end if;
  if not app.objet_du_client('session', p_session, p_client) then raise exception 'Session inconnue pour ce client' using errcode = '42501'; end if;
  if length(v_nom) < 2 or length(v_nom) > 120 then raise exception 'Nom du signataire requis' using errcode = '22023'; end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Empreinte du document invalide' using errcode = '22023'; end if;
  if p_signature is null or p_signature !~ '^data:image/png;base64,' or length(p_signature) > 400000 then
    raise exception 'Signature invalide' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_consent, ''))) < 20 then raise exception 'Accord du signataire requis' using errcode = '22023'; end if;
  -- Mention écrite au clavier par le signataire (0429) : « Bon pour accord » ou « Lu et approuvé, bon pour accord »
  if coalesce(p_consent, '') !~* '«[^»]*bon pour accord[^»]*»' then
    raise exception 'Mention « Bon pour accord » à écrire par le signataire' using errcode = '22023';
  end if;

  select * into v_s from public.sessions where id = p_session;
  -- Déjà signée avec ce même document : rien de plus
  select * into v_ex from public.document_signatures d
  where d.session_id = p_session and d.document_type = 'convention' and d.signer_type = 'client' and d.status = 'valid'
    and d.document_hash = p_sha256 order by d.signed_at desc limit 1;
  if v_ex.id is not null then return jsonb_build_object('id', v_ex.id, 'deja', true); end if;

  insert into public.document_signatures (document_type, session_id, client_id, signer_type, signer_name, signer_role,
    signature_data, document_hash, signed_at, metadata, status, company_id)
  values ('convention', p_session, p_client, 'client', v_nom, nullif(left(btrim(coalesce(p_role, '')), 120), ''),
    p_signature, p_sha256, now(),
    jsonb_build_object('canal', p_channel, 'access_id', p_access, 'profile_id', p_profile, 'consentement', left(p_consent, 1000),
      'document', left(p_label, 200), 'reference', v_s.reference),
    'valid', v_s.company_id)
  returning id into v_id;

  update public.sessions set convention_signed = true, convention_signed_date = now()
  where id = p_session and not coalesce(convention_signed, false);

  insert into public.portal_events (company_id, client_id, channel, access_id, profile_id, event, object_type, object_id,
    document_kind, document_label, document_sha256, ip, user_agent)
  values (v_s.company_id, p_client, p_channel, p_access, p_profile, 'signature', 'session', p_session, 'convention',
    left(coalesce(p_label, 'Convention de formation'), 200), p_sha256,
    left(coalesce(app.audit_entete('x-forwarded-for'), app.audit_entete('x-real-ip')), 64), left(app.entete_complet('user-agent'), 400));

  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (v_s.company_id, 'convention_signee', 'Convention signée en ligne',
    v_nom || coalesce(', ' || nullif(btrim(coalesce(p_role, '')), ''), '') || ' a signé la convention ' || coalesce(v_s.reference, '')
      || ' (' || (select c.name from public.clients c where c.id = p_client) || ').',
    '/sessions/' || p_session, jsonb_build_object('session_id', p_session, 'signature_id', v_id));

  return jsonb_build_object('id', v_id, 'deja', false);
end
$function$;

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
            'prerequisites', co.prerequisites, 'material', co.material, 'teaching_methods', co.teaching_methods, 'methods', co.methods, 'trainer_equipment', co.trainer_equipment,
            'evaluation_methods', co.evaluation_methods)
          from public.courses co where co.id = s.course_id),
        'trainers', (select jsonb_build_object('id', t.id, 'first_name', t.first_name, 'last_name', t.last_name)
          from public.trainers t where t.id = s.trainer_id),
        'session_trainees', coalesce((
          select jsonb_agg(jsonb_build_object('trainee_id', st.trainee_id, 'result', st.result, 'absent', coalesce(st.absent, false),
            'access_code', st.access_code, 'convocation_sent_at', st.convocation_sent_at,
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

delete from public.schema_migrations where version = '0493_espace_lien_inter_numerotation';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE espace_lien_inter_0493 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
