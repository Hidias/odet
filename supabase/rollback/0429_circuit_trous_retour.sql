-- Retour arrière de 0429_circuit_trous.sql : fonctions de signature d'avant 0429 ; devis partiels repassés en
-- « envoyé » avant de rétablir l'ancienne liste de statuts. Idempotent.
CREATE OR REPLACE FUNCTION app.portail_signer(p_client uuid, p_channel text, p_access uuid, p_profile uuid, p_session uuid, p_kind text, p_sha256 text, p_name text, p_role text, p_signature text, p_consent text, p_label text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_s public.sessions;
  v_id uuid;
  v_ex public.document_signatures;
  v_nom text := btrim(coalesce(p_name, ''));
begin
  if p_kind is distinct from 'convention' then raise exception 'Document non signable ici' using errcode = '22023'; end if;
  if not app.objet_du_client('session', p_session, p_client) then raise exception 'Session inconnue pour ce client' using errcode = '42501'; end if;
  if length(v_nom) < 2 or length(v_nom) > 120 then raise exception 'Nom du signataire requis' using errcode = '22023'; end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Empreinte du document invalide' using errcode = '22023'; end if;
  if p_signature is null or p_signature !~ '^data:image/png;base64,' or length(p_signature) > 400000 then
    raise exception 'Signature invalide' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_consent, ''))) < 20 then raise exception 'Accord du signataire requis' using errcode = '22023'; end if;

  select * into v_s from public.sessions where id = p_session;
  -- Déjà signée avec ce même document : rien de plus
  select * into v_ex from public.document_signatures d
  where d.session_id = p_session and d.document_type = 'convention' and d.signer_type = 'client' and d.status = 'valid'
    and d.document_hash = p_sha256 order by d.signed_at desc limit 1;
  if v_ex.id is not null then return jsonb_build_object('id', v_ex.id, 'deja', true); end if;

  insert into public.document_signatures (document_type, session_id, client_id, signer_type, signer_name, signer_role,
    signature_data, document_hash, signed_at, metadata, status, company_id)
  values ('convention', p_session, p_client, 'client', v_nom, nullif(left(btrim(coalesce(p_role, '')), 120), ''),
    p_signature, p_sha256, now(),
    jsonb_build_object('canal', p_channel, 'access_id', p_access, 'profile_id', p_profile, 'consentement', left(p_consent, 1000),
      'document', left(p_label, 200), 'reference', v_s.reference),
    'valid', v_s.company_id)
  returning id into v_id;

  update public.sessions set convention_signed = true, convention_signed_date = now()
  where id = p_session and not coalesce(convention_signed, false);

  insert into public.portal_events (company_id, client_id, channel, access_id, profile_id, event, object_type, object_id,
    document_kind, document_label, document_sha256, ip, user_agent)
  values (v_s.company_id, p_client, p_channel, p_access, p_profile, 'signature', 'session', p_session, 'convention',
    left(coalesce(p_label, 'Convention de formation'), 200), p_sha256,
    left(coalesce(app.audit_entete('x-forwarded-for'), app.audit_entete('x-real-ip')), 64), left(app.entete_complet('user-agent'), 400));

  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (v_s.company_id, 'convention_signee', 'Convention signée en ligne',
    v_nom || coalesce(', ' || nullif(btrim(coalesce(p_role, '')), ''), '') || ' a signé la convention ' || coalesce(v_s.reference, '')
      || ' (' || (select c.name from public.clients c where c.id = p_client) || ').',
    '/sessions/' || p_session, jsonb_build_object('session_id', p_session, 'signature_id', v_id));

  return jsonb_build_object('id', v_id, 'deja', false);
end
$function$;

