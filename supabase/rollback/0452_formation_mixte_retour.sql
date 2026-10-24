-- Retour arrière de 0452_formation_mixte.sql. Idempotent. Refusé s'il existe des modules ou un suivi (ils seraient
-- perdus) : les retirer d'abord.
do $do$
begin
  if to_regclass('public.course_modules') is not null and exists (select 1 from public.course_modules) then
    raise exception 'Des modules en ligne existent : retour arrière refusé';
  end if;
end
$do$;
drop function if exists public.portal_module_suivre(text, uuid, text, uuid, text, int, jsonb);
drop function if exists public.portal_modules(text, uuid, text);
drop table if exists public.course_module_progress;
drop table if exists public.course_modules;
drop function if exists app.course_module_garde();
delete from public.schema_migrations where version = '0452_formation_mixte';
