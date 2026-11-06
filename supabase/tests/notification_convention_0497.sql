-- Essai de 0497 : titre de la notification d'une signature en ligne. Rouge sans 0497 (« Contrat signé en ligne »
-- pour la convention d'une entreprise). Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_a uuid; v_p uuid; v_s uuid; v_ga uuid; v_gp uuid; v_da uuid; v_dp uuid; v_dc uuid; v_t text;
  h text := repeat('a', 64);
  sig text := 'data:image/png;base64,iVBORw0KGgo=';
  accord text := 'J''ai lu le document. « Lu et approuvé, bon pour accord »';
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Alpha essai 0497', v_cie) returning id into v_a;
  insert into public.clients (name, company_id, client_type) values ('Paul Particulier 0497', v_cie, 'particulier') returning id into v_p;
  insert into public.sessions (reference, start_date, end_date, client_id, company_id, session_type)
    values ('ESSAI-0497', current_date + 30, current_date + 30, v_a, v_cie, 'inter') returning id into v_s;
  insert into public.session_groups (session_id, client_id, kind, company_id) values (v_s, v_a, 'entreprise', v_cie) returning id into v_ga;
  insert into public.session_groups (session_id, client_id, kind, company_id) values (v_s, v_p, 'particulier', v_cie) returning id into v_gp;
  insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
    values (v_cie, v_a, 'session_group', v_ga, 'contrat', 'Convention de formation ESSAI', 'essai/a.pdf', h) returning id into v_da;
  insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
    values (v_cie, v_p, 'session_group', v_gp, 'contrat', 'Contrat de formation ESSAI', 'essai/p.pdf', h) returning id into v_dp;
  insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
    values (v_cie, v_a, 'client', v_a, 'contrat', 'Contrat de maintenance ESSAI', 'essai/c.pdf', h) returning id into v_dc;

  -- 1. Convention d'une entreprise d'une inter : « Convention signée en ligne », type inchangé
  perform app.portail_signer_document(v_a, 'lien', null, null, v_da, 'Anne Martin', 'Gérante', sig, accord);
  select title into v_t from public.notifications where metadata->>'document_id' = v_da::text;
  if v_t is distinct from 'Convention signée en ligne' then raise exception '1. titre faux pour une convention (%)', v_t; end if;
  if (select type from public.notifications where metadata->>'document_id' = v_da::text) <> 'contrat_signe' then raise exception '1b. type changé'; end if;
  -- 2. Contrat d'un particulier : « Contrat signé en ligne »
  perform app.portail_signer_document(v_p, 'lien', null, null, v_dp, 'Paul Particulier', '', sig, accord);
  select title into v_t from public.notifications where metadata->>'document_id' = v_dp::text;
  if v_t is distinct from 'Contrat signé en ligne' then raise exception '2. titre faux pour un particulier (%)', v_t; end if;
  -- 3. Autre contrat (hors groupe) : inchangé
  perform app.portail_signer_document(v_a, 'lien', null, null, v_dc, 'Anne Martin', 'Gérante', sig, accord);
  select title into v_t from public.notifications where metadata->>'document_id' = v_dc::text;
  if v_t is distinct from 'Contrat signé en ligne' then raise exception '3. titre d''un autre contrat changé (%)', v_t; end if;
  -- 4. La signature reste faite (groupe signé)
  if (select doc_status from public.session_groups where id = v_ga) <> 'signe' then raise exception '4. groupe non signé'; end if;
end
$$;

rollback;
