-- Retour arrière de 0527 : les 5 fonctions du froid reprennent la condition « status = 'completed' »,
-- puis app.session_realisee est retirée. Refusé si la règle ne vaut plus seulement « completed »
-- (de nouvelles étapes ajoutées depuis : revenir en arrière changerait le comportement).
begin;
do $$
declare
  f record; d text; n int;
begin
  if exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
              where s.nspname = 'app' and p.proname = 'session_realisee'
                and pg_get_functiondef(p.oid) not like '%array[''completed'']%') then
    raise exception 'app.session_realisee ne vaut plus seulement completed : retour arrière refusé';
  end if;
  for f in select * from (values
      ('app.froid_employeur_client(uuid,uuid)', 'app.session_realisee(se.status)', 'se.status = ''completed'''),
      ('public.froid_envois_reserver(uuid[])', 'app.session_realisee(se.status)', 'se.status = ''completed'''),
      ('app.froid_preparer_corps(uuid[],date)', 'app.session_realisee(se.status)', 'se.status = ''completed'''),
      ('public.froid_suivi()', 'app.session_realisee(se.status)', 'se.status = ''completed'''),
      ('public.portail_froid(text,uuid,text)', 'app.session_realisee(s.status)', 's.status = ''completed''')
    ) as t(sig, avant, apres)
  loop
    d := pg_get_functiondef(f.sig::regprocedure);
    n := (length(d) - length(replace(d, f.avant, ''))) / length(f.avant);
    if n <> 1 then
      raise exception 'Retour 0527 : % contient % fois « % » (attendu 1)', f.sig, n, f.avant;
    end if;
    execute replace(d, f.avant, f.apres);
  end loop;
end $$;
drop function if exists app.session_realisee(text);
delete from public.schema_migrations where version = '0527_session_realisee';
commit;
