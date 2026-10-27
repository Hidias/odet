-- Essai local de 0460 (contrats de maintenance, lot 1), en transaction annulée. Base locale seulement.
-- Lancer : psql ... -v ON_ERROR_STOP=1 -f supabase/tests/contrats_0460.sql ; se termine par « ESSAI 0460 : OK ».
begin;
set local client_min_messages = warning;

do $$
declare
  v_client uuid; v_quote uuid; v_k uuid; k public.itv_contracts; v_doc uuid; v_n int; v_r jsonb; v_ok boolean;
begin
  insert into public.clients (name, client_type, email) values ('Essai Contrat Particulier', 'particulier', 'essai@exemple.invalid') returning id into v_client;
  insert into public.quotes (reference, client_id, status, metier, contrat, total_ht)
  values ('DEV-ESSAI-0460', v_client, 'sent', 'maintenance', '{"duree_ans": 3, "reconduction": true, "preavis_mois": 3, "mois_visite": [3, 9]}', 450)
  returning id into v_quote;
  insert into public.quote_items (quote_id, position, code, description_title, quantity, unit_price_ht, metier) values
    (v_quote, 0, '', 'Vérification annuelle des extincteurs', 10, 30, null),
    (v_quote, 1, 'FRAIS-CONTRAT', 'Frais d''établissement du contrat', 1, 50, null),
    (v_quote, 2, '', 'Extincteur 6 L', 1, 100, 'vente');

  -- 1. Devis accepté : contrat à valider, prix = maintenance seule
  update public.quotes set status = 'accepted' where id = v_quote;
  select * into k from public.itv_contracts where quote_id = v_quote;
  if k.id is null or k.status <> 'a_valider' then raise exception 'contrat non préparé'; end if;
  if k.annual_price_ht <> 300 then raise exception 'prix % au lieu de 300', k.annual_price_ht; end if;
  if k.visit_months <> array[3, 9] or k.duration_years <> 3 or not k.tacit_renewal or k.notice_months <> 3 then raise exception 'conditions mal reprises'; end if;
  -- une seule fois par devis
  update public.quotes set status = 'sent' where id = v_quote;
  update public.quotes set status = 'accepted' where id = v_quote;
  select count(*) into v_n from public.itv_contracts where quote_id = v_quote;
  if v_n <> 1 then raise exception 'contrat en double'; end if;

  -- 1 bis. Nouvelle version signée avant validation : le même contrat suit, au nouveau prix
  declare v_v2 uuid; begin
    insert into public.quotes (reference, client_id, status, metier, contrat, previous_quote_id, version)
    values ('DEV-ESSAI-0460-V2', v_client, 'sent', 'maintenance', '{"duree_ans": 5, "reconduction": false}', v_quote, 2) returning id into v_v2;
    insert into public.quote_items (quote_id, position, code, description_title, quantity, unit_price_ht) values (v_v2, 0, '', 'Vérification', 12, 30);
    update public.quotes set status = 'accepted' where id = v_v2;
    select count(*) into v_n from public.itv_contracts where client_id = v_client;
    if v_n <> 1 then raise exception 'second contrat créé pour une nouvelle version'; end if;
    select * into k from public.itv_contracts where client_id = v_client;
    if k.quote_id <> v_v2 or k.annual_price_ht <> 360 or k.duration_years <> 5 or k.tacit_renewal then raise exception 'contrat non mis à jour par la V2'; end if;
    -- retour aux conditions de l'essai
    update public.itv_contracts set annual_price_ht = 300, duration_years = 3, tacit_renewal = true where id = k.id;
  end;

  -- 2. Visites refusées tant que le contrat n'est pas actif
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  v_ok := false;
  begin perform public.itv_generate_contract_visits(k.id, 2027); exception when others then v_ok := sqlerrm like 'Contrat non actif%'; end;
  if not v_ok then raise exception 'visites générées pour un contrat à valider'; end if;

  -- 3. Validation : échéance à 3 ans, pas de fin avec reconduction
  v_r := public.contrat_valider(k.id);
  select * into k from public.itv_contracts where id = k.id;
  if k.status <> 'actif' or k.term_on <> (current_date + interval '3 years' - interval '1 day')::date or k.end_on is not null then
    raise exception 'validation incorrecte : % %', k.term_on, k.end_on;
  end if;

  -- 4. Reconduction : échéance passée avancée d'un an
  update public.itv_contracts set term_on = current_date - 10 where id = k.id;
  v_r := public.contrats_relances_generer();
  select * into k from public.itv_contracts where id = k.id;
  if k.term_on <> (current_date - 10 + interval '1 year')::date then raise exception 'reconduction : % (%)', k.term_on, v_r; end if;

  -- 5. Fin de préavis dans 30 jours : relance interne ; particulier dans la fenêtre : courrier préparé
  update public.itv_contracts set term_on = (current_date + 30 + interval '3 months')::date where id = k.id;
  v_r := public.contrats_relances_generer();
  if (v_r ->> 'preavis')::int <> 1 then raise exception 'relance de préavis absente : %', v_r; end if;
  update public.itv_contracts set term_on = (current_date + 60 + interval '3 months')::date where id = k.id;
  v_r := public.contrats_relances_generer();
  if (v_r ->> 'information_particulier')::int <> 1 then raise exception 'information du particulier absente : %', v_r; end if;

  -- 6. Signature en ligne : contrat signé, conditions figées
  insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
  values (k.company_id, v_client, 'itv_contract', k.id, 'contrat', 'Contrat essai', 'essai/contrat.pdf', repeat('a', 64)) returning id into v_doc;
  insert into public.document_signatures (document_type, client_id, signer_type, signer_name, signature_data, signed_at, metadata, status)
  values ('contrat', v_client, 'client', 'Anne Essai', 'data:image/png;base64,AA', now(),
    jsonb_build_object('object_type', 'itv_contract', 'object_id', k.id, 'document_id', v_doc), 'valid');
  select * into k from public.itv_contracts where id = k.id;
  if k.signed_at is null or k.signed_name <> 'Anne Essai' or k.signed_document_id <> v_doc then raise exception 'signature non reportée'; end if;
  v_ok := false;
  begin update public.itv_contracts set annual_price_ht = 1 where id = k.id; exception when others then v_ok := sqlerrm like 'Contrat signé%'; end;
  if not v_ok then raise exception 'prix modifiable après signature'; end if;
  -- mois de visite et notes restent modifiables
  update public.itv_contracts set notes = 'ok', visit_months = array[4, 10] where id = k.id;

  raise warning 'ESSAI 0460 : OK';
end
$$;

rollback;
