-- 0527 (B126, partie 2) : une seule règle « session réalisée » en base, app.session_realisee(statut),
-- équivalent SQL de estRealisee() (src/core/session/realisee.js). Aujourd'hui : statut = 'completed', donc
-- comportement inchangé. Les 5 fonctions du questionnaire à froid la lisent désormais (décision de H du 25/11 :
-- le froid part dès la session réalisée). daily_maintenance n'est pas touchée : elle écrit le statut (lot suivant).
-- Méthode : chaque fonction est relue en base (pg_get_functiondef) et seule la condition sur le statut est
-- remplacée, avec contrôle du nombre de remplacements ; le reste de la définition en production est gardé tel quel.
-- Neutralité : null = 'completed' et app.session_realisee(null) valent tous deux null.
-- À appliquer seulement après la fusion (après le départ de l'auditrice le 27/11).
-- Retour arrière : supabase/rollback/0527_session_realisee_retour.sql
begin;

create or replace function app.session_realisee(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_status = any (array['completed']) $$;
revoke all on function app.session_realisee(text) from public, anon;
grant execute on function app.session_realisee(text) to authenticated;

do $$
declare
  f record; d text; n int;
begin
  for f in select * from (values
      ('app.froid_employeur_client(uuid,uuid)', 'se.status = ''completed''', 'app.session_realisee(se.status)', 1),
      ('public.froid_envois_reserver(uuid[])', 'se.status = ''completed''', 'app.session_realisee(se.status)', 1),
      ('app.froid_preparer_corps(uuid[],date)', 'se.status = ''completed''', 'app.session_realisee(se.status)', 1),
      ('public.froid_suivi()', 'se.status = ''completed''', 'app.session_realisee(se.status)', 1),
      ('public.portail_froid(text,uuid,text)', 's.status = ''completed''', 'app.session_realisee(s.status)', 1)
    ) as t(sig, avant, apres, attendu)
  loop
    d := pg_get_functiondef(f.sig::regprocedure);
    n := (length(d) - length(replace(d, f.avant, ''))) / length(f.avant);
    if n <> f.attendu then
      raise exception '0527 : % contient % fois « % » (attendu %), définition changée depuis la relecture du 25/11', f.sig, n, f.avant, f.attendu;
    end if;
    execute replace(d, f.avant, f.apres);
  end loop;
end $$;

insert into public.schema_migrations (version) values ('0527_session_realisee') on conflict (version) do nothing;
commit;
