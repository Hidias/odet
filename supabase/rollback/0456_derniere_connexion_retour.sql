-- Retour arrière de 0456_derniere_connexion.sql. Idempotent.
do $do$
declare
  r record;
  v_def text;
  v_ancien text := '''last_seen_at'', p.last_seen_at';
  v_nouveau text := '''last_seen_at'', coalesce(p.last_seen_at, (select u.last_sign_in_at from auth.users u where u.id = p.id)) /* 0456 */';
begin
  for r in select * from (values ('public.acces_externe_etat(text, uuid)'), ('public.client_accounts_etat(uuid)')) as t(sig) loop
    v_def := pg_get_functiondef(r.sig::regprocedure);
    if position(v_nouveau in v_def) > 0 then
      execute replace(v_def, v_nouveau, v_ancien);
    end if;
  end loop;
end
$do$;
delete from public.schema_migrations where version = '0456_derniere_connexion';
