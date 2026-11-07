-- Essai de 0504 : avis de l'entreprise donné depuis l'espace par lien. Rouge sans 0504 (fonctions absentes).
-- Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_a uuid; v_b uuid; v_sa uuid; v_sf uuid; v_sb uuid; v_si uuid; v_tok text; v_r jsonb; v_msg text; v_n int; v_claims text := current_setting('request.jwt.claims', true);
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Alpha essai 0504', v_cie) returning id into v_a;
  insert into public.clients (name, company_id) values ('Beta essai 0504', v_cie) returning id into v_b;
  insert into public.sessions (reference, start_date, end_date, client_id, company_id)
    values ('ESSAI-0504-A', current_date - 3, current_date - 2, v_a, v_cie) returning id into v_sa;
  insert into public.sessions (reference, start_date, end_date, client_id, company_id)
    values ('ESSAI-0504-F', current_date + 10, current_date + 10, v_a, v_cie) returning id into v_sf;
  insert into public.sessions (reference, start_date, end_date, client_id, company_id)
    values ('ESSAI-0504-B', current_date - 3, current_date - 3, v_b, v_cie) returning id into v_sb;
  -- Inter de Beta où Alpha a un groupe
  insert into public.sessions (reference, start_date, end_date, client_id, company_id, session_type)
    values ('ESSAI-0504-I', current_date - 5, current_date - 5, v_b, v_cie, 'inter') returning id into v_si;
  insert into public.session_groups (session_id, client_id, kind, company_id) values (v_si, v_a, 'entreprise', v_cie);
  insert into public.client_portal_access (client_id, access_code, company_id) values (v_a, '482915', v_cie) returning token into v_tok;

  -- 1. Mauvais code : erreur du lien, rien écrit
  v_r := public.client_portal_satisfaction(v_tok, '000000', v_sa, '{"note_globale": 4}'::jsonb);
  if not v_r ? 'error' then raise exception '1. mauvais code accepté (%)', v_r; end if;
  if exists (select 1 from public.client_satisfactions where client_id = v_a) then raise exception '1. avis écrit avec un mauvais code'; end if;
  v_r := public.client_portal_satisfactions(v_tok, '000000');
  if jsonb_typeof(v_r) <> 'object' or not v_r ? 'error' then raise exception '1b. liste lue avec un mauvais code (%)', v_r; end if;

  -- 2. Lecture avant tout avis : rien
  v_r := public.client_portal_satisfaction(v_tok, '482915', v_sa, null);
  if v_r is not null then raise exception '2. avis inventé (%)', v_r; end if;

  -- 3. Premier avis par le lien : écrit sans profil, une notification
  v_r := public.client_portal_satisfaction(v_tok, '482915', v_sa,
    '{"note_globale": 4, "q_suivi": 5, "recommande": true, "commentaire": "  Très bien  ", "besoins": ""}'::jsonb);
  if (v_r->>'note_globale')::int <> 4 or v_r->>'commentaire' <> 'Très bien' or v_r->>'besoins' is not null then raise exception '3. réponse fausse (%)', v_r; end if;
  if not exists (select 1 from public.client_satisfactions where client_id = v_a and session_id = v_sa and profile_id is null and q_suivi = 5 and recommande) then
    raise exception '3. avis non écrit';
  end if;
  select count(*) into v_n from public.notifications where type = 'satisfaction_entreprise' and metadata->>'session_id' = v_sa::text;
  if v_n <> 1 then raise exception '3. notifications : % au lieu de 1', v_n; end if;

  -- 4. Avis modifié : remplacé, pas de seconde notification
  v_r := public.client_portal_satisfaction(v_tok, '482915', v_sa, '{"note_globale": 2, "recommande": false}'::jsonb);
  if (select note_globale from public.client_satisfactions where client_id = v_a and session_id = v_sa) <> 2
     or (select q_suivi from public.client_satisfactions where client_id = v_a and session_id = v_sa) is not null then raise exception '4. avis non remplacé'; end if;
  select count(*) into v_n from public.notifications where type = 'satisfaction_entreprise' and metadata->>'session_id' = v_sa::text;
  if v_n <> 1 then raise exception '4. notifications : % au lieu de 1', v_n; end if;

  -- 5. Formation pas encore terminée : refusée
  begin
    v_r := public.client_portal_satisfaction(v_tok, '482915', v_sf, '{"note_globale": 5}'::jsonb);
    raise exception '5. avis accepté avant la fin';
  exception when sqlstate '22023' then get stacked diagnostics v_msg = message_text;
    if v_msg not like 'L''avis se donne à la fin%' then raise exception '5. message faux (%)', v_msg; end if;
  end;

  -- 6. Session d'un autre client : refusée, en lecture comme en écriture
  begin
    v_r := public.client_portal_satisfaction(v_tok, '482915', v_sb, null);
    raise exception '6. session d''un autre client lue';
  exception when sqlstate '42501' then null;
  end;
  begin
    v_r := public.client_portal_satisfaction(v_tok, '482915', v_sb, '{"note_globale": 5}'::jsonb);
    raise exception '6. session d''un autre client notée';
  exception when sqlstate '42501' then null;
  end;

  -- 7. Inter par un groupe du client : acceptée
  v_r := public.client_portal_satisfaction(v_tok, '482915', v_si, '{"note_globale": 5}'::jsonb);
  if (v_r->>'note_globale')::int <> 5 then raise exception '7. inter par groupe refusée (%)', v_r; end if;

  -- 8. Notes hors bornes : refusées
  begin
    v_r := public.client_portal_satisfaction(v_tok, '482915', v_sa, '{"note_globale": 0}'::jsonb);
    raise exception '8. note 0 acceptée';
  exception when sqlstate '22023' then null;
  end;
  begin
    v_r := public.client_portal_satisfaction(v_tok, '482915', v_sa, '{"note_globale": 3, "q_objectifs": 6}'::jsonb);
    raise exception '8. note 6 acceptée';
  exception when sqlstate '22023' then null;
  end;

  -- 9. Liste des avis du client : ses deux sessions, rien de Beta
  v_r := public.client_portal_satisfactions(v_tok, '482915');
  if jsonb_array_length(v_r) <> 2 or v_r @> jsonb_build_array(jsonb_build_object('session_id', v_sb)) then raise exception '9. liste fausse (%)', v_r; end if;
  if not v_r @> jsonb_build_array(jsonb_build_object('session_id', v_sa, 'note_globale', 2)) then raise exception '9. note de la session absente (%)', v_r; end if;

  -- 10. Lien désactivé : refusé
  update public.client_portal_access set is_active = false where token = v_tok;
  v_r := public.client_portal_satisfaction(v_tok, '482915', v_sa, '{"note_globale": 5}'::jsonb);
  if not v_r ? 'error' then raise exception '10. lien désactivé accepté (%)', v_r; end if;
  if (select note_globale from public.client_satisfactions where client_id = v_a and session_id = v_sa) <> 2 then raise exception '10. avis changé par un lien désactivé'; end if;

  -- 11. Droits : règles communes fermées ; lien ouvert à anon ; compte réservé aux connectés
  if has_function_privilege('anon', 'app.satisfaction_client(uuid, uuid, uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'app.satisfaction_client(uuid, uuid, uuid, jsonb)', 'execute')
     or has_function_privilege('anon', 'app.satisfactions_client(uuid)', 'execute')
     or has_function_privilege('authenticated', 'app.satisfactions_client(uuid)', 'execute') then raise exception '11. règle commune ouverte'; end if;
  if not has_function_privilege('anon', 'public.client_portal_satisfaction(text, text, uuid, jsonb)', 'execute')
     or not has_function_privilege('anon', 'public.client_portal_satisfactions(text, text)', 'execute') then raise exception '11. lien fermé à anon'; end if;
  if has_function_privilege('anon', 'public.ent_satisfaction(uuid, jsonb)', 'execute') then raise exception '11. compte ouvert à anon'; end if;

  -- 12. Espace par compte : toujours réservé à un compte entreprise actif
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    v_r := public.ent_satisfaction(v_sa, null);
    raise exception '12. lu sans compte entreprise';
  exception when sqlstate '42501' then get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Espace entreprise%' then raise exception '12. message faux (%)', v_msg; end if;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end
$$;

rollback;
