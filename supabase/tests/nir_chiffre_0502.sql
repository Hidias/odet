-- Essai propre de 0502 : numéro de sécurité sociale chiffré dans trainee_ssn, jamais en clair, lisible par la seule
-- reprise du Passeport (clé de service).
begin;
set local client_min_messages = warning;
do $$
declare
  v_cie uuid; v_cli uuid; v_se uuid; v_t uuid; v_t2 uuid; v_r json; v_nir text := '185057800608441'; v_ok boolean;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, client_type, company_id) values ('Client 0502', 'entreprise', v_cie) returning id into v_cli;
  insert into public.sessions (reference, client_id, start_date, end_date, attendance_token, company_id, status)
  values ('SES-0502', v_cli, current_date, current_date, 'jeton-0502', v_cie, 'in_progress') returning id into v_se;

  -- 1. Saisie par la fiche du stagiaire (déclencheur trainee_ssn_capture) : chiffré, colonne en clair vide
  insert into public.trainees (first_name, last_name, client_id, company_id, social_security_number)
  values ('Anne', 'Nir', v_cli, v_cie, '185057800608441') returning id into v_t;
  if not exists (select 1 from public.trainee_ssn where trainee_id = v_t and ssn is null and ssn_chiffre is not null and fin = '441') then
    raise exception '1. numéro non chiffré : %', (select row_to_json(s) from public.trainee_ssn s where trainee_id = v_t);
  end if;
  if position(v_nir in encode(coalesce((select ssn_chiffre from public.trainee_ssn where trainee_id = v_t), ''::bytea), 'escape')) > 0 then
    raise exception '1. numéro lisible dans la colonne chiffrée';
  end if;

  -- 2. Saisie par la fiche de renseignements (déclencheur info_sheet_ssn_capture)
  insert into public.trainees (first_name, last_name, client_id, company_id) values ('Bob', 'Fiche', v_cli, v_cie) returning id into v_t2;
  insert into public.session_trainees (session_id, trainee_id) values (v_se, v_t), (v_se, v_t2);
  insert into public.trainee_info_sheets (session_id, trainee_id, ssn) values (v_se, v_t2, '2 99 12 75 123 456 78')
  on conflict (session_id, trainee_id) do update set ssn = excluded.ssn;
  if not exists (select 1 from public.trainee_ssn where trainee_id = v_t2 and ssn is null and fin = '678') then
    raise exception '2. fiche de renseignements : numéro non chiffré';
  end if;

  -- 3. Écrire en clair directement : chiffré quand même ; contrainte : jamais de numéro en clair
  update public.trainee_ssn set ssn = '199127512345678' where trainee_id = v_t2;
  if (select ssn is not null or fin <> '678' from public.trainee_ssn where trainee_id = v_t2) then raise exception '3. mise à jour en clair'; end if;

  -- 4. Reprise du Passeport : numéros déchiffrés, réservée à la clé de service
  if (select ssn from public.trainee_ssn_a_reprendre() where trainee_id = v_t) <> v_nir then raise exception '4. déchiffrement faux'; end if;
  if (select ssn from public.trainee_ssn_a_reprendre() where trainee_id = v_t2) <> '199127512345678' then raise exception '4. déchiffrement de la fiche faux'; end if;
  if has_function_privilege('anon', 'public.trainee_ssn_a_reprendre()', 'execute')
     or has_function_privilege('authenticated', 'public.trainee_ssn_a_reprendre()', 'execute')
     or not has_function_privilege('service_role', 'public.trainee_ssn_a_reprendre()', 'execute')
     or has_function_privilege('authenticated', 'app.ssn_cle()', 'execute') then
    raise exception '4. droits de lecture du numéro';
  end if;

  -- 5. Lectures inchangées pour l'écran : trois derniers chiffres seulement
  update public.session_trainees set access_code = null where session_id = v_se and trainee_id = v_t;
  v_r := public.load_trainee_data('jeton-0502', v_t, null);
  if not (v_r -> 'info_sheet' ->> 'ssn_on_file')::boolean or v_r -> 'info_sheet' ->> 'ssn_last3' <> '441' or v_r -> 'info_sheet' ->> 'ssn' is not null then
    raise exception '5. portail : %', v_r -> 'info_sheet';
  end if;
  -- fiche stagiaire (compte super administrateur, s'il en existe un dans la base d'essai)
  if exists (select 1 from public.profiles where role = 'superadmin') then
    perform set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role = 'superadmin' limit 1), 'role', 'authenticated')::text, true);
    if (select social_security_number from public.get_trainee_with_ssn(v_t)) is distinct from '••••••••••••441' then
      raise exception '5. fiche stagiaire : %', (select social_security_number from public.get_trainee_with_ssn(v_t));
    end if;
    perform set_config('request.jwt.claims', '', true);
  end if;

  -- 6. Refus du numéro : effacé
  update public.trainees set refused_ssn = true where id = v_t;
  if exists (select 1 from public.trainee_ssn where trainee_id = v_t) then raise exception '6. numéro refusé gardé'; end if;
end $$;
rollback;
