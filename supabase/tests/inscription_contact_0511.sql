-- Essai de 0511 : contact d'une inscription en ligne confirmée, nom et prénom séparés (« NOM Prénom »). Rouge sans 0511
-- (contact créé au nom libre « Jean-Pierre le Régent »). Données d'essai créées ici (une société et un compte de gestion
-- existants seulement), réglage du calendrier posé ici, tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare v_cie uuid; v_co uuid; v_s uuid; v_adm uuid;
begin
  select id into v_cie from public.companies limit 1;
  select cm.profile_id into v_adm from public.company_members cm
   where cm.company_id = v_cie and cm.is_active and cm.role in ('admin', 'gestionnaire') order by cm.role limit 1;
  if v_adm is null then raise exception '0. aucun compte de gestion pour l''essai'; end if;
  update public.organization_settings set calendrier_public = true;
  insert into public.courses (title, code, company_id, duration_hours) values ('Formation essai 0511', 'E511', v_cie, 7) returning id into v_co;
  insert into public.sessions (reference, course_id, session_type, is_public, start_date, end_date, attendance_token,
    max_participants, public_price_per_person, company_id)
  values ('ESSAI-0511', v_co, 'inter', true, current_date + 20, current_date + 20, 'essai-0511', 10, 200, v_cie) returning id into v_s;
  perform set_config('essai.session', v_s::text, true);
  perform set_config('essai.compte', v_adm::text, true);
  perform set_config('essai.societe', v_cie::text, true);
end $$;

set local role anon;
do $$
declare v_s uuid := current_setting('essai.session')::uuid;
begin
  perform public.public_inscrire(v_s, '{"kind":"entreprise","consent":true,"contact_first_name":"jean-pierre","contact_last_name":"le Régent","contact_email":"jp@example.invalid","company_name":"Alpha essai 0511","participants":[{"first_name":"Al","last_name":"Un"}]}');
  perform public.public_inscrire(v_s, '{"kind":"particulier","consent":true,"contact_first_name":"Paul","contact_last_name":"Durand","contact_email":"paul@example.invalid","participants":[{"first_name":"Paul","last_name":"Durand"}]}');
  perform public.public_inscrire(v_s, '{"kind":"entreprise","consent":true,"contact_first_name":"Zoé","contact_last_name":"Zed","contact_email":"rh@example.invalid","company_name":"Beta essai 0511","participants":[{"first_name":"Be","last_name":"Un"}]}');
end $$;
reset role;

-- Beta existe déjà, son contact à cette adresse porte le nom d'une autre personne (nom libre) : il ne doit pas changer
do $$
declare v_b uuid;
begin
  insert into public.clients (name, company_id) values ('Beta essai 0511', current_setting('essai.societe')::uuid) returning id into v_b;
  insert into public.client_contacts (client_id, name, email) values (v_b, 'Service RH', 'rh@example.invalid');
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('essai.compte'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare o record;
begin
  for o in select id from public.online_registrations where session_id = current_setting('essai.session')::uuid order by created_at loop
    perform public.inscription_confirmer(o.id);
  end loop;
end $$;
reset role;

do $$
declare v_a uuid; v_p uuid; v_b uuid; c record;
begin
  select id into v_a from public.clients where name = 'Alpha essai 0511';
  select cc.* into c from public.client_contacts cc where cc.client_id = v_a and cc.email = 'jp@example.invalid';
  if c.last_name is distinct from 'LE RÉGENT' or c.first_name is distinct from 'Jean-Pierre' or c.name is distinct from 'LE RÉGENT Jean-Pierre' then
    raise exception '1. contact de l''entreprise non séparé (%, %, %)', c.name, c.last_name, c.first_name;
  end if;
  if (select count(*) from public.client_contacts where client_id = v_a) <> 1 then raise exception '1b. contact en double'; end if;
  select id into v_p from public.clients where client_type = 'particulier' and email = 'paul@example.invalid'
     and company_id = current_setting('essai.societe')::uuid;
  select cc.* into c from public.client_contacts cc where cc.client_id = v_p and cc.email = 'paul@example.invalid';
  if c.name is distinct from 'DURAND Paul' then raise exception '2. contact du particulier non séparé (%)', c.name; end if;
  select id into v_b from public.clients where name = 'Beta essai 0511';
  select cc.* into c from public.client_contacts cc where cc.client_id = v_b and cc.email = 'rh@example.invalid';
  if c.name is distinct from 'Service RH' or c.last_name is not null or c.first_name is not null then
    raise exception '3. contact d''une autre personne modifié (%, %, %)', c.name, c.last_name, c.first_name;
  end if;
end $$;

rollback;
