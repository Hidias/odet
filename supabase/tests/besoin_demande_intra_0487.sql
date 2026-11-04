-- Essai local de 0487 : besoin décrit dans la demande « Formation intra », recopié à la création de la session
-- quand une seule demande correspond, sinon repris au choix de l'organisme. Rien ne bloque la création d'une session.
begin;
set local client_min_messages = warning;
do $$
declare
  v_cie uuid; v_a uuid; v_b uuid; v_ua uuid := gen_random_uuid(); v_ub uuid := gen_random_uuid(); v_co uuid; v_co2 uuid;
  v_d1 uuid; v_d2 uuid; v_d3 uuid; v_db uuid; v_dref uuid; v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_r record; v_ok boolean; v_n int;
  v_bon jsonb := '{"context_reasons":["autre","reglementation"],"context_other":"Audit","objectives_description":"Évacuer en sécurité",
                  "participants_count":"6","participants_profiles":["terrain"],"psh_adaptation":true,"psh_contact":"M. Durand"}';
  v_sa text := '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Client A 0487', v_cie) returning id into v_a;
  insert into public.clients (name, company_id) values ('Client B 0487', v_cie) returning id into v_b;
  insert into public.courses (title, company_id) values ('Formation 0487', v_cie) returning id into v_co;
  insert into public.courses (title, company_id) values ('Autre formation 0487', v_cie) returning id into v_co2;
  insert into auth.users (id, email, aud, role) values (v_ua, 'a0487@exemple.invalid', 'authenticated', 'authenticated'), (v_ub, 'b0487@exemple.invalid', 'authenticated', 'authenticated');
  alter table public.profiles disable trigger profiles_protect_role;
  insert into public.profiles (id, email, role, is_active) values (v_ua, 'a0487@exemple.invalid', 'entreprise', true), (v_ub, 'b0487@exemple.invalid', 'entreprise', true)
    on conflict (id) do update set role = 'entreprise', is_active = true;
  alter table public.profiles enable trigger profiles_protect_role;
  insert into public.client_accounts (company_id, profile_id, client_id) values (v_cie, v_ua, v_a), (v_cie, v_ub, v_b);

  -- 1. Demande intra : besoin contrôlé et rangé normalisé ; refusé s'il est incomplet ; retiré des autres demandes
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin perform public.ent_demander('demande_intra', null, null, v_co, jsonb_build_object('besoin', v_bon - 'psh_adaptation')); v_ok := true;
  exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '1. besoin incomplet accepté'; end if;
  v_d1 := public.ent_demander('demande_intra', null, null, v_co, jsonb_build_object('effectif', '6', 'besoin', v_bon));
  v_d2 := public.ent_demander('demande_intra', 'Sans besoin', null, null, jsonb_build_object('besoin', null));
  v_d3 := public.ent_demander('message', 'Bonjour', null, null, jsonb_build_object('besoin', v_bon));
  perform set_config('role', 'postgres', true);
  select payload into v_r from public.client_requests where id = v_d1;
  if (v_r.payload -> 'besoin' ->> 'participants_count')::int <> 6 or v_r.payload -> 'besoin' -> 'context_reasons' <> '["autre", "reglementation"]'::jsonb
     or v_r.payload ->> 'effectif' <> '6' then raise exception '1. besoin rangé : %', v_r.payload; end if;
  if (select payload ? 'besoin' from public.client_requests where id = v_d2) or (select payload ? 'besoin' from public.client_requests where id = v_d3) then
    raise exception '1. besoin gardé hors demande intra ou vide'; end if;

  -- 2. Session d'une autre formation, inter ou annulée : rien n'est recopié
  insert into public.sessions (reference, client_id, course_id, session_type, start_date, end_date, attendance_token, company_id)
    values ('E0487-AUTRE', v_a, v_co2, 'intra', current_date + 5, current_date + 5, 'j0487a', v_cie) returning id into v_s1;
  insert into public.sessions (reference, client_id, course_id, session_type, start_date, end_date, attendance_token, company_id)
    values ('E0487-INTER', v_a, v_co, 'inter', current_date + 5, current_date + 5, 'j0487b', v_cie);
  insert into public.sessions (reference, client_id, course_id, session_type, status, start_date, end_date, attendance_token, company_id)
    values ('E0487-ANN', v_a, v_co, 'intra', 'cancelled', current_date + 5, current_date + 5, 'j0487f', v_cie);
  if exists (select 1 from public.session_needs_analysis a join public.sessions s on s.id = a.session_id where s.reference in ('E0487-AUTRE', 'E0487-INTER', 'E0487-ANN')) then
    raise exception '2. besoin recopié sur une autre formation, une inter ou une session annulée'; end if;

  -- 3. Session intra de la même formation : une seule demande possible, besoin recopié et demande reliée
  insert into public.sessions (reference, client_id, course_id, session_type, start_date, end_date, attendance_token, company_id)
    values ('E0487-INTRA', v_a, v_co, 'intra', current_date + 10, current_date + 10, 'j0487c', v_cie) returning id into v_s2;
  select * into v_r from public.session_needs_analysis where session_id = v_s2;
  if v_r.id is null then raise exception '3. besoin non recopié'; end if;
  if v_r.client_submitted_at <> (select created_at from public.client_requests where id = v_d1) or v_r.client_submitted_by <> v_ua
     or v_r.psh_contact <> 'M. Durand' or v_r.context_other <> 'Audit' or v_r.participants_count <> 6 or v_r.org_validated_at is not null
     or v_r.filled_at is not null or v_r.company_id <> v_cie or v_r.analysis_date <> public.paris_today() then raise exception '3. analyse recopiée : %', to_jsonb(v_r); end if;
  if (select session_id from public.client_requests where id = v_d1) <> v_s2 then raise exception '3. demande non reliée'; end if;
  -- l'entreprise la voit envoyée et peut encore la modifier
  perform set_config('role', 'authenticated', true);
  if (select x ->> 'etat' from jsonb_array_elements(public.ent_besoins()) x where x ->> 'session_id' = v_s2::text) <> 'a_valider' then
    raise exception '3. état dans l''espace'; end if;
  perform set_config('role', 'postgres', true);

  -- 4. Deux demandes possibles : rien n'est recopié, l'organisme choisit
  perform set_config('role', 'authenticated', true);
  v_d1 := public.ent_demander('demande_intra', null, null, v_co, jsonb_build_object('besoin', v_bon));
  v_d2 := public.ent_demander('demande_intra', null, null, v_co, jsonb_build_object('besoin', v_bon || '{"participants_count":"3"}'));
  v_dref := public.ent_demander('demande_intra', null, null, v_co, jsonb_build_object('besoin', v_bon));
  perform set_config('request.jwt.claims', json_build_object('sub', v_ub, 'role', 'authenticated')::text, true);
  v_db := public.ent_demander('demande_intra', null, null, null, jsonb_build_object('besoin', v_bon));
  perform set_config('role', 'postgres', true);
  insert into public.sessions (reference, client_id, course_id, session_type, start_date, end_date, attendance_token, company_id)
    values ('E0487-DEUX', v_a, v_co, 'intra', current_date + 12, current_date + 12, 'j0487d', v_cie) returning id into v_s3;
  if exists (select 1 from public.session_needs_analysis where session_id = v_s3) then raise exception '4. copie malgré deux demandes'; end if;
  -- demande refusée : jamais reprise ; demande sans formation ou trop ancienne : jamais recopiée seule
  update public.client_requests set status = 'refusee' where id = v_dref;
  update public.client_requests set course_id = null where id = v_d1;
  alter table public.client_requests disable trigger client_requests_maj;  -- la date de création est figée par 0046
  update public.client_requests set created_at = now() - interval '7 months' where id = v_d2;
  insert into public.sessions (reference, client_id, course_id, session_type, start_date, end_date, attendance_token, company_id)
    values ('E0487-SEULE', v_a, v_co, 'intra', current_date + 20, current_date + 20, 'j0487g', v_cie) returning id into v_s4;
  if exists (select 1 from public.session_needs_analysis where session_id = v_s4) then raise exception '4. demande sans formation, ancienne ou refusée recopiée'; end if;
  update public.client_requests set created_at = now() where id = v_d2;
  alter table public.client_requests enable trigger client_requests_maj;

  -- 5. Reprise par l'organisme (compte connecté, règles d'accès) : demande d'un autre client refusée, la bonne acceptée,
  --    une seconde reprise refusée, une demande déjà reliée refusée ailleurs
  perform set_config('request.jwt.claims', v_sa, true);
  perform set_config('role', 'authenticated', true);
  begin perform public.besoin_reprendre_demande(v_s3, v_db); v_ok := true; exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '5. demande d''un autre client reprise'; end if;
  begin perform public.besoin_reprendre_demande(v_s3, v_dref); v_ok := true; exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '5. demande refusée reprise'; end if;
  perform public.besoin_reprendre_demande(v_s3, v_d2);
  begin perform public.besoin_reprendre_demande(v_s3, v_d1); v_ok := true; exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '5. seconde reprise sur une analyse commencée'; end if;
  begin perform public.besoin_reprendre_demande(v_s1, v_d2); v_ok := true; exception when invalid_parameter_value then v_ok := false; end;
  if v_ok then raise exception '5. demande reliée reprise sur une autre session'; end if;
  perform set_config('role', 'postgres', true);
  if (select participants_count from public.session_needs_analysis where session_id = v_s3) <> 3 or (select session_id from public.client_requests where id = v_d2) <> v_s3 then
    raise exception '5. reprise incomplète'; end if;

  -- 6. Le compte entreprise ne peut pas reprendre une demande lui-même (sessions invisibles pour lui)
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin perform public.besoin_reprendre_demande(v_s1, v_d1); v_ok := true; exception when others then v_ok := false; end;
  perform set_config('role', 'postgres', true);
  if v_ok or exists (select 1 from public.session_needs_analysis where session_id = v_s1) then raise exception '6. reprise par le compte entreprise'; end if;

  raise warning 'ESSAI 0487 : OK';
end
$$;
rollback;
