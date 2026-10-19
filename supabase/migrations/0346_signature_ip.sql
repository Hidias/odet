-- 0346_signature_ip.sql : chantier F, écart 13 : l'adresse IP et le navigateur d'une signature sont lus par la base
-- dans les en-têtes de la requête, plus par un service tiers appelé depuis le navigateur (api.ipify.org).
-- Une valeur envoyée par l'application ne sert que si la requête n'en porte pas (appel depuis le serveur).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0346_signature_ip_retour.sql

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
drop trigger if exists signature_ip on public.document_signatures;
create trigger signature_ip before insert on public.document_signatures for each row execute function app.signature_ip();

insert into public.schema_migrations (version) values ('0346_signature_ip') on conflict (version) do nothing;
