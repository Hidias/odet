-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (signdoc_0406) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0406_signature_documents.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0406_signature_documents_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0406_signature_documents.sql =====
-- 0406 : signature en ligne des devis et contrats depuis l'espace client (décision de H du 21/10 : même principe que la
-- convention pour toutes les prestations). Le client signe le PDF exact mis à disposition (0404) : l'empreinte
-- enregistrée est celle du fichier rangé. Un devis signé passe en « accepté » avec la signature ; l'organisme est
-- prévenu ; le journal (0401) note la signature. Une signature du client ne se modifie ni ne s'efface (sauf avec une
-- donnée de test à la purge). Idempotent.

-- ── Signature d'un document mis à disposition ──
create or replace function app.portail_signer_document(p_client uuid, p_channel text, p_access uuid, p_profile uuid,
  p_document uuid, p_name text, p_role text, p_signature text, p_consent text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;
revoke all on function app.portail_signer_document(uuid, text, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.client_portal_signer_document(p_token text, p_code text, p_document uuid,
  p_name text, p_role text, p_signature text, p_consent text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_check jsonb := public.client_portal_check(p_token, p_code);
begin
  if v_check ? 'error' then return v_check; end if;
  return app.portail_signer_document((v_check->>'client_id')::uuid, 'lien', (select a.id from public.client_portal_access a where a.token = p_token),
    null, p_document, p_name, p_role, p_signature, p_consent);
end
$$;
revoke all on function public.client_portal_signer_document(text, text, uuid, text, text, text, text) from public;
grant execute on function public.client_portal_signer_document(text, text, uuid, text, text, text, text) to anon, authenticated;

create or replace function public.ent_signer_document(p_document uuid, p_name text, p_role text, p_signature text, p_consent text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
begin
  return app.portail_signer_document(v.client_id, 'compte', null, v.profile_id, p_document, p_name, p_role, p_signature, p_consent);
end
$$;
revoke all on function public.ent_signer_document(uuid, text, text, text, text) from public, anon;
grant execute on function public.ent_signer_document(uuid, text, text, text, text) to authenticated;

-- Signatures lues par le client : avec le document signé
create or replace function app.portail_signatures(p_client uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'session_id', d.session_id, 'document_type', d.document_type,
      'document_id', d.metadata->>'document_id',
      'signer_name', d.signer_name, 'signer_role', d.signer_role, 'signed_at', d.signed_at, 'document_hash', d.document_hash,
      'signature_data', d.signature_data, 'ip_address', d.ip_address, 'user_agent', d.user_agent,
      'consentement', d.metadata->>'consentement', 'canal', d.metadata->>'canal') order by d.signed_at), '[]'::jsonb)
  from public.document_signatures d
  where d.client_id = p_client and d.signer_type = 'client' and d.status = 'valid'
$$;
revoke all on function app.portail_signatures(uuid) from public, anon, authenticated;

-- Une signature du client ne s'efface pas, qu'elle porte sur une session ou sur un document ; sauf donnée de test
create or replace function app.signature_client_figee()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.signer_type = 'client' and old.client_id is not null
       and exists (select 1 from public.clients c where c.id = old.client_id)
       and not exists (select 1 from public.demo_records r where r.tbl = 'clients' and r.id = old.client_id)
       and not (old.session_id is not null and (not exists (select 1 from public.sessions s where s.id = old.session_id)
                or exists (select 1 from public.demo_records r where r.tbl = 'sessions' and r.id = old.session_id))) then
      raise exception 'Signature du client : elle ne s''efface pas' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.signer_type = 'client' and (
       new.signature_data is distinct from old.signature_data or new.document_hash is distinct from old.document_hash
    or new.signed_at is distinct from old.signed_at or new.ip_address is distinct from old.ip_address
    or new.user_agent is distinct from old.user_agent or new.signer_name is distinct from old.signer_name
    or new.signer_role is distinct from old.signer_role or new.document_type is distinct from old.document_type
    or new.session_id is distinct from old.session_id or new.metadata is distinct from old.metadata) then
    raise exception 'Signature du client : elle ne se modifie pas' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.signature_client_figee() from public, anon, authenticated;

-- Documents mis à disposition (0404) : la purge des données de test peut effacer ceux d'un client de test ; pour un
-- client réel, un document se retire et ne s'efface toujours pas
create or replace function app.client_shared_documents_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.clients c where c.id = old.client_id)
       and not exists (select 1 from public.demo_records r where r.tbl = 'clients' and r.id = old.client_id) then
      raise exception 'Document mis à disposition : il se retire, il ne s''efface pas' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.withdrawn_at is not null
     or (to_jsonb(new) - 'withdrawn_at' - 'withdrawn_by' - 'withdrawn_reason') <> (to_jsonb(old) - 'withdrawn_at' - 'withdrawn_by' - 'withdrawn_reason') then
    raise exception 'Document mis à disposition : seul le retrait est possible' using errcode = '42501';
  end if;
  if new.withdrawn_at is not null then
    new.withdrawn_at := now();
    new.withdrawn_by := auth.uid();
  end if;
  return new;
end
$$;
revoke all on function app.client_shared_documents_fige() from public, anon, authenticated;

insert into public.schema_migrations (version) values ('0406_signature_documents') on conflict (version) do nothing;
