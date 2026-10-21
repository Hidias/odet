-- Retour arrière de 0405_appareil_complet.sql : lecture de 0346 (coupée à la première virgule). Idempotent.

create or replace function app.signature_ip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.ip_address := coalesce(app.audit_entete('x-forwarded-for'), app.audit_entete('x-real-ip'), nullif(new.ip_address, 'unknown'));
  new.user_agent := coalesce(app.audit_entete('user-agent'), new.user_agent);
  return new;
end
$$;
revoke all on function app.signature_ip() from public, anon, authenticated;

do $patch$
declare
  v_def text := pg_get_functiondef('app.portail_signer(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text,text)'::regprocedure);
begin
  execute replace(v_def, $n$left(app.entete_complet('user-agent'), 400)$n$, $a$left(app.audit_entete('user-agent'), 400)$a$);
end
$patch$;
drop function if exists app.entete_complet(text);

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

delete from public.schema_migrations where version = '0405_appareil_complet';
