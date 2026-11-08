-- Essai de 0512 : financeur du devis repris sur la session préparée à la signature.
-- Rouge sans 0512 (aucune ligne de financement créée). Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_a uuid; v_opco uuid; v_co1 uuid; v_co2 uuid; v_q uuid; v_n int; f record; v_ses public.sessions; v_note text;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Alpha essai 0512', v_cie) returning id into v_a;
  insert into public.clients (name, company_id) values ('OPCO essai 0512', v_cie) returning id into v_opco;
  insert into public.courses (title, duration_hours, duration_days, company_id) values ('Formation 7 h essai 0512', 7, 1, v_cie) returning id into v_co1;
  insert into public.courses (title, duration_hours, duration_days, company_id) values ('Formation 14 h essai 0512', 14, 2, v_cie) returning id into v_co2;

  -- 1. OPCO avec montant pris en charge (150 sur 300) : une ligne par session, au prorata, subrogation et OPCO lié
  insert into public.quotes (reference, client_id, company_id, status, object, funding_type, funding_name, funding_client_id,
      funding_agreement_ref, funding_agreement_date, funding_subrogation, funding_amount_ht)
    values ('ESSAI-0512-1', v_a, v_cie, 'sent', 'Formation', 'opco', 'OPCO essai', v_opco, 'ACC-0512', date '2026-11-02', true, 150)
    returning id into v_q;
  insert into public.quote_items (quote_id, position, course_id, quantity, unit_price_ht) values (v_q, 1, v_co1, 1, 100), (v_q, 2, v_co2, 1, 200);
  update public.quotes set status = 'accepted', total_ht = 300 where id = v_q;
  v_n := app.devis_prepare_sessions(v_q);
  if v_n <> 2 then raise exception '1. % sessions préparées', v_n; end if;
  if (select count(*) from public.session_fundings sf join public.sessions s on s.id = sf.session_id where s.quote_id = v_q) <> 2 then
    raise exception '1b. lignes de financement : %', (select count(*) from public.session_fundings sf join public.sessions s on s.id = sf.session_id where s.quote_id = v_q); end if;
  select sf.*, s.total_price into f from public.session_fundings sf join public.sessions s on s.id = sf.session_id where s.quote_id = v_q and s.course_id = v_co2;
  if f.amount_ht <> 100 or f.percentage <> 50 or f.funder_type <> 'opco' or f.funder_name <> 'OPCO essai' or f.funder_client_id is distinct from v_opco
     or f.dossier_number <> 'ACC-0512' or f.agreement_date <> date '2026-11-02' or not f.subrogation or f.status <> 'pending'
     or f.company_id <> v_cie or f.notes <> 'Repris du devis ESSAI-0512-1' then
    raise exception '2. ligne de financement fausse (% % % % %)', f.amount_ht, f.percentage, f.funder_type, f.subrogation, f.notes; end if;
  select sf.amount_ht into f from public.session_fundings sf join public.sessions s on s.id = sf.session_id where s.quote_id = v_q and s.course_id = v_co1;
  if f.amount_ht <> 50 then raise exception '3. part de la session de 100 : %', f.amount_ht; end if;
  -- Note de la session inchangée quand la ligne est créée
  select * into v_ses from public.sessions where quote_id = v_q and course_id = v_co1;
  if v_ses.notes <> 'Préparée depuis le devis signé ESSAI-0512-1 : dates et formateur à confirmer.' or v_ses.funding_type <> 'opco' or v_ses.total_price <> 100 then
    raise exception '4. session changée (% % %)', v_ses.notes, v_ses.funding_type, v_ses.total_price; end if;

  -- 5. Montant au-delà du devis : plafonné au prix de la session (100 %)
  insert into public.quotes (reference, client_id, company_id, status, object, funding_type, funding_name, funding_amount_ht)
    values ('ESSAI-0512-2', v_a, v_cie, 'sent', 'Formation', 'region', 'Région essai', 500) returning id into v_q;
  insert into public.quote_items (quote_id, position, course_id, quantity, unit_price_ht) values (v_q, 1, v_co1, 1, 100);
  update public.quotes set status = 'partial', total_ht = 100 where id = v_q;
  perform app.devis_prepare_sessions(v_q);
  select sf.* into f from public.session_fundings sf join public.sessions s on s.id = sf.session_id where s.quote_id = v_q;
  if f.amount_ht <> 100 or f.percentage <> 100 or f.funder_type <> 'region' or f.subrogation or f.funder_client_id is not null then
    raise exception '5. plafond faux (% % % %)', f.amount_ht, f.percentage, f.funder_type, f.subrogation; end if;

  -- 6. France Travail : type pole_emploi ; subrogation et OPCO lié ignorés hors OPCO ; remise du devis appliquée
  insert into public.quotes (reference, client_id, company_id, status, object, funding_type, funding_client_id, funding_subrogation,
      funding_amount_ht, discount_percent)
    values ('ESSAI-0512-3', v_a, v_cie, 'sent', 'Formation', 'france_travail', v_opco, true, 45, 10) returning id into v_q;
  insert into public.quote_items (quote_id, position, course_id, quantity, unit_price_ht) values (v_q, 1, v_co1, 1, 100);
  update public.quotes set status = 'accepted', total_ht = 90 where id = v_q;
  perform app.devis_prepare_sessions(v_q);
  select sf.*, s.total_price into f from public.session_fundings sf join public.sessions s on s.id = sf.session_id where s.quote_id = v_q;
  if f.funder_type <> 'pole_emploi' or f.subrogation or f.funder_client_id is not null or f.funder_name is not null or f.amount_ht <> 45 or f.percentage <> 50 or f.total_price <> 90 then
    raise exception '6. France Travail faux (% % % % % %)', f.funder_type, f.subrogation, f.funder_client_id, f.amount_ht, f.percentage, f.total_price; end if;

  -- 7. Autre financeur sans montant : aucune ligne, la note nomme le financeur et l'accord
  insert into public.quotes (reference, client_id, company_id, status, object, funding_type, funding_name, funding_agreement_ref)
    values ('ESSAI-0512-4', v_a, v_cie, 'sent', 'Formation', 'autre', '  Fonds essai  ', 'R-12') returning id into v_q;
  insert into public.quote_items (quote_id, position, course_id, quantity, unit_price_ht) values (v_q, 1, v_co1, 1, 100);
  update public.quotes set status = 'accepted', total_ht = 100 where id = v_q;
  perform app.devis_prepare_sessions(v_q);
  select * into v_ses from public.sessions where quote_id = v_q;
  if exists (select 1 from public.session_fundings where session_id = v_ses.id) then raise exception '7. ligne créée sans montant'; end if;
  v_note := 'Préparée depuis le devis signé ESSAI-0512-4 : dates et formateur à confirmer. Financeur prévu au devis : Fonds essai (accord R-12), montant pris en charge à compléter dans la session.';
  if v_ses.notes <> v_note or v_ses.funding_type <> 'other' then raise exception '8. note fausse (%) %', v_ses.notes, v_ses.funding_type; end if;

  -- 9. Sans financement : aucune ligne, note d'origine
  insert into public.quotes (reference, client_id, company_id, status, object) values ('ESSAI-0512-5', v_a, v_cie, 'sent', 'Formation') returning id into v_q;
  insert into public.quote_items (quote_id, position, course_id, quantity, unit_price_ht) values (v_q, 1, v_co1, 1, 100);
  update public.quotes set status = 'accepted', total_ht = 100 where id = v_q;
  perform app.devis_prepare_sessions(v_q);
  select * into v_ses from public.sessions where quote_id = v_q;
  if exists (select 1 from public.session_fundings where session_id = v_ses.id) then raise exception '9. ligne créée sans financement'; end if;
  if v_ses.notes <> 'Préparée depuis le devis signé ESSAI-0512-5 : dates et formateur à confirmer.' or v_ses.funding_type <> 'none' then
    raise exception '10. session sans financement changée (% %)', v_ses.notes, v_ses.funding_type; end if;

  -- 10 bis. CPF avec montant : type cpf ; montant connu mais total du devis à 0 : aucune ligne, note
  insert into public.quotes (reference, client_id, company_id, status, object, funding_type, funding_amount_ht)
    values ('ESSAI-0512-6', v_a, v_cie, 'sent', 'Formation', 'cpf', 30) returning id into v_q;
  insert into public.quote_items (quote_id, position, course_id, quantity, unit_price_ht) values (v_q, 1, v_co1, 1, 100);
  update public.quotes set status = 'accepted', total_ht = 100 where id = v_q;
  perform app.devis_prepare_sessions(v_q);
  select sf.* into f from public.session_fundings sf join public.sessions s on s.id = sf.session_id where s.quote_id = v_q;
  if f.funder_type is distinct from 'cpf' or f.amount_ht <> 30 or f.percentage <> 30 then raise exception '10b. CPF faux (% % %)', f.funder_type, f.amount_ht, f.percentage; end if;
  insert into public.quotes (reference, client_id, company_id, status, object, funding_type, funding_name, funding_amount_ht)
    values ('ESSAI-0512-7', v_a, v_cie, 'sent', 'Formation', 'opco', 'OPCO zéro', 100) returning id into v_q;
  insert into public.quote_items (quote_id, position, course_id, quantity, unit_price_ht) values (v_q, 1, v_co1, 1, 100);
  update public.quotes set status = 'accepted', total_ht = 0 where id = v_q;
  perform app.devis_prepare_sessions(v_q);
  select * into v_ses from public.sessions where quote_id = v_q;
  if exists (select 1 from public.session_fundings where session_id = v_ses.id) then raise exception '10c. ligne créée avec un devis à 0'; end if;
  if v_ses.notes not like '%Financeur prévu au devis : OPCO zéro, montant pris en charge à compléter dans la session.' then raise exception '10d. note fausse (%)', v_ses.notes; end if;

  -- 11. Droits : fonction interne fermée
  if has_function_privilege('anon', 'app.devis_prepare_sessions(uuid)', 'execute')
     or has_function_privilege('authenticated', 'app.devis_prepare_sessions(uuid)', 'execute') then
    raise exception '11. app.devis_prepare_sessions ouverte'; end if;
end
$$;

rollback;
