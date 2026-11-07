-- Essai de 0500 : places d'une session inter publiée. Les demandes en ligne en cours (en attente, place proposée)
-- comptent dans les places affichées et au dépôt ; une saisie fautive reçoit un message en français ; une confirmation qui dépasserait l'effectif maximum est refusée.
-- Rouge sans 0500 (5 personnes acceptées en attente sur 3 places, session confirmée à 4 sur 3). Données d'essai
-- créées ici (une société et un compte de gestion existants seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_co uuid; v_s uuid; v_adm uuid;
begin
  select id into v_cie from public.companies limit 1;
  select cm.profile_id into v_adm from public.company_members cm
   where cm.company_id = v_cie and cm.is_active and cm.role in ('admin', 'gestionnaire') order by cm.role limit 1;
  if v_adm is null then raise exception '0. aucun compte de gestion pour l''essai'; end if;
  update public.organization_settings set calendrier_public = true;
  insert into public.courses (title, code, company_id, duration_hours) values ('Formation essai 0500', 'E500', v_cie, 7) returning id into v_co;
  insert into public.sessions (reference, course_id, session_type, is_public, start_date, end_date, attendance_token,
    max_participants, public_price_per_person, company_id)
  values ('ESSAI-0500', v_co, 'inter', true, current_date + 20, current_date + 20, 'essai-0500', 3, 200, v_cie) returning id into v_s;
  perform set_config('essai.session', v_s::text, true);
  perform set_config('essai.compte', v_adm::text, true);
end $$;

-- Visiteur de la page publique
set local role anon;
do $$
declare v_s uuid := current_setting('essai.session')::uuid; v_r jsonb; v_p int; v_err text;
begin
  v_r := public.public_inscrire(v_s, '{"kind":"entreprise","consent":true,"contact_first_name":"Ana","contact_last_name":"Alpha","contact_email":"ana@example.invalid","company_name":"Alpha essai 0500","participants":[{"first_name":"Al","last_name":"Un"},{"first_name":"Al","last_name":"Deux"}]}');
  if (v_r->>'liste_attente')::boolean then raise exception '1. première demande (2 sur 3 places) mise en liste d''attente'; end if;
  v_p := (public.public_calendrier()->'sessions'->0->>'places')::int;
  if v_p is distinct from 1 then raise exception '2. % place(s) affichée(s) au lieu de 1 après une demande de 2', v_p; end if;
  v_r := public.public_inscrire(v_s, '{"kind":"entreprise","consent":true,"contact_first_name":"Bob","contact_last_name":"Beta","contact_email":"bob@example.invalid","company_name":"Beta essai 0500","participants":[{"first_name":"Be","last_name":"Un"},{"first_name":"Be","last_name":"Deux"}]}');
  if not (v_r->>'liste_attente')::boolean then raise exception '3. deuxième demande (2 pour 1 place) acceptée en attente au lieu de la liste d''attente'; end if;
  v_r := public.public_inscrire(v_s, '{"kind":"particulier","consent":true,"contact_first_name":"Paul","contact_last_name":"Perso","contact_email":"paul@example.invalid","participants":[{"first_name":"Paul","last_name":"Perso"}]}');
  if (v_r->>'liste_attente')::boolean then raise exception '4. demande d''une personne pour la dernière place mise en liste d''attente'; end if;
  -- Saisie fautive : message en français, rien d'enregistré
  begin
    perform public.public_inscrire(v_s, '{"kind":"entreprise","consent":true,"contact_first_name":"Cy","contact_last_name":"Gamma","contact_email":"cy@example.invalid","company_name":"Gamma essai 0500","siret":"1234567890123","participants":[{"first_name":"Ga","last_name":"Un"}]}');
    v_err := null;
  exception when others then v_err := sqlerrm;
  end;
  if coalesce(v_err, '') not like 'Le SIRET compte 14 chiffres%' then raise exception '4b. SIRET de 13 chiffres : %', v_err; end if;
  begin
    perform public.public_inscrire(v_s, '{"kind":"entreprise","consent":true,"contact_first_name":"Cy","contact_last_name":"Gamma","contact_email":"cy@example.invalid","company_name":"Gamma essai 0500","postal_code":"29000 QUIMPER CEDEX","participants":[{"first_name":"Ga","last_name":"Un"}]}');
    v_err := null;
  exception when others then v_err := sqlerrm;
  end;
  if coalesce(v_err, '') not like 'Code postal trop long%' then raise exception '4c. code postal trop long : %', v_err; end if;
  -- Particulier : un SIRET resté dans le formulaire n'est ni contrôlé ni gardé
  v_r := public.public_inscrire(v_s, '{"kind":"particulier","consent":true,"contact_first_name":"Wil","contact_last_name":"Wait","contact_email":"wil@example.invalid","siret":"1234","company_name":"Caché","participants":[{"first_name":"Wil","last_name":"Wait"}]}');
  if not (v_r->>'liste_attente')::boolean then raise exception '4d. particulier sans place restante pas mis en liste d''attente'; end if;
  v_p := (public.public_calendrier()->'sessions'->0->>'places')::int;
  if v_p is distinct from 0 then raise exception '5. % place(s) affichée(s) au lieu de 0', v_p; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.online_registrations where contact_last_name = 'Wait' and (siret is not null or company_name is not null)) then
    raise exception '4e. SIRET ou entreprise gardés pour un particulier';
  end if;
  -- Une seule transaction : heures de dépôt remises dans l'ordre d'arrivée (Alpha, Beta, Perso, Wil)
  update public.online_registrations o set created_at = now() - make_interval(hours => x.h)
    from (values ('Alpha', 4), ('Beta', 3), ('Perso', 2), ('Wait', 1)) x(nom, h)
   where o.session_id = current_setting('essai.session')::uuid and o.contact_last_name = x.nom;
