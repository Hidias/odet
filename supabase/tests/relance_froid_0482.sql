-- Essai local de 0482 : sélection des destinataires et exclusions de la relance à froid (préparation, jamais de boucle,
-- une relance, sessions anciennes exclues, sans adresse, réponse reçue, interrupteur, une adresse par jour).
begin;
set local client_min_messages = warning;
do $$
declare
  v_cie uuid; v_cli uuid; v_se uuid; v_old uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_r jsonb; v_n int; v_id uuid; v_ok boolean;
  v_today date := current_date;
  v_gest text := '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, client_type, company_id) values ('Client 0482', 'entreprise', v_cie) returning id into v_cli;
  insert into public.client_contacts (client_id, name, email, is_followup) values (v_cli, 'Paul Suivi', 'suivi@exemple.fr', true);
  insert into public.sessions (reference, client_id, start_date, end_date, attendance_token, company_id, status)
  values ('SES-0482', v_cli, v_today - 61, v_today - 61, 'jeton-0482', v_cie, 'completed') returning id into v_se;
  insert into public.sessions (reference, client_id, start_date, end_date, attendance_token, company_id, status)
  values ('SES-0482-VIEILLE', v_cli, v_today - 400, v_today - 400, 'jeton-0482v', v_cie, 'completed') returning id into v_old;
  insert into public.trainees (first_name, last_name, email, client_id, company_id) values ('Anne', 'Avec', 'anne@exemple.fr', v_cli, v_cie) returning id into v_a;
  insert into public.trainees (first_name, last_name, email, client_id, company_id) values ('Bob', 'Sans', 'pas-une-adresse', v_cli, v_cie) returning id into v_b;
  insert into public.trainees (first_name, last_name, email, client_id, company_id) values ('Cléo', 'Repondu', 'cleo@exemple.fr', v_cli, v_cie) returning id into v_c;
  insert into public.trainees (first_name, last_name, email, client_id, company_id) values ('Dan', 'Absent', 'dan@exemple.fr', v_cli, v_cie) returning id into v_d;
  insert into public.session_trainees (session_id, trainee_id) values (v_se, v_a), (v_se, v_b), (v_se, v_c);
  insert into public.session_trainees (session_id, trainee_id, absent) values (v_se, v_d, true);
  insert into public.session_trainees (session_id, trainee_id) values (v_old, v_a);
  insert into public.evaluations_cold (session_id, trainee_id, sent_at, completed_at, skills_applied) values (v_se, v_c, now() - interval '5 days', now(), 5);

  -- 1. Délai non échu (59 jours) : rien
  perform app.froid_preparer_corps(array[v_cie], v_today - 2);
  if exists (select 1 from public.froid_envois where session_id = v_se) then raise exception '1. préparé avant le délai'; end if;

  -- 2. Au délai : Anne (stagiaire), Bob (contact de l'entreprise), employeur ; ni Cléo (répondu) ni Dan (absent) ;
  --    session de plus d'un an exclue
  v_r := app.froid_preparer_corps(array[v_cie], v_today);
  select count(*) into v_n from public.froid_envois where session_id = v_se;
  if v_n <> 3 then raise exception '2. % envois préparés (3 attendus) : %', v_n, v_r; end if;
  if not exists (select 1 from public.froid_envois where session_id = v_se and trainee_id = v_a and cible = 'stagiaire' and rang = 0 and destinataire = 'anne@exemple.fr') then raise exception '2. Anne'; end if;
  if not exists (select 1 from public.froid_envois where session_id = v_se and trainee_id = v_b and cible = 'contact' and destinataire = 'suivi@exemple.fr') then raise exception '2. Bob par le contact'; end if;
  if not exists (select 1 from public.froid_envois where session_id = v_se and cible = 'employeur' and client_id = v_cli) then raise exception '2. employeur'; end if;
  if exists (select 1 from public.froid_envois where trainee_id in (v_c, v_d)) then raise exception '2. répondu ou absent préparé'; end if;
  if exists (select 1 from public.froid_envois where session_id = v_old) then raise exception '2. session ancienne préparée'; end if;

  -- 3. Repasser : aucune nouvelle ligne (pas de boucle) ; pas de relance tant que rien n'est envoyé
  perform app.froid_preparer_corps(array[v_cie], v_today + 100);
  select count(*) into v_n from public.froid_envois where session_id = v_se;
  if v_n <> 3 then raise exception '3. relance préparée sans envoi réel (%)', v_n; end if;

  -- 4. Envoi : interrupteur fermé refusé ; ouvert, réservé ; seconde réservation refusée
  perform set_config('request.jwt.claims', v_gest, true);
  select id into v_id from public.froid_envois where session_id = v_se and trainee_id = v_a;
  v_r := public.froid_envois_reserver(array[v_id]);
  if jsonb_array_length(v_r -> 'envois') <> 0 or (v_r -> 'refus' -> 0 ->> 'raison') not like 'Envoi « Questionnaires à froid » fermé%' then raise exception '4. interrupteur fermé ignoré : %', v_r; end if;
  insert into public.auto_send_switches (company_id, kind, enabled) values (v_cie, 'evaluation_froid', true)
  on conflict (company_id, kind) do update set enabled = true, suspended_until = null;
  v_r := public.froid_envois_reserver(array[v_id]);
  if jsonb_array_length(v_r -> 'envois') <> 1 or (v_r -> 'envois' -> 0 ->> 'prenom') <> 'Anne' then raise exception '4. réservation : %', v_r; end if;
  v_r := public.froid_envois_reserver(array[v_id]);
  if jsonb_array_length(v_r -> 'envois') <> 0 then raise exception '4. double réservation'; end if;
  perform public.froid_envoi_terminer(v_id, true, 'msg-1', 'moi@exemple.fr');
  if (select sent_at from public.evaluations_cold where session_id = v_se and trainee_id = v_a) is null then raise exception '4. envoi non noté'; end if;
  -- la même adresse le même jour pour une autre session : refusée
  insert into public.froid_envois (company_id, session_id, trainee_id, client_id, cible, rang, du_le, destinataire)
  values (v_cie, v_old, v_a, v_cli, 'stagiaire', 0, v_today, 'anne@exemple.fr') returning id into v_id;
  v_r := public.froid_envois_reserver(array[v_id]);
  if (v_r -> 'refus' -> 0 ->> 'raison') not like 'Adresse déjà écrite%' then raise exception '4. une adresse par jour : %', v_r; end if;
  delete from public.froid_envois where id = v_id;

  -- 5. Relance : pas avant 30 jours après l'envoi, une seule
  perform set_config('request.jwt.claims', '', true);
  perform app.froid_preparer_corps(array[v_cie], v_today + 29);
  if exists (select 1 from public.froid_envois where trainee_id = v_a and rang = 1) then raise exception '5. relance avant 30 jours'; end if;
  perform app.froid_preparer_corps(array[v_cie], v_today + 30);
  if not exists (select 1 from public.froid_envois where trainee_id = v_a and rang = 1 and statut = 'prepare') then raise exception '5. relance absente à 30 jours'; end if;
  update public.froid_envois set statut = 'envoye', envoye_le = now() + interval '30 days' where trainee_id = v_a and rang = 1;
  perform app.froid_preparer_corps(array[v_cie], v_today + 400);
  if exists (select 1 from public.froid_envois where trainee_id = v_a and rang = 2) then raise exception '5. seconde relance au-delà du réglage'; end if;

  -- 6. Réponse reçue : la ligne préparée est écartée
  update public.froid_envois set statut = 'prepare' where trainee_id = v_b and session_id = v_se;
  update public.evaluations_cold set completed_at = now() where session_id = v_se and trainee_id = v_b;
  if not found then insert into public.evaluations_cold (session_id, trainee_id, completed_at) values (v_se, v_b, now()); end if;
  perform app.froid_preparer_corps(array[v_cie], v_today);
  if (select statut from public.froid_envois where trainee_id = v_b and session_id = v_se) <> 'ignore' then raise exception '6. réponse reçue non écartée'; end if;

  -- 7. Inclusion d'une session ancienne à la main
  update public.sessions set froid_inclure = true where id = v_old;
  perform app.froid_preparer_corps(array[v_cie], v_today);
  if not exists (select 1 from public.froid_envois where session_id = v_old and trainee_id = v_a) then raise exception '7. session incluse non préparée'; end if;

  -- 8. Réponses : questions de base, toutes les questions fermées obligatoires
  if app.froid_reponses_valides(app.froid_questions_defaut('stagiaire'), '{"skills_applied": true}') then raise exception '8. réponse incomplète acceptée'; end if;
  if not app.froid_reponses_valides(app.froid_questions_defaut('stagiaire'),
       '{"skills_applied": true, "objectives_met": false, "knowledge_retained": true, "job_impact": true, "would_recommend": true, "comments": "Bien"}') then
    raise exception '8. réponse complète refusée'; end if;
  if app.froid_reponses_valides(app.froid_questions_defaut('stagiaire'),
       '{"skills_applied": true, "objectives_met": false, "knowledge_retained": true, "job_impact": true, "would_recommend": true, "pirate": 1}') then
    raise exception '8. clé inconnue acceptée'; end if;
  -- 8 bis. Session passée laissée « confirmée » (verrou) : rien n'est préparé
  declare v_conf uuid; begin
    insert into public.sessions (reference, client_id, start_date, end_date, attendance_token, company_id, status)
    values ('SES-0482-CONF', v_cli, v_today - 70, v_today - 70, 'jeton-0482c', v_cie, 'confirmed') returning id into v_conf;
    insert into public.session_trainees (session_id, trainee_id) values (v_conf, v_a);
    perform app.froid_preparer_corps(array[v_cie], v_today);
    if exists (select 1 from public.froid_envois where session_id = v_conf) then raise exception '8 bis. session non terminée préparée'; end if;
  end;

  -- 8 ter. Contact : deux sessions, même adresse, le même jour : la seconde attend
  perform set_config('request.jwt.claims', v_gest, true);
  declare v_e1 uuid; v_e2 uuid; begin
    insert into public.froid_envois (company_id, session_id, client_id, cible, rang, du_le, destinataire) values (v_cie, v_old, v_cli, 'employeur', 0, v_today, 'suivi@exemple.fr')
    on conflict do nothing;
    select id into v_e1 from public.froid_envois where session_id = v_se and cible = 'employeur' and rang = 0;
    select id into v_e2 from public.froid_envois where session_id = v_old and cible = 'employeur' and rang = 0;
    update public.froid_envois set statut = 'prepare' where id in (v_e1, v_e2);
    v_r := public.froid_envois_reserver(array[v_e1, v_e2]);
    if jsonb_array_length(v_r -> 'envois') <> 1 or (v_r -> 'refus' -> 0 ->> 'raison') not like 'Adresse déjà écrite%' then raise exception '8 ter. contact écrit deux fois le même jour : %', v_r; end if;
    -- 8 quater. Réservation récente : ni remise à envoyer ni « interrompue », même préparée il y a longtemps
    update public.froid_envois set prepare_le = now() - interval '2 days' where id in (v_e1, v_e2);
    if public.froid_remettre(array[v_e1, v_e2]) <> 0 then raise exception '8 quater. réservation récente remise à envoyer'; end if;
    if (select reserve_le from public.froid_envois where statut = 'en_cours' and id in (v_e1, v_e2)) is null then raise exception '8 quater. heure de réservation absente'; end if;
    -- Interrompue depuis plus de 15 minutes : reprise possible
    update public.froid_envois set reserve_le = now() - interval '20 minutes' where statut = 'en_cours' and id in (v_e1, v_e2);
    if public.froid_remettre(array[v_e1, v_e2]) <> 1 then raise exception '8 quater. envoi interrompu non repris'; end if;
    -- 8 quinquies. Même session, même adresse, lignes choisies en deux fois : la seconde attend
    declare v_c1 uuid; v_c2 uuid; v_tx uuid; v_ty uuid; v_se2 uuid; begin
      insert into public.sessions (reference, client_id, start_date, end_date, attendance_token, company_id, status)
      values ('SES-0482-DEUX', v_cli, v_today - 70, v_today - 70, 'jeton-0482d', v_cie, 'completed') returning id into v_se2;
      insert into public.trainees (first_name, last_name, client_id, company_id) values ('X', 'Un', v_cli, v_cie) returning id into v_tx;
      insert into public.trainees (first_name, last_name, client_id, company_id) values ('Y', 'Deux', v_cli, v_cie) returning id into v_ty;
      insert into public.froid_envois (company_id, session_id, trainee_id, client_id, cible, rang, du_le, destinataire)
      values (v_cie, v_se2, v_tx, v_cli, 'contact', 0, v_today, 'deux@exemple.fr') returning id into v_c1;
      insert into public.froid_envois (company_id, session_id, trainee_id, client_id, cible, rang, du_le, destinataire)
      values (v_cie, v_se2, v_ty, v_cli, 'contact', 0, v_today, 'deux@exemple.fr') returning id into v_c2;
      v_r := public.froid_envois_reserver(array[v_c1]);
      if jsonb_array_length(v_r -> 'envois') <> 1 then raise exception '8 quinquies. première ligne : %', v_r; end if;
      v_r := public.froid_envois_reserver(array[v_c2]);
      if jsonb_array_length(v_r -> 'envois') <> 0 then raise exception '8 quinquies. seconde ligne choisie à part envoyée le même jour : %', v_r; end if;
      -- choisies ensemble : un seul mail, les deux passent
      update public.froid_envois set statut = 'prepare', reserve_le = null, envoye_par = null where id in (v_c1, v_c2);
      v_r := public.froid_envois_reserver(array[v_c1, v_c2]);
      if jsonb_array_length(v_r -> 'envois') <> 2 then raise exception '8 quinquies. lignes choisies ensemble refusées : %', v_r; end if;
    end;
  end;
  perform set_config('request.jwt.claims', '', true);

  -- 9. Portail : ticket exigé, questionnaire ouvert au délai, réponse figée, ligne préparée écartée
  update public.session_trainees set portal_ticket = 'ticket-0482', portal_ticket_expires_at = now() + interval '1 hour'
   where session_id = v_se and trainee_id = v_a;
  v_ok := false;
  begin perform public.portail_froid('jeton-0482', v_a, 'mauvais'); exception when others then v_ok := sqlerrm like 'Code d''accès requis%'; end;
  if not v_ok then raise exception '9. portail sans ticket'; end if;
  v_r := public.portail_froid('jeton-0482', v_a, 'ticket-0482');
  if not (v_r ->> 'ouvert')::boolean or (v_r ->> 'recue')::boolean or jsonb_array_length(v_r -> 'questions') <> 6 then raise exception '9. état du portail : %', v_r; end if;
  update public.froid_envois set statut = 'prepare' where session_id = v_se and trainee_id = v_a and rang = 1;
  v_ok := false;
  begin perform public.portail_froid_repondre('jeton-0482', v_a, 'ticket-0482', '{"skills_applied": true}'); exception when others then v_ok := sqlerrm like 'Merci de répondre%'; end;
  if not v_ok then raise exception '9. réponse incomplète acceptée'; end if;
  perform public.portail_froid_repondre('jeton-0482', v_a, 'ticket-0482',
    '{"skills_applied": true, "objectives_met": false, "knowledge_retained": true, "job_impact": true, "would_recommend": true, "comments": "Utile"}');
  if (select skills_applied <> 5 or objectives_met <> 1 or completed_at is null or comments <> 'Utile' from public.evaluations_cold where session_id = v_se and trainee_id = v_a) then
    raise exception '9. réponses mal enregistrées'; end if;
  if (select statut from public.froid_envois where session_id = v_se and trainee_id = v_a and rang = 1) <> 'ignore' then raise exception '9. relance préparée non écartée'; end if;
  v_ok := false;
  begin perform public.portail_froid_repondre('jeton-0482', v_a, 'ticket-0482',
    '{"skills_applied": false, "objectives_met": false, "knowledge_retained": false, "job_impact": false, "would_recommend": false}');
  exception when others then v_ok := sqlerrm like 'Votre réponse est déjà enregistrée%'; end;
  if not v_ok then raise exception '9. seconde réponse acceptée'; end if;
  raise warning 'ESSAI 0482 : OK';
end
$$;
rollback;
