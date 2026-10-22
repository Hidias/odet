-- Retour arrière de 0441_nir_renseigne_partout.sql. Idempotent.
do $do$
declare
  f text;
begin
  foreach f in array array['app.participants_etat(uuid)', 'app.salaries_du_client(uuid,uuid[])'] loop
    execute replace(pg_get_functiondef(f::regprocedure), $b$'ssn_present', app.nir_renseigne(t.id)$b$, $a$'ssn_present', coalesce(t.ssn_present, false)$a$);
  end loop;
end
$do$;
delete from public.schema_migrations where version = '0441_nir_renseigne_partout';
