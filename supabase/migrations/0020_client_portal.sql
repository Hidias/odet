-- 0020_client_portal.sql : accès entreprise, version minimale.
-- Un contact client reçoit un lien (/#/entreprise/<token>) et un code à 6 chiffres.
-- Depuis cet espace il consulte ses sessions et télécharge les documents (convention, convocations,
-- feuille d'émargement, attestations, certificats). Lecture seule, via deux fonctions SECURITY DEFINER.

create table if not exists public.client_portal_access (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  access_code text not null,
  contact_email text,
  is_active boolean not null default true,
  attempts integer not null default 0,
  locked_until timestamptz,
  last_access_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_portal_access enable row level security;
drop policy if exists client_portal_access_authenticated_all on public.client_portal_access;
create policy client_portal_access_authenticated_all on public.client_portal_access
  for all to authenticated using (true) with check (true);
revoke all on public.client_portal_access from anon;

-- Vérification du couple lien + code, avec verrouillage 15 minutes après 5 échecs.
create or replace function public.client_portal_check(p_token text, p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  select * into v from client_portal_access where token = p_token for update;
  if not found or not v.is_active then
    raise exception 'Lien invalide ou désactivé' using errcode = 'P0001';
  end if;
  if v.locked_until is not null and v.locked_until > now() then
    raise exception 'Trop de tentatives, réessayez dans quelques minutes' using errcode = 'P0001';
  end if;
  if v.access_code <> regexp_replace(coalesce(p_code, ''), '\s', '', 'g') then
    update client_portal_access
       set attempts = attempts + 1,
           locked_until = case when attempts + 1 >= 5 then now() + interval '15 minutes' else null end,
           updated_at = now()
     where id = v.id;
    raise exception 'Code incorrect' using errcode = 'P0001';
  end if;
  update client_portal_access set attempts = 0, locked_until = null, last_access_at = now(), updated_at = now() where id = v.id;
  return v.client_id;
end $$;

revoke all on function public.client_portal_check(text, text) from public, anon;

-- Identité de l'organisme nécessaire aux documents (sous-ensemble sans secrets)
create or replace function public.client_portal_org(p_token text, p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform client_portal_check(p_token, p_code);
  return (
    select jsonb_build_object(
      'name', name, 'legal_name', legal_name, 'forme_juridique', forme_juridique, 'app_short_name', app_short_name,
      'address', address, 'postal_code', postal_code, 'city', city, 'lieu_signature', lieu_signature,
      'phone', phone, 'email', email, 'website', website,
      'siret', siret, 'siren', siren, 'naf', naf, 'tva_intra', tva_intra, 'tva_applicable', tva_applicable,
      'nda', nda, 'nda_region', nda_region, 'iban', iban, 'bic', bic,
      'dirigeant_name', dirigeant_name, 'dirigeant_title', dirigeant_title,
      'dirigeant_signature_url', dirigeant_signature_url, 'logo_url', logo_url, 'stamp_base64', stamp_base64,
      'brand_primary', brand_primary, 'brand_accent', brand_accent, 'brand_highlight', brand_highlight,
      'doc_prefix', doc_prefix, 'qualiopi_certified', qualiopi_certified, 'activity_kind', activity_kind,
      'tribunal_competent', tribunal_competent, 'conditions_annulation', conditions_annulation,
      'referent_handicap_nom', referent_handicap_nom, 'referent_handicap_email', referent_handicap_email,
      'referent_handicap_phone', referent_handicap_phone
    )
    from organization_settings limit 1
  );
end $$;

-- Sessions du client et tout ce qu'il faut pour générer ses documents (aucune donnée d'autres clients)
create or replace function public.client_portal_data(p_token text, p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
begin
  v_client := client_portal_check(p_token, p_code);
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
end $$;

revoke all on function public.client_portal_org(text, text) from public;
revoke all on function public.client_portal_data(text, text) from public;
grant execute on function public.client_portal_org(text, text) to anon, authenticated;
grant execute on function public.client_portal_data(text, text) to anon, authenticated;

insert into public.schema_migrations (version) values ('0020_client_portal') on conflict (version) do nothing;
