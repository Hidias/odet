-- Retour arrière de 0412_marque_blanche.sql : rejoue l'état d'avant noté dans la base au premier passage
-- (app.retour_0412 : défauts, vue et fonction des comptes des associés, colonne vide, commentaire), puis retire la
-- colonne des traces à signaler. Les colonnes rajoutées reviennent vides (elles l'étaient). Idempotent.

do $$
declare r record;
begin
  if to_regclass('app.retour_0412') is null then return; end if;
  for r in select instruction from app.retour_0412 order by ordre loop
    execute r.instruction;
  end loop;
end $$;
drop table if exists app.retour_0412;

alter table public.organization_settings drop column if exists traces_a_signaler;

delete from public.schema_migrations where version = '0412_marque_blanche';
