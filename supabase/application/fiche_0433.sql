-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (fiche_0433) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0433_espaces_fiche_formation.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0433_espaces_fiche_formation_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0433_espaces_fiche_formation.sql =====
-- 0433 : les espaces (client par code, entreprise avec compte, formateur et stagiaire avec compte) reçoivent aussi les
-- moyens pédagogiques (methods) et les moyens techniques (trainer_equipment) de la formation, pour que la convention
-- générée dans l'espace soit identique à celle de l'organisme (contenu, moyens, intervenant : article D6353-1).
-- Ajout de deux champs dans le bloc « courses » de client_portal_data, ent_sessions et ext_sessions, à partir des
-- versions en production. Idempotente. Retour arrière : supabase/rollback/0433_espaces_fiche_formation_retour.sql
do $do$
declare
  f text;
  d text;
  avant text := $a$'teaching_methods', co.teaching_methods$a$;
  apres text := $b$'teaching_methods', co.teaching_methods, 'methods', co.methods, 'trainer_equipment', co.trainer_equipment$b$;
begin
  foreach f in array array['public.client_portal_data(text,text)', 'public.ent_sessions()', 'public.ext_sessions()'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position($c$'methods', co.methods$c$ in d) > 0 then continue; end if;
    if (length(d) - length(replace(d, avant, ''))) / length(avant) <> 1 then raise exception 'Bloc formation introuvable dans %', f; end if;
    execute replace(d, avant, apres);
  end loop;
end
$do$;

insert into public.schema_migrations (version) values ('0433_espaces_fiche_formation') on conflict (version) do nothing;
