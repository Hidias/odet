-- Essai local de 0493 : espace client par lien et code, sessions inter vues par les groupes (C1) ; numérotation des
-- sessions sous verrou (C5) ; convention d'une session refusée à une entreprise inscrite par un groupe.
begin;
set local client_min_messages = warning;
do $$
declare
  v_cie uuid; v_co uuid; v_b uuid; v_c uuid; v_main uuid; v_inter uuid; v_intra uuid; v_gb uuid; v_gc uuid;
  v_tb uuid; v_tc uuid; v_tm uuid; v_tok text; v_d jsonb; v_s jsonb; v_n int; v_ref1 text; v_ref2 text; v_err text;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.courses (title, code, company_id) values ('Formation essai 0493', 'E493', v_cie) returning id into v_co;
  insert into public.clients (name, company_id) values ('Client groupe B 0493', v_cie) returning id into v_b;
  insert into public.clients (name, company_id) values ('Client groupe C 0493', v_cie) returning id into v_c;
  insert into public.clients (name, company_id) values ('Client principal 0493', v_cie) returning id into v_main;
  insert into public.trainees (first_name, last_name, client_id, company_id) values ('Bea', 'BETA', v_b, v_cie) returning id into v_tb;
  insert into public.trainees (first_name, last_name, client_id, company_id) values ('Cyr', 'GAMMA', v_c, v_cie) returning id into v_tc;
  insert into public.trainees (first_name, last_name, client_id, company_id) values ('Mel', 'MAIN', v_main, v_cie) returning id into v_tm;

  -- Inter : client principal v_main, groupes B (300 €) et C ; intra de B
  insert into public.sessions (reference, course_id, client_id, session_type, start_date, end_date, attendance_token,
    inter_total_price, company_id)
  values ('ESSAI-0493-INTER', v_co, v_main, 'inter', current_date + 30, current_date + 30, 'essai-0493-inter', 9999, v_cie)
  returning id into v_inter;
  insert into public.sessions (reference, course_id, client_id, session_type, start_date, end_date, attendance_token,
    total_price, company_id)
  values ('ESSAI-0493-INTRA', v_co, v_b, 'intra', current_date + 40, current_date + 40, 'essai-0493-intra', 800, v_cie)
  returning id into v_intra;
  insert into public.session_groups (session_id, client_id, kind, price_total, company_id) values (v_inter, v_b, 'entreprise', 300, v_cie) returning id into v_gb;
  insert into public.session_groups (session_id, client_id, kind, price_total, company_id) values (v_inter, v_c, 'entreprise', 450, v_cie) returning id into v_gc;
  insert into public.session_trainees (session_id, trainee_id, group_id, company_id) values
    (v_inter, v_tb, v_gb, v_cie), (v_inter, v_tc, v_gc, v_cie), (v_inter, v_tm, null, v_cie), (v_intra, v_tb, null, v_cie);

  insert into public.client_portal_access (client_id, access_code, company_id) values (v_b, '493493', v_cie) returning token into v_tok;
  v_d := public.client_portal_data(v_tok, '493493');
  if v_d ? 'error' then raise exception '1. accès refusé (%)', v_d->>'error'; end if;
  if jsonb_array_length(v_d->'sessions') <> 2 then
    raise exception '2. le groupe ne voit pas l''inter (% session(s))', jsonb_array_length(v_d->'sessions');
  end if;
  select e into v_s from jsonb_array_elements(v_d->'sessions') e where e->>'id' = v_inter::text;
  if (v_s->>'group_id')::uuid is distinct from v_gb then raise exception '3. group_id absent ou faux'; end if;
  if (v_s->>'total_price')::numeric is distinct from 300 then raise exception '4. prix du groupe attendu (%)', v_s->>'total_price'; end if;
  if v_s->'inter_total_price' <> 'null'::jsonb or v_s->'inter_group_id' <> 'null'::jsonb then
    raise exception '5. prix ou groupe de l''inter exposés au groupe';
  end if;
  if jsonb_array_length(v_s->'session_trainees') <> 1 or v_s->'session_trainees'->0->>'trainee_id' <> v_tb::text then
    raise exception '6. participants d''autres entreprises visibles (%)', jsonb_array_length(v_s->'session_trainees');
  end if;
  select e into v_s from jsonb_array_elements(v_d->'sessions') e where e->>'id' = v_intra::text;
  if v_s->'group_id' <> 'null'::jsonb or (v_s->>'total_price')::numeric is distinct from 800 then
    raise exception '7. session intra du client changée';
  end if;
  -- Client principal de l'inter : inchangé (tous les participants de l'inter qui sont les siens ou de ses groupes)
  insert into public.client_portal_access (client_id, access_code, company_id) values (v_main, '494494', v_cie) returning token into v_tok;
  v_d := public.client_portal_data(v_tok, '494494');
  select e into v_s from jsonb_array_elements(v_d->'sessions') e where e->>'id' = v_inter::text;
  if v_s is null or (v_s->>'inter_total_price')::numeric is distinct from 9999 or jsonb_array_length(v_s->'session_trainees') <> 1 then
    raise exception '8. vue du client principal changée';
  end if;

  -- Signature : la convention de l'inter refusée au groupe B
  begin
    perform app.portail_signer(v_b, 'lien', null, null, v_inter, 'convention', repeat('a', 64), 'Bea Beta', null,
      'data:image/png;base64,AAAA', '« Bon pour accord » écrit par le signataire', 'Convention');
    v_err := null;
  exception when others then v_err := sqlerrm;
  end;
  if coalesce(v_err, '') not like '%se signe par votre groupe%' then raise exception '9. signature de la session par un groupe acceptée (%)', v_err; end if;
  if (select convention_signed from public.sessions where id = v_inter) then raise exception '10. inter marquée signée'; end if;

  -- C5 : numéros suivis, verrou présent
  insert into public.sessions (course_id, start_date, end_date, attendance_token, company_id)
    values (v_co, date '2031-03-04', date '2031-03-04', 'essai-0493-n1', v_cie) returning reference into v_ref1;
  insert into public.sessions (course_id, start_date, end_date, attendance_token, company_id)
    values (v_co, date '2031-03-04', date '2031-03-04', 'essai-0493-n2', v_cie) returning reference into v_ref2;
  if v_ref1 not like '%-E493-310304-001' or v_ref2 not like '%-E493-310304-002' then
    raise exception '11. numéros faux (%, %)', v_ref1, v_ref2;
  end if;
  if pg_get_functiondef('public.generate_session_reference_v3()'::regprocedure) not like '%pg_advisory_xact_lock%' then
    raise exception '12. numérotation sans verrou';
  end if;
  if not exists (select 1 from public.schema_migrations where version = '0493_espace_lien_inter_numerotation') then
    raise exception '13. 0493 non inscrite';
  end if;
end $$;
rollback;
