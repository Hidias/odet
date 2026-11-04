-- Essai de 0479 (après la migration, dans une transaction annulée) : effectif imposé et certificat exigé.
do $$
declare v_course uuid; v_sess uuid; v_cli uuid; v_t uuid; i int; v_ok boolean;
begin
  select id into v_course from public.courses limit 1;
  update public.courses set effectif_strict = true, min_participants = 4, max_participants = 10, prerequis_certificat_mois = 6 where id = v_course;
  insert into public.clients (name) values ('Client essai 0479') returning id into v_cli;
  insert into public.sessions (course_id, client_id, start_date, end_date, attendance_token, max_participants)
    values (v_course, v_cli, current_date + 20, current_date + 20, 'essai0479', 10) returning id into v_sess;
  for i in 1..10 loop
    insert into public.trainees (first_name, last_name, client_id) values ('Essai', 'P' || i, v_cli) returning id into v_t;
    insert into public.session_trainees (session_id, trainee_id) values (v_sess, v_t);
  end loop;
  -- 11e participant : refusé
  insert into public.trainees (first_name, last_name, client_id) values ('Essai', 'P11', v_cli) returning id into v_t;
  v_ok := false;
  begin
    insert into public.session_trainees (session_id, trainee_id) values (v_sess, v_t);
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception '11e participant accepté'; end if;
  -- Un absent libère la place
  update public.session_trainees set absent = true where id = (select id from public.session_trainees where session_id = v_sess limit 1);
  insert into public.session_trainees (session_id, trainee_id) values (v_sess, v_t);
  -- L'absent ne peut pas revenir tant que la session est complète
  v_ok := false;
  begin
    update public.session_trainees set absent = false where session_id = v_sess and absent;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'retour d''un absent au-delà du maximum accepté'; end if;
  -- Maximum de la session au-delà de celui de la formation : refusé
  v_ok := false;
  begin
    update public.sessions set max_participants = 11 where id = v_sess;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'maximum de session au-delà de la formation accepté'; end if;
  -- Formation sans effectif imposé : aucun contrôle
  update public.courses set effectif_strict = false where id = v_course;
  insert into public.trainees (first_name, last_name, client_id) values ('Essai', 'P12', v_cli) returning id into v_t;
  insert into public.session_trainees (session_id, trainee_id) values (v_sess, v_t);
  -- Copie du certificat : seulement dans le dossier prerequis/
  v_ok := false;
  begin
    update public.session_trainees set prerequis_file_path = 'autre/x.pdf' where session_id = v_sess;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'copie hors du dossier prerequis acceptée'; end if;
  raise notice '0479 : 6 test(s), 0 échec(s)';
end
$$;
