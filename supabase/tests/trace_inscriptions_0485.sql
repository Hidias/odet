-- Essai local de 0485 : ajout et retrait d'un stagiaire tracés au journal d'audit, par un compte connecté (auteur
-- posé par la base) comme sans compte ; retrait qui dit ce qui était déjà saisi ; aucun nom de stagiaire écrit ;
-- suppression du stagiaire ou de la session en cascade signalée comme telle, sans faux compte d'émargements.
begin;
set local client_min_messages = warning;
do $$
declare
  v_cie uuid; v_ses uuid; v_tr uuid; v_n int; v_l record;
  v_sa text := '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
begin
  select id into v_cie from public.companies limit 1;
  insert into public.sessions (reference, start_date, end_date, attendance_token, convention_signed, company_id)
    values ('ESSAI-0485', current_date, current_date, 'jeton-0485', true, v_cie) returning id into v_ses;
  insert into public.trainees (first_name, last_name, company_id) values ('Prenom0485', 'NOM0485', v_cie) returning id into v_tr;

  -- 1. Ajout par un compte connecté (rôle authenticated) : une ligne « create » avec auteur
  perform set_config('request.jwt.claims', v_sa, true);
  perform set_config('role', 'authenticated', true);
  insert into public.session_trainees (session_id, trainee_id) values (v_ses, v_tr);
  perform set_config('role', 'postgres', true);
  select * into v_l from public.audit_logs where entity_type = 'inscription' and entity_id = v_ses and action = 'create';
  if v_l is null then raise exception '1. ajout non tracé'; end if;
  if v_l.user_id is null or v_l.entity_name is distinct from 'ESSAI-0485' or (v_l.details ->> 'trainee_id')::uuid <> v_tr
     or (v_l.details ->> 'convention_signee')::boolean is not true then
    raise exception '1. trace incomplète : %', to_jsonb(v_l); end if;

  -- 2. Retrait après une demi-journée émargée et la fiche remplie : une ligne « delete » qui le dit
  insert into public.attendance_halfdays (session_id, trainee_id, date, morning, afternoon) values (v_ses, v_tr, current_date, true, false);
  update public.session_trainees set info_sheet_completed = true where session_id = v_ses and trainee_id = v_tr;
  perform set_config('role', 'authenticated', true);
  delete from public.session_trainees where session_id = v_ses and trainee_id = v_tr;
  perform set_config('role', 'postgres', true);
  select * into v_l from public.audit_logs where entity_type = 'inscription' and entity_id = v_ses and action = 'delete';
  if v_l is null then raise exception '2. retrait non tracé'; end if;
  if v_l.user_id is null or (v_l.details ->> 'demi_journees_emargees')::int <> 1 or (v_l.details ->> 'fiche_remplie')::boolean is not true
     or (v_l.details ->> 'evaluation_remplie')::boolean is not false then
    raise exception '2. trace du retrait incomplète : %', to_jsonb(v_l); end if;

  -- 3. Retrait sans compte (portail, tâche) : tracé aussi, sans auteur
  perform set_config('request.jwt.claims', '', true);
  insert into public.session_trainees (session_id, trainee_id) values (v_ses, v_tr);
  delete from public.session_trainees where session_id = v_ses and trainee_id = v_tr;
  select count(*) into v_n from public.audit_logs where entity_type = 'inscription' and entity_id = v_ses and user_id is null;
  if v_n <> 2 then raise exception '3. % lignes sans auteur (2 attendues)', v_n; end if;

  -- 4. Jamais le nom du stagiaire dans le journal
  select count(*) into v_n from public.audit_logs where entity_type = 'inscription'
    and (coalesce(entity_name, '') || details::text) ~ '(Prenom0485|NOM0485)';
  if v_n <> 0 then raise exception '4. nom du stagiaire écrit au journal'; end if;

  -- 5. Stagiaire supprimé (cascade) : la trace le dit et ne compte pas d'émargements effacés avant elle
  perform set_config('request.jwt.claims', v_sa, true);
  insert into public.session_trainees (session_id, trainee_id) values (v_ses, v_tr);
  insert into public.attendance_halfdays (session_id, trainee_id, date, morning, afternoon) values (v_ses, v_tr, current_date + 1, true, true);
  delete from public.trainees where id = v_tr;
  select * into v_l from public.audit_logs where entity_type = 'inscription' and entity_id = v_ses and action = 'delete'
    and details ->> 'suppression' = 'stagiaire';
  if v_l is null or v_l.details ? 'demi_journees_emargees' or v_l.entity_name is distinct from 'ESSAI-0485' then
    raise exception '5. trace de la suppression du stagiaire : %', to_jsonb(v_l); end if;

  -- 6. Session supprimée directement (cascade) : la trace le dit, sans compter
  insert into public.trainees (first_name, last_name, company_id) values ('Prenom0485', 'NOM0485', v_cie) returning id into v_tr;
  insert into public.session_trainees (session_id, trainee_id) values (v_ses, v_tr);
  insert into public.attendance_halfdays (session_id, trainee_id, date, morning, afternoon) values (v_ses, v_tr, current_date, true, true);
  delete from public.sessions where id = v_ses;
  select * into v_l from public.audit_logs where entity_type = 'inscription' and entity_id = v_ses and action = 'delete'
    and details ->> 'suppression' = 'session';
  if v_l is null or v_l.details ? 'demi_journees_emargees' then
    raise exception '6. trace de la suppression de la session : %', to_jsonb(v_l); end if;

  raise warning 'ESSAI 0485 : OK';
end
$$;
rollback;