end $$;

-- Organisme
select set_config('request.jwt.claims', json_build_object('sub', current_setting('essai.compte'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_s uuid := current_setting('essai.session')::uuid; v_err text; v_n int; v_st text;
begin
  -- Wil (liste d'attente) confirmée avant les demandes déjà comptées : refusée (places réservées), rien d'écrit
  begin
    perform public.inscription_confirmer((select id from public.online_registrations where session_id = v_s and contact_last_name = 'Wait'));
    v_err := null;
  exception when others then v_err := sqlerrm;
  end;
  if coalesce(v_err, '') not like '%réservées à d''autres demandes%' then raise exception '5b. place réservée prise par la liste d''attente (%)', v_err; end if;
  perform public.inscription_confirmer((select id from public.online_registrations where session_id = v_s and company_name = 'Alpha essai 0500'));
  -- Beta forcée alors qu'il ne reste qu'une place : refusée, rien d'écrit
  begin
    perform public.inscription_confirmer((select id from public.online_registrations where session_id = v_s and company_name = 'Beta essai 0500'));
    v_err := null;
  exception when others then v_err := sqlerrm;
  end;
  if coalesce(v_err, '') not like '%effectif maximum%' then raise exception '6. confirmation au-delà de l''effectif acceptée (%)', v_err; end if;
  select status into v_st from public.online_registrations where session_id = v_s and company_name = 'Beta essai 0500';
  if v_st <> 'liste_attente' then raise exception '7. demande refusée passée en %', v_st; end if;
  if exists (select 1 from public.clients where name = 'Beta essai 0500') then raise exception '8. client créé malgré le refus'; end if;
  -- Particulier pour la dernière place : confirmé
  perform public.inscription_confirmer((select id from public.online_registrations where session_id = v_s and contact_last_name = 'Perso'));
  select count(*) into v_n from public.session_trainees where session_id = v_s;
  if v_n <> 3 then raise exception '9. % inscrit(s) au lieu de 3', v_n; end if;
  -- Un participant retiré : Beta (2 personnes, plus ancienne) reste en liste ; la place libre va à Wil (1 personne)
  delete from public.session_trainees where session_id = v_s
     and trainee_id = (select t.id from public.trainees t where t.last_name = 'PERSO' and t.first_name = 'Paul' limit 1);
  select status into v_st from public.online_registrations where session_id = v_s and company_name = 'Beta essai 0500';
  if v_st <> 'liste_attente' then raise exception '10. Beta (2 personnes) en % pour une seule place libre', v_st; end if;
  select status into v_st from public.online_registrations where session_id = v_s and contact_last_name = 'Wait';
  if v_st <> 'place_proposee' then raise exception '10b. place libre non proposée à Wil (%)', v_st; end if;
  -- Effectif maximum relevé à 5 : la place proposée à Wil reste réservée, Beta peut être confirmée
  update public.sessions set max_participants = 5 where id = v_s;
  perform public.inscription_confirmer((select id from public.online_registrations where session_id = v_s and company_name = 'Beta essai 0500'));
  select count(*) into v_n from public.session_trainees where session_id = v_s;
  if v_n <> 4 then raise exception '11. % inscrit(s) au lieu de 4 après relèvement', v_n; end if;
end $$;
reset role;

-- Ordre d'arrivée : la demande la plus ancienne qui tient reste confirmable même si les demandes en cours dépassent
-- l'effectif (stagiaire ajouté à la main entre-temps) ; la suivante est refusée
do $$
declare v_cie uuid; v_s uuid; v_co uuid; v_t uuid;
begin
  select id into v_cie from public.companies limit 1;
  select course_id into v_co from public.sessions where id = current_setting('essai.session')::uuid;
  insert into public.sessions (reference, course_id, session_type, is_public, start_date, end_date, attendance_token, max_participants, company_id)
  values ('ESSAI-0500-B', v_co, 'inter', true, current_date + 25, current_date + 25, 'essai-0500-b', 3, v_cie) returning id into v_s;
  perform set_config('essai.session2', v_s::text, true);
  insert into public.online_registrations (session_id, kind, contact_first_name, contact_last_name, contact_email, company_name, participants, status, created_at) values
    (v_s, 'entreprise', 'Oa', 'Ordre', 'oa@example.invalid', 'Ancienne essai 0500', '[{"first_name":"O","last_name":"Un"},{"first_name":"O","last_name":"Deux"}]', 'en_attente', now() - interval '2 hours'),
    (v_s, 'entreprise', 'Ob', 'Ordre', 'ob@example.invalid', 'Récente essai 0500', '[{"first_name":"R","last_name":"Un"}]', 'en_attente', now() - interval '1 hour');
  insert into public.trainees (first_name, last_name, company_id) values ('Main', 'AJOUT', v_cie) returning id into v_t;
  insert into public.session_trainees (session_id, trainee_id, company_id) values (v_s, v_t, v_cie);
end $$;
-- Liste d'attente ancienne contre demande en attente récente (déjà acceptée au dépôt) ; participant déjà inscrit
do $$
declare v_cie uuid; v_co uuid; v_s3 uuid; v_s4 uuid; v_t uuid; v_c uuid;
begin
  select id into v_cie from public.companies limit 1;
  select course_id into v_co from public.sessions where id = current_setting('essai.session')::uuid;
  insert into public.sessions (reference, course_id, session_type, is_public, start_date, end_date, attendance_token, max_participants, company_id)
  values ('ESSAI-0500-C', v_co, 'inter', true, current_date + 26, current_date + 26, 'essai-0500-c', 4, v_cie) returning id into v_s3;
  insert into public.sessions (reference, course_id, session_type, is_public, start_date, end_date, attendance_token, max_participants, company_id)
  values ('ESSAI-0500-D', v_co, 'inter', true, current_date + 27, current_date + 27, 'essai-0500-d', 2, v_cie) returning id into v_s4;
  perform set_config('essai.session3', v_s3::text, true);
  perform set_config('essai.session4', v_s4::text, true);
  for i in 1..2 loop
    insert into public.trainees (first_name, last_name, company_id) values ('Deja', 'INSCRIT' || i, v_cie) returning id into v_t;
    insert into public.session_trainees (session_id, trainee_id, company_id) values (v_s3, v_t, v_cie);
  end loop;
  insert into public.online_registrations (session_id, kind, contact_first_name, contact_last_name, contact_email, company_name, participants, status, created_at) values
    (v_s3, 'entreprise', 'Wa', 'Liste', 'wa@example.invalid', 'Liste essai 0500', '[{"first_name":"W","last_name":"Un"},{"first_name":"W","last_name":"Deux"}]', 'liste_attente', now() - interval '2 hours'),
    (v_s3, 'entreprise', 'Na', 'Neuve', 'na@example.invalid', 'Neuve essai 0500', '[{"first_name":"N","last_name":"Un"}]', 'en_attente', now() - interval '1 hour');
  -- Session D : Paul déjà inscrit dans son entreprise, sa demande en attente le compte une seconde fois
  insert into public.clients (name, siret, company_id) values ('Deja essai 0500', '11122233344455', v_cie) returning id into v_c;
  insert into public.trainees (first_name, last_name, client_id, company_id) values ('Paul', 'DEJA', v_c, v_cie) returning id into v_t;
  insert into public.session_trainees (session_id, trainee_id, company_id) values (v_s4, v_t, v_cie);
  insert into public.online_registrations (session_id, kind, contact_first_name, contact_last_name, contact_email, company_name, siret, participants, status, created_at) values
    (v_s4, 'entreprise', 'Paul', 'Deja', 'pd@example.invalid', 'Deja essai 0500', '11122233344455', '[{"first_name":"Paul","last_name":"Deja"}]', 'en_attente', now() - interval '2 hours'),
    (v_s4, 'entreprise', 'Xa', 'Attente', 'xa@example.invalid', 'Attente essai 0500', null, '[{"first_name":"X","last_name":"Un"}]', 'liste_attente', now() - interval '1 hour');
end $$;
set local role authenticated;
do $$
declare v_err text; v_st text;
begin
  begin
    perform public.inscription_confirmer((select id from public.online_registrations where company_name = 'Liste essai 0500'));
    v_err := null;
  exception when others then v_err := sqlerrm;
  end;
  if coalesce(v_err, '') not like '%effectif maximum%' then raise exception '14. liste d''attente confirmée sur la place d''une demande récente (%)', v_err; end if;
  perform public.inscription_confirmer((select id from public.online_registrations where company_name = 'Neuve essai 0500'));
  perform public.inscription_confirmer((select id from public.online_registrations where company_name = 'Deja essai 0500'));
  select status into v_st from public.online_registrations where company_name = 'Attente essai 0500';
  if v_st <> 'place_proposee' then raise exception '15. place libérée à la confirmation non proposée (%)', v_st; end if;
end $$;
do $$
declare v_s uuid := current_setting('essai.session2')::uuid; v_err text;
begin
  perform public.inscription_confirmer((select id from public.online_registrations where session_id = v_s and company_name = 'Ancienne essai 0500'));
  begin
    perform public.inscription_confirmer((select id from public.online_registrations where session_id = v_s and company_name = 'Récente essai 0500'));
    v_err := null;
  exception when others then v_err := sqlerrm;
  end;
  if coalesce(v_err, '') not like '%effectif maximum%' then raise exception '13. demande récente confirmée au-delà de l''effectif (%)', v_err; end if;
end $$;
reset role;
do $$ begin
  if app.places_libres_inter(current_setting('essai.session')::uuid) <> 0 then raise exception '12. places libres fausses'; end if;
end $$;

select 'inscription_places_0500 : vert' as resultat;
rollback;
