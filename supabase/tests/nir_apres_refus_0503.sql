-- Essai de 0503 : numéro saisi sur la fiche de renseignements après un refus. Rouge sans 0503 (numéro effacé).
-- Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_c uuid; v_s uuid; v_s2 uuid; v_t uuid; v_fin text;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.courses (title, company_id) values ('Formation essai 0503', v_cie) returning id into v_c;
  insert into public.sessions (reference, course_id, start_date, end_date, company_id)
    values ('ESSAI-0503', v_c, current_date + 10, current_date + 10, v_cie) returning id into v_s;
  insert into public.sessions (reference, course_id, start_date, end_date, company_id)
    values ('ESSAI-0503-B', v_c, current_date + 20, current_date + 20, v_cie) returning id into v_s2;
  insert into public.trainees (first_name, last_name, company_id) values ('Essai', 'NIR', v_cie) returning id into v_t;
  insert into public.session_trainees (session_id, trainee_id) values (v_s, v_t), (v_s2, v_t);
  if (select count(*) from public.trainee_info_sheets where trainee_id = v_t) <> 2 then raise exception '0. fiches non créées'; end if;

  -- 1. Refus sur la fiche
  update public.trainee_info_sheets set ssn_refused = true, ssn = null where session_id = v_s and trainee_id = v_t;
  if exists (select 1 from public.trainee_ssn where trainee_id = v_t) then raise exception '1. numéro présent après refus'; end if;
  if not (select refused_ssn from public.trainees where id = v_t) then raise exception '1. refus non reporté au stagiaire'; end if;

  -- 2. Nouvelle saisie du numéro, refus décoché (ce qu'envoie le portail)
  update public.trainee_info_sheets set ssn_refused = false, ssn = '1 85 05 78 006 084 36' where session_id = v_s and trainee_id = v_t;
  select fin into v_fin from public.trainee_ssn where trainee_id = v_t;
  if v_fin is distinct from '436' then raise exception '2. numéro perdu après un refus (fin = %)', coalesce(v_fin, 'aucune'); end if;
  if (select ssn from public.trainee_ssn where trainee_id = v_t) is not null then raise exception '2. numéro en clair'; end if;
  if (select refused_ssn from public.trainees where id = v_t) then raise exception '2. refus resté sur le stagiaire'; end if;
  if not (select ssn_present from public.trainees where id = v_t) then raise exception '2. stagiaire sans numéro'; end if;
  if exists (select 1 from public.trainee_info_sheets where trainee_id = v_t and (ssn_refused or not ssn_present)) then
    raise exception '2. fiches non alignées'; end if;
  if exists (select 1 from public.trainee_info_sheets where trainee_id = v_t and ssn is not null) then raise exception '2. numéro en clair sur une fiche'; end if;

  -- 3. Correction du numéro sur l'autre fiche : remplacé, pas perdu
  update public.trainee_info_sheets set ssn = '2 90 01 75 112 233 18' where session_id = v_s2 and trainee_id = v_t;
  if (select fin from public.trainee_ssn where trainee_id = v_t) is distinct from '318' then raise exception '3. correction ignorée'; end if;

  -- 4. Nouveau refus : numéro effacé
  update public.trainee_info_sheets set ssn_refused = true where session_id = v_s2 and trainee_id = v_t;
  if exists (select 1 from public.trainee_ssn where trainee_id = v_t) then raise exception '4. numéro gardé après un nouveau refus'; end if;
  if (select ssn_present from public.trainees where id = v_t) then raise exception '4. stagiaire encore avec numéro'; end if;
end
$$;

rollback;
