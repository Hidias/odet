-- Essai local de 0486 : analyse du besoin remplie depuis l'espace entreprise, relue et validée par l'organisme.
-- Sessions montrées (intra du client seulement), réponses obligatoires, adaptation sans détail de santé,
-- notification unique, validation qui exige l'analyse de l'organisme et ferme la saisie du client.
begin;
set local client_min_messages = warning;
do $$
declare
  v_cie uuid; v_a uuid; v_b uuid; v_ua uuid := gen_random_uuid(); v_ub uuid := gen_random_uuid();
  v_intra uuid; v_inter uuid; v_annulee uuid; v_passee uuid; v_autre uuid; v_interne uuid;
  v_r jsonb; v_ok boolean; v_n int; v_l record;
  v_bon jsonb := '{"context_reasons":["reglementation","autre"],"context_other":"Audit interne","objectives_description":"Savoir réagir en cas d''incendie",
                  "participants_count":"8","participants_profiles":["production"],"level":"debutant","psh_adaptation":false,"psh_contact":"ne pas garder",
                  "company_equipment":true,"company_equipment_details":"Extincteurs","ppe_provided":true}';
  v_staff text := '{"sub":"00000000-0000-4000-8000-000000000486","role":"authenticated"}';
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Client A 0486', v_cie) returning id into v_a;
  insert into public.clients (name, company_id) values ('Client B 0486', v_cie) returning id into v_b;
  insert into public.sessions (reference, client_id, session_type, start_date, end_date, attendance_token, company_id)
    values ('E0486-INTRA', v_a, 'intra', current_date + 10, current_date + 10, 'j0486a', v_cie) returning id into v_intra;
  insert into public.sessions (reference, client_id, session_type, start_date, end_date, attendance_token, company_id)
    values ('E0486-INTER', v_a, 'inter', current_date + 10, current_date + 10, 'j0486b', v_cie) returning id into v_inter;
  insert into public.sessions (reference, client_id, session_type, status, start_date, end_date, attendance_token, company_id)
    values ('E0486-ANN', v_a, 'intra', 'cancelled', current_date + 10, current_date + 10, 'j0486c', v_cie) returning id into v_annulee;
  insert into public.sessions (reference, client_id, session_type, start_date, end_date, attendance_token, company_id)
    values ('E0486-PASSEE', v_a, 'intra', current_date - 10, current_date - 10, 'j0486d', v_cie) returning id into v_passee;
  insert into public.sessions (reference, client_id, session_type, start_date, end_date, attendance_token, company_id)
    values ('E0486-INTERNE', v_a, 'intra', current_date + 20, current_date + 20, 'j0486f', v_cie) returning id into v_interne;
  insert into public.sessions (reference, client_id, session_type, start_date, end_date, attendance_token, company_id)
    values ('E0486-B', v_b, 'intra', current_date + 10, current_date + 10, 'j0486e', v_cie) returning id into v_autre;
  insert into public.session_needs_analysis (session_id, objectives_description, filled_at, particularities_psh)
    values (v_interne, 'Fait au téléphone', now(), 'DETAIL-SANTE-0486');

  insert into auth.users (id, email, aud, role) values (v_ua, 'a0486@exemple.invalid', 'authenticated', 'authenticated'), (v_ub, 'b0486@exemple.invalid', 'authenticated', 'authenticated');
  alter table public.profiles disable trigger profiles_protect_role;
  insert into public.profiles (id, email, role, is_active) values (v_ua, 'a0486@exemple.invalid', 'entreprise', true), (v_ub, 'b0486@exemple.invalid', 'entreprise', true)
    on conflict (id) do update set role = 'entreprise', is_active = true;
  alter table public.profiles enable trigger profiles_protect_role;
  insert into public.client_accounts (company_id, profile_id, client_id) values (v_cie, v_ua, v_a), (v_cie, v_ub, v_b);

  -- 1. Liste : intra à venir du client et analyse faite par l'organisme ; ni inter, ni annulée, ni passée vide, ni autre client
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_r := public.ent_besoins();
  if jsonb_array_length(v_r) <> 2 or v_r -> 0 ->> 'reference' <> 'E0486-INTRA' or v_r -> 0 ->> 'etat' <> 'a_completer'
     or not (v_r -> 0 ->> 'modifiable')::boolean then raise exception '1. liste : %', v_r; end if;
  if v_r -> 1 ->> 'etat' <> 'organisme' or (v_r -> 1 ->> 'modifiable')::boolean then raise exception '1. analyse interne : %', v_r -> 1; end if;
  if v_r::text like '%DETAIL-SANTE-0486%' then raise exception '1. détail de santé renvoyé à l''entreprise'; end if;

  -- 2. Réponses incomplètes refusées
  begin perform public.ent_besoin_enregistrer(v_intra, v_bon - 'psh_adaptation'); v_ok := true; exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '2. adaptation sans réponse acceptée'; end if;
  begin perform public.ent_besoin_enregistrer(v_intra, v_bon || '{"psh_adaptation":true,"psh_contact":" "}'); v_ok := true; exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '2. adaptation sans contact acceptée'; end if;
  begin perform public.ent_besoin_enregistrer(v_intra, v_bon || '{"objectives_description":""}'); v_ok := true; exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '2. attentes vides acceptées'; end if;
  begin perform public.ent_besoin_enregistrer(v_intra, v_bon || '{"level":"expert"}'); v_ok := true; exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '2. niveau inconnu accepté'; end if;
  begin perform public.ent_besoin_enregistrer(v_intra, v_bon || '{"participants_count":"0"}'); v_ok := true; exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '2. zéro participant accepté'; end if;

  -- 3. Envoi correct : état « à valider », contact effacé quand pas d'adaptation, une notification
  perform public.ent_besoin_enregistrer(v_intra, v_bon);
  perform public.ent_besoin_enregistrer(v_intra, v_bon || '{"participants_count":"9"}');
  perform set_config('role', 'postgres', true);
  select * into v_l from public.session_needs_analysis where session_id = v_intra;
  if v_l.analysis_date is distinct from public.paris_today() then raise exception '3. date d''analyse : %', v_l.analysis_date; end if;
  if v_l.client_submitted_by <> v_ua or v_l.participants_count <> 9 or v_l.psh_adaptation or v_l.psh_contact is not null
     or v_l.context_other <> 'Audit interne' or v_l.company_id <> v_cie or v_l.filled_at is not null then
    raise exception '3. ligne enregistrée : %', to_jsonb(v_l); end if;
  select count(*) into v_n from public.notifications where type = 'besoin_a_valider' and metadata ->> 'session_id' = v_intra::text;
  if v_n <> 1 then raise exception '3. % notifications (1 attendue)', v_n; end if;

  -- 4. Autre client, session inter, annulée ou passée : refusées
  perform set_config('request.jwt.claims', json_build_object('sub', v_ub, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin perform public.ent_besoin_enregistrer(v_intra, v_bon); v_ok := true; exception when insufficient_privilege then v_ok := false; end;
  if v_ok then raise exception '4. session d''un autre client modifiée'; end if;
  if jsonb_array_length(public.ent_besoins()) <> 1 then raise exception '4. le client B voit autre chose que sa session'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  begin perform public.ent_besoin_enregistrer(v_inter, v_bon); v_ok := true; exception when insufficient_privilege then v_ok := false; end;
  if v_ok then raise exception '4. inter acceptée'; end if;
  begin perform public.ent_besoin_enregistrer(v_annulee, v_bon); v_ok := true; exception when insufficient_privilege then v_ok := false; end;
  if v_ok then raise exception '4. session annulée acceptée'; end if;
  begin perform public.ent_besoin_enregistrer(v_passee, v_bon); v_ok := true; exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '4. session passée acceptée'; end if;
  begin perform public.ent_besoin_enregistrer(v_interne, v_bon); v_ok := true; exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '4. analyse faite par l''organisme écrasée'; end if;

  -- 5. Le compte entreprise n'a aucun accès direct à la table
  begin perform 1 from public.session_needs_analysis limit 1; v_ok := true; exception when insufficient_privilege then v_ok := false; end;
  if v_ok and exists (select 1 from public.session_needs_analysis) then raise exception '5. table lisible par le compte entreprise'; end if;
  perform set_config('role', 'postgres', true);

  -- 6. Validation sans analyse de l'organisme refusée ; avec, auteur posé par la base
  perform set_config('request.jwt.claims', v_staff, true);
  begin update public.session_needs_analysis set org_validated_at = now() where session_id = v_intra; v_ok := true; exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '6. validation sans analyse acceptée'; end if;
  -- l'origine « entreprise » ne s'efface pas
  begin update public.session_needs_analysis set client_submitted_at = null where session_id = v_intra; v_ok := true; exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '6. réponse de l''entreprise transformée en analyse interne'; end if;
  update public.session_needs_analysis set org_conclusion = 'Besoin confirmé, exercice sur site', org_validated_at = '2020-01-01', org_validated_by = gen_random_uuid() where session_id = v_intra;
  select * into v_l from public.session_needs_analysis where session_id = v_intra;
  if v_l.org_validated_by <> '00000000-0000-4000-8000-000000000486'::uuid then raise exception '6. auteur de la validation : %', v_l.org_validated_by; end if;
  if v_l.org_validated_at < now() - interval '1 minute' then raise exception '6. date de validation antidatée : %', v_l.org_validated_at; end if;
  begin update public.session_needs_analysis set objectives_description = 'Changé après validation' where session_id = v_intra; v_ok := true; exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '6. analyse validée modifiée sans réouverture'; end if;
  update public.session_needs_analysis set signature_trainer = 'data:image/png;base64,AA' where session_id = v_intra;
  begin update public.session_needs_analysis set org_conclusion = '' where session_id = v_intra; v_ok := true; exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '6. analyse validée effacée'; end if;
  update public.session_needs_analysis set org_validated_at = now() + interval '1 day' where session_id = v_intra;
  if (select org_validated_at from public.session_needs_analysis where session_id = v_intra) <> v_l.org_validated_at then raise exception '6. date de validation réécrite'; end if;

  -- 7. Validée : l'entreprise la voit validée et ne peut plus la modifier
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_r := public.ent_besoins() -> 0;
  if v_r ->> 'etat' <> 'validee' or (v_r ->> 'modifiable')::boolean or (v_r -> 'reponses' ->> 'participants_count')::int <> 9 then raise exception '7. état : %', v_r; end if;
  if v_r::text like '%Besoin confirmé%' then raise exception '7. analyse interne renvoyée à l''entreprise'; end if;
  begin perform public.ent_besoin_enregistrer(v_intra, v_bon); v_ok := true; exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '7. analyse validée modifiée par l''entreprise'; end if;

  -- 8. Rouverte par l'organisme : l'auteur s'efface, l'entreprise peut corriger
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', v_staff, true);
  update public.session_needs_analysis set org_validated_at = null where session_id = v_intra;
  if (select org_validated_by from public.session_needs_analysis where session_id = v_intra) is not null then raise exception '8. auteur resté'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.ent_besoin_enregistrer(v_intra, v_bon || '{"psh_adaptation":true,"psh_contact":"Mme Martin, 02 00 00 00 00"}');
  perform set_config('role', 'postgres', true);
  if (select psh_contact from public.session_needs_analysis where session_id = v_intra) <> 'Mme Martin, 02 00 00 00 00' then raise exception '8. correction non enregistrée'; end if;

  -- 9. L'organisme reprend l'analyse après l'envoi : l'entreprise ne peut plus écraser ses corrections
  -- (envoi daté d'une heure plus tôt : dans un même essai, now() ne bouge pas) ; date de l'ordinateur ignorée
  update public.session_needs_analysis set client_submitted_at = now() - interval '1 hour' where session_id = v_intra;
  update public.session_needs_analysis set objectives_description = 'Corrigé par l''organisme', filled_at = '2000-01-01' where session_id = v_intra;
  if (select filled_at from public.session_needs_analysis where session_id = v_intra) <> now() then raise exception '9. date de reprise prise sur l''ordinateur'; end if;
  perform set_config('role', 'authenticated', true);
  if (public.ent_besoins() -> 0 ->> 'modifiable')::boolean then raise exception '9. encore modifiable par l''entreprise'; end if;
  begin perform public.ent_besoin_enregistrer(v_intra, v_bon); v_ok := true; exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '9. corrections de l''organisme écrasées'; end if;
  perform set_config('role', 'postgres', true);
  if (select objectives_description from public.session_needs_analysis where session_id = v_intra) <> 'Corrigé par l''organisme' then raise exception '9. correction perdue'; end if;

  raise warning 'ESSAI 0486 : OK';
end
$$;
rollback;
