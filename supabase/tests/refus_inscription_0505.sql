-- Essai de 0505 : refus d'une demande d'inscription en ligne pris sous le verrou de la session, dans le même ordre que
-- la confirmation (session puis demande) ; liste d'attente comptée sous ce verrou. Rouge sans 0505 (verrous absents).
-- La simultanéité elle-même se rejoue à deux connexions (description de la PR). Le refus garde son
-- effet : la liste d'attente avance, une demande déjà traitée est refusée. Données d'essai créées ici (une société et
-- un compte de gestion existants seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_co uuid; v_s uuid; v_adm uuid; v_def text;
begin
  select id into v_cie from public.companies limit 1;
  select cm.profile_id into v_adm from public.company_members cm
   where cm.company_id = v_cie and cm.is_active and cm.role in ('admin', 'gestionnaire') order by cm.role limit 1;
  if v_adm is null then raise exception '0. aucun compte de gestion pour l''essai'; end if;
  -- 1. Verrous : session puis demande dans le refus ; session avant tout comptage dans la liste d'attente
  v_def := regexp_replace(pg_get_functiondef('public.inscription_refuser(uuid, text)'::regprocedure), '\s+', ' ', 'g');
  if position('from public.sessions where id = v_sess for update' in v_def) = 0
     or position('from public.sessions where id = v_sess for update' in v_def) > position('from public.online_registrations where id = p_id for update' in v_def) then
    raise exception '1. refus sans verrou de session pris avant la demande';
  end if;
  v_def := regexp_replace(pg_get_functiondef('app.liste_attente_avancer(uuid)'::regprocedure), '\s+', ' ', 'g');
  if position('from public.sessions where id = p_session for update' in v_def) = 0
     or position('from public.sessions where id = p_session for update' in v_def) > position('app.places_libres_inter' in v_def) then
    raise exception '1b. liste d''attente comptée sans verrou de session';
  end if;
  insert into public.courses (title, code, company_id, duration_hours) values ('Formation essai 0505', 'E505', v_cie, 7) returning id into v_co;
  insert into public.sessions (reference, course_id, session_type, is_public, start_date, end_date, attendance_token,
    max_participants, public_price_per_person, company_id)
  values ('ESSAI-0505', v_co, 'inter', true, current_date + 20, current_date + 20, 'essai-0505', 3, 200, v_cie) returning id into v_s;
  insert into public.online_registrations (company_id, session_id, kind, status, contact_first_name, contact_last_name, contact_email, company_name, participants, consent_at)
  values (v_cie, v_s, 'entreprise', 'en_attente', 'Ana', 'Alpha', 'ana@example.invalid', 'Alpha essai 0505',
          '[{"first_name":"Al","last_name":"Un"},{"first_name":"Al","last_name":"Deux"}]', now()),
         (v_cie, v_s, 'entreprise', 'liste_attente', 'Bob', 'Beta', 'bob@example.invalid', 'Beta essai 0505',
          '[{"first_name":"Be","last_name":"Un"},{"first_name":"Be","last_name":"Deux"}]', now());
  perform set_config('essai.session', v_s::text, true);
  perform set_config('essai.compte', v_adm::text, true);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('essai.compte'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_s uuid := current_setting('essai.session')::uuid; v_a uuid; v_b uuid; v_err text;
begin
  select id into v_a from public.online_registrations where session_id = v_s and contact_last_name = 'Alpha';
  select id into v_b from public.online_registrations where session_id = v_s and contact_last_name = 'Beta';
  -- 2. Refus : motif gardé, place libérée proposée à la liste d'attente
  perform public.inscription_refuser(v_a, '  Session complète pour vous  ');
  if (select status || '|' || coalesce(response, '') from public.online_registrations where id = v_a) <> 'refusee|Session complète pour vous' then
    raise exception '2. refus mal enregistré';
  end if;
  if (select status from public.online_registrations where id = v_b) <> 'place_proposee' then raise exception '2b. liste d''attente non avancée'; end if;
  -- 3. Demande déjà traitée : refusée
  begin
    perform public.inscription_refuser(v_a, null);
    v_err := null;
  exception when others then v_err := sqlerrm;
  end;
  if coalesce(v_err, '') <> 'Inscription déjà traitée' then raise exception '3. second refus : %', v_err; end if;
  -- 4. Demande inconnue : refusée
  begin
    perform public.inscription_refuser(gen_random_uuid(), null);
    v_err := null;
  exception when others then v_err := sqlerrm;
  end;
  if coalesce(v_err, '') <> 'Inscription inconnue' then raise exception '4. demande inconnue : %', v_err; end if;
end $$;
reset role;

rollback;
