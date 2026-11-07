-- Essai de 0506 : numéro saisi directement sur le stagiaire ou dans le Passeport, fiches de renseignements alignées.
-- Rouge sans 0506 (fiches « numéro absent »). Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_c uuid; v_s uuid; v_s2 uuid; v_t uuid; v_t2 uuid; v_t3 uuid; v_t4 uuid; v_t5 uuid; v_ctid tid;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.courses (title, company_id) values ('Formation essai 0506', v_cie) returning id into v_c;
  insert into public.sessions (reference, course_id, start_date, end_date, company_id)
    values ('ESSAI-0506', v_c, current_date + 10, current_date + 10, v_cie) returning id into v_s;
  insert into public.sessions (reference, course_id, start_date, end_date, company_id)
    values ('ESSAI-0506-B', v_c, current_date + 20, current_date + 20, v_cie) returning id into v_s2;
  insert into public.trainees (first_name, last_name, email, company_id) values ('Essai', 'UN', 'un.0506@example.invalid', v_cie) returning id into v_t;
  insert into public.trainees (first_name, last_name, company_id) values ('Essai', 'DEUX', v_cie) returning id into v_t2;
  insert into public.trainees (first_name, last_name, company_id) values ('Essai', 'TROIS', v_cie) returning id into v_t3;
  insert into public.trainees (first_name, last_name, company_id) values ('Essai', 'QUATRE', v_cie) returning id into v_t4;
  insert into public.trainees (first_name, last_name, company_id) values ('Essai', 'CINQ', v_cie) returning id into v_t5;
  insert into public.session_trainees (session_id, trainee_id)
    values (v_s, v_t), (v_s2, v_t), (v_s, v_t2), (v_s2, v_t2), (v_s, v_t3), (v_s, v_t4), (v_s, v_t5), (v_s2, v_t5);
  if (select count(*) from public.trainee_info_sheets where trainee_id in (v_t, v_t2, v_t3, v_t4, v_t5)) <> 8 then
    raise exception '0. fiches non créées'; end if;

  -- 1. Saisie directe sur le stagiaire (fiche du stagiaire, liste des participants)
  update public.trainees set social_security_number = '185057800608436' where id = v_t;
  if (select fin from public.trainee_ssn where trainee_id = v_t) is distinct from '436' then raise exception '1. numéro non rangé'; end if;
  if exists (select 1 from public.trainee_info_sheets where trainee_id = v_t and not ssn_present) then
    raise exception '1. fiche restée « numéro absent » après une saisie sur le stagiaire'; end if;
  if exists (select 1 from public.trainee_info_sheets where trainee_id = v_t and (ssn is not null or ssn_refused)) then
    raise exception '1. fiche abîmée (numéro en clair ou refus)'; end if;

  -- 2. Second passage : correction du numéro et de l'e-mail dans la même instruction
  update public.trainees set social_security_number = '290017511223318', email = 'un.bis.0506@example.invalid' where id = v_t;
  if (select fin from public.trainee_ssn where trainee_id = v_t) is distinct from '318' then raise exception '2. correction ignorée'; end if;
  if (select email from public.trainees where id = v_t) <> 'un.bis.0506@example.invalid' then raise exception '2. e-mail du stagiaire écrasé'; end if;
  if exists (select 1 from public.trainee_info_sheets where trainee_id = v_t and (not ssn_present or email <> 'un.bis.0506@example.invalid')) then
    raise exception '2. fiches non alignées'; end if;

  -- 3. Refus sur le stagiaire : numéro effacé, fiches « refus »
  update public.trainees set refused_ssn = true where id = v_t;
  if exists (select 1 from public.trainee_ssn where trainee_id = v_t) then raise exception '3. numéro gardé après un refus'; end if;
  if exists (select 1 from public.trainee_info_sheets where trainee_id = v_t and (ssn_present or not ssn_refused)) then
    raise exception '3. fiches non passées en refus'; end if;

  -- 4. Refus levé et numéro saisi sur le stagiaire dans la même instruction
  update public.trainees set refused_ssn = false, social_security_number = '185057800608436' where id = v_t;
  if (select fin from public.trainee_ssn where trainee_id = v_t) is distinct from '436' then raise exception '4. numéro perdu'; end if;
  if exists (select 1 from public.trainee_info_sheets where trainee_id = v_t and (ssn_refused or not ssn_present)) then
    raise exception '4. fiches non alignées après la levée du refus'; end if;

  -- 5. Saisie dans le Passeport (pp_nir), puis écriture ordinaire d'une fiche : « présent » gardé
  insert into public.pp_nir (trainee_id, nir_chiffre, fin) values (v_t2, 'chiffre-essai', '436');
  if exists (select 1 from public.trainee_info_sheets where trainee_id = v_t2 and not ssn_present) then
    raise exception '5. fiche restée « numéro absent » après une saisie dans le Passeport'; end if;
  update public.trainee_info_sheets set job_title = 'Cariste' where trainee_id = v_t2 and session_id = v_s;
  if exists (select 1 from public.trainee_info_sheets where trainee_id = v_t2 and not ssn_present) then
    raise exception '5. « présent » perdu à la mise à jour d''une fiche'; end if;
  if (select ssn_present from public.trainees where id = v_t2) then raise exception '5. stagiaire marqué en attente de reprise'; end if;

  -- 6. Reprise du Passeport (api/passeport.js) : pp_nir écrit, trainee_ssn effacé, stagiaire à faux ; fiches gardées
  update public.trainees set social_security_number = '185057800608436' where id = v_t3;
  insert into public.pp_nir (trainee_id, nir_chiffre, fin) values (v_t3, 'chiffre-essai', '436');
  delete from public.trainee_ssn where trainee_id = v_t3;
  update public.trainees set ssn_present = false where id = v_t3;
  update public.trainee_info_sheets set csp = 'ouvrier' where trainee_id = v_t3;
  if not (select ssn_present from public.trainee_info_sheets where trainee_id = v_t3) then
    raise exception '6. fiche « numéro absent » après la reprise du Passeport'; end if;

  -- 7. Fiche « refus » jamais touchée par une saisie dans le Passeport
  update public.trainee_info_sheets set ssn_refused = true where trainee_id = v_t4;
  select ctid into v_ctid from public.trainee_info_sheets where trainee_id = v_t4;
  insert into public.pp_nir (trainee_id, nir_chiffre, fin) values (v_t4, 'chiffre-essai', '436');
  if (select ctid from public.trainee_info_sheets where trainee_id = v_t4) <> v_ctid then
    raise exception '7. fiche « refus » réécrite (la branche refus efface le numéro)'; end if;
  if exists (select 1 from public.trainee_info_sheets where trainee_id = v_t4 and (ssn_present or not ssn_refused)) then
    raise exception '7. fiche « refus » modifiée'; end if;

  -- 9. Chemin du portail (save_trainee_info : insert ... on conflict do update) pour un stagiaire à deux fiches
  insert into public.trainee_info_sheets (session_id, trainee_id, ssn, ssn_refused, filled_online)
    values (v_s, v_t5, '185057800608436', false, true)
    on conflict (session_id, trainee_id) do update set ssn = excluded.ssn, ssn_refused = excluded.ssn_refused, filled_online = excluded.filled_online;
  if exists (select 1 from public.trainee_info_sheets where trainee_id = v_t5 and not ssn_present) then
    raise exception '9. fiches non alignées après une saisie au portail'; end if;
  if not (select ssn_present from public.trainees where id = v_t5) then raise exception '9. stagiaire sans numéro'; end if;

  -- 8. Recopie vers les fiches une seule fois (déclencheur en double retiré)
  if (select count(*) from pg_trigger where tgrelid = 'public.trainees'::regclass and not tgisinternal
        and tgfoid = 'public.sync_trainee_to_info_sheets'::regproc) <> 1 then
    raise exception '8. recopie vers les fiches déclenchée plusieurs fois'; end if;
end
$$;

rollback;