CREATE OR REPLACE FUNCTION app.portail_signer_document(p_client uuid, p_channel text, p_access uuid, p_profile uuid, p_document uuid, p_name text, p_role text, p_signature text, p_consent text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d public.client_shared_documents;
  v_ex uuid;
  v_id uuid;
  v_nom text := btrim(coalesce(p_name, ''));
  v_lien text;
  v_client text;
begin
  select * into d from public.client_shared_documents where id = p_document and client_id = p_client and withdrawn_at is null;
  if d.id is null then raise exception 'Document inconnu pour ce client' using errcode = '42501'; end if;
  if d.kind not in ('devis', 'contrat') then raise exception 'Document non signable' using errcode = '22023'; end if;
  if length(v_nom) < 2 or length(v_nom) > 120 then raise exception 'Nom du signataire requis' using errcode = '22023'; end if;
  if p_signature is null or p_signature !~ '^data:image/png;base64,' or length(p_signature) > 400000 then
    raise exception 'Signature invalide' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_consent, ''))) < 20 then raise exception 'Accord du signataire requis' using errcode = '22023'; end if;
  if d.kind = 'devis' and exists (select 1 from public.quotes q where q.id = d.object_id and q.status in ('refused', 'expired')) then
    raise exception 'Ce devis n''est plus valable : contactez votre interlocuteur' using errcode = '22023';
  end if;

  select s.id into v_ex from public.document_signatures s
  where s.signer_type = 'client' and s.status = 'valid' and s.metadata->>'document_id' = d.id::text limit 1;
  if v_ex is not null then return jsonb_build_object('id', v_ex, 'deja', true); end if;

  insert into public.document_signatures (document_type, session_id, client_id, signer_type, signer_name, signer_role,
    signature_data, document_hash, signed_at, metadata, status, company_id)
  values (d.kind, case when d.object_type = 'session' then d.object_id end, p_client, 'client', v_nom,
    nullif(left(btrim(coalesce(p_role, '')), 120), ''), p_signature, d.sha256, now(),
    jsonb_build_object('canal', p_channel, 'access_id', p_access, 'profile_id', p_profile, 'consentement', left(p_consent, 1000),
      'document', d.label, 'document_id', d.id, 'object_type', d.object_type, 'object_id', d.object_id),
    'valid', d.company_id)
  returning id into v_id;

  -- Devis signé : accepté, avec la signature du client (le devis garde son historique de statut habituel)
  if d.kind = 'devis' and d.object_type = 'quote' then
    update public.quotes set status = 'accepted', signature_base64 = p_signature, updated_at = now()
    where id = d.object_id and status in ('draft', 'sent', 'partial');
    v_lien := '/devis?open=' || d.object_id;
  elsif d.kind = 'contrat' and d.object_type = 'session_group' then
    -- Convention ou contrat d'un groupe inter signé en ligne (0420) : document du groupe signé (la base calcule la fin
    -- de rétractation d'un particulier à partir de cette date)
    update public.session_groups set doc_status = 'signe', doc_signed_at = coalesce(doc_signed_at, now())
    where id = d.object_id;
    select '/sessions/' || g.session_id into v_lien from public.session_groups g where g.id = d.object_id;
  else
    v_lien := '/clients/' || p_client;
  end if;

  insert into public.portal_events (company_id, client_id, channel, access_id, profile_id, event, object_type, object_id,
    document_kind, document_label, document_sha256, ip, user_agent)
  values (d.company_id, p_client, p_channel, p_access, p_profile, 'signature', d.object_type, d.object_id, d.kind, d.label, d.sha256,
    left(coalesce(app.audit_entete('x-forwarded-for'), app.audit_entete('x-real-ip')), 64), left(app.entete_complet('user-agent'), 400));

  select c.name into v_client from public.clients c where c.id = p_client;
  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (d.company_id, case when d.kind = 'devis' then 'devis_signe' else 'contrat_signe' end,
    case when d.kind = 'devis' then 'Devis signé en ligne' else 'Contrat signé en ligne' end,
    v_nom || coalesce(', ' || nullif(btrim(coalesce(p_role, '')), ''), '') || ' a signé « ' || d.label || ' » (' || coalesce(v_client, '') || ').',
    v_lien, jsonb_build_object('document_id', d.id, 'signature_id', v_id));

  return jsonb_build_object('id', v_id, 'deja', false);
end
$function$;

update public.quotes set status = 'sent' where status = 'partial';
alter table public.quotes drop constraint if exists quotes_status_check;
alter table public.quotes add constraint quotes_status_check check (((status)::text = any ((array['draft'::character varying, 'sent'::character varying, 'accepted'::character varying, 'refused'::character varying, 'expired'::character varying, 'invoiced'::character varying])::text[])));
delete from public.schema_migrations where version = '0429_circuit_trous';
