-- Essai de 0517 : avis des financeurs (Qualiopi 30), préparation de la nuit, lien à usage unique, échanges, suivi.
-- Rouge sans 0517 (tables et fonctions absentes). Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_autre uuid; v_u uuid := gen_random_uuid(); c_u text;
  v_course uuid; v_opco uuid; v_opco2 uuid; v_reg uuid; v_cli_autre uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_s5 uuid; v_s6 uuid; v_s7 uuid;
  v_an int := extract(year from (now() at time zone 'Europe/Paris'))::int;
  v_auj date := (now() at time zone 'Europe/Paris')::date;
  v_fin date;
  r jsonb; v_tok text; v_tok2 text; v_d uuid; v_d2 uuid; v_n int; v_a record; v_t text;
begin
  select id into v_cie from public.companies where status = 'active' order by created_at limit 1;
  update public.companies set is_training_org = true where id = v_cie;
  if not exists (select 1 from vault.decrypted_secrets where name = 'app_url') then
    perform vault.create_secret('https://exemple.invalid/', 'app_url');
  end if;
  -- Dernier jour passé dans l'année en cours (le 1er janvier : la veille serait l'an passé, on prend le jour même)
  v_fin := greatest(v_auj - 1, make_date(v_an, 1, 1));

  insert into public.courses (title) values ('Essai 0517 formation') returning id into v_course;
  insert into public.clients (name, client_type, email, company_id) values ('ESSAI 0517 OPCO UN', 'opco', 'opco1@exemple.invalid', v_cie) returning id into v_opco;
  insert into public.clients (name, client_type, email, company_id) values ('ESSAI 0517 OPCO DEUX', 'opco', 'opco2@exemple.invalid', v_cie) returning id into v_opco2;
  insert into public.clients (name, client_type, company_id) values ('ESSAI 0517 REGION', 'public', v_cie) returning id into v_reg;
  insert into public.clients (name, company_id) values ('ESSAI 0517 ENTREPRISE', v_cie) returning id into v_cli_autre;

  insert into public.sessions (course_id, client_id, start_date, end_date, status, company_id) values
    (v_course, v_cli_autre, v_fin, v_fin, 'completed', v_cie) returning id into v_s1;
  insert into public.sessions (course_id, client_id, start_date, end_date, status, company_id) values
    (v_course, v_cli_autre, v_fin, v_fin, 'completed', v_cie) returning id into v_s2;
  insert into public.sessions (course_id, client_id, start_date, end_date, status, company_id) values
    (v_course, v_cli_autre, v_fin, v_fin, 'cancelled', v_cie) returning id into v_s3;
  insert into public.sessions (course_id, client_id, start_date, end_date, status, company_id) values
    (v_course, v_cli_autre, make_date(v_an + 1, 1, 10), make_date(v_an + 1, 1, 10), 'planned', v_cie) returning id into v_s4;
  insert into public.sessions (course_id, client_id, start_date, end_date, status, company_id) values
    (v_course, v_cli_autre, v_fin, v_fin, 'completed', v_cie) returning id into v_s5;

  insert into public.session_fundings (session_id, funder_type, funder_name, funder_client_id, funder_contact_email, amount_ht, status, company_id) values
    (v_s1, 'opco', 'nom libre', v_opco, 'dossiers@exemple.invalid', 500, 'pending', v_cie),   -- OPCO un, adresse du financement
    (v_s2, 'opco', null, v_opco, null, 300, 'paid', v_cie),                                     -- OPCO un, 2e session
    (v_s1, 'cpf', null, null, null, 200, 'pending', v_cie),                                     -- CPF : jamais préparé
    (v_s3, 'region', 'ESSAI 0517 REGION', v_reg, 'region@exemple.invalid', 100, 'pending', v_cie),  -- session annulée
    (v_s4, 'opco', null, v_opco2, null, 100, 'pending', v_cie),                                 -- année suivante
    (v_s5, 'opco', null, v_opco2, null, 100, 'refused', v_cie),                                 -- financement refusé
    (v_s5, 'autre', 'Fonds  essai   sans adresse', null, null, 100, 'pending', v_cie),          -- sans adresse
    (v_s5, 'entreprise', null, v_cli_autre, 'ent@exemple.invalid', 100, 'pending', v_cie),      -- l'entreprise elle-même
    (v_s2, 'autre', 'essai  0517 opco ÜN', null, null, 20, 'pending', v_cie);                   -- OPCO un saisi à la main
  -- OPCO un : une session de plus, pas encore faite (jamais annoncée au financeur), si l'année n'est pas finie
  if extract(year from v_auj + 1)::int = v_an then
    insert into public.sessions (course_id, client_id, start_date, end_date, status, company_id) values
      (v_course, v_cli_autre, v_auj + 1, v_auj + 1, 'planned', v_cie) returning id into v_s6;
    insert into public.session_fundings (session_id, funder_type, funder_client_id, amount_ht, status, company_id) values (v_s6, 'opco', v_opco, 10, 'pending', v_cie);
  end if;
  -- Session marquée financée par un OPCO sans aucun financeur renseigné
  insert into public.sessions (course_id, client_id, start_date, end_date, status, company_id, funding_type) values
    (v_course, v_cli_autre, v_fin, v_fin, 'completed', v_cie, 'opco') returning id into v_s7;

  -- 1. Financeurs de l'année : OPCO un (2 sessions), CPF, « autre » sans adresse ; ni annulée, ni refusée, ni l'an prochain, ni l'entreprise
  select count(*) into v_n from app.financeurs_de_l_annee(v_cie, v_an) f where f.funder_key in ('c:' || v_opco, 'cpf', 'n:fonds essai sans adresse');
  if v_n <> 3 then raise exception '1. financeurs de l''année : % sur 3', v_n; end if;
  -- Saisie libre du même nom (casse, accents, espaces, autre type) : rattachée à la fiche
  if exists (select 1 from app.financeurs_de_l_annee(v_cie, v_an) f where f.funder_key like 'n:essai 0517%') then raise exception '1a. même financeur sous deux clés'; end if;
  if app.financeur_nom_norme(' Région   BRETAGNE ') <> 'region bretagne' then raise exception '1a2. nom normalisé : %', app.financeur_nom_norme(' Région   BRETAGNE '); end if;
  if exists (select 1 from app.financeurs_de_l_annee(v_cie, v_an) f where f.funder_key in ('c:' || v_reg, 'c:' || v_opco2, 'c:' || v_cli_autre)) then
    raise exception '1b. financeur exclu repris';
  end if;
  select f.sessions_terminees, f.contact_email, f.funder_name into v_a from app.financeurs_de_l_annee(v_cie, v_an) f where f.funder_key = 'c:' || v_opco;
  if v_a.sessions_terminees <> 2 or v_a.funder_name <> 'ESSAI 0517 OPCO UN' then raise exception '1c. OPCO un : %', row_to_json(v_a); end if;
  if v_a.contact_email not in ('dossiers@exemple.invalid', 'opco1@exemple.invalid') then raise exception '1d. adresse : %', v_a.contact_email; end if;

  -- 2. Préparation : une seule demande (OPCO un), relance « à valider » avec le lien ; rien pour CPF ni sans adresse
  delete from public.funder_feedback where company_id = v_cie;
  r := public.financeurs_avis_preparer();
  select id, token into v_d, v_tok from public.funder_feedback where company_id = v_cie and funder_key = 'c:' || v_opco and year = v_an;
  if v_d is null then raise exception '2. demande absente (%)', r; end if;
  if exists (select 1 from public.funder_feedback where company_id = v_cie and funder_key in ('cpf', 'n:fonds essai sans adresse')) then raise exception '2b. demande sans adresse ou CPF'; end if;
  select * into v_a from public.scheduled_actions where company_id = v_cie and dedup_key = 'avis_financeur:' || v_d;
  if v_a.id is null or v_a.status <> 'a_valider' or v_a.kind <> 'avis_financeur' or v_a.target_id <> v_d then raise exception '2c. relance absente ou fausse'; end if;
  if position('/#/avis-financeur/' || v_tok in v_a.payload->>'texte') = 0 then raise exception '2d. lien absent du texte'; end if;
  if v_a.payload->>'texte' like '%' || chr(8212) || '%' then raise exception '2e. tiret cadratin'; end if;
  if position('En ' || v_an || ', ' in v_a.payload->>'texte') = 0 or position('2 formations que vous avez financées' in v_a.payload->>'texte') = 0
     or jsonb_array_length((select sessions from public.funder_feedback where id = v_d)) <> 2 then raise exception '2f. nombre de formations : %', v_a.payload->>'texte'; end if;
  if length(v_tok) <> 48 then raise exception '2g. jeton de % caractères', length(v_tok); end if;
  -- Rejouée : rien de plus
  perform public.financeurs_avis_preparer();
  if (select count(*) from public.scheduled_actions where company_id = v_cie and kind = 'avis_financeur') <> 1 then raise exception '2h. préparation rejouée en double'; end if;

  -- 3. Échange saisi dans l'année : couvre le financeur, rien n'est préparé pour lui
  insert into public.session_fundings (session_id, funder_type, funder_client_id, amount_ht, status, company_id)
    values (v_s5, 'opco', v_opco2, 50, 'pending', v_cie);
  insert into public.funder_exchanges (company_id, funder_type, funder_name, funder_client_id, kind, happened_on)
    values (v_cie, 'opco', 'ESSAI 0517 OPCO DEUX', v_opco2, 'webinaire', v_fin);
  perform public.financeurs_avis_preparer();
  if exists (select 1 from public.funder_feedback where company_id = v_cie and funder_key = 'c:' || v_opco2) then raise exception '3. demande malgré un échange'; end if;
  -- Règles de l'échange : date future refusée, fiche d'une autre société refusée, société figée
  begin
    insert into public.funder_exchanges (company_id, funder_type, funder_name, kind, happened_on) values (v_cie, 'cpf', 'CPF', 'consultation_site', v_auj + 1);
    raise exception '3b. date future acceptée';
  exception when check_violation then null;
  end;
  insert into public.companies (legal_name) values ('Société essai 0517') returning id into v_autre;
  begin
    insert into public.funder_exchanges (company_id, funder_type, funder_name, funder_client_id, kind, happened_on) values (v_autre, 'opco', 'Essai autre', v_opco, 'reunion', v_fin);
    raise exception '3c. fiche d''une autre société acceptée';
  exception when check_violation then null;
  end;

  -- 4. Lien inactif tant que la relance n'est pas validée
  r := public.financeur_avis_ouvrir(v_tok);
  if not (r ? 'error') then raise exception '4. lien actif avant validation'; end if;
  r := public.financeur_avis_repondre(v_tok, '{"note_globale": 4}');
  if not (r ? 'error') or exists (select 1 from public.funder_feedback where id = v_d and answered_at is not null) then raise exception '4b. réponse avant validation'; end if;
  -- Lien qui aurait expiré pendant l'attente : repart pour 90 jours à l'envoi
  update public.funder_feedback set expires_at = now() - interval '1 day' where id = v_d;
  update public.scheduled_actions set status = 'envoye' where id = v_a.id;
  if (select expires_at from public.funder_feedback where id = v_d) < now() + interval '89 days' then raise exception '4c. lien non prolongé à l''envoi'; end if;

  -- 5. Page publique, rôle anonyme : ouverture, réponses refusées, réponse unique, table fermée
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  r := public.financeur_avis_ouvrir(v_tok);
  if r ? 'error' or r->>'financeur' <> 'ESSAI 0517 OPCO UN' or (r->>'annee')::int <> v_an or jsonb_array_length(r->'sessions') <> 2
     or (r->>'repondu')::boolean then raise exception '5. ouverture : %', r; end if;
  if (r->'sessions'->0) ? 'id' or (r->'sessions'->0) ? 'reference' then raise exception '5b. identifiants de session montrés'; end if;
  r := public.financeur_avis_ouvrir('zz' || left(v_tok, 46));
  if not (r ? 'error') then raise exception '5c. jeton mal formé accepté'; end if;
  r := public.financeur_avis_ouvrir(left(v_tok, 47) || case right(v_tok, 1) when '0' then '1' else '0' end);
  if not (r ? 'error') then raise exception '5d. jeton inconnu accepté'; end if;
  r := public.financeur_avis_repondre(v_tok, '{"note_globale": 6}');
  if not (r ? 'error') then raise exception '5e. note 6 acceptée'; end if;
  r := public.financeur_avis_repondre(v_tok, '{"note_globale": 4, "q_qualite": 0}');
  if not (r ? 'error') then raise exception '5f. note 0 acceptée'; end if;
  r := public.financeur_avis_repondre(v_tok, '{"note_globale": "4.5"}');
  if not (r ? 'error') then raise exception '5g. note décimale acceptée'; end if;
  r := public.financeur_avis_repondre(v_tok, jsonb_build_object('note_globale', 4, 'q_information', 5, 'q_relation', null, 'commentaire', '  Bon suivi  '));
  if r ? 'error' then raise exception '5h. réponse refusée : %', r; end if;
  r := public.financeur_avis_repondre(v_tok, '{"note_globale": 1}');
  if not (r ? 'error') then raise exception '5i. seconde réponse acceptée'; end if;
  begin
    perform 1 from public.funder_feedback limit 1;
    raise exception '5j. table lisible par le rôle anonyme';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  select * into v_a from public.funder_feedback where id = v_d;
  if v_a.note_globale <> 4 or v_a.q_information <> 5 or v_a.q_relation is not null or v_a.commentaire <> 'Bon suivi' or v_a.answered_at is null then
    raise exception '5k. réponse enregistrée fausse : %', row_to_json(v_a);
  end if;
  if not exists (select 1 from public.notifications where type = 'avis_financeur' and company_id = v_cie and (metadata->>'funder_feedback_id')::uuid = v_d) then
    raise exception '5l. notification absente';
  end if;

  -- 6. Seconde relance : 15 jours après l'envoi sans réponse ; jamais pour une demande répondue ; une seule
  insert into public.funder_feedback (company_id, year, funder_key, funder_type, funder_name, contact_email, sessions)
    values (v_cie, v_an, 'autre:essai relance', 'autre', 'Essai relance', 'relance@exemple.invalid', '[{"titre": "X"}]')
    returning id, token into v_d2, v_tok2;
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, due_on, title, payload, dedup_key)
    values (v_cie, 'avis_financeur', 'funder_feedback', v_d2, v_auj, 'Essai', '{}', 'avis_financeur:' || v_d2);
  update public.scheduled_actions set payload = '{"destinataire": " corrigee@exemple.invalid "}', status = 'valide' where dedup_key = 'avis_financeur:' || v_d2;
  update public.scheduled_actions set status = 'envoye' where dedup_key = 'avis_financeur:' || v_d2;
  update public.scheduled_actions set sent_at = now() - interval '14 days' where dedup_key in ('avis_financeur:' || v_d2, 'avis_financeur:' || v_d);
  perform public.financeurs_avis_preparer();
  if exists (select 1 from public.scheduled_actions where dedup_key like 'avis_financeur_relance:%' and company_id = v_cie) then raise exception '6. relance avant 15 jours'; end if;
  update public.scheduled_actions set sent_at = now() - interval '16 days' where dedup_key in ('avis_financeur:' || v_d2, 'avis_financeur:' || v_d);
  perform public.financeurs_avis_preparer();
  perform public.financeurs_avis_preparer();
  if (select count(*) from public.scheduled_actions where dedup_key = 'avis_financeur_relance:' || v_d2) <> 1 then raise exception '6b. relance absente ou en double'; end if;
  if exists (select 1 from public.scheduled_actions where dedup_key = 'avis_financeur_relance:' || v_d) then raise exception '6c. relance d''une demande répondue'; end if;
  select payload->>'texte' into v_t from public.scheduled_actions where dedup_key = 'avis_financeur_relance:' || v_d2;
  if position('/#/avis-financeur/' || v_tok2 in v_t) = 0 or position('la formation que vous avez financée' in v_t) = 0 then raise exception '6d. texte de relance : %', v_t; end if;
  if (select payload->>'destinataire' from public.scheduled_actions where dedup_key = 'avis_financeur_relance:' || v_d2) <> 'corrigee@exemple.invalid' then raise exception '6d2. relance à l''ancienne adresse'; end if;
  -- Expirée : plus de réponse
  update public.funder_feedback set expires_at = now() - interval '1 minute' where id = v_d2;
  -- Années ouvertes : l'année en cours, et l'année écoulée jusqu'au 31 mars
  if app.financeurs_annees_ouvertes() <> (case when extract(month from (now() at time zone 'Europe/Paris')) <= 3 then array[v_an, v_an - 1] else array[v_an] end) then
    raise exception '6g. années ouvertes : %', app.financeurs_annees_ouvertes();
  end if;
  r := public.financeur_avis_repondre(v_tok2, '{"note_globale": 3}');
  if not (r ? 'error') or position('expiré' in r->>'error') = 0 then raise exception '6e. lien expiré accepté : %', r; end if;
  if not (public.financeur_avis_ouvrir(v_tok2)->>'expire')::boolean then raise exception '6f. expiration non signalée'; end if;

  -- 6h. Fiche créée après l'envoi d'une demande faite sur une saisie libre : pas de seconde demande, état gardé
  insert into public.session_fundings (session_id, funder_type, funder_name, funder_contact_email, amount_ht, status, company_id)
    values (v_s5, 'opco', 'Atlas essai 0517', 'atlas@exemple.invalid', 30, 'pending', v_cie);
  perform public.financeurs_avis_preparer();
  select id into v_d2 from public.funder_feedback where company_id = v_cie and funder_key = 'n:atlas essai 0517' and year = v_an;
  if v_d2 is null then raise exception '6h. demande Atlas absente'; end if;
  update public.scheduled_actions set status = 'envoye' where dedup_key = 'avis_financeur:' || v_d2;
  insert into public.clients (name, client_type, company_id) values ('ATLAS ESSAI 0517', 'opco', v_cie);
  perform public.financeurs_avis_preparer();
  if (select count(*) from public.funder_feedback where company_id = v_cie and year = v_an and app.financeur_nom_norme(funder_name) like 'atlas essai 0517') <> 1 then
    raise exception '6h2. seconde demande après la création de la fiche';
  end if;
  if app.financeur_nom_norme('Région Pays-de-la-Loire') <> app.financeur_nom_norme('Region Pays de la Loire')
     or app.financeur_nom_norme('OPCO de l''industrie') <> app.financeur_nom_norme('OPCO de l’industrie') then
    raise exception '6i. tirets ou apostrophes';
  end if;

  -- 7. Compte de la société : suivi lisible, demandes non modifiables, échanges avec le droit
  insert into auth.users (id, email, aud, role) values (v_u, 'u-0517@exemple.invalid', 'authenticated', 'authenticated');
  insert into public.profiles (id, email) values (v_u, 'u-0517@exemple.invalid') on conflict (id) do nothing;
  update public.profiles set is_active = true where id = v_u;
  insert into public.company_members (company_id, profile_id, role, is_default, is_active) values (v_cie, v_u, 'admin', true, true)
  on conflict (company_id, profile_id) do update set role = 'admin', is_active = true, is_default = true;
  c_u := json_build_object('sub', v_u, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', c_u, true);
  perform set_config('request.jwt.claim.sub', v_u::text, true);
  execute 'set local role authenticated';
  r := public.financeurs_suivi(v_an);
  if not exists (select 1 from jsonb_array_elements(r->'sans_financeur') x where (x->>'id')::uuid = v_s7)
     or exists (select 1 from jsonb_array_elements(r->'sans_financeur') x where (x->>'id')::uuid in (v_s1, v_s2, v_s5)) then
    raise exception '7a. sessions sans financeur : %', r->'sans_financeur';
  end if;
  if not (r->>'annee_ouverte')::boolean then raise exception '7a2. année en cours fermée'; end if;
  select x into r from jsonb_array_elements(public.financeurs_suivi(v_an)->'financeurs') x where x->>'cle' = 'n:fonds essai sans adresse';
  if r is null or (r->>'preparable')::boolean or (r->>'email_valide')::boolean then raise exception '7a3. financeur sans adresse : %', r; end if;
  begin
    perform token from public.funder_feedback limit 1;
    raise exception '7a4. jeton lisible par un compte';
  exception when insufficient_privilege then null;
  end;
  if not exists (select 1 from public.funder_feedback where id = v_d) then raise exception '7a5. demande illisible pour la société'; end if;
  select x into r from jsonb_array_elements(public.financeurs_suivi(v_an)->'financeurs') x where x->>'cle' = 'c:' || v_opco;
  if r is null or r->>'demande' <> 'repondue' or not (r->>'couvert')::boolean or (r->>'note')::int <> 4 then raise exception '7. suivi OPCO un : %', r; end if;
  select x into r from jsonb_array_elements(public.financeurs_suivi(v_an)->'financeurs') x where x->>'nom' = 'ATLAS ESSAI 0517';
  if r is null or r->>'demande' <> 'envoyee' or not (r->>'couvert')::boolean then raise exception '7a6. état perdu après la création de la fiche : %', r; end if;
  select x into r from jsonb_array_elements(public.financeurs_suivi(v_an)->'financeurs') x where x->>'cle' = 'c:' || v_opco2;
  if r is null or not (r->>'couvert')::boolean or (r->>'echanges')::int <> 1 then raise exception '7b. suivi OPCO deux : %', r; end if;
  select x into r from jsonb_array_elements(public.financeurs_suivi(v_an)->'financeurs') x where x->>'cle' = 'cpf';
  if r is null or (r->>'couvert')::boolean then raise exception '7c. suivi CPF : %', r; end if;
  begin
    update public.funder_feedback set note_globale = 5 where id = v_d;
    raise exception '7d. demande modifiable par un compte';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.funder_feedback (company_id, year, funder_key, funder_type, funder_name) values (v_cie, v_an, 'autre:x', 'autre', 'X');
    raise exception '7e. demande créée par un compte';
  exception when insufficient_privilege then null;
  end;
  insert into public.funder_exchanges (company_id, funder_type, funder_name, kind, happened_on) values (v_cie, 'cpf', ' CPF ', 'consultation_site', v_fin);
  select x into r from jsonb_array_elements(public.financeurs_suivi(v_an)->'financeurs') x where x->>'cle' = 'cpf';
  if not (r->>'couvert')::boolean then raise exception '7f. CPF non couvert après la consultation'; end if;
  if (select created_by from public.funder_exchanges where funder_type = 'cpf' and company_id = v_cie) is distinct from v_u then raise exception '7g. auteur'; end if;
  execute 'reset role';
  -- Sans connexion : suivi refusé
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.financeurs_suivi(v_an);
    raise exception '7h. suivi sans connexion';
  exception when insufficient_privilege then null;
  end;
end $$;

select 'VERT' as essai_0517;
rollback;
