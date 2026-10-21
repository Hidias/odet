-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (signature_0402) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0402_signature_espace_client.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0402_signature_espace_client_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0402_signature_espace_client.sql =====
-- 0402 : signature de la convention depuis l'espace client (décision de H du 21/10 : zéro papier, sans double saisie).
-- Le client lit la convention, coche « lu et approuvé », signe à l'écran. La base garde la signature dans
-- document_signatures (table déjà prévue, adresse IP et appareil relevés par la base, 0346) avec l'empreinte SHA-256
-- du PDF présenté et le texte exact accepté ; la session passe d'elle-même en « convention signée » ; une
-- notification prévient l'organisme ; le journal de l'espace client (0401) note la signature. Une signature du client
-- ne se modifie ni ne s'efface (elle part seulement avec sa session). Signature électronique simple (eIDAS, art. 25) :
-- valable, la preuve repose sur ce dossier. Prestations : convention de formation (devis et bons d'intervention
-- viendront sur le même modèle). Idempotent.

-- ── Signature du client figée ──
create or replace function app.signature_client_figee()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.signer_type = 'client' and old.session_id is not null
       and exists (select 1 from public.sessions s where s.id = old.session_id) then
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
drop trigger if exists document_signatures_client_figee on public.document_signatures;
create trigger document_signatures_client_figee before update or delete on public.document_signatures
  for each row execute function app.signature_client_figee();

-- ── Signature commune aux deux espaces ──
create or replace function app.portail_signer(p_client uuid, p_channel text, p_access uuid, p_profile uuid,
  p_session uuid, p_kind text, p_sha256 text, p_name text, p_role text, p_signature text, p_consent text, p_label text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    left(coalesce(app.audit_entete('x-forwarded-for'), app.audit_entete('x-real-ip')), 64), left(app.audit_entete('user-agent'), 400));

  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (v_s.company_id, 'convention_signee', 'Convention signée en ligne',
    v_nom || coalesce(', ' || nullif(btrim(coalesce(p_role, '')), ''), '') || ' a signé la convention ' || coalesce(v_s.reference, '')
      || ' (' || (select c.name from public.clients c where c.id = p_client) || ').',
    '/sessions/' || p_session, jsonb_build_object('session_id', p_session, 'signature_id', v_id));

  return jsonb_build_object('id', v_id, 'deja', false);
end
$$;
revoke all on function app.portail_signer(uuid, text, uuid, uuid, uuid, text, text, text, text, text, text, text) from public, anon, authenticated;

-- Signatures du client lisibles par lui-même (pour sa convention signée et son dossier de preuve)
create or replace function app.portail_signatures(p_client uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'session_id', d.session_id, 'document_type', d.document_type,
      'signer_name', d.signer_name, 'signer_role', d.signer_role, 'signed_at', d.signed_at, 'document_hash', d.document_hash,
      'signature_data', d.signature_data, 'ip_address', d.ip_address, 'user_agent', d.user_agent,
      'consentement', d.metadata->>'consentement', 'canal', d.metadata->>'canal') order by d.signed_at), '[]'::jsonb)
  from public.document_signatures d
  where d.client_id = p_client and d.signer_type = 'client' and d.status = 'valid'
$$;
revoke all on function app.portail_signatures(uuid) from public, anon, authenticated;

-- Espace par lien et code
create or replace function public.client_portal_signer(p_token text, p_code text, p_session uuid, p_kind text,
  p_sha256 text, p_name text, p_role text, p_signature text, p_consent text, p_label text default null)
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
  return app.portail_signer((v_check->>'client_id')::uuid, 'lien', (select a.id from public.client_portal_access a where a.token = p_token),
    null, p_session, p_kind, p_sha256, p_name, p_role, p_signature, p_consent, p_label);
end
$$;
revoke all on function public.client_portal_signer(text, text, uuid, text, text, text, text, text, text, text) from public;
grant execute on function public.client_portal_signer(text, text, uuid, text, text, text, text, text, text, text) to anon, authenticated;

create or replace function public.client_portal_signatures(p_token text, p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_check jsonb := public.client_portal_check(p_token, p_code);
begin
  if v_check ? 'error' then return '[]'::jsonb; end if;
  return app.portail_signatures((v_check->>'client_id')::uuid);
end
$$;
revoke all on function public.client_portal_signatures(text, text) from public;
grant execute on function public.client_portal_signatures(text, text) to anon, authenticated;

-- Espace par compte
create or replace function public.ent_signer(p_session uuid, p_kind text, p_sha256 text, p_name text, p_role text,
  p_signature text, p_consent text, p_label text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
begin
  return app.portail_signer(v.client_id, 'compte', null, v.profile_id, p_session, p_kind, p_sha256, p_name, p_role, p_signature, p_consent, p_label);
end
$$;
revoke all on function public.ent_signer(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.ent_signer(uuid, text, text, text, text, text, text, text) to authenticated;

create or replace function public.ent_signatures()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
begin
  return app.portail_signatures(v.client_id);
end
$$;
revoke all on function public.ent_signatures() from public, anon;
grant execute on function public.ent_signatures() to authenticated;

insert into public.schema_migrations (version) values ('0402_signature_espace_client') on conflict (version) do nothing;
