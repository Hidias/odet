-- Essai de 0498 : document signable, signataire prévu d'un devis, session préparée au jour ouvré et à la bonne heure.
-- Rouge sans 0498 (fonctions absentes). Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_a uuid; v_b uuid; v_ca uuid; v_cb uuid; v_s uuid; v_ga uuid; v_q uuid; v_q2 uuid; v_co4 uuid; v_co14 uuid;
  v_dg uuid; v_dq uuid; v_dq2 uuid; v_ds uuid; d public.client_shared_documents; v_r jsonb; v_n int; v_ses public.sessions;
  v_lundi date; h text := repeat('b', 64); v_sig text := 'data:image/png;base64,iVBORw0KGgo=';
  v_acc text := 'Je, soussigné, déclare « Bon pour accord » sur ce document';
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Alpha essai 0498', v_cie) returning id into v_a;
  insert into public.clients (name, company_id) values ('Beta essai 0498', v_cie) returning id into v_b;
  insert into public.client_contacts (client_id, company_id, name, first_name, last_name, fonction) values (v_a, v_cie, '', 'Alice', 'Essai', 'Gérante') returning id into v_ca;
  insert into public.client_contacts (client_id, company_id, name, role) values (v_b, v_cie, 'Bruno Beta', 'DRH') returning id into v_cb;
  insert into public.sessions (reference, start_date, end_date, client_id, company_id, session_type)
    values ('ESSAI-0498', current_date + 30, current_date + 30, v_b, v_cie, 'inter') returning id into v_s;
  insert into public.session_groups (session_id, client_id, kind, contact_id, company_id) values (v_s, v_a, 'entreprise', v_ca, v_cie) returning id into v_ga;
  insert into public.quotes (reference, client_id, contact_id, company_id, status, object) values ('ESSAI-0498-1', v_a, v_ca, v_cie, 'sent', 'Formation') returning id into v_q;
  -- Devis dont le contact appartient à un autre client : aucun signataire
  insert into public.quotes (reference, client_id, contact_id, company_id, status, object) values ('ESSAI-0498-2', v_a, v_cb, v_cie, 'sent', 'Formation') returning id into v_q2;
  insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
    values (v_cie, v_a, 'session_group', v_ga, 'contrat', 'Convention ESSAI 0498', 'essai/g.pdf', h) returning id into v_dg;
  insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
    values (v_cie, v_a, 'quote', v_q, 'devis', 'Devis ESSAI 0498', 'essai/q.pdf', h) returning id into v_dq;
  insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
    values (v_cie, v_a, 'quote', v_q2, 'devis', 'Devis ESSAI 0498 bis', 'essai/q2.pdf', h) returning id into v_dq2;

  -- 1. Signataire figé d'un devis : le contact du devis ; contact d'un autre client : rien
  if app.signataire_prevu(v_a, v_dq) is distinct from jsonb_build_object('name', 'Alice Essai', 'role', 'Gérante') then
    raise exception '1. signataire du devis faux (%)', app.signataire_prevu(v_a, v_dq); end if;
  if app.signataire_prevu(v_a, v_dq2) <> '{}'::jsonb then raise exception '2. contact d''un autre client proposé'; end if;
  -- 3. Groupe : inchangé (0496)
  if app.signataire_prevu(v_a, v_dg)->>'name' <> 'Alice Essai' then raise exception '3. signataire du groupe perdu'; end if;

  -- 4. Liste de l'espace : « signable » vrai pour le devis envoyé et la convention à signer
  v_r := app.portail_documents_client(v_a);
  if (select count(*) from jsonb_array_elements(v_r) e where (e->>'signable')::boolean) <> 3 then raise exception '4. signables faux (%)', v_r; end if;

  -- 5. Devis accepté, refusé, remplacé : plus signable, plus de signataire, signature refusée
  update public.quotes set status = 'accepted' where id = v_q;
  select * into d from public.client_shared_documents where id = v_dq;
  if app.document_signable(d) then raise exception '5. devis accepté signable'; end if;
  if app.signataire_prevu(v_a, v_dq) <> '{}'::jsonb then raise exception '6. signataire d''un devis accepté'; end if;
  begin
    perform app.portail_signer_document(v_a, 'lien', null, null, v_dq, 'Alice Essai', 'Gérante', v_sig, v_acc);
    raise exception '7. devis accepté signé';
  exception when sqlstate '22023' then null;
  end;
  update public.quotes set status = 'replaced' where id = v_q;
  if app.document_signable(d) then raise exception '8. devis remplacé signable'; end if;
  update public.quotes set status = 'sent' where id = v_q;
  if not app.document_signable(d) then raise exception '9. devis envoyé non signable'; end if;

  -- 10. Convention de groupe marquée signée sur papier, puis groupe annulé : plus signable, signature refusée
  update public.session_groups set doc_status = 'signe' where id = v_ga;
  select * into d from public.client_shared_documents where id = v_dg;
  if app.document_signable(d) then raise exception '10. convention signée sur papier signable'; end if;
  begin
    perform app.portail_signer_document(v_a, 'lien', null, null, v_dg, 'Alice Essai', 'Gérante', v_sig, v_acc);
    raise exception '11. convention signée sur papier signée';
  exception when sqlstate '22023' then null;
  end;
  update public.session_groups set doc_status = 'envoye', status = 'cancelled' where id = v_ga;
  if app.document_signable(d) then raise exception '12. groupe annulé signable'; end if;
  update public.session_groups set status = 'confirmed' where id = v_ga;
  if not app.document_signable(d) then raise exception '13. convention à signer non signable'; end if;

  -- 14. Convention d'une session marquée signée : plus signable
  insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
    values (v_cie, v_b, 'session', v_s, 'contrat', 'Convention session ESSAI 0498', 'essai/s.pdf', h) returning id into v_ds;
  select * into d from public.client_shared_documents where id = v_ds;
  if not app.document_signable(d) then raise exception '14. convention de session non signable'; end if;
  update public.sessions set convention_signed = true where id = v_s;
  if app.document_signable(d) then raise exception '15. convention de session signée signable'; end if;

  -- 16. Signature en ligne d'un devis envoyé : acceptée, puis « déjà signé » au second appel (réponse inchangée)
  v_r := app.portail_signer_document(v_a, 'lien', null, null, v_dq, 'Alice Essai', 'Gérante', v_sig, v_acc);
  if (v_r->>'deja')::boolean then raise exception '16. première signature vue comme déjà faite'; end if;
  v_r := app.portail_signer_document(v_a, 'lien', null, null, v_dq, 'Alice Essai', 'Gérante', v_sig, v_acc);
  if not (v_r->>'deja')::boolean then raise exception '17. second appel non reconnu (%)', v_r; end if;

  -- 18. Jour ouvré : samedi et dimanche sautés, jours ouvrés en plus
  v_lundi := date '2030-01-07';
  if app.jour_ouvre(v_cie, v_lundi - 2) <> v_lundi then raise exception '18. samedi non reporté au lundi'; end if;
  if app.jour_ouvre(v_cie, v_lundi - 1) <> v_lundi then raise exception '19. dimanche non reporté au lundi'; end if;
  if app.jour_ouvre(v_cie, v_lundi + 4, 1) <> v_lundi + 7 then raise exception '20. vendredi plus un jour faux'; end if;
  insert into public.hr_public_holidays (company_id, day, label) values (v_cie, v_lundi, 'Férié essai 0498') on conflict do nothing;
  if app.jour_ouvre(v_cie, v_lundi - 1) <> v_lundi + 1 then raise exception '21. jour férié non sauté'; end if;

  -- 22. Session préparée depuis un devis signé : 4 heures de 9 h à 13 h, jour ouvré ; 14 heures sur deux jours ouvrés
  insert into public.courses (title, duration_hours, duration_days, company_id) values ('Formation 4 h essai 0498', 4, 1, v_cie) returning id into v_co4;
  insert into public.courses (title, duration_hours, duration_days, company_id) values ('Formation 14 h essai 0498', 14, 1, v_cie) returning id into v_co14;
  -- Devis daté pour que devis + 30 jours tombe un samedi (le lundi suivant est férié : session le mardi)
  update public.quotes set status = 'accepted', quote_date = (v_lundi - 2) - 30 where id = v_q2;
  insert into public.quote_items (quote_id, position, course_id, quantity, unit_price_ht) values (v_q2, 1, v_co4, 1, 100), (v_q2, 2, v_co14, 1, 200);
  begin
    v_n := app.devis_prepare_sessions(v_q2);
    if v_n <> 2 then raise exception '22. % sessions préparées', v_n; end if;
    select * into v_ses from public.sessions where quote_id = v_q2 and course_id = v_co4;
    if v_ses.start_date <> v_lundi + 1 or v_ses.start_time <> time '09:00' or v_ses.end_time <> time '13:00' or v_ses.day_type <> 'half' then
      raise exception '23. session de 4 h fausse (% % % %)', v_ses.start_date, v_ses.start_time, v_ses.end_time, v_ses.day_type; end if;
    select * into v_ses from public.sessions where quote_id = v_q2 and course_id = v_co14;
    if v_ses.start_date <> v_lundi + 1 or v_ses.end_date <> v_lundi + 2 or v_ses.end_time <> time '17:00' then
      raise exception '24. session de 14 h fausse (% % %)', v_ses.start_date, v_ses.end_date, v_ses.end_time; end if;
  end;

  -- 25. Droits : fonctions internes fermées
  if has_function_privilege('anon', 'app.document_signable(public.client_shared_documents)', 'execute')
     or has_function_privilege('authenticated', 'app.document_signable(public.client_shared_documents)', 'execute')
     or has_function_privilege('authenticated', 'app.jour_ouvre(uuid, date, int)', 'execute')
     or has_function_privilege('authenticated', 'app.signataire_du_devis(uuid)', 'execute')
     or has_function_privilege('authenticated', 'app.signataire_du_contact(uuid, uuid)', 'execute') then
    raise exception '25. fonction interne ouverte'; end if;
end
$$;

rollback;
