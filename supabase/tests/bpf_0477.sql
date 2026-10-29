-- Essai local de 0477 : calcul du BPF au format 10443*17 sur un exercice fabriqué, chiffres attendus calculés à la main.
begin;
set local client_min_messages = warning;
do $$
declare
  v_cie uuid; v_ent uuid; v_part uuid; v_of uuid; v_opco uuid;
  v_c1 uuid; v_c2 uuid; v_c3 uuid; v_tin uuid; v_tex uuid; v_st uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_hors uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid;
  v_sa uuid := gen_random_uuid(); v_fo uuid := gen_random_uuid();
  v_r jsonb; l jsonb; v_ok boolean; v_g uuid;
begin
  select id into v_cie from public.companies order by position limit 1;
  update public.companies set fiscal_year_start_month = 1 where id = v_cie;

  insert into public.clients (name, client_type, company_id) values ('Ent 0477', 'entreprise', v_cie) returning id into v_ent;
  insert into public.clients (name, client_type, company_id) values ('Part 0477', 'particulier', v_cie) returning id into v_part;
  insert into public.clients (name, client_type, company_id) values ('OF 0477', 'organisme_formation', v_cie) returning id into v_of;
  insert into public.clients (name, client_type, company_id) values ('OPCO 0477', 'opco', v_cie) returning id into v_opco;

  insert into public.courses (title, duration_hours, bpf_objectif, nsf_code, company_id) values ('SST 0477', 14, 'rs', '344', v_cie) returning id into v_c1;
  insert into public.courses (title, duration_hours, bpf_objectif, nsf_code, company_id) values ('Habilitation 0477', 7, 'autre', '255', v_cie) returning id into v_c2;
  insert into public.courses (title, duration_hours, company_id) values ('Non classée 0477', 7, v_cie) returning id into v_c3;

  insert into public.trainers (first_name, last_name, is_internal, company_id) values ('In', 'TERNE', true, v_cie) returning id into v_tin;
  insert into public.trainers (first_name, last_name, is_internal, company_id) values ('Ex', 'TERNE', false, v_cie) returning id into v_tex;

  -- S1 : SST pour une entreprise, financée OPCO, 2 stagiaires, heures émises 14 et 10,5 ; formateur interne
  insert into public.sessions (reference, start_date, end_date, course_id, client_id, trainer_id, funding_type, company_id)
  values ('S1-0477', '2027-03-01', '2027-03-02', v_c1, v_ent, v_tin, 'opco', v_cie) returning id into v_s1;
  -- S2 : habilitation pour un particulier, 1 stagiaire, sans document émis (7 h prévues) ; formateur externe
  insert into public.sessions (reference, start_date, end_date, course_id, client_id, trainer_id, company_id)
  values ('S2-0477', '2027-05-10', '2027-05-10', v_c2, v_part, v_tex, v_cie) returning id into v_s2;
  -- S3 : pour le compte d'un autre organisme (cadre G), 1 stagiaire ; formateur interne
  insert into public.sessions (reference, start_date, end_date, course_id, client_id, trainer_id, session_type, company_id)
  values ('S3-0477', '2027-06-01', '2027-06-01', v_c2, v_of, v_tin, 'subcontract', v_cie) returning id into v_s3;
  -- S4 : formation non classée, entreprise, 1 stagiaire apprenti, confiée à un organisme prestataire (F-2)
  insert into public.sessions (reference, start_date, end_date, course_id, client_id, company_id)
  values ('S4-0477', '2027-09-01', '2027-09-01', v_c3, v_ent, v_cie) returning id into v_s4;
  -- Hors exercice
  insert into public.sessions (reference, start_date, end_date, course_id, client_id, company_id)
  values ('HORS-0477', '2026-12-30', '2026-12-31', v_c1, v_ent, v_cie) returning id into v_hors;

  insert into public.trainees (first_name, last_name, company_id) values ('A', 'UN', v_cie) returning id into t1;
  insert into public.trainees (first_name, last_name, company_id) values ('B', 'DEUX', v_cie) returning id into t2;
  insert into public.trainees (first_name, last_name, company_id) values ('C', 'TROIS', v_cie) returning id into t3;
  insert into public.trainees (first_name, last_name, company_id) values ('D', 'QUATRE', v_cie) returning id into t4;
  insert into public.trainees (first_name, last_name, company_id) values ('E', 'CINQ', v_cie) returning id into t5;
  insert into public.session_trainees (session_id, trainee_id) values (v_s1, t1), (v_s1, t2), (v_s2, t3), (v_s3, t4), (v_hors, t5);
  insert into public.session_trainees (session_id, trainee_id, bpf_categorie) values (v_s4, t5, 'b');
  insert into public.training_documents_issued (session_id, trainee_id, kind, version, issued_on, hours)
  values (v_s1, t1, 'attestation', 1, '2027-03-02', 14), (v_s1, t2, 'attestation', 1, '2027-03-02', 10.5);

  insert into public.subcontractors (name, kind, company_id) values ('Presta 0477', 'organisme', v_cie) returning id into v_st;
  insert into public.subcontract_orders (subcontractor_id, session_id, status, company_id) values (v_st, v_s4, 'signe', v_cie);

  -- Factures de l'exercice : S1 1000 € (OPCO), S2 300 € (particulier), S3 500 € (autre organisme), avoir 100 € sur S1,
  -- facture hors formation 2000 € ; une facture en brouillon et une de 2026 ignorées
  alter table public.invoices disable trigger user;
  insert into public.invoices (reference, type, client_id, session_id, company_id, status, total_ht, total_net_ht, invoice_date, is_formation_pro) values
    ('F1-0477', 'invoice', v_ent, v_s1, v_cie, 'paid', 1000, 1000, '2027-03-05', true),
    ('F2-0477', 'invoice', v_part, v_s2, v_cie, 'paid', 300, 300, '2027-05-12', true),
    ('F3-0477', 'invoice', v_of, v_s3, v_cie, 'sent', 500, 500, '2027-06-02', true),
    ('A1-0477', 'credit_note', v_ent, v_s1, v_cie, 'paid', 100, 100, '2027-03-20', true),
    ('F4-0477', 'invoice', v_ent, null, v_cie, 'sent', 2000, 2000, '2027-07-01', false),
    ('F5-0477', 'invoice', v_ent, v_s1, v_cie, 'draft', 999, 999, '2027-03-06', true),
    ('F6-0477', 'invoice', v_ent, v_hors, v_cie, 'paid', 777, 777, '2026-12-31', true);
  -- Groupe payé par France Travail, facture en subrogation, session sans financement : C-7, pas C-2-h (relecture #254)
  insert into public.session_groups (session_id, client_id, kind, payer_kind, company_id) values (v_s2, v_part, 'particulier', 'france_travail', v_cie) returning id into v_g;
  insert into public.invoices (reference, type, client_id, session_id, session_group_id, is_subrogation, company_id, status, total_ht, total_net_ht, invoice_date, is_formation_pro)
  values ('F7-0477', 'invoice', v_part, v_s2, v_g, true, v_cie, 'sent', 200, 200, '2027-05-15', true);
  alter table public.invoices enable trigger user;

  -- Comptes : super administrateur, puis formateur sans droit sur les registres qualité
  insert into auth.users (id, email, aud, role) values (v_sa, 'sa-0477@exemple.invalid', 'authenticated', 'authenticated'),
                                                       (v_fo, 'fo-0477@exemple.invalid', 'authenticated', 'authenticated');
  insert into public.profiles (id, email) values (v_sa, 'sa-0477@exemple.invalid'), (v_fo, 'fo-0477@exemple.invalid') on conflict (id) do nothing;
  if exists (select 1 from pg_trigger where tgname = 'profiles_protect_role') then
    execute 'alter table public.profiles disable trigger profiles_protect_role';
  end if;
  update public.profiles set role = 'superadmin', is_active = true where id = v_sa;
  update public.profiles set role = 'formateur', is_active = true where id = v_fo;
  if exists (select 1 from pg_trigger where tgname = 'profiles_protect_role') then
    execute 'alter table public.profiles enable trigger profiles_protect_role';
  end if;

  perform set_config('request.jwt.claim.sub', v_sa::text, true);
  execute 'set local role authenticated';
  v_r := public.bpf_calculer(2027, v_cie);
  execute 'reset role';
  l := v_r->'lignes';

  if v_r->'exercice'->>'debut' <> '2027-01-01' or v_r->'exercice'->>'fin' <> '2027-12-31' then raise exception 'exercice : %', v_r->'exercice'; end if;
  -- C : 1000 - 100 = 900 en C-2-h (OPCO) ; 300 en C-9 ; 500 en C-10 ; 200 en C-7 ; total 1900 ; CA 3900 -> 49 %
  if (l->>'C-2-h')::numeric <> 900 then raise exception 'C-2-h : %', l->>'C-2-h'; end if;
  if (l->>'C-2')::numeric <> 900 then raise exception 'C-2 : %', l->>'C-2'; end if;
  if (l->>'C-9')::numeric <> 300 then raise exception 'C-9 : %', l->>'C-9'; end if;
  if (l->>'C-10')::numeric <> 500 then raise exception 'C-10 : %', l->>'C-10'; end if;
  if (l->>'C-7')::numeric <> 200 then raise exception 'C-7 : %', l->>'C-7'; end if;
  if (l->>'C')::numeric <> 1900 then raise exception 'C : %', l->>'C'; end if;
  if (v_r->>'part_ca')::int <> 49 then raise exception 'part : %', v_r->>'part_ca'; end if;
  -- F-1 (hors S3) : a = 2 stagiaires 24,5 h -> 25 ; d = 1 / 7 ; b = 1 / 7 ; total 4 stagiaires, 38,5 h -> 39
  if (l->'F-1-a'->>'stagiaires')::int <> 2 or (l->'F-1-a'->>'heures')::numeric <> 25 then raise exception 'F-1-a : %', l->'F-1-a'; end if;
  if (l->'F-1-d'->>'stagiaires')::int <> 1 or (l->'F-1-d'->>'heures')::numeric <> 7 then raise exception 'F-1-d : %', l->'F-1-d'; end if;
  if (l->'F-1-b'->>'stagiaires')::int <> 1 then raise exception 'F-1-b : %', l->'F-1-b'; end if;
  if (l->'F-1'->>'stagiaires')::int <> 4 or (l->'F-1'->>'heures')::numeric <> 39 then raise exception 'F-1 : %', l->'F-1'; end if;
  -- F-2 : S4 confiée à un organisme
  if (l->'F-2'->>'stagiaires')::int <> 1 or (l->'F-2'->>'heures')::numeric <> 7 then raise exception 'F-2 : %', l->'F-2'; end if;
  -- F-3 : RS 2 / 25 ; autre 1 / 7 ; non classée listée, pas comptée
  if (l->'F-3-b'->>'stagiaires')::int <> 2 then raise exception 'F-3-b : %', l->'F-3-b'; end if;
  if (l->'F-3-d'->>'stagiaires')::int <> 1 then raise exception 'F-3-d : %', l->'F-3-d'; end if;
  if (l->'F-3'->>'stagiaires')::int <> 3 then raise exception 'F-3 : %', l->'F-3'; end if;
  if not (v_r->'a_classer'->'objectif') ? 'Non classée 0477' then raise exception 'à classer : %', v_r->'a_classer'; end if;
  -- F-4 : 344 en tête (25 h), 255 ensuite (7 h)
  if l->'F-4'->'principales'->0->>'code' <> '344' then raise exception 'F-4 : %', l->'F-4'; end if;
  -- G : S3, 1 stagiaire 7 h
  if (l->'G'->>'stagiaires')::int <> 1 or (l->'G'->>'heures')::numeric <> 7 then raise exception 'G : %', l->'G'; end if;
  -- E : interne 1 personne, S1 14 h + S3 7 h = 21 ; externe 1 personne 7 h
  if (l->'E-1'->>'personnes')::int <> 1 or (l->'E-1'->>'heures')::numeric <> 21 then raise exception 'E-1 : %', l->'E-1'; end if;
  if (l->'E-2'->>'personnes')::int <> 1 or (l->'E-2'->>'heures')::numeric <> 7 then raise exception 'E-2 : %', l->'E-2'; end if;
  -- Heures prévues signalées : S2, S3, S4
  if (v_r->'detail'->>'heures_prevues')::int <> 3 then raise exception 'heures prévues : %', v_r->'detail'->>'heures_prevues'; end if;

  -- Exercice décalé : début en juillet -> du 01/07/2026 au 30/06/2027
  update public.companies set fiscal_year_start_month = 7 where id = v_cie;
  perform set_config('request.jwt.claim.sub', v_sa::text, true);
  execute 'set local role authenticated';
  v_r := public.bpf_calculer(2027, v_cie);
  execute 'reset role';
  if v_r->'exercice'->>'debut' <> '2026-07-01' or v_r->'exercice'->>'fin' <> '2027-06-30' then raise exception 'exercice décalé : %', v_r->'exercice'; end if;
  -- F6 (31/12/2026) entre, F4 (01/07/2027) sort : 900 + 300 + 500 + 200 + 777
  if (v_r->'lignes'->>'C')::numeric <> 2677 then raise exception 'C décalé : %', v_r->'lignes'->>'C'; end if;
  update public.companies set fiscal_year_start_month = 1 where id = v_cie;

  -- Un formateur sans droit est refusé ; personne d'anonyme
  v_ok := false;
  perform set_config('request.jwt.claim.sub', v_fo::text, true);
  execute 'set local role authenticated';
  begin
    v_r := public.bpf_calculer(2027, v_cie);
  exception when insufficient_privilege then v_ok := true;
  end;
  execute 'reset role';
  if not v_ok then raise exception 'formateur accepté'; end if;
  if has_function_privilege('anon', 'public.bpf_calculer(integer, uuid)', 'execute') then raise exception 'anon peut appeler'; end if;

  -- Une déclaration par société et par année
  insert into public.bpf_declarations (year, company_id) values (2027, v_cie);
  v_ok := false;
  begin
    insert into public.bpf_declarations (year, company_id) values (2027, v_cie);
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'doublon société/année accepté'; end if;
  -- Le formateur ne lit pas la déclaration (chiffre d'affaires)
  perform set_config('request.jwt.claim.sub', v_fo::text, true);
  execute 'set local role authenticated';
  if exists (select 1 from public.bpf_declarations where year = 2027) then raise exception 'formateur lit le BPF'; end if;
  execute 'reset role';
  if not exists (select 1 from public.schema_migrations where version = '0477_bpf_donnees') then raise exception 'registre'; end if;
  if (select count(*) from public.bpf_specialites) <> 92 then raise exception 'spécialités : %', (select count(*) from public.bpf_specialites); end if;

  raise warning 'ESSAI 0477 : OK';
end
$$;
rollback;
