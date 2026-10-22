-- Retour arrière de 0436_decharge_nir.sql. Idempotent. Les décharges déjà signées restent.
drop function if exists public.portail_decharge_nir_signer(text, uuid, text, text, text, text);
drop function if exists public.portail_decharge_nir_etat(text, uuid, text);
drop function if exists public.portail_org_stagiaire(text, uuid, text);
-- Règle d'avant (signature du client seulement)
CREATE OR REPLACE FUNCTION app.signature_client_figee()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;
delete from public.schema_migrations where version = '0436_decharge_nir';
