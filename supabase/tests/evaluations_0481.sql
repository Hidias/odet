-- Essai local de 0481 : réponses figées dès leur réception, saisie en une fois, correction du super administrateur
-- avec motif et trace, portail qui ne réécrit plus une évaluation reçue.
begin;
set local client_min_messages = warning;
do $$
declare
  v_cie uuid; v_cli uuid; v_se uuid; v_tr uuid; v_tr2 uuid; v_fo uuid; v_r jsonb; v_ok boolean; v_n int; v_msg text;
  v_gest text := '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
  v_sa text := '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, client_type, company_id) values ('Client 0481', 'entreprise', v_cie) returning id into v_cli;
  insert into public.trainers (first_name, last_name, company_id) values ('Fo', 'Essai', v_cie) returning id into v_fo;
  insert into public.sessions (reference, client_id, trainer_id, start_date, end_date, attendance_token, company_id, status)
  values ('SES-0481', v_cli, v_fo, current_date - 10, current_date - 9, 'jeton-0481', v_cie, 'completed') returning id into v_se;
  insert into public.trainees (first_name, last_name, client_id, company_id) values ('Anne', 'Un', v_cli, v_cie) returning id into v_tr;
  insert into public.trainees (first_name, last_name, client_id, company_id) values ('Bob', 'Deux', v_cli, v_cie) returning id into v_tr2;
  insert into public.session_trainees (session_id, trainee_id) values (v_se, v_tr), (v_se, v_tr2);
  -- 0501 : ticket du code personnel exigé par le portail
  update public.session_trainees set portal_ticket = 'ticket-0481', portal_ticket_expires_at = now() + interval '1 hour'
  where session_id = v_se and trainee_id = v_tr;
  alter table public.profiles disable trigger user;
  update public.profiles set role = 'superadmin' where id = '00000000-0000-4000-8000-000000000002';
  alter table public.profiles enable trigger user;

  -- 1. Portail : première évaluation reçue, la seconde refusée
  perform public.save_evaluation('jeton-0481', v_tr, '{"q_org_documents": 4, "would_recommend": true}', 'ticket-0481');
  v_ok := false;
  begin perform public.save_evaluation('jeton-0481', v_tr, '{"q_org_documents": 1}', 'ticket-0481'); exception when others then v_ok := sqlerrm like 'Votre évaluation est déjà enregistrée%'; end;
  if not v_ok then raise exception '1. évaluation à chaud réécrite par le portail'; end if;
  if (select q_org_documents from public.trainee_evaluations where session_id = v_se and trainee_id = v_tr) <> 4 then raise exception '1. note modifiée'; end if;

  -- 2. Attentes : une fois, pas deux
  update public.trainee_evaluations set attentes_satisfaites = 'oui' where session_id = v_se and trainee_id = v_tr;
  v_ok := false;
  begin update public.trainee_evaluations set attentes_satisfaites = 'non' where session_id = v_se and trainee_id = v_tr;
  exception when others then v_ok := sqlerrm like 'Votre réponse sur vos attentes%'; end;
  if not v_ok then raise exception '2. attentes réécrites'; end if;

  -- 3. Écriture directe sur une réponse reçue : refusée, même pour la base
  v_ok := false;
  begin update public.trainee_evaluations set q_org_documents = 2 where session_id = v_se and trainee_id = v_tr;
  exception when others then v_ok := sqlerrm like 'Réponse reçue%'; end;
  if not v_ok then raise exception '3. modification directe acceptée'; end if;
  v_ok := false;
  begin delete from public.trainee_evaluations where session_id = v_se and trainee_id = v_tr;
  exception when others then v_ok := sqlerrm like 'Réponse reçue%'; end;
  if not v_ok then raise exception '3. suppression directe acceptée'; end if;

  -- 4. Saisie papier en une fois par le gestionnaire : figée, saisi_par posé
  perform set_config('request.jwt.claims', v_gest, true);
  perform public.evaluation_froid_suivi(v_se, v_tr2, true);
  if (select sent_at from public.evaluations_cold where session_id = v_se and trainee_id = v_tr2) is null then raise exception '4. envoi non noté'; end if;
  v_r := public.evaluation_enregistrer('froid', v_se, v_tr2, '{"skills_applied": 5, "objectives_met": 1, "would_recommend": true}');
  if (select completed_at is null or saisi_par is null or objectives_met <> 1 from public.evaluations_cold where session_id = v_se and trainee_id = v_tr2) then
    raise exception '4. saisie à froid incomplète'; end if;
  v_ok := false;
  begin perform public.evaluation_enregistrer('froid', v_se, v_tr2, '{"objectives_met": 5}'); exception when others then v_ok := sqlerrm like 'Réponse déjà reçue%'; end;
  if not v_ok then raise exception '4. seconde saisie acceptée pour le gestionnaire'; end if;
  v_ok := false;
  begin perform public.evaluation_froid_suivi(v_se, v_tr2, false); exception when others then v_ok := sqlerrm like 'Réponse déjà reçue%'; end;
  if not v_ok then raise exception '4. envoi annulé après réception'; end if;
  v_ok := false;
  begin perform public.evaluation_enregistrer('froid', v_se, v_tr2, '{"objectives_met": 9}'); exception when others then v_ok := sqlerrm like '%note de 1 à 5%' or sqlerrm like 'Réponse déjà reçue%'; end;
  if not v_ok then raise exception '4. note hors bornes'; end if;
  v_ok := false;
  begin perform public.evaluation_enregistrer('froid', v_se, v_tr, '{"inconnu": 1}'); exception when others then v_ok := sqlerrm like 'Réponse inconnue%'; end;
  if not v_ok then raise exception '4. clé inconnue acceptée'; end if;
  v_ok := false;
  begin perform public.evaluation_supprimer('froid', v_se, v_tr2, 'erreur de saisie'); exception when others then v_ok := sqlerrm like 'Réservé au super administrateur%'; end;
  if not v_ok then raise exception '4. suppression par le gestionnaire'; end if;

  -- 5. Avis du formateur : saisi une fois, figé
  v_r := public.evaluation_enregistrer('formateur', v_se, v_fo, '{"overall_score": 4, "comments": "Groupe motivé"}');
  if (select submitted_at from public.trainer_evaluations where session_id = v_se) is null then raise exception '5. avis du formateur non figé'; end if;
  v_ok := false;
  begin perform public.evaluation_enregistrer('formateur', v_se, v_fo, '{"overall_score": 2}'); exception when others then v_ok := sqlerrm like 'Réponse déjà reçue%'; end;
  if not v_ok then raise exception '5. avis du formateur réécrit'; end if;

  -- 6. Super administrateur : correction avec motif, trace avant et après
  perform set_config('request.jwt.claims', v_sa, true);
  perform set_config('app.m_rights', '', true);
  v_ok := false;
  begin perform public.evaluation_enregistrer('chaud', v_se, v_tr, '{"q_org_documents": 5}'); exception when others then v_ok := sqlerrm like 'Indiquez le motif%'; end;
  if not v_ok then raise exception '6. correction sans motif'; end if;
  v_r := public.evaluation_enregistrer('chaud', v_se, v_tr, '{"q_org_documents": 5}', 'Erreur de saisie signalée par le stagiaire');
  if not (v_r ->> 'correction')::boolean then raise exception '6. correction non reconnue'; end if;
  if (select q_org_documents from public.trainee_evaluations where session_id = v_se and trainee_id = v_tr) <> 5 then raise exception '6. correction non faite'; end if;
  select count(*) into v_n from public.audit_logs where entity_type = 'evaluation' and action = 'update'
     and details -> 'changements' -> 'q_org_documents' ->> 'avant' = '4' and details -> 'changements' -> 'q_org_documents' ->> 'apres' = '5'
     and details ->> 'motif' like 'Erreur de saisie%';
  if v_n <> 1 then raise exception '6. trace de correction absente'; end if;
  -- toujours figée après correction
  v_ok := false;
  begin update public.trainee_evaluations set q_org_documents = 1 where session_id = v_se and trainee_id = v_tr;
  exception when others then v_ok := sqlerrm like 'Réponse reçue%'; end;
  if not v_ok then raise exception '6. réglage de correction resté ouvert'; end if;
  -- suppression avec motif et trace complète
  v_r := public.evaluation_supprimer('froid', v_se, v_tr2, 'Réponse saisie sur la mauvaise personne');
  if exists (select 1 from public.evaluations_cold where session_id = v_se and trainee_id = v_tr2) then raise exception '6. suppression non faite'; end if;
  if not exists (select 1 from public.audit_logs where entity_type = 'evaluation' and action = 'delete' and details -> 'avant' ->> 'objectives_met' = '1') then
    raise exception '6. trace de suppression absente'; end if;

  -- 7. Effacement en cascade de la session : passe
  perform set_config('request.jwt.claims', '', true);
  delete from public.sessions where id = v_se;
  if exists (select 1 from public.trainee_evaluations where session_id = v_se) then raise exception '7. cascade bloquée'; end if;
  raise warning 'ESSAI 0481 : OK';
end
$$;
rollback;
