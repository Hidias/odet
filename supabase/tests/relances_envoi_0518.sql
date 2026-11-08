-- Essai de 0518 : envoi des relances depuis l'outil (ce qui peut partir, réservation, fin d'envoi, colonnes protégées,
-- texte figé après validation, retouche, envoi resté sans suite, changement d'état par la base).
-- Rouge sans 0518 (colonnes et fonctions absentes). Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_u uuid := gen_random_uuid(); v_l uuid := gen_random_uuid(); c_u text; c_l text;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_f uuid; v_g uuid; v_h uuid; v_i uuid; v_j uuid; v_m uuid; v_cie2 uuid; v_n uuid;
  r jsonb; v_row public.scheduled_actions;
  c_srv text := '{"role":"service_role"}';
begin
  select id into v_cie from public.companies where status = 'active' order by created_at limit 1;

  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'autre', 'Essai 0518 A', 'valide', 'essai-0518-a', '{"destinataire":"a@exemple.invalid","objet":"Objet A","texte":"Bonjour A"}') returning id into v_a;
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'autre', 'Essai 0518 B', 'a_valider', 'essai-0518-b', '{"destinataire":"b@exemple.invalid","objet":"Objet B","texte":"Bonjour B"}') returning id into v_b;
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'autre', 'Essai 0518 C', 'valide', 'essai-0518-c', '{"destinataire":"pas une adresse","texte":"Bonjour C"}') returning id into v_c;
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'autre', 'Essai 0518 D', 'valide', 'essai-0518-d', '{"destinataire":"d@exemple.invalid","texte":"  "}') returning id into v_d;
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload, blocked_reason) values
    (v_cie, 'autre', 'Essai 0518 E', 'valide', 'essai-0518-e', '{"destinataire":"e@exemple.invalid","texte":"Bonjour E"}', 'session incomplète') returning id into v_e;
  -- Étape du pilote faite depuis la session : le texte est une consigne pour l'équipe
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'convocation', 'Essai 0518 F', 'valide', 'essai-0518-f', '{"etape":"convocation","destinataire":"f@exemple.invalid","texte":"Convocations à envoyer depuis la session"}') returning id into v_f;
  -- Note interne et courrier qui attend l'expert
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'renouvellement_contrat', 'Essai 0518 G', 'valide', 'essai-0518-g', '{"interne":true,"destinataire":"g@exemple.invalid","texte":"Note"}') returning id into v_g;
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'renouvellement_contrat', 'Essai 0518 H', 'valide', 'essai-0518-h', '{"a_valider_par_expert":true,"destinataire":"h@exemple.invalid","texte":"Courrier"}') returning id into v_h;
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'relance_impaye', 'Essai 0518 I', 'valide', 'essai-0518-i', '{"destinataire":"i@exemple.invalid","objet":"Facture","texte":"Bonjour I"}') returning id into v_i;

  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'renouvellement_contrat', 'Essai 0518 J', 'a_valider', 'essai-0518-j', '{"interne":true,"etape":"x","destinataire":"j@exemple.invalid","texte":"Note J"}') returning id into v_j;
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie, 'relance_impaye', 'Essai 0518 M', 'valide', 'essai-0518-m', '{"etape":"mise_en_demeure","destinataire":"m@exemple.invalid","texte":"Mise en demeure"}') returning id into v_m;
  -- Règle déclenchée par une autre écriture (comme le règlement d'une facture) : table d'essai, annulée à la fin
  create table public.essai_0518_t (id int primary key, relance uuid);
  grant select, update on public.essai_0518_t to authenticated;
  create function public.essai_0518_f() returns trigger language plpgsql security definer set search_path = '' as $f$
  begin update public.scheduled_actions set status = 'ignore' where id = new.relance; return null; end $f$;
  create trigger essai_0518_tr after update on public.essai_0518_t for each row execute function public.essai_0518_f();

  -- 0. Ce qui peut partir
  if not (select envoi_possible from public.scheduled_actions where id = v_a) or not (select envoi_possible from public.scheduled_actions where id = v_i)
     or (select envoi_possible from public.scheduled_actions where id = v_f) or (select envoi_possible from public.scheduled_actions where id = v_g)
     or (select envoi_possible from public.scheduled_actions where id = v_h) or (select envoi_possible from public.scheduled_actions where id = v_m) then
    raise exception '0. règle des relances envoyables';
  end if;

  -- Comptes : un administrateur (droit d'envoyer) et un compte en lecture seule
  insert into auth.users (id, email, aud, role) values (v_u, 'u-0518@exemple.invalid', 'authenticated', 'authenticated'),
    (v_l, 'l-0518@exemple.invalid', 'authenticated', 'authenticated');
  insert into public.profiles (id, email) values (v_u, 'u-0518@exemple.invalid'), (v_l, 'l-0518@exemple.invalid') on conflict (id) do nothing;
  update public.profiles set is_active = true where id in (v_u, v_l);
  insert into public.company_members (company_id, profile_id, role, is_default, is_active) values (v_cie, v_u, 'admin', true, true), (v_cie, v_l, 'lecture', true, true)
  on conflict (company_id, profile_id) do update set role = excluded.role, is_active = true, is_default = true;
  -- Seconde société où le compte a le droit, mais qui n'est pas celle choisie (société par défaut : la première)
  insert into public.companies (legal_name) values ('Société essai 0518') returning id into v_cie2;
  insert into public.company_members (company_id, profile_id, role, is_default, is_active) values (v_cie2, v_u, 'admin', false, true);
  insert into public.scheduled_actions (company_id, kind, title, status, dedup_key, payload) values
    (v_cie2, 'autre', 'Essai 0518 N', 'valide', 'essai-0518-n', '{"destinataire":"n@exemple.invalid","texte":"Bonjour N"}') returning id into v_n;
  c_u := json_build_object('sub', v_u, 'role', 'authenticated')::text;
  c_l := json_build_object('sub', v_l, 'role', 'authenticated')::text;

  -- 1. Sans connexion : refusé
  begin perform public.relance_envoi_reserver(v_a, 'a@exemple.invalid', (select validated_at from public.scheduled_actions where id = v_a)); raise exception '1. réservation sans connexion acceptée';
  exception when insufficient_privilege then null; end;

  -- 2. Compte en lecture seule : refusé
  perform set_config('request.jwt.claims', c_l, true);
  perform set_config('request.jwt.claim.sub', v_l::text, true);
  execute 'set local role authenticated';
  begin perform public.relance_envoi_reserver(v_a, 'a@exemple.invalid', (select validated_at from public.scheduled_actions where id = v_a)); raise exception '2. réservation par un compte sans droit acceptée';
  exception when insufficient_privilege then null; end;
  execute 'reset role';

  -- Compte avec le droit
  perform set_config('request.jwt.claims', c_u, true);
  perform set_config('request.jwt.claim.sub', v_u::text, true);
  execute 'set local role authenticated';

  -- 3. Colonnes d'envoi non écrites par un compte
  update public.scheduled_actions set envoi_reserve_at = now(), envoi_reserve_par = v_u, envoi_boite = 'x@exemple.invalid', envoi_message_id = 'x', texte_retouche = true where id = v_a;
  select * into v_row from public.scheduled_actions where id = v_a;
  if v_row.envoi_reserve_at is not null or v_row.envoi_reserve_par is not null or v_row.envoi_boite is not null or v_row.envoi_message_id is not null or v_row.texte_retouche then
    raise exception '3. colonnes d''envoi écrites par un compte';
  end if;

  -- 4. Retouche avant validation ; texte figé après validation
  update public.scheduled_actions set payload = payload || '{"texte":"Bonjour B, corrigé"}' where id = v_b;
  if not (select texte_retouche from public.scheduled_actions where id = v_b) then raise exception '4a. retouche non notée'; end if;
  update public.scheduled_actions set status = 'valide' where id = v_b;
  if not (select texte_retouche from public.scheduled_actions where id = v_b) then raise exception '4b. retouche perdue'; end if;
  begin update public.scheduled_actions set payload = payload || '{"destinataire":"autre@exemple.invalid"}' where id = v_b; raise exception '4c. destinataire changé après validation';
  exception when invalid_parameter_value then null; end;
  begin update public.scheduled_actions set payload = payload || '{"texte":"autre"}' where id = v_b; raise exception '4d. texte changé après validation';
  exception when invalid_parameter_value then null; end;
  begin update public.scheduled_actions set title = 'Autre objet' where id = v_b; raise exception '4e. titre changé après validation';
  exception when invalid_parameter_value then null; end;
  update public.scheduled_actions set payload = payload || '{"note":"vu"}' where id = v_b;
  -- Validation et envoi non écrits à la main
  update public.scheduled_actions set validated_at = '2020-01-01', validated_by = v_l, sent_at = '2020-01-01', sent_by = v_l where id = v_b;
  select * into v_row from public.scheduled_actions where id = v_b;
  if v_row.validated_at = '2020-01-01' or v_row.validated_by is distinct from v_u or v_row.sent_at is not null or v_row.sent_by is not null then
    raise exception '4g. validation ou envoi écrits à la main';
  end if;
  -- Nature de la relance posée par la base seulement
  update public.scheduled_actions set payload = (payload - 'interne' - 'etape') || '{"a_valider_par_expert":false}' where id = v_j;
  select * into v_row from public.scheduled_actions where id = v_j;
  if v_row.payload->'interne' is distinct from 'true'::jsonb or v_row.payload->>'etape' is distinct from 'x' or v_row.payload ? 'a_valider_par_expert' or v_row.envoi_possible then
    raise exception '4f. nature de la relance changée par un compte : %', v_row.payload;
  end if;

  -- 5. Refus : pas « à envoyer », adresse invalide, texte vide, bloquée, non envoyable, destinataire différent de l'aperçu
  update public.scheduled_actions set status = 'a_valider' where id = v_b;
  begin perform public.relance_envoi_reserver(v_b, 'b@exemple.invalid', (select validated_at from public.scheduled_actions where id = v_b)); raise exception '5a. relance à valider réservée';
  exception when invalid_parameter_value then null; end;
  begin perform public.relance_envoi_reserver(v_c, 'pas une adresse', (select validated_at from public.scheduled_actions where id = v_c)); raise exception '5b. adresse invalide réservée';
  exception when invalid_parameter_value then null; end;
  begin perform public.relance_envoi_reserver(v_d, 'd@exemple.invalid', (select validated_at from public.scheduled_actions where id = v_d)); raise exception '5c. texte vide réservé';
  exception when invalid_parameter_value then null; end;
  begin perform public.relance_envoi_reserver(v_e, 'e@exemple.invalid', (select validated_at from public.scheduled_actions where id = v_e)); raise exception '5d. relance bloquée réservée';
  exception when invalid_parameter_value then null; end;
  begin perform public.relance_envoi_reserver(v_f, 'f@exemple.invalid', (select validated_at from public.scheduled_actions where id = v_f)); raise exception '5e. étape du pilote réservée';
  exception when invalid_parameter_value then null; end;
  begin perform public.relance_envoi_reserver(v_g, 'g@exemple.invalid', (select validated_at from public.scheduled_actions where id = v_g)); raise exception '5f. note interne réservée';
  exception when invalid_parameter_value then null; end;
  if v_cie2 not in (select app.societes_avec_droit('formation.convocations.envoyer')) then raise exception '5i. essai mal préparé : droit absent dans la seconde société'; end if;
  begin perform public.relance_envoi_reserver(v_n, 'n@exemple.invalid', null); raise exception '5i. relance d''une société non choisie réservée';
  exception when insufficient_privilege then null; end;
  begin perform public.relance_envoi_reserver(v_a, 'a@exemple.invalid', now()); raise exception '5h. validée autrement que lors de l''aperçu';
  exception when invalid_parameter_value then null; end;
  begin perform public.relance_envoi_reserver(v_a, 'autre@exemple.invalid', (select validated_at from public.scheduled_actions where id = v_a)); raise exception '5g. destinataire différent de l''aperçu';
  exception when invalid_parameter_value then null; end;

  -- 6. Réservation : ce qui part ; seconde réservation et état figés pendant l'envoi
  r := public.relance_envoi_reserver(v_a, ' A@exemple.invalid ', (select validated_at from public.scheduled_actions where id = v_a));
  if r->>'destinataire' <> 'a@exemple.invalid' or r->>'objet' <> 'Objet A' or r->>'texte' <> 'Bonjour A' then raise exception '6a. contenu %', r; end if;
  select * into v_row from public.scheduled_actions where id = v_a;
  if v_row.envoi_reserve_at is null or v_row.envoi_reserve_par is distinct from v_u then raise exception '6b. réservation non posée'; end if;
  begin perform public.relance_envoi_reserver(v_a, 'a@exemple.invalid', (select validated_at from public.scheduled_actions where id = v_a)); raise exception '6c. double réservation';
  exception when invalid_parameter_value then
    if sqlerrm not like 'Envoi déjà en cours%' then raise exception '6c. message : %', sqlerrm; end if;
  end;
  -- Étape du pilote, quel que soit le type
  perform set_config('app.relance_envoi', '', true);
  if app.relance_envoyable('autre', '{"etape":"convocation"}') or app.relance_envoyable('autre', '{"etape":"attestations"}') then
    raise exception '6f. étape du pilote envoyable';
  end if;
  begin update public.scheduled_actions set status = 'a_valider' where id = v_a; raise exception '6e. état changé pendant l''envoi';
  exception when invalid_parameter_value then null; end;

  -- 7. Fin d'envoi interdite à un compte
  begin perform public.relance_envoi_terminer(v_a, v_u, true); raise exception '7a. fin d''envoi par un compte';
  exception when insufficient_privilege then null; end;
  execute 'reset role';

  -- Clé de service (la route)
  perform set_config('request.jwt.claims', c_srv, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role service_role';
  begin perform public.relance_envoi_terminer(v_a, v_l, true); raise exception '7b. fin par un autre auteur';
  exception when invalid_parameter_value then null; end;
  -- 8. Échec : l'erreur est notée, la relance reste à envoyer
  perform public.relance_envoi_terminer(v_a, v_u, false, 'Boîte injoignable');
  select * into v_row from public.scheduled_actions where id = v_a;
  if v_row.status <> 'valide' or v_row.error <> 'Boîte injoignable' or v_row.envoi_reserve_at is not null or v_row.envoi_reserve_par is not null then raise exception '8a. échec mal noté'; end if;
  begin perform public.relance_envoi_terminer(v_a, v_u, true); raise exception '8b. fin sans envoi en cours acceptée';
  exception when invalid_parameter_value then null; end;
  execute 'reset role';
  -- L'erreur tombe quand la relance change d'état (remise à valider pour correction)
  perform set_config('request.jwt.claims', c_u, true);
  perform set_config('request.jwt.claim.sub', v_u::text, true);
  execute 'set local role authenticated';
  update public.scheduled_actions set status = 'a_valider' where id = v_a;
  if (select error from public.scheduled_actions where id = v_a) is not null then raise exception '8c. erreur gardée après remise à valider'; end if;
  update public.scheduled_actions set status = 'valide' where id = v_a;
  execute 'reset role';

  -- 9. Réussite : envoyée, auteur, date, boîte, message ; erreur effacée ; plus rien ne bouge
  perform set_config('request.jwt.claims', c_u, true);
  perform set_config('request.jwt.claim.sub', v_u::text, true);
  execute 'set local role authenticated';
  r := public.relance_envoi_reserver(v_a, 'a@exemple.invalid', (select validated_at from public.scheduled_actions where id = v_a));
  if (select error from public.scheduled_actions where id = v_a) is not null then raise exception '9a. erreur gardée à la réservation'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', c_srv, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role service_role';
  perform public.relance_envoi_terminer(v_a, v_u, true, null, '<m-0518@exemple.invalid>', 'u-0518@exemple.invalid');
  -- Second appel après une réponse perdue : accepté sans rien changer
  if public.relance_envoi_terminer(v_a, v_u, true, null, '<m-0518@exemple.invalid>', 'u-0518@exemple.invalid') <> 'envoyee' then raise exception '9d. second appel'; end if;
  begin perform public.relance_envoi_terminer(v_a, v_u, true, null, '<autre@exemple.invalid>', 'u-0518@exemple.invalid'); raise exception '9d. second appel avec un autre message';
  exception when invalid_parameter_value then null; end;
  execute 'reset role';
  select * into v_row from public.scheduled_actions where id = v_a;
  if v_row.status <> 'envoye' or v_row.sent_by is distinct from v_u or v_row.sent_at is null
     or v_row.envoi_boite <> 'u-0518@exemple.invalid' or v_row.envoi_message_id <> '<m-0518@exemple.invalid>'
     or v_row.envoi_reserve_at is not null or v_row.error is not null or v_row.texte_retouche then
    raise exception '9b. réussite mal notée : %', row_to_json(v_row);
  end if;

  -- 10. Changement d'état par la base pendant un envoi (règlement de la facture) : accepté, réservation levée
  perform set_config('request.jwt.claims', c_u, true);
  perform set_config('request.jwt.claim.sub', v_u::text, true);
  execute 'set local role authenticated';
  r := public.relance_envoi_reserver(v_i, 'i@exemple.invalid', (select validated_at from public.scheduled_actions where id = v_i));
  begin perform public.relance_envoi_reserver(v_a, 'a@exemple.invalid', (select validated_at from public.scheduled_actions where id = v_a)); raise exception '9c. relance envoyée réservée';
  exception when invalid_parameter_value then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  update public.scheduled_actions set status = 'ignore' where id = v_i;
  select * into v_row from public.scheduled_actions where id = v_i;
  if v_row.status <> 'ignore' or v_row.envoi_reserve_at is not null then raise exception '10a. état de la base refusé pendant l''envoi'; end if;
  perform set_config('request.jwt.claims', c_srv, true);
  execute 'set local role service_role';
  -- Mail parti quand même : noté sans changer l'état
  if public.relance_envoi_terminer(v_i, v_u, true, null, '<i-0518@exemple.invalid>', 'u-0518@exemple.invalid') <> 'ecartee' then raise exception '10b. fin sur une relance écartée'; end if;
  select * into v_row from public.scheduled_actions where id = v_i;
  if v_row.status <> 'ignore' or v_row.envoi_boite <> 'u-0518@exemple.invalid' or v_row.envoi_message_id <> '<i-0518@exemple.invalid>' or v_row.error is null or v_row.envoi_reserve_par is not null then
    raise exception '10b. trace du mail parti après écartement : %', row_to_json(v_row);
  end if;
  begin perform public.relance_envoi_terminer(v_i, v_u, true, null, '<j@exemple.invalid>'); raise exception '10b. seconde fin sur une relance écartée';
  exception when invalid_parameter_value then null; end;
  if public.relance_envoi_terminer(v_i, v_u, true, null, '<i-0518@exemple.invalid>', 'u-0518@exemple.invalid') <> 'ecartee' then raise exception '10b. second appel identique refusé'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- 10c. Même chose par un compte, à travers une autre règle (règlement saisi par une personne)
  update public.scheduled_actions set status = 'valide' where id = v_i;
  insert into public.essai_0518_t values (1, v_i);
  perform set_config('request.jwt.claims', c_u, true);
  perform set_config('request.jwt.claim.sub', v_u::text, true);
  execute 'set local role authenticated';
  r := public.relance_envoi_reserver(v_i, 'i@exemple.invalid', (select validated_at from public.scheduled_actions where id = v_i));
  update public.essai_0518_t set id = 2 where id = 1;
  execute 'reset role';
  select * into v_row from public.scheduled_actions where id = v_i;
  if v_row.status <> 'ignore' or v_row.envoi_reserve_at is not null then raise exception '10c. règlement saisi par une personne refusé pendant l''envoi'; end if;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  -- 10d. Motif écrit par la base avec l'état : gardé
  update public.scheduled_actions set status = 'ignore', error = 'Session annulée' where id = v_e;
  if (select error from public.scheduled_actions where id = v_e) is distinct from 'Session annulée' then raise exception '10d. motif de la base effacé'; end if;

  -- 11. Envoi resté sans suite : jamais repris seul ; marquer envoyée lève la réservation
  update public.scheduled_actions set status = 'valide' where id = v_b;
  perform set_config('app.relance_envoi', 'on', true);
  update public.scheduled_actions set envoi_reserve_at = now() - interval '11 minutes', envoi_reserve_par = v_u where id = v_b;
  perform set_config('app.relance_envoi', '', true);
  perform set_config('request.jwt.claims', c_u, true);
  perform set_config('request.jwt.claim.sub', v_u::text, true);
  execute 'set local role authenticated';
  begin perform public.relance_envoi_reserver(v_b, 'b@exemple.invalid', (select validated_at from public.scheduled_actions where id = v_b)); raise exception '11a. envoi sans suite repris';
  exception when invalid_parameter_value then null; end;
  update public.scheduled_actions set status = 'envoye' where id = v_b;
  select * into v_row from public.scheduled_actions where id = v_b;
  if v_row.status <> 'envoye' or v_row.envoi_reserve_at is not null or v_row.sent_by is distinct from v_u then raise exception '11b. marquer envoyée après envoi sans suite'; end if;
  execute 'reset role';

  -- 12. Fonctions fermées au visiteur ; fin d'envoi fermée aux comptes
  if has_function_privilege('anon', 'public.relance_envoi_reserver(uuid, text, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.relance_envoi_terminer(uuid, uuid, boolean, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.relance_envoi_terminer(uuid, uuid, boolean, text, text, text)', 'execute') then
    raise exception '12. fonctions trop ouvertes';
  end if;
  -- La règle de la colonne calculée reste exécutable par ceux qui écrivent
  if not has_function_privilege('authenticated', 'app.relance_envoyable(text, jsonb)', 'execute')
     or not has_function_privilege('service_role', 'app.relance_envoyable(text, jsonb)', 'execute')
     or has_function_privilege('anon', 'app.relance_envoyable(text, jsonb)', 'execute') then
    raise exception '12b. droits de la règle des relances envoyables';
  end if;
end $$;

select 'VERT' as essai_0518;
rollback;
