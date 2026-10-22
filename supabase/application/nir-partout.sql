-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (nir-partout) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0441_nir_renseigne_partout.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0441_nir_renseigne_partout_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0441_nir_renseigne_partout.sql =====
-- 0441 : « n° déjà connu » juste aussi après le passage dans le Passeport (22/10). Depuis la reprise automatique,
-- un numéro saisi par l'entreprise quitte l'ancien emplacement en 15 minutes au plus : la liste des participants et
-- les salariés connus le montraient alors comme manquant. Ils lisent désormais app.nir_renseigne (fiche ou Passeport).
-- Fonctions seulement. Idempotente. Retour arrière : supabase/rollback/0441_nir_renseigne_partout_retour.sql

do $do$
declare
  f text;
  d text;
  avant text := $a$'ssn_present', coalesce(t.ssn_present, false)$a$;
  apres text := $b$'ssn_present', app.nir_renseigne(t.id)$b$;
begin
  foreach f in array array['app.participants_etat(uuid)', 'app.salaries_du_client(uuid,uuid[])'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position(avant in d) = 0 then
      if position(apres in d) > 0 then continue; end if;
      raise exception 'Lecture du n° introuvable dans %', f;
    end if;
    execute replace(d, avant, apres);
  end loop;
end
$do$;

insert into public.schema_migrations (version) values ('0441_nir_renseigne_partout') on conflict (version) do nothing;
