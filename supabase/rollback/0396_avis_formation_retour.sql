-- Retour arrière de 0396_avis_formation.sql : retire les avis (s'il n'y en a aucun) et la colonne du catalogue.
-- Idempotent.

do $r$
begin
  if to_regclass('public.training_avis') is not null and exists (select 1 from public.training_avis) then
    raise exception 'Des avis après formation existent : retour arrière refusé, rien n''est modifié';
  end if;
end $r$;

drop table if exists public.training_avis;
drop function if exists app.training_avis_maj();
alter table public.courses drop constraint if exists courses_avis_kind_check;
alter table public.courses drop column if exists avis_kind;

delete from public.schema_migrations where version = '0396_avis_formation';
