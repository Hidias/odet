-- Retour arrière de 0516 : déclencheurs de la vue groupe retirés de toutes les tables, fonctions retirées. Rien d'autre
-- n'avait changé.
do $$
declare r record;
begin
  for r in select g.tgrelid::regclass as t from pg_trigger g where g.tgname = 'aa_vue_groupe_lecture' loop
    execute format('drop trigger if exists aa_vue_groupe_lecture on %s', r.t);
  end loop;
end $$;
drop function if exists app.vue_groupe_poser();
drop function if exists app.vue_groupe_lecture_seule();

delete from public.schema_migrations where version = '0516_vue_groupe_lecture_seule';
