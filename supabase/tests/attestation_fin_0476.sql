-- Essai local de 0476 : attestation de fin de formation figée avec ses objectifs ; espace stagiaire limité à ses
-- seules versions émises ; un compte qui n'est pas stagiaire est refusé.
begin;
set local client_min_messages = warning;
do $$
declare
  v_cie uuid; v_co uuid; v_s uuid; v_a uuid; v_b uuid; v_ua uuid := gen_random_uuid(); v_ux uuid := gen_random_uuid();
  v_r jsonb; v_ok boolean;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.courses (title, objectives, company_id) values ('Formation 0476', E'Objectif un\nObjectif deux', v_cie) returning id into v_co;
  insert into public.sessions (reference, start_date, end_date, course_id, company_id)
  values ('SES-0476', current_date - 3, current_date - 2, v_co, v_cie) returning id into v_s;
  insert into public.trainees (first_name, last_name, company_id) values ('Alice', 'ESSAI', v_cie) returning id into v_a;
  insert into public.trainees (first_name, last_name, company_id) values ('Bruno', 'ESSAI', v_cie) returning id into v_b;
  insert into public.session_trainees (session_id, trainee_id) values (v_s, v_a), (v_s, v_b);

  -- Une attestation de fin de formation sans objectifs ni résultat est refusée
  v_ok := false;
  begin
    insert into public.training_documents_issued (session_id, trainee_id, kind, version, issued_on, result)
    values (v_s, v_a, 'fin_formation', 1, current_date - 2, 'acquired');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'attestation sans objectifs acceptée'; end if;

  v_ok := false;
  begin
    insert into public.training_documents_issued (session_id, trainee_id, kind, version, issued_on, objectives)
    values (v_s, v_a, 'fin_formation', 1, current_date - 2, '[{"texte":"Objectif un","acquis":true}]');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'attestation sans résultat global acceptée'; end if;

  -- Version 1 de chacun, avec ses objectifs ; un certificat de Bruno à côté
  insert into public.training_documents_issued (session_id, trainee_id, kind, version, issued_on, hours, result, objectives)
  values (v_s, v_a, 'fin_formation', 1, current_date - 2, 14, 'acquired', '[{"texte":"Objectif un","acquis":true},{"texte":"Objectif deux","acquis":true}]'),
         (v_s, v_b, 'fin_formation', 1, current_date - 2, 7, 'not_acquired', '[{"texte":"Objectif un","acquis":true},{"texte":"Objectif deux","acquis":false}]'),
         (v_s, v_b, 'certificat', 1, current_date - 2, 7, 'not_acquired', null);

  -- Les anciens types restent valides sans objectifs
  if (select count(*) from public.training_documents_issued where session_id = v_s) <> 3 then raise exception 'insertions'; end if;

  -- Espace stagiaire d'Alice : ses seules versions, objectifs compris
  insert into auth.users (id, email, aud, role) values (v_ua, 'alice-0476@exemple.invalid', 'authenticated', 'authenticated'),
                                                       (v_ux, 'autre-0476@exemple.invalid', 'authenticated', 'authenticated');
  -- Le profil naît avec le compte (déclencheur) : on le relie
  insert into public.profiles (id, email) values (v_ua, 'alice-0476@exemple.invalid'), (v_ux, 'autre-0476@exemple.invalid') on conflict (id) do nothing;
  if exists (select 1 from pg_trigger where tgname = 'profiles_protect_role') then
    execute 'alter table public.profiles disable trigger profiles_protect_role';
  end if;
  update public.profiles set role = 'stagiaire', is_active = true, trainee_id = v_a where id = v_ua;
  update public.profiles set role = 'entreprise', is_active = true where id = v_ux;
  if exists (select 1 from pg_trigger where tgname = 'profiles_protect_role') then
    execute 'alter table public.profiles enable trigger profiles_protect_role';
  end if;

  perform set_config('request.jwt.claim.sub', v_ua::text, true);
  execute 'set local role authenticated';
  v_r := public.stg_documents_emis();
  execute 'reset role';
  if jsonb_array_length(v_r) <> 1 then raise exception 'stagiaire : % ligne(s) au lieu de 1', jsonb_array_length(v_r); end if;
  if (v_r->0->>'trainee_id')::uuid <> v_a then raise exception 'stagiaire : document d''un autre'; end if;
  if jsonb_array_length(v_r->0->'objectives') <> 2 then raise exception 'stagiaire : objectifs absents'; end if;
  if v_r->0 ? 'reason' or v_r->0 ? 'issued_by' then raise exception 'stagiaire : motif ou auteur exposé'; end if;

  -- Un compte qui n'est pas stagiaire est refusé
  v_ok := false;
  perform set_config('request.jwt.claim.sub', v_ux::text, true);
  execute 'set local role authenticated';
  begin
    v_r := public.stg_documents_emis();
  exception when insufficient_privilege then v_ok := true;
  end;
  execute 'reset role';
  if not v_ok then raise exception 'compte non stagiaire accepté'; end if;

  -- Personne d'anonyme
  if has_function_privilege('anon', 'public.stg_documents_emis()', 'execute') then raise exception 'anon peut appeler'; end if;

  raise warning 'ESSAI 0476 : OK';
end
$$;
rollback;
