-- Essai de 0509 : évaluation à froid de l'employeur depuis l'espace par lien. Rouge sans 0509 (fonctions et colonne
-- absentes). Données d'essai créées ici (une société existante seulement), réglages de la société posés ici, tout est
-- annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_a uuid; v_b uuid; v_sa uuid; v_sr uuid; v_sb uuid; v_tok text; v_acces uuid; v_r jsonb; v_msg text; v_n int;
  v_ok jsonb := '{"e_pratique": true, "e_besoins": true, "e_recommande": false, "e_commentaire": "Très utile"}'::jsonb;
  v_claims text := current_setting('request.jwt.claims', true);
begin
  select id into v_cie from public.companies limit 1;
  -- Réglages posés par l'essai (jamais ceux de la production)
  insert into public.froid_reglages (company_id, actif, premier_envoi_jours, anciennete_max_jours, employeur_actif)
  values (v_cie, true, 60, 365, true)
  on conflict (company_id) do update set actif = true, premier_envoi_jours = 60, anciennete_max_jours = 365, employeur_actif = true;
  insert into public.clients (name, company_id) values ('Alpha essai 0509', v_cie) returning id into v_a;
  insert into public.clients (name, company_id) values ('Beta essai 0509', v_cie) returning id into v_b;
  -- terminée il y a 70 jours : questionnaire ouvert ; terminée il y a 10 jours : pas encore ; celle de Beta : jamais pour Alpha
  insert into public.sessions (reference, start_date, end_date, client_id, company_id, status)
    values ('ESSAI-0509-A', current_date - 71, current_date - 70, v_a, v_cie, 'completed') returning id into v_sa;
  insert into public.sessions (reference, start_date, end_date, client_id, company_id, status)
    values ('ESSAI-0509-R', current_date - 10, current_date - 10, v_a, v_cie, 'completed') returning id into v_sr;
  insert into public.sessions (reference, start_date, end_date, client_id, company_id, status)
    values ('ESSAI-0509-B', current_date - 71, current_date - 70, v_b, v_cie, 'completed') returning id into v_sb;
  insert into public.froid_envois (company_id, session_id, client_id, cible, rang, du_le, destinataire)
    values (v_cie, v_sa, v_a, 'employeur', 0, current_date, 'rh@example.invalid');
  insert into public.client_portal_access (client_id, access_code, company_id) values (v_a, '482915', v_cie) returning token, id into v_tok, v_acces;
  perform set_config('essai.jeton', v_tok, true);
  perform set_config('essai.session', v_sa::text, true);

  -- 1. Mauvais code : erreur du lien, rien lu ni écrit
  v_r := public.client_portal_froid(v_tok, '000000');
  if not v_r ? 'error' then raise exception '1. lu avec un mauvais code (%)', v_r; end if;
  v_r := public.client_portal_froid_repondre(v_tok, '000000', v_sa, v_ok);
  if not v_r ? 'error' then raise exception '1b. réponse acceptée avec un mauvais code (%)', v_r; end if;
  if exists (select 1 from public.froid_employeur where client_id = v_a) then raise exception '1c. réponse écrite avec un mauvais code'; end if;

  -- 2. Liste par le lien : la session ouverte seulement, questionnaire de l'employeur proposé, pas encore reçu
  v_r := public.client_portal_froid(v_tok, '482915');
  if jsonb_array_length(v_r -> 'sessions') <> 1 or (v_r -> 'sessions' -> 0 ->> 'session_id')::uuid <> v_sa then
    raise exception '2. liste fausse (%)', v_r;
  end if;
  if jsonb_typeof(v_r -> 'sessions' -> 0 -> 'employeur') <> 'object' or (v_r -> 'sessions' -> 0 -> 'employeur' ->> 'recue')::boolean then
    raise exception '2b. questionnaire de l''employeur absent ou déjà reçu (%)', v_r;
  end if;

  -- 3. Session pas encore ouverte, ou d'un autre client : refusée
  begin
    v_r := public.client_portal_froid_repondre(v_tok, '482915', v_sr, v_ok);
    raise exception '3. session pas encore ouverte acceptée';
  exception when sqlstate '22023' then get stacked diagnostics v_msg = message_text;
    if v_msg <> 'Questionnaire non disponible pour cette formation' then raise exception '3. message faux (%)', v_msg; end if;
  end;
  begin
    v_r := public.client_portal_froid_repondre(v_tok, '482915', v_sb, v_ok);
    raise exception '3b. session d''un autre client acceptée';
  exception when sqlstate '22023' then null;
  end;

  -- 4. Réponses incomplètes : refusées
  begin
    v_r := public.client_portal_froid_repondre(v_tok, '482915', v_sa, '{"e_pratique": true}'::jsonb);
    raise exception '4. réponses incomplètes acceptées';
  exception when sqlstate '22023' then get stacked diagnostics v_msg = message_text;
    if v_msg <> 'Merci de répondre à toutes les questions' then raise exception '4. message faux (%)', v_msg; end if;
  end;

  -- 5. Réponse par le lien : écrite, figée, tracée par l'accès (sans profil), envoi préparé ignoré
  v_r := public.client_portal_froid_repondre(v_tok, '482915', v_sa, v_ok);
  if not coalesce((v_r ->> 'success')::boolean, false) then raise exception '5. réponse refusée (%)', v_r; end if;
  if not exists (select 1 from public.froid_employeur where session_id = v_sa and client_id = v_a and company_id = v_cie
                  and completed_at is not null and repondu_par is null and repondu_acces = v_acces and saisi_par is null
                  and reponses = v_ok) then
    raise exception '5b. réponse non écrite ou mal tracée';
  end if;
  if (select statut from public.froid_envois where session_id = v_sa and client_id = v_a and cible = 'employeur') <> 'ignore' then
    raise exception '5c. envoi préparé non ignoré';
  end if;
  v_r := public.client_portal_froid(v_tok, '482915');
  if not (v_r -> 'sessions' -> 0 -> 'employeur' ->> 'recue')::boolean then raise exception '5d. réponse non vue comme reçue (%)', v_r; end if;

  -- 6. Seconde réponse : refusée, la première reste
  begin
    v_r := public.client_portal_froid_repondre(v_tok, '482915', v_sa, '{"e_pratique": false, "e_besoins": false, "e_recommande": false}'::jsonb);
    raise exception '6. seconde réponse acceptée';
  exception when sqlstate '23505' then null;
  end;
  if (select reponses from public.froid_employeur where session_id = v_sa and client_id = v_a) <> v_ok then raise exception '6b. réponse remplacée'; end if;

  -- 6 bis. Salarié de l'entreprise inscrit à une formation achetée par une autre (relecture de 0509) : rien sans
  -- demande de relance ; avec un envoi « contact » à cette entreprise, la formation est listée pour ce salarié, sans
  -- questionnaire de l'employeur, et la réponse est refusée
  declare v_t uuid; v_g uuid; v_si uuid;
  begin
    insert into public.trainees (first_name, last_name, client_id, company_id) values ('Zoé', 'ESSAI', v_a, v_cie) returning id into v_t;
    insert into public.session_trainees (session_id, trainee_id) values (v_sb, v_t);
    v_r := public.client_portal_froid(v_tok, '482915');
    if v_r -> 'sessions' @> jsonb_build_array(jsonb_build_object('session_id', v_sb)) then raise exception '6c. formation d''un autre client listée (%)', v_r; end if;
    insert into public.froid_envois (company_id, session_id, trainee_id, client_id, cible, rang, du_le, destinataire)
      values (v_cie, v_sb, v_t, v_a, 'contact', 0, current_date, 'rh@example.invalid');
    v_r := public.client_portal_froid(v_tok, '482915');
    select x into v_r from jsonb_array_elements(v_r -> 'sessions') x where (x ->> 'session_id')::uuid = v_sb;
    if v_r is null or jsonb_typeof(v_r -> 'employeur') = 'object' or jsonb_array_length(v_r -> 'stagiaires') <> 1 then
      raise exception '6d. relance du salarié fausse (%)', v_r;
    end if;
    begin
      v_r := public.client_portal_froid_repondre(v_tok, '482915', v_sb, v_ok);
      raise exception '6e. réponse acceptée pour une formation d''un autre client';
    exception when sqlstate '22023' then null;
    end;
    -- Inter : groupe de l'entreprise proposé ; groupe annulé, plus proposé
    insert into public.sessions (reference, start_date, end_date, client_id, company_id, status, session_type)
      values ('ESSAI-0509-I', current_date - 71, current_date - 70, v_b, v_cie, 'completed', 'inter') returning id into v_si;
    insert into public.session_groups (session_id, client_id, kind, company_id) values (v_si, v_a, 'entreprise', v_cie) returning id into v_g;
    v_r := public.client_portal_froid(v_tok, '482915');
    select x into v_r from jsonb_array_elements(v_r -> 'sessions') x where (x ->> 'session_id')::uuid = v_si;
    if jsonb_typeof(v_r -> 'employeur') <> 'object' then raise exception '6f. groupe de l''inter sans questionnaire (%)', v_r; end if;
    update public.session_groups set status = 'cancelled' where id = v_g;
    v_r := public.client_portal_froid(v_tok, '482915');
    if v_r -> 'sessions' @> jsonb_build_array(jsonb_build_object('session_id', v_si)) then raise exception '6g. groupe annulé encore listé (%)', v_r; end if;
  end;

  -- 7. Droits : règles communes fermées ; lien ouvert à anon ; compte réservé aux connectés
  if has_function_privilege('anon', 'app.froid_employeur_client(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'app.froid_employeur_client(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'app.froid_employeur_repondre(uuid, uuid, uuid, jsonb, uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'app.froid_employeur_repondre(uuid, uuid, uuid, jsonb, uuid, uuid)', 'execute') then
    raise exception '7. règle commune ouverte';
  end if;
  if not has_function_privilege('anon', 'public.client_portal_froid(text, text)', 'execute')
     or not has_function_privilege('anon', 'public.client_portal_froid_repondre(text, text, uuid, jsonb)', 'execute') then
    raise exception '7b. lien fermé à anon';
  end if;
  if has_function_privilege('anon', 'public.ent_froid()', 'execute') or has_function_privilege('anon', 'public.ent_froid_repondre(uuid, jsonb)', 'execute') then
    raise exception '7c. compte ouvert à anon';
  end if;

  -- 8. Espace par compte : toujours réservé à un compte entreprise actif
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    v_r := public.ent_froid();
    raise exception '8. lu sans compte entreprise';
  exception when sqlstate '42501' then get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Espace entreprise%' then raise exception '8. message faux (%)', v_msg; end if;
  end;
  begin
    v_r := public.ent_froid_repondre(v_sa, v_ok);
    raise exception '8b. réponse sans compte entreprise';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  -- réponse reçue figée : l'essai la retire par la purge fictive pour la suite
  perform set_config('app.demo_purge', 'on', true);
  delete from public.froid_employeur where session_id = v_sa and client_id = v_a;
  perform set_config('app.demo_purge', '', true);
end
$$;

-- Visiteur de l'espace par lien (rôle anon), appels réels
set local role anon;
do $$
declare v_tok text := current_setting('essai.jeton'); v_s uuid := current_setting('essai.session')::uuid; v_r jsonb; i int;
begin
  -- 9. Lecture et réponse par le lien en anon
  v_r := public.client_portal_froid(v_tok, '482915');
  if not v_r -> 'sessions' @> jsonb_build_array(jsonb_build_object('session_id', v_s)) then raise exception '9. lecture en anon fausse (%)', v_r; end if;
  -- 10. Règle commune fermée en anon
  begin
    v_r := app.froid_employeur_client(null, null);
    raise exception '10. règle commune appelée en anon';
  exception when insufficient_privilege then null;
  end;
  -- 11. Cinq mauvais codes : le bon code est ensuite refusé, rien écrit
  for i in 1..5 loop v_r := public.client_portal_froid(v_tok, '000000'); end loop;
  v_r := public.client_portal_froid_repondre(v_tok, '482915', v_s, '{"e_pratique": true, "e_besoins": true, "e_recommande": true}'::jsonb);
  if coalesce(v_r->>'error', '') not like 'Trop de tentatives%' then raise exception '11. lien non bloqué (%)', v_r; end if;
end
$$;
reset role;

do $$
declare v_tok text := current_setting('essai.jeton'); v_s uuid := current_setting('essai.session')::uuid; v_r jsonb;
begin
  if exists (select 1 from public.froid_employeur where session_id = v_s) then raise exception '11b. réponse écrite pendant le blocage'; end if;
  -- 12. Lien désactivé : refusé
  update public.client_portal_access set is_active = false, locked_until = null, attempts = 0 where token = v_tok;
  v_r := public.client_portal_froid_repondre(v_tok, '482915', v_s, '{"e_pratique": true, "e_besoins": true, "e_recommande": true}'::jsonb);
  if not v_r ? 'error' then raise exception '12. lien désactivé accepté (%)', v_r; end if;
  if exists (select 1 from public.froid_employeur where session_id = v_s) then raise exception '12b. réponse écrite par un lien désactivé'; end if;
  -- 13. Lien réactivé, réponse en anon puis lecture
  update public.client_portal_access set is_active = true where token = v_tok;
end
$$;
set local role anon;
do $$
declare v_tok text := current_setting('essai.jeton'); v_s uuid := current_setting('essai.session')::uuid; v_r jsonb;
begin
  v_r := public.client_portal_froid_repondre(v_tok, '482915', v_s, '{"e_pratique": true, "e_besoins": true, "e_recommande": true}'::jsonb);
  if not coalesce((v_r ->> 'success')::boolean, false) then raise exception '13. réponse en anon refusée (%)', v_r; end if;
end
$$;
reset role;
do $$
begin
  if not exists (select 1 from public.froid_employeur where session_id = current_setting('essai.session')::uuid and repondu_acces is not null) then
    raise exception '13b. réponse en anon non tracée';
  end if;
end
$$;

rollback;
