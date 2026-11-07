-- Essai propre de 0501 : le ticket du code personnel est exigé par les huit fonctions du portail stagiaire.
begin;
set local client_min_messages = warning;
do $$
declare
  v_cie uuid; v_cli uuid; v_se uuid; v_a uuid; v_b uuid; v_c uuid; v_r json; v_ok boolean; v_n int;
  v_eval jsonb := '{"q_org_documents": 5, "q_global_adequation": 4, "would_recommend": true}';
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, client_type, company_id) values ('Client 0501', 'entreprise', v_cie) returning id into v_cli;
  insert into public.sessions (reference, client_id, start_date, end_date, attendance_token, company_id, status)
  values ('SES-0501', v_cli, current_date, current_date, 'jeton-0501', v_cie, 'in_progress') returning id into v_se;
  insert into public.trainees (first_name, last_name, client_id, company_id) values ('Anne', 'Code', v_cli, v_cie) returning id into v_a;
  insert into public.trainees (first_name, last_name, client_id, company_id) values ('Bob', 'Autre', v_cli, v_cie) returning id into v_b;
  insert into public.trainees (first_name, last_name, client_id, company_id) values ('Cléo', 'Hors', v_cli, v_cie) returning id into v_c;
  insert into public.session_trainees (session_id, trainee_id, access_code, portal_ticket, portal_ticket_expires_at)
  values (v_se, v_a, '123456', 'ticket-anne-0501', now() + interval '1 hour'),
         (v_se, v_b, null, null, null);
  -- le code personnel est donné d'office à l'inscription (0423) : Bob représente un ancien stagiaire sans code
  update public.session_trainees set access_code = null where session_id = v_se and trainee_id = v_b;
  update public.session_trainees set access_code = '123456', portal_ticket = 'ticket-anne-0501',
         portal_ticket_expires_at = now() + interval '1 hour' where session_id = v_se and trainee_id = v_a;

  -- 1. Évaluation à chaud : refusée sans ticket, avec un mauvais ticket, ou avec un ticket expiré
  begin
    perform public.save_evaluation('jeton-0501', v_a, v_eval, null);
    raise exception '1. évaluation acceptée sans ticket';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.save_evaluation('jeton-0501', v_a, v_eval, 'ticket-de-bob');
    raise exception '1. évaluation acceptée avec un mauvais ticket';
  exception when sqlstate '42501' then null;
  end;
  update public.session_trainees set portal_ticket_expires_at = now() - interval '1 minute' where session_id = v_se and trainee_id = v_a;
  begin
    perform public.save_evaluation('jeton-0501', v_a, v_eval, 'ticket-anne-0501');
    raise exception '1. évaluation acceptée avec un ticket expiré';
  exception when sqlstate '42501' then null;
  end;
  update public.session_trainees set portal_ticket_expires_at = now() + interval '1 hour' where session_id = v_se and trainee_id = v_a;
  if exists (select 1 from public.trainee_evaluations where session_id = v_se) then raise exception '1. évaluation écrite malgré le refus'; end if;
  perform public.save_evaluation('jeton-0501', v_a, v_eval, 'ticket-anne-0501');
  if not exists (select 1 from public.trainee_evaluations where session_id = v_se and trainee_id = v_a and questionnaire_submitted) then
    raise exception '1. évaluation avec le bon ticket non enregistrée';
  end if;
  -- stagiaire sans code personnel : comme avant, sans ticket
  perform public.save_evaluation('jeton-0501', v_b, v_eval, null);
  if not exists (select 1 from public.trainee_evaluations where session_id = v_se and trainee_id = v_b) then raise exception '1. stagiaire sans code refusé'; end if;

  -- 2. Test de positionnement : stagiaire non inscrit refusé (n'était pas contrôlé), ticket exigé
  begin
    perform public.save_positioning_test_answers('jeton-0501', v_c, '[]'::jsonb, null);
    raise exception '2. positionnement accepté pour un stagiaire non inscrit';
  exception when others then
    if sqlerrm not like 'Stagiaire non trouvé%' then raise; end if;
  end;
  begin
    perform public.save_positioning_test_answers('jeton-0501', v_a, '[]'::jsonb, null);
    raise exception '2. positionnement accepté sans ticket';
  exception when sqlstate '42501' then null;
  end;
  perform public.save_positioning_test_answers('jeton-0501', v_a, '[]'::jsonb, 'ticket-anne-0501');
  if not (select positioning_test_completed from public.session_trainees where session_id = v_se and trainee_id = v_a) then raise exception '2. positionnement non noté'; end if;

  -- 3. Refus d'e-mail et émargement : refus rendu en json, rien d'écrit
  v_r := public.portal_set_email_refused('jeton-0501', v_a, true, null);
  if (v_r->>'ok')::boolean or v_r->>'error' <> 'Votre accès a expiré : saisissez à nouveau votre code personnel' then raise exception '3. refus d''e-mail sans ticket : %', v_r; end if;
  if coalesce((select email_refused from public.trainees where id = v_a), false) then raise exception '3. refus d''e-mail écrit sans ticket'; end if;
  v_r := public.portal_set_email_refused('jeton-0501', v_a, true, 'ticket-anne-0501');
  if not (v_r->>'ok')::boolean then raise exception '3. refus d''e-mail avec ticket : %', v_r; end if;
  v_r := public.portal_sign_halfday('jeton-0501', v_a, 'morning', 'data:image/png;base64,AAAA', null);
  if (v_r->>'ok')::boolean or v_r->>'error' <> 'Votre accès a expiré : saisissez à nouveau votre code personnel' then raise exception '3. émargement sans ticket : %', v_r; end if;
  v_r := public.portal_sign_halfday('jeton-0501', v_a, 'morning', 'data:image/png;base64,AAAA', 'ticket-anne-0501');
  if v_r->>'error' = 'Votre accès a expiré : saisissez à nouveau votre code personnel' then raise exception '3. émargement refusé avec le bon ticket'; end if;

  -- 3 bis. Émargement envoyé plus tard (sans réseau) : ticket gardé avec la signature, valable à l'heure de la signature
  v_r := public.portal_sign_halfday_differe('jeton-0501', v_a, 'afternoon', 'data:image/png;base64,AAAA', now() - interval '5 minutes', null);
  if (v_r->>'ok')::boolean or v_r->>'error' <> 'Votre accès a expiré : saisissez à nouveau votre code personnel' then raise exception '3 bis. envoi différé sans ticket : %', v_r; end if;
  v_r := public.portal_sign_halfday_differe('jeton-0501', v_a, 'afternoon', 'data:image/png;base64,AAAA', now() - interval '5 minutes', 'ticket-de-bob');
  if (v_r->>'ok')::boolean then raise exception '3 bis. envoi différé avec un mauvais ticket'; end if;
  update public.session_trainees set portal_ticket_expires_at = now() - interval '10 minutes' where session_id = v_se and trainee_id = v_a;
  v_r := public.portal_sign_halfday_differe('jeton-0501', v_a, 'afternoon', 'data:image/png;base64,AAAA', now() - interval '5 minutes', 'ticket-anne-0501');
  if (v_r->>'ok')::boolean then raise exception '3 bis. signature faite après l''expiration du ticket acceptée'; end if;
  v_r := public.portal_sign_halfday_differe('jeton-0501', v_a, 'afternoon', 'data:image/png;base64,AAAA', now() - interval '20 minutes', 'ticket-anne-0501');
  if v_r->>'error' = 'Votre accès a expiré : saisissez à nouveau votre code personnel' then raise exception '3 bis. signature faite avant l''expiration refusée'; end if;
  update public.session_trainees set portal_ticket_expires_at = now() + interval '1 hour' where session_id = v_se and trainee_id = v_a;
  -- lien inconnu : refus du corps inchangé
  v_r := public.portal_sign_halfday('lien-inconnu-0501', v_a, 'morning', 'data:image/png;base64,AAAA', null);
  if v_r->>'error' <> 'Lien invalide' then raise exception '3 bis. refus du lien inconnu changé : %', v_r; end if;

  -- 4. Quiz : résumé, questions et quiz final
  begin
    perform public.portal_quiz_summary('jeton-0501', v_a, null);
    raise exception '4. résumé du quiz sans ticket';
  exception when sqlstate '42501' then null;
  end;
  perform public.portal_quiz_summary('jeton-0501', v_a, 'ticket-anne-0501');
  begin
    perform public.portal_quiz_finish('jeton-0501', v_a, 'final', '[]'::jsonb, null);
    raise exception '4. quiz final sans ticket';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.portal_quiz_questions('jeton-0501', v_a, 'final', null);
    raise exception '4. questions du quiz sans ticket';
  exception when sqlstate '42501' then null;
  end;

  -- 5. Anciennes signatures retirées, corps fermés aux comptes
  if to_regprocedure('public.save_evaluation(text,uuid,jsonb)') is not null
     or to_regprocedure('public.portal_sign_halfday(text,uuid,text,text)') is not null
     or to_regprocedure('public.portal_sign_halfday_differe(text,uuid,text,text,timestamptz)') is not null then
    raise exception '5. ancienne fonction sans ticket encore publique';
  end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app' and p.proname like '%\_corps' escape '\'
    and p.proname in ('save_evaluation_corps', 'save_positioning_test_answers_corps', 'portal_set_email_refused_corps',
                      'portal_quiz_questions_corps', 'portal_quiz_finish_corps', 'portal_quiz_summary_corps', 'portal_sign_halfday_corps',
                      'portal_sign_halfday_differe_corps')
    and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute');
  if v_n <> 8 then raise exception '5. % corps fermés sur 8', v_n; end if;
  if not has_function_privilege('anon', 'public.save_evaluation(text,uuid,jsonb,text)', 'execute') then raise exception '5. portail fermé à anon'; end if;
end $$;
rollback;
