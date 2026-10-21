-- Retour arrière de 0406_signature_documents.sql : les signatures déjà faites restent. Idempotent.

drop function if exists public.client_portal_signer_document(text, text, uuid, text, text, text, text);
drop function if exists public.ent_signer_document(uuid, text, text, text, text);
drop function if exists app.portail_signer_document(uuid, text, uuid, uuid, uuid, text, text, text, text);

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

create or replace function app.signature_client_figee()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.signer_type = 'client' and old.session_id is not null
       and exists (select 1 from public.sessions s where s.id = old.session_id)
       and not exists (select 1 from public.demo_records r where r.tbl = 'sessions' and r.id = old.session_id) then
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

create or replace function app.client_shared_documents_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.clients c where c.id = old.client_id) then
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

delete from public.schema_migrations where version = '0406_signature_documents';
