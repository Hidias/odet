-- Retour arrière de 0433_espaces_fiche_formation.sql : les deux champs retirés du bloc « courses ». Idempotent.
do $do$
declare
  f text;
  d text;
  avant text := $b$'teaching_methods', co.teaching_methods, 'methods', co.methods, 'trainer_equipment', co.trainer_equipment$b$;
  apres text := $a$'teaching_methods', co.teaching_methods$a$;
begin
  foreach f in array array['public.client_portal_data(text,text)', 'public.ent_sessions()', 'public.ext_sessions()'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position(avant in d) = 0 then continue; end if;
    execute replace(d, avant, apres);
  end loop;
end
$do$;
delete from public.schema_migrations where version = '0433_espaces_fiche_formation';
