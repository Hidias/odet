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

delete from public.schema_migrations where version = '0405_appareil_complet';
