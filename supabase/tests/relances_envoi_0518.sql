-- Essai de 0518 : envoi des relances depuis l'outil (réservation, fin d'envoi, colonnes protégées, retouche).
-- Rouge sans 0518 (colonnes et fonctions absentes). Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_u uuid := gen_random_uuid(); v_l uuid := gen_random_uuid(); c_u text; c_l text;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; r jsonb; v_row public.scheduled_actions;
begin
  select id into v_cie from public.companies where status = 'active' order by created_at limit 1;

  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'autre', 'Essai 0518 A', 'valide', 'essai-0518-a', '{"destinataire":"a@exemple.invalid","objet":"Objet A","texte":"Bonjour A"}')
    returning id into v_a;
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'autre', 'Essai 0518 B', 'a_valider', 'essai-0518-b', '{"destinataire":"b@exemple.invalid","objet":"Objet B","texte":"Bonjour B"}')
    returning id into v_b;
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'autre', 'Essai 0518 C', 'valide', 'essai-0518-c', '{"destinataire":"pas une adresse","texte":"Bonjour C"}')
    returning id into v_c;
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'autre', 'Essai 0518 D', 'valide', 'essai-0518-d', '{"destinataire":"d@exemple.invalid","texte":"  "}')
    returning id into v_d;
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload, blocked_reason) values
    (v_cie, 'autre', 'Essai 0518 E', 'valide', 'essai-0518-e', '{"destinataire":"e@exemple.invalid","texte":"Bonjour E"}', 'session incomplète')
    returning id into v_e;

  -- Comptes : un administrateur (droit d'envoyer) et un compte en lecture seule
  insert into auth.users (id, email, aud, role) values (v_u, 'u-0518@exemple.invalid', 'authenticated', 'authenticated'),
    (v_l, 'l-0518@exemple.invalid', 'authenticated', 'authenticated');
  insert into public.profiles (id, email) values (v_u, 'u-0518@exemple.invalid'), (v_l, 'l-0518@exemple.invalid') on conflict (id) do nothing;
  update public.profiles set is_active = true where id in (v_u, v_l);
  insert into public.company_members (company_id, profile_id, role, is_default, is_active) values (v_cie, v_u, 'admin', true, true), (v_cie, v_l, 'lecture', true, true)
  on conflict (company_id, profile_id) do update set role = excluded.role, is_active = true, is_default = true;
  c_u := json_build_object('sub', v_u, 'role', 'authenticated')::text;
  c_l := json_build_object('sub', v_l, 'role', 'authenticated')::text;

  -- 1. Sans connexion : refusé
  begin
    perform public.relance_envoi_reserver(v_a);
    raise exception '1. réservation sans connexion acceptée';
  exception when insufficient_privilege then null;
  end;

  -- 2. Compte en lecture seule : refusé
  perform set_config('request.jwt.claims', c_l, true);
  perform set_config('request.jwt.claim.sub', v_l::text, true);
  execute 'set local role authenticated';
  begin
    perform public.relance_envoi_reserver(v_a);
    raise exception '2. réservation par un compte sans droit acceptée';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  -- Compte avec le droit
  perform set_config('request.jwt.claims', c_u, true);
  perform set_config('request.jwt.claim.sub', v_u::text, true);
  execute 'set local role authenticated';

  -- 3. Colonnes d'envoi non écrites par un compte
  update public.scheduled_actions set envoi_reserve_at = now(), envoi_boite = 'x@exemple.invalid', envoi_message_id = 'x', texte_retouche = true where id = v_a;
  select * into v_row from public.scheduled_actions where id = v_a;
  if v_row.envoi_reserve_at is not null or v_row.envoi_boite is not null or v_row.envoi_message_id is not null or v_row.texte_retouche then
    raise exception '3. colonnes d''envoi écrites par un compte';
  end if;

  -- 4. Retouche : texte changé par une personne
  update public.scheduled_actions set payload = payload || '{"texte":"Bonjour B, corrigé"}' where id = v_b;
  if not (select texte_retouche from public.scheduled_actions where id = v_b) then raise exception '4a. retouche non notée'; end if;
  update public.scheduled_actions set status = 'valide' where id = v_b;
  if not (select texte_retouche from public.scheduled_actions where id = v_b) then raise exception '4b. retouche perdue'; end if;

  -- 5. Refus : pas « à envoyer », adresse invalide, texte vide, relance bloquée
  update public.scheduled_actions set status = 'a_valider' where id = v_b;
  begin perform public.relance_envoi_reserver(v_b); raise exception '5a. relance à valider réservée';
  exception when invalid_parameter_value then null; end;
  begin perform public.relance_envoi_reserver(v_c); raise exception '5b. adresse invalide réservée';
  exception when invalid_parameter_value then null; end;
  begin perform public.relance_envoi_reserver(v_d); raise exception '5c. texte vide réservé';
  exception when invalid_parameter_value then null; end;
  begin perform public.relance_envoi_reserver(v_e); raise exception '5d. relance bloquée réservée';
  exception when invalid_parameter_value then null; end;

  -- 6. Réservation : ce qui part, objet par défaut = titre si vide
  r := public.relance_envoi_reserver(v_a);
  if r->>'destinataire' <> 'a@exemple.invalid' or r->>'objet' <> 'Objet A' or r->>'texte' <> 'Bonjour A' then raise exception '6a. contenu %', r; end if;
  if (select envoi_reserve_at from public.scheduled_actions where id = v_a) is null then raise exception '6b. réservation non posée'; end if;
  -- Seconde réservation pendant l'envoi : refusée
  begin perform public.relance_envoi_reserver(v_a); raise exception '6c. double réservation';
  exception when invalid_parameter_value then null; end;
  -- Texte et état figés pendant l'envoi
  begin update public.scheduled_actions set payload = payload || '{"texte":"autre"}' where id = v_a; raise exception '6d. texte changé pendant l''envoi';
  exception when invalid_parameter_value then null; end;
  begin update public.scheduled_actions set status = 'a_valider' where id = v_a; raise exception '6e. état changé pendant l''envoi';
  exception when invalid_parameter_value then null; end;

  -- 7. Échec : l'erreur est notée, la relance reste à envoyer et peut repartir
  perform public.relance_envoi_terminer(v_a, false, 'Boîte injoignable');
  select * into v_row from public.scheduled_actions where id = v_a;
  if v_row.status <> 'valide' or v_row.error <> 'Boîte injoignable' or v_row.envoi_reserve_at is not null then raise exception '7a. échec mal noté'; end if;
  begin perform public.relance_envoi_terminer(v_a, true); raise exception '7b. fin sans envoi en cours acceptée';
  exception when invalid_parameter_value then null; end;

  -- 8. Réussite : envoyée, auteur, date, boîte, message ; erreur effacée ; plus rien ne bouge
  r := public.relance_envoi_reserver(v_a);
  if (select error from public.scheduled_actions where id = v_a) is not null then raise exception '8a. erreur gardée à la réservation'; end if;
  perform public.relance_envoi_terminer(v_a, true, null, '<m-0518@exemple.invalid>', 'u-0518@exemple.invalid');
  select * into v_row from public.scheduled_actions where id = v_a;
  if v_row.status <> 'envoye' or v_row.sent_by is distinct from v_u or v_row.sent_at is null
     or v_row.envoi_boite <> 'u-0518@exemple.invalid' or v_row.envoi_message_id <> '<m-0518@exemple.invalid>'
     or v_row.envoi_reserve_at is not null or v_row.error is not null or v_row.texte_retouche then
    raise exception '8b. réussite mal notée : %', row_to_json(v_row);
  end if;
  begin perform public.relance_envoi_reserver(v_a); raise exception '8c. relance envoyée réservée';
  exception when invalid_parameter_value then null; end;

  -- 9. « Marquer envoyée » à la main reste possible
  update public.scheduled_actions set status = 'valide' where id = v_b;
  update public.scheduled_actions set status = 'envoye' where id = v_b;
  if (select status from public.scheduled_actions where id = v_b) <> 'envoye' then raise exception '9. marquer envoyée refusé'; end if;
  execute 'reset role';

  -- 10. Fonctions fermées au visiteur sans compte
  if has_function_privilege('anon', 'public.relance_envoi_reserver(uuid)', 'execute')
     or has_function_privilege('anon', 'public.relance_envoi_terminer(uuid, boolean, text, text, text)', 'execute') then
    raise exception '10. fonctions ouvertes au visiteur';
  end if;
end $$;

select 'VERT' as essai_0518;
rollback;
