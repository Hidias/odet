-- Retour arrière de 0500 : calendrier, dépôt, confirmation et liste d'attente de 0421 ; aide des places retirée.
-- Les demandes déposées entre-temps restent, avec le statut que 0500 leur a donné.

CREATE OR REPLACE FUNCTION public.public_calendrier()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o record;
  v_societe uuid := app.company_default();
begin
  select os.calendrier_public, os.name, os.phone, os.email, os.website, os.mention_maintien into o
    from public.organization_settings os limit 1;
  if not coalesce(o.calendrier_public, false) then
    return jsonb_build_object('publie', false);
  end if;
  return jsonb_build_object(
    'publie', true,
    'organisme', jsonb_build_object('name', o.name, 'phone', o.phone, 'email', o.email, 'website', o.website),
    'mention_maintien', o.mention_maintien,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'reference', s.reference, 'course_id', s.course_id, 'title', co.title, 'code', co.code,
               'duration_hours', co.duration_hours, 'duration_days', co.duration_days,
               'start_date', s.start_date, 'end_date', coalesce(s.end_date, s.start_date),
               'start_time', s.start_time, 'end_time', s.end_time,
               'city', s.location_city, 'postal_code', s.location_postal_code, 'is_remote', coalesce(s.is_remote, false),
               'price_per_person', s.public_price_per_person,
               'places', case when s.max_participants is null then null
                              else greatest(s.max_participants - (select count(*) from public.session_trainees st
                                                                   where st.session_id = s.id and not coalesce(st.absent, false)), 0) end)
             order by s.start_date, co.title)
      from public.sessions s left join public.courses co on co.id = s.course_id
      where s.company_id = v_societe and s.session_type = 'inter' and coalesce(s.is_public, false)
        and s.start_date >= (now() at time zone 'Europe/Paris')::date
        and coalesce(s.status, '') not in ('cancelled', 'annulee')), '[]'::jsonb)
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.public_inscrire(p_session uuid, p_inscription jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s record;
  v_ouvert boolean;
  v_kind text := p_inscription->>'kind';
  v_email text := lower(btrim(coalesce(p_inscription->>'contact_email', '')));
  v_parts jsonb := coalesce(p_inscription->'participants', '[]'::jsonb);
  v_n int;
  v_places int;
  v_id uuid;
  p jsonb;
  v_attente boolean := false;
begin
  select coalesce(os.calendrier_public, false) into v_ouvert from public.organization_settings os limit 1;
  if not coalesce(v_ouvert, false) then raise exception 'Inscriptions en ligne fermées' using errcode = '42501'; end if;
  select se.id, se.company_id, se.max_participants, se.start_date, co.title into s
    from public.sessions se left join public.courses co on co.id = se.course_id
   where se.id = p_session and se.session_type = 'inter' and coalesce(se.is_public, false)
     and se.start_date >= (now() at time zone 'Europe/Paris')::date and coalesce(se.status, '') not in ('cancelled', 'annulee');
  if s.id is null then raise exception 'Session introuvable ou fermée aux inscriptions' using errcode = '22023'; end if;
  if v_kind not in ('particulier', 'entreprise') then raise exception 'Type d''inscription inconnu' using errcode = '22023'; end if;
  if not coalesce((p_inscription->>'consent')::boolean, false) then
    raise exception 'Accord sur l''usage des données requis' using errcode = '22023';
  end if;
  if jsonb_typeof(v_parts) <> 'array' or jsonb_array_length(v_parts) < 1 or jsonb_array_length(v_parts) > 20 then
    raise exception 'Indiquez de 1 à 20 participants' using errcode = '22023';
  end if;
  for p in select * from jsonb_array_elements(v_parts) loop
    if length(btrim(coalesce(p->>'first_name', ''))) < 1 or length(btrim(coalesce(p->>'last_name', ''))) < 1 then
      raise exception 'Prénom et nom de chaque participant requis' using errcode = '22023';
    end if;
  end loop;
  v_n := jsonb_array_length(v_parts);
  if s.max_participants is not null then
    select s.max_participants - count(*) into v_places from public.session_trainees st
     where st.session_id = s.id and not coalesce(st.absent, false);
    -- Plus assez de places : la demande va en liste d'attente (0421) ; une place libérée lui sera proposée
    if v_n > v_places then v_attente := true; end if;
  end if;
  if (select count(*) from public.online_registrations r
       where r.session_id = s.id and lower(r.contact_email) = v_email and r.status in ('en_attente', 'liste_attente', 'place_proposee')) >= 3 then
    raise exception 'Une demande est déjà en attente pour cette adresse : l''organisme va vous répondre' using errcode = '22023';
  end if;

  insert into public.online_registrations (session_id, kind, contact_first_name, contact_last_name, contact_email, contact_phone,
    contact_function, company_name, siret, address, postal_code, city, participants, message, status)
  values (s.id, v_kind, btrim(p_inscription->>'contact_first_name'), btrim(p_inscription->>'contact_last_name'), v_email,
    nullif(btrim(coalesce(p_inscription->>'contact_phone', '')), ''), nullif(btrim(coalesce(p_inscription->>'contact_function', '')), ''),
    nullif(btrim(coalesce(p_inscription->>'company_name', '')), ''),
    nullif(regexp_replace(coalesce(p_inscription->>'siret', ''), '\s', '', 'g'), ''),
    nullif(btrim(coalesce(p_inscription->>'address', '')), ''), nullif(btrim(coalesce(p_inscription->>'postal_code', '')), ''),
    nullif(btrim(coalesce(p_inscription->>'city', '')), ''),
    (select jsonb_agg(jsonb_build_object('first_name', btrim(x->>'first_name'), 'last_name', btrim(x->>'last_name'),
                                         'email', nullif(lower(btrim(coalesce(x->>'email', ''))), ''),
                                         'job_title', nullif(btrim(coalesce(x->>'job_title', '')), '')))
       from jsonb_array_elements(v_parts) x),
    nullif(btrim(left(coalesce(p_inscription->>'message', ''), 2000)), ''),
    case when v_attente then 'liste_attente' else 'en_attente' end)
  returning id into v_id;

  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (s.company_id, 'inscription_en_ligne',
          left('Inscription en ligne : ' || coalesce(s.title, 'session inter') || ' du ' || to_char(s.start_date, 'DD/MM'), 255),
          case when v_kind = 'entreprise' then coalesce(p_inscription->>'company_name', 'Une entreprise') || ' inscrit '
                 || v_n || ' participant' || case when v_n > 1 then 's' else '' end
               else btrim(p_inscription->>'contact_first_name') || ' ' || upper(btrim(p_inscription->>'contact_last_name')) || ' s''inscrit' end
            || case when v_attente then ' : session complète, en liste d''attente.' else ' : à confirmer dans la session.' end,
          '/sessions/' || s.id, jsonb_build_object('session_id', s.id, 'registration_id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id, 'liste_attente', v_attente);
end
$function$;

CREATE OR REPLACE FUNCTION public.inscription_confirmer(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.online_registrations;
  s record;
  v_client uuid;
  v_trainee uuid;
  v_group uuid;
  v_prix numeric;
  v_nom text;
  p jsonb;
begin
  select * into r from public.online_registrations where id = p_id for update;
  if r.id is null then raise exception 'Inscription inconnue' using errcode = '22023'; end if;
  if r.company_id not in (select app.societes_avec_droit('formation.inscriptions.gerer')) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if r.status not in ('en_attente', 'place_proposee', 'liste_attente') then raise exception 'Inscription déjà traitée' using errcode = '22023'; end if;
  select se.id, se.course_id, se.public_price_per_person into s from public.sessions se where se.id = r.session_id;

  -- Client : retrouvé (entreprise par SIRET, sinon par nom et code postal ; particulier par adresse email), sinon créé
  if r.kind = 'entreprise' then
    select c.id into v_client from public.clients c
     where c.company_id = r.company_id and r.siret is not null and c.siret = r.siret limit 1;
    if v_client is null then
      select c.id into v_client from public.clients c
       where c.company_id = r.company_id and lower(btrim(c.name)) = lower(btrim(r.company_name))
         and coalesce(c.postal_code, '') = coalesce(r.postal_code, '') limit 1;
    end if;
    if v_client is null then
      insert into public.clients (company_id, name, siret, siren, address, postal_code, city, client_type, type, email, contact_name, contact_email, contact_phone)
      values (r.company_id, btrim(r.company_name), r.siret, left(r.siret, 9), r.address, r.postal_code, r.city, 'entreprise', 'client',
              r.contact_email, r.contact_first_name || ' ' || r.contact_last_name, r.contact_email, r.contact_phone)
      returning id into v_client;
    end if;
    if not exists (select 1 from public.client_contacts cc where cc.client_id = v_client and lower(cc.email) = r.contact_email) then
      insert into public.client_contacts (client_id, name, first_name, last_name, email, phone, fonction, is_document_contact)
      values (v_client, r.contact_first_name || ' ' || r.contact_last_name, r.contact_first_name, r.contact_last_name, r.contact_email,
              r.contact_phone, r.contact_function, true);
    end if;
  else
    select c.id into v_client from public.clients c
     where c.company_id = r.company_id and c.client_type = 'particulier'
       and (lower(c.email) = r.contact_email or lower(c.contact_email) = r.contact_email) limit 1;
    if v_client is null then
      insert into public.clients (company_id, name, client_type, type, email, contact_name, contact_email, contact_phone, mobile, address, postal_code, city)
      values (r.company_id, r.contact_first_name || ' ' || upper(r.contact_last_name), 'particulier', 'client', r.contact_email,
              r.contact_first_name || ' ' || r.contact_last_name, r.contact_email, r.contact_phone, r.contact_phone, r.address, r.postal_code, r.city)
      returning id into v_client;
    end if;
  end if;

  -- Groupe inter : prix par personne du tarif du client (0418), sinon prix public de la session
  select g.id into v_group from public.session_groups g where g.session_id = r.session_id and g.client_id = v_client limit 1;
  if v_group is null then
    v_prix := coalesce((app.prix_client(v_client, 'formation', s.course_id)).prix_inter_ht, s.public_price_per_person);
    insert into public.session_groups (session_id, client_id, kind, payer_kind, nb_personnes, price_per_person, status, doc_status, source)
    values (r.session_id, v_client, r.kind, r.kind, jsonb_array_length(r.participants), v_prix, 'confirmed', 'a_envoyer', 'page_publique')
    returning id into v_group;
  end if;

  -- Stagiaires : retrouvés dans le client (adresse email, sinon prénom et nom), sinon créés ; inscrits dans le groupe
  for p in select * from jsonb_array_elements(r.participants) loop
    v_trainee := null;
    if nullif(p->>'email', '') is not null then
      select t.id into v_trainee from public.trainees t where t.client_id = v_client and lower(t.email) = lower(p->>'email') limit 1;
    end if;
    if v_trainee is null then
      select t.id into v_trainee from public.trainees t
       where t.client_id = v_client and lower(btrim(t.first_name)) = lower(p->>'first_name') and lower(btrim(t.last_name)) = lower(p->>'last_name') limit 1;
    end if;
    if v_trainee is null then
      insert into public.trainees (first_name, last_name, email, job_title, client_id)
      values (p->>'first_name', upper(p->>'last_name'), nullif(p->>'email', ''), nullif(p->>'job_title', ''), v_client)
      returning id into v_trainee;
    end if;
    if not exists (select 1 from public.session_trainees st where st.session_id = r.session_id and st.trainee_id = v_trainee) then
      insert into public.session_trainees (session_id, trainee_id, group_id) values (r.session_id, v_trainee, v_group);
    end if;
  end loop;
  update public.session_groups g set nb_personnes = (select count(*) from public.session_trainees st where st.group_id = g.id)
   where g.id = v_group;

  update public.online_registrations
     set status = 'confirmee', client_id = v_client, group_id = v_group, handled_by = auth.uid(), handled_at = now()
   where id = r.id;
  return jsonb_build_object('ok', true, 'client_id', v_client, 'group_id', v_group);
end
$function$;

CREATE OR REPLACE FUNCTION app.liste_attente_avancer(p_session uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s record;
  v_libres int;
  r record;
  v_faits int := 0;
begin
  select se.id, se.company_id, se.max_participants, se.start_date, co.title into s
    from public.sessions se left join public.courses co on co.id = se.course_id where se.id = p_session;
  if s.id is null or s.max_participants is null or s.start_date < (now() at time zone 'Europe/Paris')::date then return 0; end if;
  select s.max_participants
         - (select count(*) from public.session_trainees st where st.session_id = s.id and not coalesce(st.absent, false))
         - coalesce((select sum(jsonb_array_length(o.participants)) from public.online_registrations o
                      where o.session_id = s.id and o.status = 'place_proposee'), 0)
    into v_libres;
  for r in select o.id, o.kind, o.company_name, o.contact_first_name, o.contact_last_name, jsonb_array_length(o.participants) as n
             from public.online_registrations o where o.session_id = s.id and o.status = 'liste_attente' order by o.created_at loop
    exit when v_libres <= 0;
    continue when r.n > v_libres;
    update public.online_registrations set status = 'place_proposee', proposed_at = now() where id = r.id;
    v_libres := v_libres - r.n;
    v_faits := v_faits + 1;
    insert into public.notifications (company_id, type, title, message, link, metadata)
    values (s.company_id, 'liste_attente',
            left('Place libérée : ' || coalesce(s.title, 'session inter') || ' du ' || to_char(s.start_date, 'DD/MM'), 255),
            'Place proposée à ' || case when r.kind = 'entreprise' then coalesce(r.company_name, 'une entreprise')
                                        else r.contact_first_name || ' ' || upper(r.contact_last_name) end
              || ' (liste d''attente, ' || r.n || ' participant' || case when r.n > 1 then 's' else '' end || ') : à confirmer dans la session.',
            '/sessions/' || s.id, jsonb_build_object('session_id', s.id, 'registration_id', r.id));
  end loop;
  return v_faits;
end
$function$;

drop function if exists app.places_libres_inter(uuid);

delete from public.schema_migrations where version = '0500_inscription_places';
