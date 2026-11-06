-- Essai de 0495 : formateurs d'une session. La confirmation garde les autres formateurs et ne retire que l'ancien
-- principal ; les lignes de session_trainers partent avec la session ou le formateur ; une ligne sans session ou sans
-- formateur est refusée. Sans 0495 : le formateur B disparaît à la confirmation (étape 1).
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_a uuid; v_b uuid; v_c uuid; v_s uuid; v_s2 uuid; v_liste text; v_refus boolean;
  v_data jsonb;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.trainers (first_name, last_name, is_internal, company_id) values ('Essai', 'ALPHA', true, v_cie) returning id into v_a;
  insert into public.trainers (first_name, last_name, is_internal, company_id) values ('Essai', 'BRAVO', true, v_cie) returning id into v_b;
  insert into public.trainers (first_name, last_name, is_internal, company_id) values ('Essai', 'CHARLIE', true, v_cie) returning id into v_c;
  insert into public.sessions (reference, start_date, end_date, trainer_id, validation_requise, company_id)
    values ('ESSAI-0495-1', current_date + 30, current_date + 30, v_a, true, v_cie) returning id into v_s;
  insert into public.session_trainers (session_id, trainer_id) values (v_s, v_a), (v_s, v_b);
  v_data := jsonb_build_object('start_date', current_date + 30, 'start_time', '09:00', 'end_time', '17:00',
    'location_name', 'Salle essai', 'max_participants', 8, 'trainer_id', v_c);

  -- 1. Confirmation avec un nouveau principal C : A (ancien principal) part, B (autre formateur) reste, C arrive
  perform app.session_appliquer(v_s, v_data);
  select string_agg(t.last_name, ',' order by t.last_name) into v_liste
    from public.session_trainers st join public.trainers t on t.id = st.trainer_id where st.session_id = v_s;
  if v_liste is distinct from 'BRAVO,CHARLIE' then raise exception '1. formateurs après changement de principal : % (attendu BRAVO,CHARLIE)', v_liste; end if;
  if (select trainer_id from public.sessions where id = v_s) <> v_c then raise exception '2. principal non posé'; end if;

  -- 2. Nouvelle confirmation, même principal : rien ne part
  perform app.session_appliquer(v_s, v_data);
  select string_agg(t.last_name, ',' order by t.last_name) into v_liste
    from public.session_trainers st join public.trainers t on t.id = st.trainer_id where st.session_id = v_s;
  if v_liste is distinct from 'BRAVO,CHARLIE' then raise exception '3. formateurs après confirmation identique : %', v_liste; end if;

  -- 3. Formateur supprimé : ses lignes partent avec lui
  insert into public.sessions (reference, start_date, end_date, trainer_id, company_id)
    values ('ESSAI-0495-2', current_date + 40, current_date + 40, v_c, v_cie) returning id into v_s2;
  insert into public.session_trainers (session_id, trainer_id) values (v_s2, v_c), (v_s2, v_b);
  delete from public.trainers where id = v_b;
  if exists (select 1 from public.session_trainers where trainer_id = v_b) then raise exception '4. lignes du formateur supprimé restées'; end if;
  if (select count(*) from public.session_trainers where session_id in (v_s, v_s2)) <> 2 then raise exception '5. lignes des autres formateurs touchées'; end if;

  -- 4. Session supprimée : ses lignes partent avec elle, celles de l'autre session restent
  delete from public.sessions where id = v_s;
  if exists (select 1 from public.session_trainers where session_id = v_s) then raise exception '6. lignes de la session supprimée restées'; end if;
  if not exists (select 1 from public.session_trainers where session_id = v_s2 and trainer_id = v_c) then raise exception '7. ligne d''une autre session retirée'; end if;

  -- 5. Ligne sans session ou sans formateur existant : refusée
  v_refus := false;
  begin
    insert into public.session_trainers (session_id, trainer_id) values (gen_random_uuid(), v_c);
  exception when foreign_key_violation then v_refus := true;
  end;
  if not v_refus then raise exception '8. ligne sans session acceptée'; end if;
  v_refus := false;
  begin
    insert into public.session_trainers (session_id, trainer_id) values (v_s2, gen_random_uuid());
  exception when foreign_key_violation then v_refus := true;
  end;
  if not v_refus then raise exception '9. ligne sans formateur acceptée'; end if;

  -- 6. Droits inchangés, migration inscrite
  if has_function_privilege('anon', 'app.session_appliquer(uuid,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'app.session_appliquer(uuid,jsonb)', 'execute') then
    raise exception '10. fonction ouverte à anon ou authenticated';
  end if;
  if not exists (select 1 from public.schema_migrations where version = '0495_formateurs_session_cles') then
    raise exception '11. 0495 non inscrite';
  end if;
end $$;
rollback;
