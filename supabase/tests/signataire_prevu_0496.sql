-- Essai de 0496 : signataire prévu d'un document de l'espace client. Rouge sans 0496 (fonctions absentes).
-- Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_a uuid; v_b uuid; v_p uuid; v_ca uuid; v_cb uuid; v_s uuid; v_ga uuid; v_gp uuid; v_gx uuid;
  v_da uuid; v_dw uuid; v_dp uuid; v_dx uuid; v_dq uuid; v_acc uuid; v_tok text; v_r jsonb;
  h text := repeat('a', 64);
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Alpha essai 0496', v_cie) returning id into v_a;
  insert into public.clients (name, company_id) values ('Beta essai 0496', v_cie) returning id into v_b;
  insert into public.clients (name, company_id, client_type) values ('Paul Particulier', v_cie, 'particulier') returning id into v_p;
  insert into public.client_contacts (client_id, company_id, name, first_name, last_name, fonction) values (v_a, v_cie, '', 'Anne', 'Martin', 'Gérante') returning id into v_ca;
  insert into public.client_contacts (client_id, company_id, name, role) values (v_b, v_cie, 'Bruno Beta', 'DRH') returning id into v_cb;
  insert into public.sessions (reference, start_date, end_date, client_id, company_id, session_type)
    values ('ESSAI-0496', current_date + 30, current_date + 30, v_b, v_cie, 'inter') returning id into v_s;
  insert into public.session_groups (session_id, client_id, kind, contact_id, company_id) values (v_s, v_a, 'entreprise', v_ca, v_cie) returning id into v_ga;
  insert into public.session_groups (session_id, client_id, kind, contact_id, company_id) values (v_s, v_p, 'particulier', null, v_cie) returning id into v_gp;
  -- Groupe d'Alpha dont le contact appartient à un autre client : aucun signataire
  insert into public.session_groups (session_id, client_id, kind, contact_id, company_id) values (v_s, v_a, 'entreprise', v_cb, v_cie) returning id into v_gx;
  insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
    values (v_cie, v_a, 'session_group', v_ga, 'contrat', 'Convention de formation ESSAI', 'essai/a.pdf', h) returning id into v_da;
  insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
    values (v_cie, v_p, 'session_group', v_gp, 'contrat', 'Contrat de formation ESSAI', 'essai/p.pdf', h) returning id into v_dp;
  insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
    values (v_cie, v_a, 'session_group', v_gx, 'convention', 'Convention de formation ESSAI 2', 'essai/x.pdf', h) returning id into v_dx;
  insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
    values (v_cie, v_a, 'client', v_a, 'autre', 'Document ESSAI', 'essai/q.pdf', h) returning id into v_dq;

  -- 1. Convention d'un groupe d'entreprise : contact du groupe, nom fait du prénom et du nom, fonction
  v_r := app.signataire_prevu(v_a, v_da);
  if v_r is distinct from jsonb_build_object('name', 'Anne Martin', 'role', 'Gérante') then raise exception '1. signataire faux (%)', v_r; end if;
  -- 2. Contrat d'un particulier : le particulier
  v_r := app.signataire_prevu(v_p, v_dp);
  if v_r->>'name' <> 'Paul Particulier' then raise exception '2. particulier faux (%)', v_r; end if;
  -- 3. Document d'un autre client : rien
  if app.signataire_prevu(v_b, v_da) <> '{}'::jsonb then raise exception '3. document d''un autre client lu'; end if;
  -- 4. Contact d'un autre client : rien
  if app.signataire_prevu(v_a, v_dx) <> '{}'::jsonb then raise exception '4. contact d''un autre client proposé'; end if;
  -- 5. Autre type de document : rien
  if app.signataire_prevu(v_a, v_dq) <> '{}'::jsonb then raise exception '5. document hors groupe'; end if;
  -- 6. Document retiré : rien
  insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
    values (v_cie, v_a, 'session_group', v_ga, 'convention', 'Convention retirée ESSAI', 'essai/w.pdf', h) returning id into v_dw;
  update public.client_shared_documents set withdrawn_at = now() where id = v_dw;
  if app.signataire_prevu(v_a, v_dw) <> '{}'::jsonb then raise exception '6. document retiré lu'; end if;

  -- 6 bis. Contact du groupe changé ou renommé après la publication : le signataire figé reste celui du PDF
  update public.client_contacts set first_name = 'Annie', fonction = 'Présidente' where id = v_ca;
  update public.session_groups set contact_id = (select id from public.client_contacts where client_id = v_a and id <> v_ca limit 1) where id = v_ga;
  v_r := app.signataire_prevu(v_a, v_da);
  if v_r is distinct from jsonb_build_object('name', 'Anne Martin', 'role', 'Gérante') then raise exception '6b. signataire non figé (%)', v_r; end if;
  -- 6 ter. Groupe annulé : rien
  update public.session_groups set status = 'cancelled' where id = v_gp;
  if app.signataire_prevu(v_p, v_dp) <> '{}'::jsonb then raise exception '6c. groupe annulé proposé'; end if;
  update public.session_groups set status = 'confirmed' where id = v_gp;

  -- 7. Espace par lien : mauvais code refusé, bon code lu
  insert into public.client_portal_access (client_id, access_code, company_id) values (v_a, '482915', v_cie) returning id, token into v_acc, v_tok;
  v_r := public.client_portal_signataire_prevu(v_tok, '000000', v_da);
  if not v_r ? 'error' then raise exception '7. mauvais code accepté (%)', v_r; end if;
  v_r := public.client_portal_signataire_prevu(v_tok, '482915', v_da);
  if v_r->>'name' <> 'Anne Martin' then raise exception '8. lecture par lien fausse (%)', v_r; end if;

  -- 9. Droits : fonction interne fermée ; lien ouvert à anon ; compte réservé aux connectés
  if has_function_privilege('anon', 'app.signataire_prevu(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'app.signataire_prevu(uuid, uuid)', 'execute') then raise exception '9. fonction interne ouverte'; end if;
  if not has_function_privilege('anon', 'public.client_portal_signataire_prevu(text, text, uuid)', 'execute') then raise exception '10. lien fermé à anon'; end if;
  if has_function_privilege('anon', 'public.ent_signataire_prevu(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.ent_signataire_prevu(uuid)', 'execute') then raise exception '11. droits du compte faux'; end if;
end
$$;

rollback;
