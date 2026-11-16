-- Essai de 0519 : réglage des envois à trois modes (droits, modes permis, suspension), proposition de l'automatique
-- après 5 envois sans retouche, relances du circuit dans la file (préparation, une seule fois, écart), envoi
-- automatique de la file (sélection, réservation, fin sans auteur), fin d'envoi des questionnaires à froid fermée aux comptes.
-- Rouge sans 0519 (fonctions et colonne absentes). Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_adm uuid := gen_random_uuid(); v_lec uuid := gen_random_uuid(); v_sa uuid := gen_random_uuid();
  c_adm text; c_lec text; c_sa text;
  v_cli uuid; v_q uuid; v_s uuid; v_t uuid; v_r1 uuid; v_r2 uuid; v_x uuid; v_y uuid; v_z uuid; v_w uuid;
  r jsonb; v_n int; v_row public.scheduled_actions;
begin
  select id into v_cie from public.companies where status = 'active' order by created_at limit 1;

  -- 0. Reprise : un mode posé et permis pour chaque type
  if exists (select 1 from unnest(app.envoi_types()) t(kind)
              where not exists (select 1 from public.auto_send_switches s where s.company_id = v_cie and s.kind = t.kind
                                  and s.mode = any (app.envoi_modes_permis(t.kind)))) then
    raise exception '0. reprise incomplète';
  end if;
  if cardinality(app.envoi_types()) <> 11 or 'convocation' = any (app.envoi_types()) or 'relance_devis' = any (app.envoi_types()) then
    raise exception '0b. types';
  end if;

  insert into auth.users (id, email, aud, role) values (v_adm, 'adm-0519@exemple.invalid', 'authenticated', 'authenticated'),
    (v_lec, 'lec-0519@exemple.invalid', 'authenticated', 'authenticated'), (v_sa, 'sa-0519@exemple.invalid', 'authenticated', 'authenticated');
  insert into public.profiles (id, email) values (v_adm, 'adm-0519@exemple.invalid'), (v_lec, 'lec-0519@exemple.invalid'), (v_sa, 'sa-0519@exemple.invalid')
  on conflict (id) do nothing;
  update public.profiles set is_active = true where id in (v_adm, v_lec, v_sa);
  -- Droits complets de la société (licence), pour que l'administrateur ait le droit de régler l'organisme
  update public.companies set full_license = true where id = v_cie;
  alter table public.profiles disable trigger profiles_protect_role;
  update public.profiles set role = 'superadmin' where id = v_sa;
  update public.profiles set role = 'admin' where id = v_adm;
  alter table public.profiles enable trigger profiles_protect_role;
  insert into public.company_members (company_id, profile_id, role, is_default, is_active) values
    (v_cie, v_adm, 'admin', true, true), (v_cie, v_lec, 'lecture', true, true), (v_cie, v_sa, 'admin', true, true)
  on conflict (company_id, profile_id) do update set role = excluded.role, is_active = true, is_default = true;
  c_adm := json_build_object('sub', v_adm, 'role', 'authenticated')::text;
  c_lec := json_build_object('sub', v_lec, 'role', 'authenticated')::text;
  c_sa := json_build_object('sub', v_sa, 'role', 'authenticated')::text;

  -- 1. Régler : sans connexion, compte en lecture, administrateur (pas l'automatique), super administrateur
  begin perform public.envoi_regler(v_cie, 'relance_circuit', 'ferme'); raise exception '1. réglage sans connexion accepté';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', c_lec, true); perform set_config('request.jwt.claim.sub', v_lec::text, true);
  execute 'set local role authenticated';
  begin perform public.envoi_regler(v_cie, 'relance_circuit', 'ferme'); raise exception '1b. réglage par un compte en lecture accepté';
  exception when insufficient_privilege then null; end;
  begin perform public.envois_reglages(v_cie); raise exception '1c. lecture des réglages sans droit acceptée';
  exception when insufficient_privilege then null; end;
  if jsonb_array_length(public.envois_reglages(null)) <> 0 then raise exception '1d. réglages lus sans droit'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', c_adm, true); perform set_config('request.jwt.claim.sub', v_adm::text, true);
  execute 'set local role authenticated';
  perform public.envoi_regler(v_cie, 'relance_circuit', 'a_valider');
  perform public.envoi_regler(v_cie, 'relance_circuit', 'ferme');
  begin perform public.envoi_regler(v_cie, 'rappel', 'ferme'); raise exception '1j1. relance de la file fermée acceptée (la préparation ne lit pas le réglage)';
  exception when invalid_parameter_value then null; end;
  begin perform public.envoi_regler(v_cie, 'rappel', 'auto'); raise exception '1e. automatique par un administrateur accepté';
  exception when insufficient_privilege then null; end;
  begin perform public.envoi_regler(v_cie, 'convocation', 'a_valider'); raise exception '1h. type retiré accepté';
  exception when invalid_parameter_value then null; end;
  begin update public.auto_send_switches set mode = 'auto' where company_id = v_cie and kind = 'rappel';
    if found then raise exception '1i. mode écrit à la main'; end if;
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  if app.envoi_ouvert(v_cie, 'relance_circuit') or app.envoi_auto_autorise(v_cie, 'relance_circuit') then raise exception '1j. fermé'; end if;
  if not exists (select 1 from public.auto_send_switch_log where company_id = v_cie and kind = 'relance_circuit' and action = 'ferme' and user_id = v_adm) then
    raise exception '1k. journal'; end if;
  perform set_config('request.jwt.claims', c_sa, true); perform set_config('request.jwt.claim.sub', v_sa::text, true);
  execute 'set local role authenticated';
  perform public.envoi_regler(v_cie, 'rappel', 'auto');
  -- Modes permis, même pour le super administrateur
  begin perform public.envoi_regler(v_cie, 'evaluation_froid', 'auto'); raise exception '1f. automatique des questionnaires à froid accepté';
  exception when invalid_parameter_value then null; end;
  begin perform public.envoi_regler(v_cie, 'demande_nir', 'ferme'); raise exception '1g. demande du n° fermée acceptée';
  exception when invalid_parameter_value then null; end;
  execute 'reset role';
  if not app.envoi_auto_autorise(v_cie, 'rappel') or not app.envoi_ouvert(v_cie, 'rappel') then raise exception '1l. automatique'; end if;
  -- Un administrateur peut ramener à « à valider »
  perform set_config('request.jwt.claims', c_adm, true); perform set_config('request.jwt.claim.sub', v_adm::text, true);
  execute 'set local role authenticated';
  perform public.envoi_regler(v_cie, 'autre', 'a_valider');
  execute 'reset role';
  if not app.envoi_ouvert(v_cie, 'autre') or app.envoi_auto_autorise(v_cie, 'autre') then raise exception '1m. à valider'; end if;

  -- 2. Suspension : plus rien ne part ni ne se prépare
  update public.auto_send_switches set suspended_until = now() + interval '1 hour' where company_id = v_cie and kind = 'rappel';
  if app.envoi_auto_autorise(v_cie, 'rappel') or app.envoi_ouvert(v_cie, 'rappel') then raise exception '2. suspendu'; end if;
  update public.auto_send_switches set suspended_until = null where company_id = v_cie and kind = 'rappel';

  -- 3. Proposition de l'automatique : 5 envois validés sans retouche depuis le dernier réglage
  perform set_config('request.jwt.claims', c_sa, true); perform set_config('request.jwt.claim.sub', v_sa::text, true);
  execute 'set local role authenticated';
  perform public.envoi_regler(v_cie, 'avis_financeur', 'a_valider');
  execute 'reset role';
  update public.auto_send_switches set mode_at = now() - interval '1 day' where company_id = v_cie and kind = 'avis_financeur';
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload, validated_by, validated_at, sent_at, texte_retouche)
  select v_cie, 'avis_financeur', 'Essai 0519 P' || g, 'envoye', 'essai-0519-p' || g, '{"destinataire":"p@exemple.invalid","texte":"T"}',
         v_adm, now() - interval '2 hours', now() - interval '1 hour' + g * interval '1 minute', false
    from generate_series(1, 4) g;
  perform set_config('request.jwt.claims', c_sa, true); perform set_config('request.jwt.claim.sub', v_sa::text, true);
  execute 'set local role authenticated';
  select x into r from jsonb_array_elements(public.envois_reglages(v_cie)) x where x->>'kind' = 'avis_financeur';
  if (r->>'sans_retouche')::int <> 4 or (r->>'proposition')::boolean then raise exception '3. 4 envois : %', r; end if;
  if jsonb_array_length(public.envois_reglages(v_cie)) <> 11 or jsonb_array_length(public.envois_reglages(null)) < 11 then raise exception '3b. 11 types'; end if;
  execute 'reset role';
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload, validated_by, validated_at, sent_at, texte_retouche)
  values (v_cie, 'avis_financeur', 'Essai 0519 P5', 'envoye', 'essai-0519-p5', '{"destinataire":"p@exemple.invalid","texte":"T"}',
          v_adm, now() - interval '2 hours', now() - interval '30 minutes', false);
  -- Relance partie seule (validée par la base) : ne compte pas
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload, validated_by, validated_at, sent_at, texte_retouche)
  values (v_cie, 'avis_financeur', 'Essai 0519 P6', 'envoye', 'essai-0519-p6', '{"destinataire":"p@exemple.invalid","texte":"T"}',
          null, now() - interval '2 hours', now() - interval '29 minutes', false);
  execute 'set local role authenticated';
  select x into r from jsonb_array_elements(public.envois_reglages(v_cie)) x where x->>'kind' = 'avis_financeur';
  if (r->>'sans_retouche')::int <> 5 or not (r->>'proposition')::boolean then raise exception '3c. 5 envois : %', r; end if;
  select x into r from jsonb_array_elements(public.envois_reglages(v_cie)) x where x->>'kind' = 'demande_nir';
  if r->>'sans_retouche' is not null or (r->>'proposition')::boolean then raise exception '3d. demande du n° : %', r; end if;
  execute 'reset role';
  -- Une retouche remet le compteur à zéro
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload, validated_by, validated_at, sent_at, texte_retouche)
  values (v_cie, 'avis_financeur', 'Essai 0519 P7', 'envoye', 'essai-0519-p7', '{"destinataire":"p@exemple.invalid","texte":"T"}',
          v_adm, now() - interval '2 hours', now() - interval '20 minutes', true);
  if app.envoi_sans_retouche(v_cie, 'avis_financeur') <> 0 then raise exception '3e. retouche : %', app.envoi_sans_retouche(v_cie, 'avis_financeur'); end if;
  -- Un nouveau réglage aussi (envois comptés depuis le dernier changement)
  delete from public.scheduled_actions where dedup_key = 'essai-0519-p7';
  update public.auto_send_switches set mode_at = now() - interval '25 minutes' where company_id = v_cie and kind = 'avis_financeur';
  if app.envoi_sans_retouche(v_cie, 'avis_financeur') <> 0 then raise exception '3f. depuis le réglage'; end if;

  -- 4. Relances du circuit dans la file
  update public.auto_send_switches set mode = 'a_valider' where company_id = v_cie and kind = 'relance_circuit';
  insert into public.clients (name, company_id, email) values ('Client essai 0519', v_cie, 'client-0519@exemple.invalid') returning id into v_cli;
  insert into public.quotes (reference, client_id, company_id, status, object) values ('ESSAI-0519', v_cli, v_cie, 'accepted', 'Formation') returning id into v_q;
  insert into public.sessions (reference, start_date, end_date, status, company_id, client_id, quote_id)
    values ('ESSAI-0519-1', current_date + 5, current_date + 5, 'planned', v_cie, v_cli, v_q) returning id into v_s;
  if not exists (select 1 from jsonb_array_elements(public.circuit_relances_dues()) x where x->>'session_id' = v_s::text and x->>'kind' = 'participants') then
    raise exception '4. relance due absente'; end if;
  update public.auto_send_switches set mode = 'ferme' where company_id = v_cie and kind = 'relance_circuit';
  if exists (select 1 from jsonb_array_elements(public.circuit_relances_dues()) x where x->>'session_id' = v_s::text)
     or public.circuit_relance_preparer(v_s, 'participants', 'client-0519@exemple.invalid', 'Objet', 'Texte') is not null then
    raise exception '4b. fermé : préparée quand même'; end if;
  update public.auto_send_switches set mode = 'a_valider' where company_id = v_cie and kind = 'relance_circuit';
  v_r1 := public.circuit_relance_preparer(v_s, 'participants', 'client-0519@exemple.invalid', 'Participants à indiquer', 'Bonjour, texte');
  select * into v_row from public.scheduled_actions where id = v_r1;
  if v_r1 is null or v_row.kind <> 'relance_circuit' or v_row.status <> 'a_valider' or not v_row.envoi_possible or v_row.session_id <> v_s
     or v_row.payload->>'circuit' <> 'participants' or v_row.payload->>'destinataire' <> 'client-0519@exemple.invalid' or v_row.title <> 'Participants à indiquer' then
    raise exception '4c. relance préparée : %', row_to_json(v_row); end if;
  if public.circuit_relance_preparer(v_s, 'participants', 'client-0519@exemple.invalid', 'Objet', 'Texte') is not null
     or exists (select 1 from jsonb_array_elements(public.circuit_relances_dues()) x where x->>'session_id' = v_s::text) then
    raise exception '4d. préparée deux fois'; end if;
  begin perform public.circuit_relance_preparer(v_s, 'autre chose', 'a@exemple.invalid', 'O', 'T'); raise exception '4e. objet inconnu accepté';
  exception when invalid_parameter_value then null; end;
  -- Participants saisis : relance écartée, puis convention due
  insert into public.trainees (first_name, last_name, company_id) values ('Alice', 'ESSAI', v_cie) returning id into v_t;
  insert into public.session_trainees (session_id, trainee_id) values (v_s, v_t);
  if public.circuit_relances_ecarter() < 1 then raise exception '4f. rien écarté'; end if;
  select * into v_row from public.scheduled_actions where id = v_r1;
  if v_row.status <> 'ignore' or v_row.error <> 'Participants saisis entre-temps' then raise exception '4g. écart : % %', v_row.status, v_row.error; end if;
  if not exists (select 1 from jsonb_array_elements(public.circuit_relances_dues()) x where x->>'session_id' = v_s::text and x->>'kind' = 'convention') then
    raise exception '4h. convention due absente'; end if;
  v_r2 := public.circuit_relance_preparer(v_s, 'convention', 'client-0519@exemple.invalid', 'Convention à signer', 'Bonjour');
  update public.sessions set convention_signed = true where id = v_s;
  perform public.circuit_relances_ecarter();
  if (select error from public.scheduled_actions where id = v_r2) <> 'Convention signée entre-temps' then raise exception '4i. convention signée'; end if;

  -- 5. Envoi automatique de la file (rappel en automatique depuis 1, autre à valider)
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload, due_on) values
    (v_cie, 'rappel', 'Essai 0519 X', 'a_valider', 'essai-0519-x', '{"destinataire":"x@exemple.invalid","objet":"Objet X","texte":"Bonjour X"}', current_date) returning id into v_x;
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload, due_on) values
    (v_cie, 'rappel', 'Essai 0519 Y', 'a_valider', 'essai-0519-y', '{"destinataire":"y@exemple.invalid","texte":"Bonjour Y"}', current_date + 3) returning id into v_y;
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload, blocked_reason) values
    (v_cie, 'rappel', 'Essai 0519 Z', 'a_valider', 'essai-0519-z', '{"destinataire":"z@exemple.invalid","texte":"Bonjour Z"}', 'bloquée') returning id into v_z;
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'autre', 'Essai 0519 W', 'a_valider', 'essai-0519-w', '{"destinataire":"w@exemple.invalid","texte":"Bonjour W"}') returning id into v_w;
  if not (v_x = any (array(select public.relances_auto_a_envoyer(100))))
     or v_y = any (array(select public.relances_auto_a_envoyer(100))) or v_z = any (array(select public.relances_auto_a_envoyer(100)))
     or v_w = any (array(select public.relances_auto_a_envoyer(100))) then
    raise exception '5. sélection automatique'; end if;
  if public.relance_auto_reserver(v_w) is not null or public.relance_auto_reserver(v_y) is not null or public.relance_auto_reserver(v_z) is not null then
    raise exception '5b. réservation hors automatique'; end if;
  r := public.relance_auto_reserver(v_x);
  select * into v_row from public.scheduled_actions where id = v_x;
  if r is null or r->>'destinataire' <> 'x@exemple.invalid' or r->>'objet' <> 'Objet X' or v_row.status <> 'valide' or v_row.validated_by is not null
     or v_row.validated_at is null or v_row.envoi_reserve_at is null or v_row.envoi_reserve_par is not null then
    raise exception '5c. réservation : % %', r, row_to_json(v_row); end if;
  if public.relance_auto_reserver(v_x) is not null or v_x = any (array(select public.relances_auto_a_envoyer(100))) then raise exception '5d. réservée deux fois'; end if;
  if public.relance_envoi_terminer(v_x, null, true, null, '<m-0519@exemple.invalid>', 'boite@exemple.invalid') <> 'envoyee' then raise exception '5e. fin'; end if;
  select * into v_row from public.scheduled_actions where id = v_x;
  if v_row.status <> 'envoye' or v_row.sent_by is not null or v_row.envoi_message_id <> '<m-0519@exemple.invalid>' or v_row.envoi_reserve_at is not null then
    raise exception '5f. envoyée : %', row_to_json(v_row); end if;
  -- Échec sûrement avant l'envoi : erreur notée, la relance repart au passage suivant
  update public.scheduled_actions set due_on = current_date where id = v_y;
  perform public.relance_auto_reserver(v_y);
  if public.relance_envoi_terminer(v_y, null, false, 'Connexion refusée') <> 'erreur' then raise exception '5g. échec'; end if;
  if (select status from public.scheduled_actions where id = v_y) <> 'valide' or not (v_y = any (array(select public.relances_auto_a_envoyer(100)))) then
    raise exception '5h. reprise après échec'; end if;
  -- Résultat incertain (réservation restée) : jamais repris seul
  perform public.relance_auto_reserver(v_y);
  if v_y = any (array(select public.relances_auto_a_envoyer(100))) or public.relance_auto_reserver(v_y) is not null then raise exception '5i. incertain repris'; end if;
  -- Retour à « à valider » : plus rien ne part seul
  update public.auto_send_switches set mode = 'a_valider' where company_id = v_cie and kind = 'rappel';
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'rappel', 'Essai 0519 V', 'a_valider', 'essai-0519-v', '{"destinataire":"v@exemple.invalid","texte":"Bonjour V"}') returning id into v_x;
  if v_x = any (array(select public.relances_auto_a_envoyer(100))) or public.relance_auto_reserver(v_x) is not null then raise exception '5j. à valider parti seul'; end if;
  -- Note interne : jamais
  update public.auto_send_switches set mode = 'auto' where company_id = v_cie and kind = 'rappel';
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'rappel', 'Essai 0519 I', 'a_valider', 'essai-0519-i', '{"interne":true,"destinataire":"i@exemple.invalid","texte":"Note"}') returning id into v_z;
  if v_z = any (array(select public.relances_auto_a_envoyer(100))) or public.relance_auto_reserver(v_z) is not null then raise exception '5k. note interne'; end if;

  -- Stock d'avant le passage en automatique, échéance dépassée de plus de 3 jours, remise à valider, adresse refusée : à la main
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload, created_at) values
    (v_cie, 'rappel', 'Essai 0519 S1', 'a_valider', 'essai-0519-s1', '{"destinataire":"s1@exemple.invalid","texte":"T"}', now() - interval '1 day') returning id into v_x;
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload, due_on) values
    (v_cie, 'rappel', 'Essai 0519 S2', 'a_valider', 'essai-0519-s2', '{"destinataire":"s2@exemple.invalid","texte":"T"}', current_date - 4) returning id into v_y;
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload, validated_at) values
    (v_cie, 'rappel', 'Essai 0519 S3', 'a_valider', 'essai-0519-s3', '{"destinataire":"s3@exemple.invalid","texte":"T"}', now()) returning id into v_z;
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload, error) values
    (v_cie, 'rappel', 'Essai 0519 S4', 'valide', 'essai-0519-s4', '{"destinataire":"s4@exemple.invalid","texte":"T"}', 'Adresse refusée par le serveur : s4@exemple.invalid') returning id into v_w;
  if v_x = any (array(select public.relances_auto_a_envoyer(100))) or public.relance_auto_reserver(v_x) is not null then raise exception '5l. stock parti seul'; end if;
  if v_y = any (array(select public.relances_auto_a_envoyer(100))) or public.relance_auto_reserver(v_y) is not null then raise exception '5m. échéance ancienne'; end if;
  if v_z = any (array(select public.relances_auto_a_envoyer(100))) or public.relance_auto_reserver(v_z) is not null then raise exception '5n. remise à valider'; end if;
  if v_w = any (array(select public.relances_auto_a_envoyer(100))) or public.relance_auto_reserver(v_w) is not null then raise exception '5o. adresse refusée'; end if;
  -- Relance déjà validée par une personne : garde sa validation
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload, validated_by, validated_at) values
    (v_cie, 'rappel', 'Essai 0519 S5', 'valide', 'essai-0519-s5', '{"destinataire":"s5@exemple.invalid","texte":"T"}', v_adm, now()) returning id into v_x;
  r := public.relance_auto_reserver(v_x);
  if r is null or (select validated_by from public.scheduled_actions where id = v_x) is distinct from v_adm then raise exception '5p. validation perdue'; end if;
  -- Relance du circuit devenue inutile : ni seule, ni à la main
  update public.auto_send_switches set mode = 'auto' where company_id = v_cie and kind = 'relance_circuit';
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload, session_id) values
    (v_cie, 'relance_circuit', 'Essai 0519 C', 'valide', 'essai-0519-c', jsonb_build_object('circuit', 'convention', 'destinataire', 'client-0519@exemple.invalid', 'texte', 'T'), v_s)
    returning id into v_r2;
  if v_r2 = any (array(select public.relances_auto_a_envoyer(100))) or public.relance_auto_reserver(v_r2) is not null then raise exception '5q. circuit inutile parti seul'; end if;
  perform set_config('request.jwt.claims', c_adm, true); perform set_config('request.jwt.claim.sub', v_adm::text, true);
  execute 'set local role authenticated';
  begin perform public.relance_envoi_reserver(v_r2, 'client-0519@exemple.invalid', (select validated_at from public.scheduled_actions where id = v_r2));
    raise exception '5r. circuit inutile envoyé à la main';
  exception when invalid_parameter_value then null; end;
  execute 'reset role';
  -- Type suspendu : plus d'envoi à la main depuis la file
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'relance_impaye', 'Essai 0519 S6', 'valide', 'essai-0519-s6', '{"destinataire":"s6@exemple.invalid","texte":"T"}') returning id into v_x;
  update public.auto_send_switches set suspended_until = now() + interval '1 hour' where company_id = v_cie and kind = 'relance_impaye';
  execute 'set local role authenticated';
  begin perform public.relance_envoi_reserver(v_x, 's6@exemple.invalid', (select validated_at from public.scheduled_actions where id = v_x));
    raise exception '5s. type suspendu envoyé à la main';
  exception when invalid_parameter_value then null; end;
  execute 'reset role';
  update public.auto_send_switches set suspended_until = null where company_id = v_cie and kind = 'relance_impaye';
  execute 'set local role authenticated';
  if public.relance_envoi_reserver(v_x, 's6@exemple.invalid', (select validated_at from public.scheduled_actions where id = v_x)) is null then raise exception '5t. envoi à la main'; end if;
  execute 'reset role';

  -- 6. Droits des fonctions de service et questionnaires à froid
  if has_function_privilege('authenticated', 'public.relance_auto_reserver(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.relances_auto_a_envoyer(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.circuit_relance_preparer(uuid,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.circuit_relances_ecarter()', 'execute')
     or has_function_privilege('authenticated', 'public.froid_envoi_terminer(uuid,uuid,boolean,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.envoi_auto_regler(uuid,text,boolean)', 'execute')
     or has_function_privilege('authenticated', 'app.envoi_ouvert(uuid,text)', 'execute')
     or to_regprocedure('public.froid_envoi_terminer(uuid,boolean,text,text,text)') is not null then
    raise exception '6. droits des fonctions';
  end if;
  update public.auto_send_switches set mode = 'ferme' where company_id = v_cie and kind = 'evaluation_froid';
  if app.envoi_ouvert(v_cie, 'evaluation_froid') or position('app.envoi_ouvert(e.company_id, ''evaluation_froid'')' in
       pg_get_functiondef('public.froid_envois_reserver(uuid[])'::regprocedure)) = 0 then
    raise exception '6b. questionnaires à froid fermés'; end if;
  update public.auto_send_switches set mode = 'a_valider' where company_id = v_cie and kind = 'evaluation_froid';
  if not app.envoi_ouvert(v_cie, 'evaluation_froid') or app.envoi_auto_autorise(v_cie, 'evaluation_froid') then raise exception '6c. à valider'; end if;
  -- Société créée ensuite (aucune ligne) : à valider par défaut
  if app.envoi_mode(gen_random_uuid(), 'rappel') <> 'a_valider' then raise exception '6d. défaut'; end if;
end
$$;
rollback;
